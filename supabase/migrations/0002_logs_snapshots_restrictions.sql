-- =============================================================
-- Migration 0002
-- status_log + trigger, inventory snapshots, admin notifications,
-- months.is_frozen + auto-freeze trigger, tightened RLS,
-- drop model_checklist, enable Realtime on inventory_snapshots.
-- =============================================================

-- 1) Drop unused model_checklist.
drop table if exists public.model_checklist cascade;

-- 2) Month freezing.
alter table public.months
  add column if not exists is_frozen boolean not null default false;

create or replace function public.auto_freeze_old_active_month()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and old.is_active = true and new.is_active = false then
    new.is_frozen := true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_freeze_months on public.months;
create trigger trg_auto_freeze_months
  before update on public.months
  for each row execute function public.auto_freeze_old_active_month();

-- 3) Status log table.
create table if not exists public.status_log (
  id bigint generated always as identity primary key,
  brand_checklist_id uuid references public.brand_checklist(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  month_id uuid not null references public.months(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  person_id uuid not null,
  changed_by uuid not null,
  previous_status text,
  new_status text not null,
  changed_at timestamptz not null default now()
);

create index if not exists status_log_month_idx on public.status_log(month_id, changed_at desc);
create index if not exists status_log_person_idx on public.status_log(person_id, changed_at desc);
create index if not exists status_log_brand_idx on public.status_log(brand_id, changed_at desc);
create index if not exists status_log_changed_by_idx on public.status_log(changed_by, changed_at desc);

create or replace function public.log_brand_checklist_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_month uuid;
  v_brand uuid;
  v_person uuid;
  v_changer uuid;
  v_prev text;
begin
  if tg_op = 'UPDATE' then
    if new.status is not distinct from old.status then return new; end if;
    v_prev := old.status;
  elsif tg_op = 'INSERT' then
    if new.status = 'pending' then return new; end if;
    v_prev := null;
  else
    return new;
  end if;

  select a.month_id, a.brand_id, a.person_id into v_month, v_brand, v_person
    from public.assignments a where a.id = new.assignment_id;

  v_changer := coalesce(new.updated_by, auth.uid());

  -- Log only when changer is the owner. Admin overrides NOT logged.
  if v_changer = v_person then
    insert into public.status_log(
      brand_checklist_id, assignment_id, month_id, brand_id,
      person_id, changed_by, previous_status, new_status
    ) values (
      new.id, new.assignment_id, v_month, v_brand,
      v_person, v_changer, v_prev, new.status
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_log_brand_checklist_status on public.brand_checklist;
create trigger trg_log_brand_checklist_status
  after insert or update on public.brand_checklist
  for each row execute function public.log_brand_checklist_status_change();

alter table public.status_log enable row level security;

drop policy if exists status_log_select_owner_or_admin on public.status_log;
create policy status_log_select_owner_or_admin
  on public.status_log for select to authenticated
  using (person_id = auth.uid() or public.is_admin());

-- 4) Inventory snapshots (metadata).
create table if not exists public.inventory_snapshots (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid not null references auth.users(id),
  uploaded_at timestamptz not null default now(),
  filename text,
  row_count integer not null default 0,
  notes text
);

create index if not exists inventory_snapshots_uploaded_at_idx
  on public.inventory_snapshots(uploaded_at desc);

alter table public.inventory_snapshots enable row level security;

drop policy if exists inv_snapshots_select_all on public.inventory_snapshots;
create policy inv_snapshots_select_all
  on public.inventory_snapshots for select to authenticated
  using (true);

drop policy if exists inv_snapshots_insert on public.inventory_snapshots;
create policy inv_snapshots_insert
  on public.inventory_snapshots for insert to authenticated
  with check (uploaded_by = auth.uid());

drop policy if exists inv_snapshots_delete_admin on public.inventory_snapshots;
create policy inv_snapshots_delete_admin
  on public.inventory_snapshots for delete to authenticated
  using (public.is_admin());

-- 5) Inventory rows.
create table if not exists public.inventory_rows (
  id bigint generated always as identity primary key,
  snapshot_id uuid not null references public.inventory_snapshots(id) on delete cascade,
  model text,
  brand_raw text,
  brand_normalized text,
  committed numeric,
  bucket text,
  qty numeric,
  upc text,
  mpn text,
  extra jsonb
);

create index if not exists inventory_rows_snapshot_idx on public.inventory_rows(snapshot_id);
create index if not exists inventory_rows_brand_norm_idx on public.inventory_rows(snapshot_id, brand_normalized);

alter table public.inventory_rows enable row level security;

drop policy if exists inv_rows_select_all on public.inventory_rows;
create policy inv_rows_select_all
  on public.inventory_rows for select to authenticated
  using (true);

drop policy if exists inv_rows_insert_own on public.inventory_rows;
create policy inv_rows_insert_own
  on public.inventory_rows for insert to authenticated
  with check (
    exists(select 1 from public.inventory_snapshots s
           where s.id = snapshot_id and s.uploaded_by = auth.uid())
  );

drop policy if exists inv_rows_delete_admin on public.inventory_rows;
create policy inv_rows_delete_admin
  on public.inventory_rows for delete to authenticated
  using (public.is_admin());

-- 6) Admin notifications.
create table if not exists public.admin_notifications (
  id bigint generated always as identity primary key,
  kind text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  dismissed_at timestamptz,
  dismissed_by uuid
);

create index if not exists admin_notif_active_idx
  on public.admin_notifications(created_at desc)
  where dismissed_at is null;

alter table public.admin_notifications enable row level security;

drop policy if exists admin_notif_select_admin on public.admin_notifications;
create policy admin_notif_select_admin
  on public.admin_notifications for select to authenticated
  using (public.is_admin());

drop policy if exists admin_notif_insert on public.admin_notifications;
create policy admin_notif_insert
  on public.admin_notifications for insert to authenticated
  with check (true);

drop policy if exists admin_notif_update_admin on public.admin_notifications;
create policy admin_notif_update_admin
  on public.admin_notifications for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 7) Tighten RLS on assignments + brand_checklist.
drop policy if exists assignments_select_all on public.assignments;
drop policy if exists assignments_select_owner_or_admin on public.assignments;
create policy assignments_select_owner_or_admin
  on public.assignments for select to authenticated
  using (person_id = auth.uid() or public.is_admin());

drop policy if exists bc_select_all on public.brand_checklist;
drop policy if exists bc_select_owner_or_admin on public.brand_checklist;
create policy bc_select_owner_or_admin
  on public.brand_checklist for select to authenticated
  using (
    public.is_admin()
    or exists(
      select 1 from public.assignments a
      where a.id = brand_checklist.assignment_id
        and a.person_id = auth.uid()
    )
  );

-- 8) Enable Supabase Realtime on inventory_snapshots.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inventory_snapshots'
  ) then
    execute 'alter publication supabase_realtime add table public.inventory_snapshots';
  end if;
end $$;
