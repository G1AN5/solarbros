-- ============================================================================
-- 0058  A WAY TO ACTUALLY CREATE AN ADMINISTRATOR
-- ----------------------------------------------------------------------------
-- THE GAP
-- Migration 0052 locked `profiles.role` behind a trigger and told anybody who
-- hit it:
--
--     "A role cannot be changed here. Staff roles are granted by approving a
--      registration; anything else is done in the Supabase dashboard."
--
-- The second half of that sentence was not true. The trigger fires on every
-- UPDATE from every connection, including the SQL editor, so the route it
-- names does not exist. Both 0052's own header comment and GOING-LIVE.md say
-- the first administrator is made by hand in the dashboard — and after 0052
-- there was no way to make one at all.
--
-- It went unnoticed because the only administrator was promoted BEFORE 0052
-- was applied. The defect surfaces the first time somebody needs a second one,
-- which is exactly when they are least able to work around it.
--
-- THE FIX IS A NAMED, AUDITED OPERATION — NOT A LOOSER TRIGGER
-- Weakening the trigger would give the capability back to the browser, which is
-- the whole thing 0052 exists to prevent. Instead this adds one function that
-- is unreachable from PostgREST and obvious in the audit log.
--
-- WHY THIS DOES NOT WEAKEN ANYTHING
-- Anyone who can execute this already has direct database access, and anyone
-- with direct database access can drop the trigger, alter the table or edit the
-- column however they wish. Refusing them here would not protect the system; it
-- would only leave a legitimate operation undocumented and force people into
-- ad-hoc workarounds, which is worse. The boundary that matters is "can this be
-- done from a browser session", and the answer to that is still no:
--
--   · revoked from anon, authenticated and service_role, so no PostgREST call
--     reaches it — not from a customer, not from an administrator, not with the
--     service key
--   · the GUC it sets is transaction-local and cannot be set from a request
--   · every use writes a `critical` audit row naming who was promoted
-- ============================================================================

create or replace function public.grant_admin(p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile record;
begin
  select id, email, full_name, role, approval_status
    into v_profile
  from public.profiles
  where lower(email) = lower(btrim(p_email));

  if not found then
    raise exception
      'No account exists for %. Create the user first (Authentication -> Users -> Add user), then run this again.',
      p_email
      using errcode = 'P0002';
  end if;

  if v_profile.role = 'admin' then
    return format('%s is already an administrator. Nothing to do.', v_profile.email);
  end if;

  /* A pending staff registration belongs in the approval queue, where the
     claim, the decision and the person who made it are all recorded together.
     Quietly promoting somebody out from under their own pending registration
     would leave that queue lying about what happened. */
  if v_profile.approval_status = 'pending' then
    raise exception
      '% has a staff registration awaiting approval. Deal with it in Roles & access first, or refuse it, then run this again.',
      v_profile.email
      using errcode = '22023';
  end if;

  /* The same transaction-local switch `approve_staff` uses. `set local` means
     it lasts for this statement's transaction only, and a GUC set inside a
     SECURITY DEFINER function cannot be reached from a PostgREST request, so
     this is not a door the browser can open. */
  perform set_config('solarbros.role_change_approved', 'yes', true);

  update public.profiles
  set role = 'admin',
      is_active = true,
      -- A dashboard-made administrator never went through the queue, so leave
      -- no half-filled approval state behind to confuse the governance screen.
      requested_role = null,
      approval_status = null,
      rejection_reason = null
  where id = v_profile.id;

  /* Severity 'critical' deliberately. Creating an administrator is the single
     most consequential change anybody can make to this system, and it happens
     outside the application where nobody is watching a screen. */
  insert into public.audit_log (actor_name, action, entity, entity_id, severity, metadata)
  values (
    'Supabase SQL editor',
    'grant_admin',
    'profiles',
    v_profile.id::text,
    'critical',
    jsonb_build_object(
      'email', v_profile.email,
      'full_name', v_profile.full_name,
      'previous_role', v_profile.role,
      'granted_role', 'admin',
      'route', 'direct database access'
    )
  );

  return format(
    '%s is now an administrator (was %s). Recorded in the audit log.',
    v_profile.email,
    v_profile.role
  );
end;
$$;

-- The point of the whole exercise. Nothing that speaks PostgREST may call this,
-- including a signed-in administrator and including the service key.
revoke all on function public.grant_admin(text) from public, anon, authenticated, service_role;

comment on function public.grant_admin(text) is
  'Promotes an existing account to administrator. Callable only with direct database access (the Supabase SQL editor), never from the API. Writes a critical audit row.';


-- ----------------------------------------------------------------------------
-- Point the trigger at the route that now exists
-- ----------------------------------------------------------------------------
-- The old message sent people to "the Supabase dashboard" and left them to
-- guess. An error that names the exact command to run costs nothing and saves
-- the next person the half hour this one cost.

create or replace function public.enforce_role_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role then
    /* `public.approve_staff` and `public.grant_admin` set this for the duration
       of their transaction. Nothing else can: a GUC set by a SECURITY DEFINER
       function is not reachable from a PostgREST request, so there is no way to
       fake it from the browser. */
    if coalesce(current_setting('solarbros.role_change_approved', true), '') <> 'yes' then
      -- ONLY the wording changes here. The rule is identical.
      raise exception
        'A role cannot be changed here. Staff roles are granted by approving a registration in Roles & access. To create an administrator, run this in the Supabase SQL editor: select public.grant_admin(''%'');',
        new.email
        using errcode = '42501';
    end if;
  end if;

  /* Nobody may promote themselves, under any circumstances, by any route.
     REPRODUCED VERBATIM from 0052. It is a separate rule from the one above —
     it still applies when the GUC IS set, which is what stops an administrator
     calling an approval path on their own account. `auth.uid()` is null over a
     direct database connection, so this correctly does not obstruct
     grant_admin from the SQL editor. */
  if new.role is distinct from old.role and new.id = (select auth.uid()) then
    raise exception 'You cannot change your own role.' using errcode = '42501';
  end if;

  return new;
end;
$$;
