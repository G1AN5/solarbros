-- ============================================================================
-- 0053  RESTORE THE PROSPECT LINKING THAT 0052 DESTROYED
-- ----------------------------------------------------------------------------
-- Migration 0052 rewrote `handle_new_user` to read a staff role claim. It was
-- written against the version in migration 0001 — and migration 0033 had
-- already replaced that function with a much larger one that connects a newly
-- registered customer to everything raised under their email address before
-- they had an account: their leads, the contract waiting for their signature,
-- the project, its invoices and its appointments.
--
-- All of that was silently lost. Nothing failed, because nothing in the
-- database referred to it — the function simply stopped doing two thirds of its
-- job. `npm run verify:onboarding` caught it, on the four checks that follow a
-- prospect through to signing their contract.
--
-- That is precisely the failure this project has been warning itself about:
-- "a quick fix that quietly rewrites a security-definer function is how a rule
-- gets lost", written into migration 0042 three weeks ago by the same hand that
-- then did it anyway. The lesson is not "be careful"; it is that a function
-- redefined in a later migration must be rebuilt from THAT migration, never
-- from the original, and that only a test which follows a whole journey will
-- notice when it is not.
--
-- This restores 0033's body verbatim and adds the 0052 role claim to it.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(new.email));
  v_reference text := nullif(trim(new.raw_user_meta_data ->> 'project_reference'), '');
  v_claim text := new.raw_user_meta_data ->> 'requested_role';
begin
  /* --- STAFF REGISTRATION (migration 0052) ------------------------------
     A claimed role grants nothing. The account is parked on the least
     privileged role and INACTIVE, so `current_user_role()` returns NULL and
     every staff policy denies until an administrator approves it.

     Validated against a whitelist: anything else, including 'admin' and
     including nonsense, is ignored and the person is treated as a customer.
     `role` is NEVER read from user metadata — that object came from the
     browser, so trusting it would let anybody mint an administrator. */
  if v_claim in ('sales', 'project_engineer', 'inventory_manager', 'accountant', 'technician') then
    insert into public.profiles (
      id, full_name, email, phone, role, is_active, requested_role, approval_status
    )
    values (
      new.id,
      coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
      new.email,
      new.raw_user_meta_data ->> 'phone',
      'client',
      false,
      v_claim::public.user_role,
      'pending'
    )
    on conflict (id) do nothing;

    /* Deliberately returns here. A member of staff registering must NOT pick up
       customer records that happen to share their email address — an employee
       who was once a customer would otherwise arrive holding their own project,
       which is a conflict of interest the database should not create for them. */
    return new;
  end if;

  /* --- CUSTOMER REGISTRATION -------------------------------------------- */
  insert into public.profiles (id, full_name, email, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data ->> 'phone'
  )
  on conflict (id) do nothing;

  /* --- Claim the leads raised under this email -------------------------- */
  update public.leads
  set converted_client_id = new.id
  where lower(email) = v_email
    and converted_client_id is null;

  /* --- Contracts waiting for them ---------------------------------------
     Only through a lead that carries their email. A contract is never claimed
     by reference alone. */
  update public.contracts c
  set client_id = new.id
  where c.client_id is null
    and exists (
      select 1 from public.leads l
      where l.id = c.lead_id and lower(l.email) = v_email
    );

  /* --- Projects, and everything hanging off them ------------------------- */
  update public.projects p
  set client_id = new.id
  where p.client_id is null
    and exists (
      select 1
      from public.contracts c
      join public.leads l on l.id = c.lead_id
      where c.id = p.contract_id and lower(l.email) = v_email
    );

  /* A reference typed at registration only narrows what is already theirs by
     email — it never widens it. Kept because a customer who has been quoted
     twice should land on the project they meant. */
  if v_reference is not null then
    update public.projects p
    set client_id = new.id
    where p.reference = v_reference
      and p.client_id is null
      and exists (
        select 1
        from public.contracts c
        join public.leads l on l.id = c.lead_id
        where c.id = p.contract_id and lower(l.email) = v_email
      );
  end if;

  /* Invoices and appointments carry their own client_id so the portal can read
     them without joining through the project every time. Bring them along. */
  update public.invoices i
  set client_id = new.id
  where i.client_id is null
    and exists (
      select 1 from public.projects p
      where p.id = i.project_id and p.client_id = new.id
    );

  update public.appointments a
  set client_id = new.id
  where a.client_id is null
    and exists (
      select 1 from public.leads l
      where l.id = a.lead_id and lower(l.email) = v_email
    );

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

comment on function public.handle_new_user() is
  'Creates the profile for a new account. A customer picks up everything raised under their email; a staff registrant picks up a pending role claim and nothing else.';
