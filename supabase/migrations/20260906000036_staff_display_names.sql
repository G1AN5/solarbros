-- ============================================================================
-- 0036 · STAFF DISPLAY NAMES, FOR PEOPLE WHO MAY NOT READ PROFILES
-- ----------------------------------------------------------------------------
-- A customer's ticket said "Assigned to 11111111-0000-4000-8000-000000000003".
--
-- Third time this exact bug has appeared: the project engineer on the customer
-- dashboard (fixed in 0031), the ticket assignee in the admin queue (fixed with
-- a join), and now the ticket assignee in the CUSTOMER'S portal. The shape is
-- always the same — a uuid column rendered where a person's name belongs,
-- because `profiles_read_self` means a customer's join comes back empty and the
-- mapper falls through to the id.
--
-- Fixing it per-screen has not worked. This is the general answer: one function
-- that turns ids into names, for STAFF ONLY.
--
-- WHY STAFF ONLY, AND WHY THAT IS THE WHOLE SECURITY ARGUMENT
-- A customer is going to meet their engineer; the name is not a secret, and
-- withholding it while showing a uuid is worse than useless. But if this
-- resolved any profile, a signed-in customer could walk the id space and
-- enumerate every OTHER CUSTOMER by name. Restricting it to internal roles
-- makes that impossible: customer ids simply return nothing.
--
-- Names only. Not emails, not phone numbers — those stay behind
-- `profiles_read_self`, which is why a policy could not have solved this: RLS
-- grants rows, and a row carries the contact details too.
-- ============================================================================

create or replace function public.staff_display_names(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_object_agg(p.id::text, p.full_name),
    '{}'::jsonb
  )
  from public.profiles p
  where p.id = any(p_ids)
    -- Internal roles only. A customer id resolves to nothing, so this cannot
    -- be used to enumerate other customers.
    and p.role <> 'client';
$$;

revoke all on function public.staff_display_names(uuid[]) from public, anon;
grant execute on function public.staff_display_names(uuid[]) to authenticated;

comment on function public.staff_display_names(uuid[]) is
  'Maps staff ids to names for callers who cannot read profiles. Staff only, names only — a customer id returns nothing, so it cannot enumerate customers.';
