-- ============================================================================
-- 0059  THE SAME DOOR, FOR THE OTHER FIVE ROLES
-- ----------------------------------------------------------------------------
-- 0058 gave administrators a named, audited route that works over a direct
-- database connection. The five working roles still had only one route: a
-- person registers at /staff/register, confirms their email, and an
-- administrator approves the claim.
--
-- That flow is right for a real hire and stays exactly as it is. It is wrong
-- for two situations that happen anyway:
--
--   SETTING THE TEAM UP. Supabase's built-in email sender allows roughly two
--   messages an hour. Registering five staff accounts means waiting most of an
--   afternoon on confirmation emails before anybody can do anything — while
--   creating the users in the dashboard with "Auto Confirm User" sends no email
--   at all. What was missing was a way to then give those accounts their role.
--
--   CORRECTING A ROLE AFTER APPROVAL. A technician who becomes a project
--   engineer had no path at all: roles cannot be toggled in the application by
--   design, and the approval queue only handles a registration once.
--
-- WHY THIS DOES NOT REOPEN WHAT 0052 CLOSED
-- The rule 0052 enforces is "a role cannot be granted from a browser session".
-- That rule is untouched. Like `grant_admin`, this function is revoked from
-- anon, authenticated and service_role, so no PostgREST request reaches it
-- however the caller is signed in — not a customer, not an administrator, not
-- the service key. Inside the application the approval queue remains the only
-- route, with no dropdown and no toggle.
--
-- What this adds is a documented way to do the thing the owner was always
-- expected to do from the Supabase dashboard. The alternative was not "nobody
-- can do this" — it was people pasting `set_config` and a raw UPDATE from a
-- comment in a gitignored file, with no validation and no audit trail.
-- ============================================================================

create or replace function public.grant_staff_role(p_email text, p_role text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile record;
begin
  /* The same five roles the registration form offers. 'admin' is excluded so
     there is exactly ONE function that mints administrators and exactly one
     audit action to look for; 'client' is excluded because a customer is not a
     staff role and demoting somebody into the customer portal would silently
     hand them a different application. */
  if p_role not in ('sales', 'project_engineer', 'inventory_manager', 'accountant', 'technician') then
    raise exception
      '% is not a staff role. Use one of sales, project_engineer, inventory_manager, accountant, technician. For an administrator use grant_admin(email); a customer account cannot be converted.',
      p_role
      using errcode = '22023';
  end if;

  select id, email, full_name, role, approval_status
    into v_profile
  from public.profiles
  where lower(email) = lower(btrim(p_email));

  if not found then
    raise exception
      'No account exists for %. Create the user first (Authentication -> Users -> Add user, ticking "Auto Confirm User"), then run this again.',
      p_email
      using errcode = 'P0002';
  end if;

  if v_profile.role::text = p_role then
    return format('%s is already %s. Nothing to do.', v_profile.email, p_role);
  end if;

  /* A registration still sitting in the queue belongs to the queue. Granting
     the role behind its back would leave the governance screen showing a
     pending decision that no longer means anything, and the audit trail would
     record an approval that never happened. */
  if v_profile.approval_status = 'pending' then
    raise exception
      '% has a registration awaiting approval. Approve it in Roles & access — that route records who decided and what was claimed.',
      v_profile.email
      using errcode = '22023';
  end if;

  perform set_config('solarbros.role_change_approved', 'yes', true);

  update public.profiles
  set role = p_role::public.user_role,
      is_active = true,
      requested_role = null,
      approval_status = null,
      rejection_reason = null
  where id = v_profile.id;

  insert into public.audit_log (actor_name, action, entity, entity_id, severity, metadata)
  values (
    'Supabase SQL editor',
    'grant_staff_role',
    'profiles',
    v_profile.id::text,
    'critical',
    jsonb_build_object(
      'email', v_profile.email,
      'full_name', v_profile.full_name,
      'previous_role', v_profile.role,
      'granted_role', p_role,
      'route', 'direct database access'
    )
  );

  return format(
    '%s is now %s (was %s). Recorded in the audit log.',
    v_profile.email,
    p_role,
    v_profile.role
  );
end;
$$;

revoke all on function public.grant_staff_role(text, text) from public, anon, authenticated, service_role;

comment on function public.grant_staff_role(text, text) is
  'Sets an existing account to one of the five staff roles. Callable only with direct database access (the Supabase SQL editor), never from the API. Writes a critical audit row. The in-app route remains the approval queue.';
