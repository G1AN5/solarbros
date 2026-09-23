-- ============================================================================
-- 0052  STAFF APPROVAL, AND ROLES THAT CANNOT BE TOGGLED
-- ----------------------------------------------------------------------------
-- Three changes to how somebody gets a role, all pulling the same direction:
-- a role should be hard to acquire, impossible to acquire by accident, and
-- never changeable by a stray click.
--
-- 1. STAFF REGISTER THEMSELVES, AND CLAIM A ROLE THEY DO NOT YET HAVE.
--    The claim is stored in `requested_role`. It grants nothing. The account is
--    created INACTIVE, which — because of migration 0016 — means
--    `current_user_role()` returns NULL and every staff policy across all 39
--    tables denies. A pending staff member can read their own profile row and
--    nothing else in the system.
--
-- 2. AN ADMINISTRATOR APPROVES THE CLAIM, OR REJECTS IT.
--    Approval is the ONLY path by which `profiles.role` may change. Not a
--    dropdown, not an UPDATE, not an administrator who meant to click the row
--    below. `enforce_role_immutability` refuses every other route.
--
-- 3. A CUSTOMER IS A CUSTOMER FOREVER.
--    `role` cannot move off 'client' at all, including by an administrator,
--    because a customer never has a pending approval to be approved. The
--    protection is structural rather than a rule somebody has to remember.
--
-- WHY THE ROLE COLUMN IS LOCKED RATHER THAN JUST UNGATED IN THE UI
-- Removing the dropdown removes the accident. It does not remove the capability
-- — `profiles_admin_all` still grants an administrator UPDATE on every profile,
-- so a crafted request, or the next screen somebody builds, could still do it.
-- The trigger is what makes "roles are not toggled here" true rather than
-- merely current.
--
-- 'admin' CANNOT BE SELF-REQUESTED.
-- The first administrator is created by hand in the Supabase dashboard, and
-- every later one the same way. An approval queue that can mint administrators
-- is a queue worth attacking; this one can only mint the five working roles.
-- ============================================================================


create type public.staff_approval as enum ('pending', 'approved', 'rejected');

