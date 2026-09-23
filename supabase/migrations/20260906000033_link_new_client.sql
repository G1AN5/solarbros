-- ============================================================================
-- 0033 · LINKING A NEW ACCOUNT TO THE WORK ALREADY DONE FOR IT
-- ----------------------------------------------------------------------------
-- THE MISSING LINK IN THE WHOLE FLOW.
--
-- A prospect submits the estimator, sales quotes them, a contract is raised.
-- Then they register a portal account — and nothing connected the two. The
-- registration form asks for a project reference, sends it up in the user's
-- metadata, and `handle_new_user` created a profile and ignored it entirely.
--
-- The result: their portal is empty for ever. No project, no invoice, and — the
-- part that actually stops the business — no contract they can sign, because
-- the signing card matches on `contracts.client_id` and theirs is null. The
-- contract sits "awaiting customer signature" and the customer has no way to
-- reach it.
--
-- Nothing failed, so nothing showed up as broken. The account existed, the
-- contract existed, and they simply did not know about each other.
--
-- THE MATCH IS ON EMAIL, AND THAT IS THE SECURITY BOUNDARY
-- A project reference is printed on quotations and emails — it is an
-- identifier, not a secret, and someone could guess SB-2026-1002. So the
-- reference alone never claims anything. The email address on the lead has to
-- match the address they just verified ownership of by registering with it.
--
-- Registering with an address nobody has quoted links nothing, silently and
-- correctly: they get an empty portal until sales adds them.
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
begin
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
  'Creates the profile AND links the new account to the leads, contracts, projects, invoices and appointments already raised under that email. Matching is on the verified email; a project reference can only narrow, never widen.';


-- ============================================================================
-- BACKFILL
-- ----------------------------------------------------------------------------
-- Anyone who registered before this existed is still orphaned, and would stay
-- that way — the trigger only runs at signup. Run the same matching over the
-- accounts that already exist.
-- ============================================================================

do $$
declare
  u record;
begin
  for u in select id, lower(trim(email)) as email from auth.users loop
    update public.leads
    set converted_client_id = u.id
    where lower(email) = u.email and converted_client_id is null;

    update public.contracts c
    set client_id = u.id
    where c.client_id is null
      and exists (
        select 1 from public.leads l
        where l.id = c.lead_id and lower(l.email) = u.email
      );

    update public.projects p
    set client_id = u.id
    where p.client_id is null
      and exists (
        select 1
        from public.contracts c
        join public.leads l on l.id = c.lead_id
        where c.id = p.contract_id and lower(l.email) = u.email
      );
  end loop;
end;
$$;
