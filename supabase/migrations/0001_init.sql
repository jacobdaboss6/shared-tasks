-- ===========================================================================
-- Brand Audit Manager v4 — initial schema
--
-- Paste this whole file into the Supabase SQL Editor and run it once after
-- creating the project. It is idempotent where possible; re-running on a
-- fresh database is safe.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- EXTENSIONS
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- PROFILES
--   Mirrors auth.users. A trigger below creates one row per new auth user.
--   Auto-promotes jacobdaboss6@gmail.com to admin on first sign-in.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null unique,
  display_name text,
  role         text not null default 'member' check (role in ('admin','member')),
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- ---------------------------------------------------------------------------
-- is_admin() helper — SECURITY DEFINER so RLS policies can call it without
-- recursing back through their own policies on `profiles`. Defined AFTER
-- profiles so function-body validation can resolve the table.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = uid and p.role = 'admin'
  );
$$;

grant execute on function public.is_admin(uuid) to authenticated;

drop policy if exists profiles_select_all on public.profiles;
create policy profiles_select_all on public.profiles
  for select to authenticated
  using (true);

drop policy if exists profiles_update_self_or_admin on public.profiles;
create policy profiles_update_self_or_admin on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (
    id = auth.uid() or public.is_admin()
  );

-- Trigger: create a profile row on new auth user.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_seed_admin boolean := new.email = 'jacobdaboss6@gmail.com';
begin
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    split_part(new.email, '@', 1),
    case when is_seed_admin then 'admin' else 'member' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_auth_user();

-- Safety net: if the seed admin already exists, make sure they're admin.
-- (Useful if you ran this migration *after* signing up.)
update public.profiles
   set role = 'admin'
 where email = 'jacobdaboss6@gmail.com';

