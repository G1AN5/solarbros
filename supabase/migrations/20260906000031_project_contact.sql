-- ============================================================================
-- 0031 · WHO IS MY ENGINEER?
-- ----------------------------------------------------------------------------
-- The customer dashboard showed "Assigned engineer:
-- 11111111-0000-4000-8000-000000000003" — a raw uuid where a person's name
-- should be. Found by looking at the portal as a customer, which no test was
-- ever going to catch: the query succeeded, the mapper had a fallback, and the
-- fallback was the id column.
--
-- The frontend fallback is fixed separately. The underlying reason the name was
-- missing is here: `profiles_read_self` limits a customer to their own profile
-- row, so joining the engineer returns nothing.
--
-- WHY NOT JUST WIDEN THE POLICY
-- Letting customers SELECT the profile rows of staff assigned to their project
-- would work, and would also hand them every engineer's email address and
-- mobile number. RLS grants rows, not columns — the same limitation that made
-- migration 0023 necessary.
--
-- A customer needs a NAME. "Your engineer is Pat Santos" is reassuring and
-- costs nothing; the mobile number is not theirs to have. So: a function that
-- returns exactly the name, for a project they own.
-- ============================================================================

create or replace function public.project_contact(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_engineer text;
  v_allowed boolean;
begin
  -- SECURITY DEFINER bypasses RLS, so the ownership check RLS would have made
  -- has to be made here. Without it this would answer for any project id.
  select exists (
    select 1 from public.projects p
    where p.id = p_project_id
      and (p.client_id = (select auth.uid()) or public.is_staff())
  ) into v_allowed;

  if not v_allowed then
    raise exception 'Not your project' using errcode = '42501';
  end if;

  select pr.full_name into v_engineer
  from public.projects p
  join public.profiles pr on pr.id = p.assigned_engineer
  where p.id = p_project_id;

  -- Only the name leaves this function. Not the email, not the phone number.
  return jsonb_build_object('engineer_name', v_engineer);
end;
$$;

revoke all on function public.project_contact(uuid) from public, anon;
grant execute on function public.project_contact(uuid) to authenticated;

comment on function public.project_contact(uuid) is
  'The engineer''s NAME for a project the caller owns. Deliberately not their contact details.';
