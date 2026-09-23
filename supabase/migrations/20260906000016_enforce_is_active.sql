-- ============================================================================
-- 0016 · MAKE DEACTIVATION ACTUALLY REVOKE ACCESS
-- ----------------------------------------------------------------------------
-- THE GAP
-- `profiles.is_active` existed from migration 0001 and the governance screen
-- displayed it, but nothing in the database consulted it. Setting a staff
-- member to inactive changed a boolean and nothing else: they kept their
-- session, kept their role, and kept full access to every module their role
-- allowed.
--
-- That is the worst kind of security control — one that looks like it works.
-- An administrator would deactivate a departing employee, see the row update,
-- and reasonably believe access had been withdrawn.
--
-- HOW IT WAS FOUND
-- scripts/verify-staff-admin.mjs deactivates its probe account at the end of
-- each run, and the account carried on working. Nothing in the type-checker,
-- linter or test suite would ever have noticed.
--
-- THE FIX
-- The role helper functions are the chokepoint: every policy in 0007 resolves
-- permissions through them. Requiring `is_active` there withdraws access across
-- all 39 tables at once, with no policy rewrites.
--
-- WHAT DEACTIVATION NOW MEANS
--   * is_staff(), is_internal(), is_admin(), has_role() all return false
--   * every staff-scoped policy therefore denies
--   * the user can still sign in and read their own profile row, which is
--     deliberate: a blank screen with their name on it is clearer than a login
--     form that rejects a correct password with no explanation
--
-- LIMITATION, STATED PLAINLY
-- An existing JWT stays valid until it expires (one hour by default), so
-- deactivation takes effect within the hour rather than instantly. For an
-- immediate lockout, also revoke the user's sessions from the Supabase
-- dashboard under Authentication → Users.
-- ============================================================================

-- current_user_role() now returns NULL for a deactivated account. Every helper
-- below is built on it, so they all fail closed together.
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role
  from public.profiles
  where id = (select auth.uid())
    and is_active;
$$;

comment on function public.current_user_role is
  'Role of the calling user, or NULL if their account is deactivated. Read server-side; never trust a role sent by the browser.';

-- `coalesce(... , false)` in each helper already turns that NULL into false, so
-- they need no change. Redefined here anyway so the whole access model can be
-- read in one file rather than inferred across two migrations.

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.current_user_role() in (
      'sales', 'project_engineer', 'inventory_manager', 'accountant', 'admin'
    ),
    false
  );
$$;

create or replace function public.is_internal()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_user_role() <> 'client', false);
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_user_role() = 'admin', false);
$$;

create or replace function public.has_role(variadic roles public.user_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_user_role() = any (roles), false);
$$;

-- A deactivated client must not keep reading their own project either. These
-- helpers gate the client-facing policies, so they get the same treatment.
create or replace function public.owns_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects p
    join public.profiles pr on pr.id = (select auth.uid())
    where p.id = p_project_id
      and p.client_id = (select auth.uid())
      and pr.is_active
  );
$$;

create or replace function public.is_crew_on_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_crew c
    join public.profiles pr on pr.id = c.user_id
    where c.project_id = p_project_id
      and c.user_id = (select auth.uid())
      and pr.is_active
  );
$$;

create or replace function public.is_assigned_to_appointment(p_appointment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.appointment_assignees a
    join public.profiles pr on pr.id = a.user_id
    where a.appointment_id = p_appointment_id
      and a.user_id = (select auth.uid())
      and pr.is_active
  );
$$;

-- `create or replace` resets privileges to the default, so the grants from
-- migration 0009 must be re-applied. Without this every policy that calls one
-- of these fails with "permission denied for function" and the entire
-- application locks up for signed-in users.
revoke all on function public.current_user_role() from public, anon;
revoke all on function public.is_staff() from public, anon;
revoke all on function public.is_internal() from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.has_role(public.user_role[]) from public, anon;
revoke all on function public.owns_project(uuid) from public, anon;
revoke all on function public.is_crew_on_project(uuid) from public, anon;
revoke all on function public.is_assigned_to_appointment(uuid) from public, anon;

grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_internal() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.has_role(public.user_role[]) to authenticated;
grant execute on function public.owns_project(uuid) to authenticated;
grant execute on function public.is_crew_on_project(uuid) to authenticated;
grant execute on function public.is_assigned_to_appointment(uuid) to authenticated;

-- Tidy up the probe accounts left behind by verify-staff-admin.mjs. The Edge
-- Function deliberately cannot delete users, so this is the sanctioned place.
delete from auth.users where email like 'probe-engineer-%@demo.solarbros.ph';