-- ---------------------------------------------------------------------------
-- BRANDS
--   name is the human form; normalized is the comparable form (lowercase,
--   alphanumeric only). Normalized has a unique index so reconciliation and
--   dedup queries are O(1).
-- ---------------------------------------------------------------------------
create table if not exists public.brands (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  normalized text generated always as (
    regexp_replace(lower(name), '[^a-z0-9]', '', 'g')
  ) stored,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists brands_name_unique on public.brands (lower(name));
create unique index if not exists brands_normalized_unique on public.brands (normalized);

alter table public.brands enable row level security;

drop policy if exists brands_select_all on public.brands;
create policy brands_select_all on public.brands
  for select to authenticated using (true);

drop policy if exists brands_admin_insert on public.brands;
create policy brands_admin_insert on public.brands
  for insert to authenticated with check (public.is_admin());

drop policy if exists brands_admin_update on public.brands;
create policy brands_admin_update on public.brands
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists brands_admin_delete on public.brands;
create policy brands_admin_delete on public.brands
  for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- MONTHS
--   One "is_active" month at a time; enforced by a partial unique index.
-- ---------------------------------------------------------------------------
create table if not exists public.months (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  month_num  int  not null check (month_num between 1 and 12),
  year       int  not null check (year between 2000 and 2100),
  is_active  boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists months_only_one_active
  on public.months (is_active)
  where is_active = true;

alter table public.months enable row level security;

drop policy if exists months_select_all on public.months;
create policy months_select_all on public.months
  for select to authenticated using (true);

drop policy if exists months_admin_write on public.months;
create policy months_admin_write on public.months
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- ASSIGNMENTS
--   One row per (month, brand). person_id owns the brand for that month.
-- ---------------------------------------------------------------------------
create table if not exists public.assignments (
  id         uuid primary key default gen_random_uuid(),
  month_id   uuid not null references public.months(id)   on delete cascade,
  person_id  uuid not null references public.profiles(id) on delete cascade,
  brand_id   uuid not null references public.brands(id)   on delete cascade,
  position   int  not null default 0,
  created_at timestamptz not null default now(),
  unique (month_id, brand_id)
);

create index if not exists assignments_month_person on public.assignments (month_id, person_id);

alter table public.assignments enable row level security;

drop policy if exists assignments_select_all on public.assignments;
create policy assignments_select_all on public.assignments
  for select to authenticated using (true);

drop policy if exists assignments_admin_write on public.assignments;
create policy assignments_admin_write on public.assignments
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- BRAND_CHECKLIST
--   One row per assignment. The owner (person_id on the assignment) can
--   update their own row; admins can update anything.
-- ---------------------------------------------------------------------------
create table if not exists public.brand_checklist (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null unique references public.assignments(id) on delete cascade,
  status        text not null default 'pending'
                 check (status in ('pending','in_progress','done','skipped')),
  notes         text,
  updated_by    uuid references public.profiles(id) on delete set null,
  updated_at    timestamptz not null default now()
);

alter table public.brand_checklist enable row level security;

drop policy if exists bc_select_all on public.brand_checklist;
create policy bc_select_all on public.brand_checklist
  for select to authenticated using (true);

drop policy if exists bc_write_owner_or_admin on public.brand_checklist;
create policy bc_write_owner_or_admin on public.brand_checklist
  for all to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.assignments a
      where a.id = brand_checklist.assignment_id and a.person_id = auth.uid()
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1 from public.assignments a
      where a.id = brand_checklist.assignment_id and a.person_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- MODEL_CHECKLIST
--   One row per (assignment, normalized_model). Populated from inventory
--   uploads; preserved across re-uploads so touched rows keep their state.
-- ---------------------------------------------------------------------------
create table if not exists public.model_checklist (
  id               uuid primary key default gen_random_uuid(),
  assignment_id    uuid not null references public.assignments(id) on delete cascade,
  model            text not null,
  normalized_model text generated always as (
    regexp_replace(lower(model), '[^a-z0-9]', '', 'g')
  ) stored,
  status           text not null default 'pending'
                   check (status in ('pending','in_progress','done','skipped')),
  notes            text,
  updated_by       uuid references public.profiles(id) on delete set null,
  updated_at       timestamptz not null default now(),
  unique (assignment_id, normalized_model)
);

create index if not exists mc_assignment on public.model_checklist (assignment_id);

alter table public.model_checklist enable row level security;

drop policy if exists mc_select_all on public.model_checklist;
create policy mc_select_all on public.model_checklist
  for select to authenticated using (true);

drop policy if exists mc_write_owner_or_admin on public.model_checklist;
create policy mc_write_owner_or_admin on public.model_checklist
  for all to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.assignments a
      where a.id = model_checklist.assignment_id and a.person_id = auth.uid()
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1 from public.assignments a
      where a.id = model_checklist.assignment_id and a.person_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- TOUCH updated_at on any row change
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists bc_touch on public.brand_checklist;
create trigger bc_touch before update on public.brand_checklist
  for each row execute function public.touch_updated_at();

drop trigger if exists mc_touch on public.model_checklist;
create trigger mc_touch before update on public.model_checklist
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- SEED — default brand list from v3. Safe to re-run; uses ON CONFLICT.
-- ---------------------------------------------------------------------------
insert into public.brands (name) values
  ('3P Solutions'),('Access Networks'),('AIR TV'),('Altec Lansing'),('Amber Protection'),
  ('AMBISONIC'),('AMERICAN LIGHTING'),('Antop'),('APC'),('ARAKNIS'),
  ('Audio Technica'),('AudioQuest'),('Austere'),('AVF'),('AVPRO'),
  ('BINARY'),('Bosch'),('BOSE'),('Bowers Wilkins'),('BULLET TRAIN'),
  ('CAFE'),('Cary Audio'),('CATALYST AV'),('Channel Master'),('CHIEF'),
  ('CLEER'),('CLEERLINE'),('CONTROL4'),('Cool Components'),('Cuisinart'),
  ('Definitive Technology'),('DENON'),('DIAMOND'),('DIRECTV'),('Ecobee'),
  ('EERO'),('ELAC'),('Elite Screens'),('Enclave'),('EPIC'),
  ('EPISODE'),('ErgoAV'),('Ethereal'),('Frame My TV'),('Frigidaire'),
  ('Furrion'),('FX Luminaire'),('GE Appliances'),('GE PROFILE'),('Gemini'),
  ('GOOGLE'),('Harman-Kardon'),('Hisense'),('HOTPOINT'),('Installation Nation'),
  ('JBL'),('Juke Audio'),('JVC'),('Kanto'),('KEF'),
  ('KLH'),('KLIPSCH'),('Labor'),('LEGENDS FURNITURE'),('LEGRAND'),
  ('Leica'),('LEON'),('LG'),('LG Appliances'),('LILIN'),
  ('Logitech'),('Luma Surveillance'),('Lutron'),('LUXUL'),('MACKIE'),
  ('Marantz'),('Mid Atlantic'),('Misc'),('MITSUBISHI'),('MONOGRAM'),
  ('MONSTER'),('Mount-It'),('Neptune'),('NEST'),('Netgear'),
  ('NXG'),('OLYMPUS'),('OneForAll'),('ONKYO'),('ONQ'),
  ('ORIGIN ACOUSTICS'),('PAKEDGE'),('PANAMAX'),('PANASONIC'),('Peerless-AV'),
  ('PHILIPS'),('PIONEER'),('PIONEER ELITE'),('PLANET 3'),('Platin Audio'),
  ('POLK AUDIO'),('POWER BRIDGE'),('Pro-Ject'),('Pro-Ject Audio Systems'),('Pulse8'),
  ('Quest Technology International Inc.'),('RCA'),('RING'),('ROKU'),('RowOne'),
  ('RUCKUS'),('Salamander'),('SAMSUNG'),('Samsung Appliances'),('SANUS SYSTEMS'),
  ('Secura'),('SHARP'),('SHELLY'),('SKYWORTH'),('Snap AV'),
  ('SONOS'),('SONOS BUNDLE CREDIT'),('SONY'),('SteelSeries'),('STRONG'),
  ('TCL'),('TRIAD'),('UMBIQUITI'),('VANCO'),('Victrola'),
  ('VIZIO'),('WALTS TV'),('WattBox'),('Western Digital'),('Westinghouse'),
  ('Wirepath'),('WiSA'),('YAMAHA')
on conflict (normalized) do nothing;

-- ===========================================================================
-- Done. Sign up with your email (jacobdaboss6@gmail.com) and you'll be admin.
-- ===========================================================================