alter table public.profiles
  add column if not exists requested_role public.user_role,
  add column if not exists approval_status public.staff_approval,
  add column if not exists approved_by uuid references public.profiles (id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists rejection_reason text;

comment on column public.profiles.requested_role is
  'The role this person says the company assigned them. A claim, not a grant — it confers nothing until an administrator approves it.';
comment on column public.profiles.approval_status is
  'NULL for an ordinary customer, who needs no approval. Set only on staff self-registration.';

create index if not exists profiles_pending_idx on public.profiles (created_at)
  where approval_status = 'pending';


-- ----------------------------------------------------------------------------
-- 1. Registration reads the claim, and grants nothing
-- ----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim text := new.raw_user_meta_data ->> 'requested_role';
  v_role public.user_role;
begin
  /* The claim is validated against the enum and against a whitelist. Anything
     else — including 'admin', including nonsense — is ignored entirely and the
     account is created as an ordinary customer.

     NOTE what is NOT happening: `role` is never read from user metadata. That
     value arrives from the browser at signup, so treating it as the role would
     let anybody mint themselves an administrator account by editing a request. */
  if v_claim in ('sales', 'project_engineer', 'inventory_manager', 'accountant', 'technician') then
    v_role := v_claim::public.user_role;

    insert into public.profiles (
      id, full_name, email, phone, role, is_active, requested_role, approval_status
    )
    values (
      new.id,
      coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
      new.email,
      new.raw_user_meta_data ->> 'phone',
      -- Parked on the least-privileged role in the system. It is not the role
      -- they asked for, and is_active = false means it grants nothing either.
      'client',
      false,
      v_role,
      'pending'
    )
    on conflict (id) do nothing;
  else
    insert into public.profiles (id, full_name, email, phone)
    values (
      new.id,
      coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
      new.email,
      new.raw_user_meta_data ->> 'phone'
    )
    on conflict (id) do nothing;
  end if;

  return new;
end;
$$;


-- ----------------------------------------------------------------------------
-- 2. The role column is sealed
-- ----------------------------------------------------------------------------

create or replace function public.enforce_role_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role then
    /* `public.approve_staff` sets this for the duration of its transaction.
       Nothing else can: a GUC set by a SECURITY DEFINER function is not
       reachable from a PostgREST request, so there is no way to fake it from
       the browser. */
    if coalesce(current_setting('solarbros.role_change_approved', true), '') <> 'yes' then
      raise exception
        'A role cannot be changed here. Staff roles are granted by approving a registration; anything else is done in the Supabase dashboard.'
        using errcode = '42501';
    end if;
  end if;

  /* Nobody may promote themselves, under any circumstances, by any route. */
  if new.role is distinct from old.role and new.id = (select auth.uid()) then
    raise exception 'You cannot change your own role.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_role_immutability on public.profiles;

create trigger enforce_role_immutability
  before update on public.profiles
  for each row execute function public.enforce_role_immutability();

revoke all on function public.enforce_role_immutability() from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 3. Approving, or refusing, a registration
-- ----------------------------------------------------------------------------

create or replace function public.approve_staff(
  p_user_id uuid,
  p_approve boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile record;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator may approve a staff registration.'
      using errcode = '42501';
  end if;

  if p_user_id = (select auth.uid()) then
    raise exception 'You cannot approve your own registration.' using errcode = '42501';
  end if;

  select id, email, full_name, requested_role, approval_status
    into v_profile
  from public.profiles
  where id = p_user_id;

  if not found then
    raise exception 'No such account.' using errcode = 'P0002';
  end if;

  if v_profile.approval_status is distinct from 'pending' then
    raise exception 'That registration has already been dealt with.' using errcode = '22023';
  end if;

  if p_approve then
    if v_profile.requested_role is null then
      raise exception 'That registration did not name a role.' using errcode = '22023';
    end if;

    -- Opens the one door the immutability trigger will accept, for this
    -- statement only.
    perform set_config('solarbros.role_change_approved', 'yes', true);

    update public.profiles
    set role = requested_role,
        is_active = true,
        approval_status = 'approved',
        approved_by = (select auth.uid()),
        approved_at = now(),
        rejection_reason = null
    where id = p_user_id;

    perform set_config('solarbros.role_change_approved', '', true);

    perform public.write_audit(
      'staff_registration_approved', 'profiles', p_user_id::text, 'warning',
      jsonb_build_object('email', v_profile.email, 'role', v_profile.requested_role)
    );

    insert into public.notifications (user_id, title, body, channel, category, entity, entity_id)
    values (
      p_user_id,
      'Your staff account has been approved',
      'You can now sign in at the staff portal.',
      'in_app', 'account', 'profiles', p_user_id::text
    );
  else
    /* Rejected accounts stay inactive rather than being deleted. The person
       may have simply picked the wrong role, and a row that says why is more
       use to whoever they ring than a missing account. */
    update public.profiles
    set approval_status = 'rejected',
        is_active = false,
        approved_by = (select auth.uid()),
        approved_at = now(),
        rejection_reason = nullif(btrim(coalesce(p_reason, '')), '')
    where id = p_user_id;

    perform public.write_audit(
      'staff_registration_rejected', 'profiles', p_user_id::text, 'warning',
      jsonb_build_object('email', v_profile.email, 'claimed_role', v_profile.requested_role)
    );
  end if;
end;
$$;

revoke all on function public.approve_staff(uuid, boolean, text) from public, anon;
grant execute on function public.approve_staff(uuid, boolean, text) to authenticated;

comment on function public.approve_staff(uuid, boolean, text) is
  'The only path by which profiles.role may change. Administrator only, never on your own account, and only from a pending registration.';
