-- ============================================================================
-- 0071  EVERY RECORD FINDS ITS CUSTOMER WHEN IT IS WRITTEN, NOT ONLY AT SIGN-UP
-- ----------------------------------------------------------------------------
-- WHAT WENT WRONG
-- A customer who registered BEFORE sending an enquiry saw an empty portal,
-- while one who registered AFTER saw everything. Same business, same forms —
-- the only difference was the order things happened in.
--
-- The cause: linking a lead, a contract or a visit to a customer account was
-- done in exactly one place, `handle_new_user`, which runs once, when the
-- account is created. Anything raised afterwards under the same email address
-- was never attached to anybody:
--
--   · the enquiry and the booking had no `converted_client_id`,
--   · the contract raised from the quotation had no `client_id`, so the
--     signing card in the portal (which matches on client_id) never showed it,
--   · the dispatched site survey had no `client_id`, so the customer could not
--     see that a team was coming.
--
-- Two contracts for the same customer were sitting at "awaiting client" with
-- nobody able to sign either of them.
--
-- THE FIX
-- Linking becomes a property of the WRITE, enforced by triggers, so it happens
-- however a record arrives — public form, portal, CRM, or a row typed in the
-- dashboard:
--
--   leads         find the account by the signed-in customer, else by email
--   contracts     inherit the lead's account
--   appointments  inherit from the ticket, the project or the lead, and fill
--                 the contact details the office needs from the same source
--   invoices      inherit from their project
--
-- `link_client_records` is the one routine that walks a customer's whole
-- history and attaches it. Sign-up calls it, and this migration runs it once
-- for every existing customer, which repairs the records already stranded.
--
-- ALSO HERE, BECAUSE THEY ARE THE SAME CLASS OF PROBLEM
--   · one live contract per lead and per quotation (there were two)
--   · accepting a quotation supersedes the other open versions for that lead
--   · the CRM stage follows the work forward and is never dragged backwards
--     by an automatic step
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Which customer account owns this email address?
-- ----------------------------------------------------------------------------
-- Customers only. A member of staff who registered with an address that was
-- once a prospect's must not inherit that prospect's records (0053 made the
-- same decision for sign-up), and a pending or refused staff registration is
-- parked on role 'client' with `requested_role` set, so that is excluded too.

create or replace function public.client_id_for_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where lower(p.email) = lower(btrim(coalesce(p_email, '')))
    and p.role = 'client'
    and p.requested_role is null
    and p.is_active
  order by p.created_at
  limit 1;
$$;

revoke all on function public.client_id_for_email(text) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 2. Attach a customer's whole history to their account
-- ----------------------------------------------------------------------------
-- Only ever fills an EMPTY client column. A record already attached to somebody
-- is never moved by this routine — reassigning an installation is a warranty
-- transfer, which has its own approval.
--
-- `solarbros.linking` tells the customer-scope triggers (0023) that this is
-- the system attaching records, not a customer editing them. It is transaction
-- local and cleared again before returning.

