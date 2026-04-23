# Brand Audit v4

Cloud rebuild of the single-file Brand Audit Manager. Three users, three tabs,
one Supabase Postgres behind RLS.

Stack: Vite + React 19 + Supabase (Auth + Postgres) + SheetJS for XLSX.
Deployed on Vercel.

## Setup (one time)

### 1. Create a new Supabase project
1. Go to <https://supabase.com/dashboard> → **New project**.
2. Pick a strong DB password, wait for it to finish provisioning.
3. Open **SQL Editor** → paste the contents of `supabase/migrations/0001_init.sql` → **Run**.
   This creates the schema, RLS policies, seeds the default brand list, and
   auto-promotes `jacobdaboss6@gmail.com` to admin on first sign-in.

### 2. Grab your Supabase keys
Project Settings → **API**:
- **Project URL** → `VITE_SUPABASE_URL`
- **anon public** key → `VITE_SUPABASE_ANON_KEY`

### 3. Auth redirect URLs (magic links need this)
Authentication → **URL Configuration**:
- **Site URL**: your Vercel production URL (e.g. `https://brand-audit.vercel.app`)
- **Redirect URLs**: add both `http://localhost:5173` and your Vercel URL.

If you want signups without "Confirm email" friction, go to
Authentication → **Providers** → **Email** and turn *off* "Confirm email".
(Not a big deal either way — the link still works.)

### 4. Run locally
```bash
cp .env.local.example .env.local   # then fill in the two values
npm install
npm run dev
```
Open http://localhost:5173. Sign up with `jacobdaboss6@gmail.com` to become admin.

### 5. Deploy to Vercel
This repo is already connected to Vercel. On the project settings page:
1. Settings → **Environment Variables** → add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` (Production + Preview).
2. Push to `main`, or run `npx vercel --prod` from this folder.

## How roles work

- Every signed-in user has a row in `profiles`.
- `role` is `member` by default; the seed admin (`jacobdaboss6@gmail.com`)
  is promoted automatically on first sign-in.
- Admins can use the **Randomize** tab to create months and assign brands,
  edit the master brand list, and promote/demote members from the
  **Admin** chip in the top-right.
- Members can only update checklist rows on their own assignments — the
  DB enforces this via RLS, not just UI.

## How reconciliation works

When you upload an inventory file on the **Audit** tab, it parses client-side
and looks for rows matching your assigned brands (by normalized name). For
each brand you own, it:

- Inserts new `model_checklist` rows for models you haven't seen.
- Keeps existing rows intact (both status and notes).
- Deletes rows whose status is still `pending` if the model no longer
  appears in the inventory. Touched rows (in_progress / done / skipped)
  are kept so you never lose audit history.

The raw Excel file never leaves the browser.