create or replace function public.link_client_records(p_client uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  select lower(btrim(p.email)) into v_email
  from public.profiles p
  where p.id = p_client
    and p.role = 'client'
    and p.requested_role is null;

  if v_email is null then
    return;
  end if;

  perform set_config('solarbros.linking', 'on', true);

  update public.leads
  set converted_client_id = p_client
  where lower(email) = v_email
    and converted_client_id is null;

  update public.contracts c
  set client_id = p_client
  where c.client_id is null
    and exists (
      select 1 from public.leads l
      where l.id = c.lead_id and l.converted_client_id = p_client
    );

  update public.projects p
  set client_id = p_client
  where p.client_id is null
    and exists (
      select 1 from public.contracts c
      where c.id = p.contract_id and c.client_id = p_client
    );

  /* A warranty transferred to this address before its new owner had an
     account. The approval already happened (0008 found nobody to move it to),
     so the installation belongs to them the moment they exist. */
  update public.projects p
  set client_id = p_client
  where p.client_id is distinct from p_client
    and exists (
      select 1 from public.warranty_requests w
      where w.project_id = p.id
        and w.request_type = 'transfer'
        and w.status = 'approved'
        and lower(w.transfer_to_email) = v_email
    );

  update public.invoices i
  set client_id = p_client
  where i.client_id is null
    and exists (
      select 1 from public.projects p
      where p.id = i.project_id and p.client_id = p_client
    );

  update public.appointments a
  set client_id = p_client
  where a.client_id is null
    and (
      exists (
        select 1 from public.leads l
        where l.id = a.lead_id and l.converted_client_id = p_client
      )
      or exists (
        select 1 from public.projects p
        where p.id = a.project_id and p.client_id = p_client
      )
    );

  update public.serialised_assets s
  set client_id = p_client
  where s.client_id is distinct from p_client
    and exists (
      select 1 from public.projects p
      where p.id = s.project_id and p.client_id = p_client
    )
    and (
      s.client_id is null
      or exists (
        select 1 from public.warranty_requests w
        where w.project_id = s.project_id
          and w.request_type = 'transfer'
          and w.status = 'approved'
          and lower(w.transfer_to_email) = v_email
      )
    );

  perform set_config('solarbros.linking', '', true);
end;
$$;

revoke all on function public.link_client_records(uuid) from public, anon, authenticated;

comment on function public.link_client_records(uuid) is
  'Attaches every lead, contract, project, invoice, visit and asset raised under a customer''s email to their account. Never moves a record that already belongs to somebody.';


-- ----------------------------------------------------------------------------
-- 3. Leads find their account as they are written
-- ----------------------------------------------------------------------------

create or replace function public.link_lead_to_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.converted_client_id is null then
    /* A signed-in customer using the estimator, the contact form or the
       booking page is that customer, whatever address they typed — a
       household books under whichever inbox is to hand. */
    if (select auth.uid()) is not null
       and public.current_user_role() = 'client' then
      new.converted_client_id := (select auth.uid());
    else
      new.converted_client_id := public.client_id_for_email(new.email);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists leads_link_client on public.leads;
create trigger leads_link_client
  before insert or update of email on public.leads
  for each row execute function public.link_lead_to_client();


/* When a lead gains an account later — a rep corrects a mistyped email in the
   CRM — the contract and visits raised against it follow it. Depth-guarded:
   `link_client_records` updates leads itself, and its own writes must not
   start the walk again. */
create or replace function public.propagate_lead_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  if new.converted_client_id is not null
     and (tg_op = 'INSERT' or old.converted_client_id is distinct from new.converted_client_id) then
    perform public.link_client_records(new.converted_client_id);
  end if;

  return null;
end;
$$;

drop trigger if exists leads_propagate_link on public.leads;
create trigger leads_propagate_link
  after insert or update of converted_client_id on public.leads
  for each row execute function public.propagate_lead_link();


-- ----------------------------------------------------------------------------
-- 4. Contracts: the customer is the lead's account
-- ----------------------------------------------------------------------------
-- `useCreateContract` already looked this up in the browser, from the lead's
-- `converted_client_id` — which was exactly the column nothing filled in. Done
-- here, it no longer depends on the screen remembering to ask.

create or replace function public.fill_contract_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.client_id is null then
    select coalesce(l.converted_client_id, public.client_id_for_email(l.email))
      into new.client_id
    from public.leads l
    where l.id = new.lead_id;
  end if;
  return new;
end;
$$;

drop trigger if exists contracts_fill_client on public.contracts;
create trigger contracts_fill_client
  before insert on public.contracts
  for each row execute function public.fill_contract_client();


-- ----------------------------------------------------------------------------
-- 5. Appointments: who it is for, and how to reach them
-- ----------------------------------------------------------------------------
-- A visit can arrive from a public booking (a lead), a ticket, a project, the
-- customer's own portal or the dispatch board. Each of those knows something
-- the others do not, and the crew needs all of it: a name, a number to ring
-- from the gate, and an address. Filled only where the caller left a blank.
--
-- It also refuses a customer booking a visit against somebody else's
-- installation — the insert policy only checked whose name was on it.

create or replace function public.fill_appointment_details()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket record;
  v_project record;
  v_lead record;
  v_profile record;
begin
  if new.ticket_id is not null then
    select t.client_id, t.project_id into v_ticket
    from public.tickets t where t.id = new.ticket_id;

    new.client_id := coalesce(new.client_id, v_ticket.client_id);
    new.project_id := coalesce(new.project_id, v_ticket.project_id);
  end if;

  if new.project_id is not null then
    select p.client_id, p.address into v_project
    from public.projects p where p.id = new.project_id;

    if v_project.client_id is not null
       and new.client_id is not null
       and new.client_id is distinct from v_project.client_id
       and not public.is_internal() then
      raise exception 'That installation is not on your account.' using errcode = '42501';
    end if;

    new.client_id := coalesce(new.client_id, v_project.client_id);
    new.address := coalesce(nullif(btrim(new.address), ''), v_project.address);
  end if;

  if new.lead_id is not null then
    select l.name, l.email, l.phone, l.address, l.location, l.converted_client_id
      into v_lead
    from public.leads l where l.id = new.lead_id;

    new.client_id := coalesce(
      new.client_id, v_lead.converted_client_id, public.client_id_for_email(v_lead.email)
    );
    new.contact_name := coalesce(nullif(btrim(new.contact_name), ''), v_lead.name);
    new.contact_phone := coalesce(nullif(btrim(new.contact_phone), ''), v_lead.phone);
    new.address := coalesce(nullif(btrim(new.address), ''), v_lead.address, v_lead.location);
  end if;

  if new.client_id is not null then
    select p.full_name, p.phone, p.address into v_profile
    from public.profiles p where p.id = new.client_id;

    new.contact_name := coalesce(nullif(btrim(new.contact_name), ''), v_profile.full_name);
    new.contact_phone := coalesce(nullif(btrim(new.contact_phone), ''), v_profile.phone);
    new.address := coalesce(nullif(btrim(new.address), ''), v_profile.address);
  end if;

  if new.created_by is null then
    new.created_by := (select auth.uid());
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_fill_details on public.appointments;
create trigger appointments_fill_details
  before insert on public.appointments
  for each row execute function public.fill_appointment_details();


-- ----------------------------------------------------------------------------
-- 6. Invoices: the customer is the project's
-- ----------------------------------------------------------------------------

create or replace function public.fill_invoice_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.client_id is null then
    select p.client_id into new.client_id from public.projects p where p.id = new.project_id;
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_fill_client on public.invoices;
create trigger invoices_fill_client
  before insert on public.invoices
  for each row execute function public.fill_invoice_client();


-- ----------------------------------------------------------------------------
-- 7. The customer-scope triggers stand aside for the system's own linking
-- ----------------------------------------------------------------------------
-- Both bodies are 0023's, reproduced verbatim apart from the marked additions.
-- Without the first addition, a signed-in customer submitting a booking would
-- trip "the terms of a contract cannot be changed from the customer portal" on
-- the linking update their own submission set off.

create or replace function public.enforce_contract_client_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_headers jsonb;
  v_ip text;
begin
  -- ADDED 0071: the system attaching a record to its customer.
  if current_setting('solarbros.linking', true) = 'on' then
    return new;
  end if;

  -- Staff changes are governed by contracts_write_staff and are none of this
  -- function's business. The service role (auth.uid() is null) is the Edge
  -- Function layer, which does its own authorisation.
  if v_actor is null or public.is_staff() then
    /* ADDED 0071: the counter-signature is attributed to whoever is signed
       in, never to whoever the request named — the same rule payments (0022)
       and milestones (0027) already follow. */
    if v_actor is not null
       and new.status = 'executed'
       and old.status is distinct from 'executed' then
      new.company_signed_by := v_actor;
      new.company_signed_at := coalesce(new.company_signed_at, now());
    end if;
    return new;
  end if;

  -- Anyone else reaching this point is the customer named on the contract,
  -- because contracts_sign_client is the only other policy that permits it.

  if new.contract_value is distinct from old.contract_value
     or new.down_payment_pct is distinct from old.down_payment_pct
     or new.delivery_pct is distinct from old.delivery_pct
     or new.commissioning_pct is distinct from old.commissioning_pct
     or new.quotation_id is distinct from old.quotation_id
     or new.lead_id is distinct from old.lead_id
     or new.client_id is distinct from old.client_id
     or new.financing_approved is distinct from old.financing_approved
     or new.reference is distinct from old.reference then
    raise exception 'The terms of a contract cannot be changed from the customer portal.'
      using errcode = '42501';
  end if;

  -- The counter-signature is ours to give.
  if new.company_signed_at is distinct from old.company_signed_at
     or new.company_signed_by is distinct from old.company_signed_by then
    raise exception 'Only SolarBros can add the company signature.'
      using errcode = '42501';
  end if;

  -- Signing is a one-way door. Without this a customer could clear their own
  -- signature after work had started and dispute that they ever agreed.
  if old.client_signed_at is not null
     and new.client_signed_at is distinct from old.client_signed_at then
    raise exception 'This contract has already been signed.'
      using errcode = '42501';
  end if;

  -- The only status move a customer may make: accepting a contract that is
  -- waiting for them, which hands it back to us for counter-signature. In
  -- particular they cannot reach 'executed', which is what creates the project
  -- and reserves stock.
  if new.status is distinct from old.status then
    if not (old.status = 'awaiting_client' and new.status = 'awaiting_company') then
      raise exception 'A contract cannot be moved to that state from the customer portal.'
        using errcode = '42501';
    end if;
  end if;

  -- Record where the signature came from rather than trusting the browser to
  -- report it. A signature with no provenance is hard to stand behind if it is
  -- ever disputed.
  if new.client_signed_at is not null and old.client_signed_at is null then
    new.client_signed_at := now();
    if new.client_signature_name is null or length(trim(new.client_signature_name)) < 2 then
      raise exception 'Please type your full name to sign.' using errcode = '22023';
    end if;

    /* ADDED 0071: the address the signature came from, read from the request
       PostgREST is serving rather than from anything the browser reports.
       Best effort — a missing or malformed header leaves the column empty
       instead of refusing a signature over plumbing. */
    begin
      v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
      v_ip := btrim(split_part(
        coalesce(v_headers ->> 'x-forwarded-for', v_headers ->> 'cf-connecting-ip', v_headers ->> 'x-real-ip', ''),
        ',', 1
      ));
      new.client_signature_ip := nullif(v_ip, '')::inet;
    exception when others then
      new.client_signature_ip := null;
    end;
  end if;

  return new;
end;
$$;


create or replace function public.enforce_appointment_client_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  -- ADDED 0071: the system attaching a record to its customer.
  if current_setting('solarbros.linking', true) = 'on' then
    return new;
  end if;

  if v_actor is null or public.is_staff() then
    return new;
  end if;

  /* ADDED 0071: TECHNICIANS. They are not in `is_staff()` — they have their
     own portal — so until now they fell through to the CUSTOMER rules below,
     which refuse every status change but a cancellation. A technician could
     therefore never close a job: "Complete job" failed for everybody who is
     actually sent to do jobs.

     The policy `appointments_update_assigned` already limits them to visits
     they are crewed on. This limits WHAT they may change on one: its
     progress, not the booking itself. */
  if public.current_user_role() = 'technician' then
    if new.client_id is distinct from old.client_id
       or new.project_id is distinct from old.project_id
       or new.lead_id is distinct from old.lead_id
       or new.ticket_id is distinct from old.ticket_id
       or new.appointment_type is distinct from old.appointment_type
       or new.scheduled_date is distinct from old.scheduled_date
       or new.time_slot is distinct from old.time_slot then
      raise exception 'Ask the office to change the booking itself — from the field you can only record its progress.'
        using errcode = '42501';
    end if;

    if new.status is distinct from old.status
       and new.status not in ('in_progress', 'completed') then
      raise exception 'From the field you can start or complete a visit; the office handles the rest.'
        using errcode = '42501';
    end if;

    if new.status = 'completed' and new.completed_at is null then
      new.completed_at := now();
    end if;

    return new;
  end if;

  if new.project_id is distinct from old.project_id
     or new.client_id is distinct from old.client_id
     or new.lead_id is distinct from old.lead_id
     or new.completed_at is distinct from old.completed_at then
    raise exception 'That cannot be changed from the customer portal.'
      using errcode = '42501';
  end if;

  -- A customer may cancel, and may not declare work done or crews assigned.
  if new.status is distinct from old.status and new.status <> 'cancelled' then
    raise exception 'Only SolarBros can change the status of a visit.'
      using errcode = '42501';
  end if;

  -- Rescheduling a visit that has already happened is not rescheduling.
  if old.status in ('completed', 'in_progress')
     and new.scheduled_date is distinct from old.scheduled_date then
    raise exception 'This visit has already taken place. Please book a new one.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;


-- ----------------------------------------------------------------------------
-- 8. Sign-up uses the same routine
-- ----------------------------------------------------------------------------
-- 0053's body, reproduced, with the customer-linking block replaced by the
-- shared routine. The staff branch is untouched: a member of staff registering
-- still picks up a pending role claim and NOTHING else.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
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

  -- Everything raised under this email before the account existed.
  perform public.link_client_records(new.id);

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 9. One live contract per lead, and per quotation
-- ----------------------------------------------------------------------------
-- Two "Customer accepted" clicks on two versions of the same quotation raised
-- two contracts for one roof. The customer would have been asked to sign both,
-- and executing both would have built two projects and billed two down
-- payments. The older unsigned duplicates are cancelled first, keeping the
-- most advanced (then newest) contract for each lead.

with ranked as (
  select
    c.id,
    row_number() over (
      partition by c.lead_id
      order by
        case c.status
          when 'executed' then 0
          when 'awaiting_company' then 1
          when 'awaiting_client' then 2
          else 3
        end,
        c.created_at desc
    ) as position
  from public.contracts c
  where c.status <> 'cancelled'
)
update public.contracts c
set status = 'cancelled'
from ranked r
where r.id = c.id
  and r.position > 1
  and c.status in ('draft', 'awaiting_client');

create unique index if not exists contracts_one_live_per_lead
  on public.contracts (lead_id)
  where status <> 'cancelled';

create unique index if not exists contracts_one_live_per_quotation
  on public.contracts (quotation_id)
  where status <> 'cancelled';


-- ----------------------------------------------------------------------------
-- 10. Accepting one version closes the others
-- ----------------------------------------------------------------------------
-- A lead negotiates through v1, v2, v3. When the customer accepts one, the
-- others are no longer offers — leaving them "sent" invites somebody to accept
-- a superseded price. And a lead whose accepted quotation already has a live
-- contract cannot quietly accept a second one.

create or replace function public.quotation_accepted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing text;
begin
  if new.status <> 'accepted' or old.status = 'accepted' then
    return new;
  end if;

  select q.reference into v_existing
  from public.quotations q
  join public.contracts c on c.quotation_id = q.id and c.status <> 'cancelled'
  where q.lead_id = new.lead_id
    and q.id <> new.id
  limit 1;

  if v_existing is not null then
    raise exception
      'This customer already has a contract from %. Cancel that contract first if the terms have changed.',
      v_existing
      using errcode = '23505';
  end if;

  update public.quotations
  set status = 'rejected',
      rejection_reason = 'Superseded by ' || new.reference,
      responded_at = coalesce(responded_at, now())
  where lead_id = new.lead_id
    and id <> new.id
    and status in ('draft', 'pending_approval', 'sent');

  return new;
end;
$$;

drop trigger if exists quotations_accepted on public.quotations;
create trigger quotations_accepted
  before update of status on public.quotations
  for each row execute function public.quotation_accepted();


-- ----------------------------------------------------------------------------
-- 11. The pipeline stage follows the work, forwards only
-- ----------------------------------------------------------------------------
-- Pressing "I have sent the quotation" on an enquiry whose contract was already
-- executed moved a paying customer back to "Quoted" on the CRM board. A person
-- may move a lead anywhere; an AUTOMATIC step only ever moves it forward.

create or replace function public.advance_lead_stage(p_lead uuid, p_stage public.lead_stage)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.leads l
  set stage = p_stage
  where l.id = p_lead
    and l.stage <> 'lost'
    and array_position(
          array['new', 'quoted', 'site_visit', 'contract', 'installed']::public.lead_stage[], l.stage)
        < array_position(
          array['new', 'quoted', 'site_visit', 'contract', 'installed']::public.lead_stage[], p_stage);
$$;

revoke all on function public.advance_lead_stage(uuid, public.lead_stage) from public, anon, authenticated;


create or replace function public.quotation_moves_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'sent' and old.status is distinct from 'sent' then
    perform public.advance_lead_stage(new.lead_id, 'quoted');
    update public.leads
    set quotation_sent_at = coalesce(quotation_sent_at, now()),
        first_contacted_at = coalesce(first_contacted_at, now())
    where id = new.lead_id;
  end if;
  return new;
end;
$$;

drop trigger if exists quotations_move_lead on public.quotations;
create trigger quotations_move_lead
  after update of status on public.quotations
  for each row execute function public.quotation_moves_lead();


create or replace function public.survey_moves_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.lead_id is not null
     and new.appointment_type = 'site_survey'
     and new.status in ('confirmed', 'dispatched', 'in_progress', 'completed') then
    perform public.advance_lead_stage(new.lead_id, 'site_visit');
  end if;
  return null;
end;
$$;

drop trigger if exists appointments_move_lead on public.appointments;
create trigger appointments_move_lead
  after insert or update of status on public.appointments
  for each row execute function public.survey_moves_lead();


create or replace function public.project_moves_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.lead_id is not null
     and new.status = 'completed'
     and old.status is distinct from 'completed' then
    perform public.advance_lead_stage(new.lead_id, 'installed');
  end if;
  return null;
end;
$$;

drop trigger if exists projects_move_lead on public.projects;
create trigger projects_move_lead
  after update of status on public.projects
  for each row execute function public.project_moves_lead();


-- ----------------------------------------------------------------------------
-- 12. Ownership follows whoever actually works the lead
-- ----------------------------------------------------------------------------
-- `assigned_to` was never set by anything, so every lead on the board read
-- "Unassigned", the representative filter had nothing to filter by, and a
-- customer could only ever message an administrator (messaging reaches the rep
-- through this column). The rep who first contacts a lead, or who prepares its
-- first quotation, now owns it. A person can still reassign it in the CRM.

create or replace function public.stamp_lead_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_to is null
     and new.first_contacted_at is not null
     and old.first_contacted_at is null then
    new.assigned_to := coalesce(new.contacted_by, (select auth.uid()));
  end if;

  if new.first_contacted_at is not null and new.contacted_by is null then
    new.contacted_by := (select auth.uid());
  end if;

  return new;
end;
$$;

drop trigger if exists leads_stamp_owner on public.leads;
create trigger leads_stamp_owner
  before update on public.leads
  for each row execute function public.stamp_lead_owner();


create or replace function public.stamp_quotation_preparer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  -- Who prepared it is a fact about the session, not a field on the form.
  if v_actor is not null then
    new.prepared_by := v_actor;
  end if;

  update public.leads
  set assigned_to = new.prepared_by
  where id = new.lead_id
    and assigned_to is null
    and new.prepared_by is not null;

  return new;
end;
$$;

drop trigger if exists quotations_stamp_preparer on public.quotations;
create trigger quotations_stamp_preparer
  before insert on public.quotations
  for each row execute function public.stamp_quotation_preparer();


-- ----------------------------------------------------------------------------
-- 13. Repair what is already stranded
-- ----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select id from public.profiles
    where role = 'client' and requested_role is null and is_active
  loop
    perform public.link_client_records(r.id);
  end loop;
end;
$$;

-- Leads whose work has already moved on.
update public.leads l
set stage = 'contract'
where l.stage in ('new', 'quoted', 'site_visit')
  and exists (
    select 1 from public.contracts c
    where c.lead_id = l.id and c.status = 'executed'
  );

update public.leads l
set stage = 'installed'
where l.stage <> 'installed'
  and l.stage <> 'lost'
  and exists (
    select 1 from public.projects p
    where p.lead_id = l.id and p.status = 'completed'
  );

-- The leads quoted so far belong to whoever prepared their quotations.
update public.leads l
set assigned_to = q.prepared_by
from (
  select distinct on (lead_id) lead_id, prepared_by
  from public.quotations
  where prepared_by is not null
  order by lead_id, created_at
) q
where q.lead_id = l.id
  and l.assigned_to is null;
