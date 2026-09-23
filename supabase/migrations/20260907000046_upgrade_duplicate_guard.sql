-- ============================================================================
-- 0046  UPGRADE REQUEST — NARROWER DUPLICATE GUARD
-- ----------------------------------------------------------------------------
-- The guard added in 0044 refused a second upgrade request while the customer
-- had ANY open lead with source 'referral' against their email address. That is
-- too wide: a rep who logs a walk-in referral for an existing customer would
-- silently lock that customer out of ever asking to expand their system, and
-- the message they would see — "you already have an upgrade request with us" —
-- would be untrue.
--
-- Found by the verification script rather than by reading the code: the demo
-- customer already had a referral lead from the seed, so the very first call
-- was refused. The intent was only ever to stop a double submission, so the
-- check now looks for an actual upgrade request.
-- ============================================================================

create or replace function public.request_upgrade(
  p_reason text,
  p_monthly_bill numeric default null,
  p_details text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile record;
  v_project record;
  v_lead_id uuid;
begin
  if v_uid is null then
    raise exception 'Please sign in again.' using errcode = '42501';
  end if;

  select p.full_name, p.email, p.phone
    into v_profile
  from public.profiles p
  where p.id = v_uid;

  if not found then
    raise exception 'We could not find your account.' using errcode = 'P0002';
  end if;

  if length(coalesce(p_details, '')) > 2000 then
    raise exception 'That note is too long.' using errcode = '22023';
  end if;

  if p_monthly_bill is not null and (p_monthly_bill < 0 or p_monthly_bill > 10000000) then
    raise exception 'That monthly bill does not look right.' using errcode = '22023';
  end if;

  /* Their existing installation, if there is one. It is the whole reason this
     lead is valuable — the address and the current system size come from the
     record rather than being retyped and mistyped. */
  select pr.id, pr.address, pr.system_kw
    into v_project
  from public.projects pr
  where pr.client_id = v_uid
  order by pr.created_at desc
  limit 1;

  /* One open upgrade request at a time. Pressing submit twice should not put
     the same customer into the pipeline twice — a duplicate lead is chased by
     two reps who then discover each other in front of the customer. */
  if exists (
    select 1 from public.leads l
    where lower(l.email) = lower(v_profile.email)
      and l.source = 'referral'
      and l.stage not in ('installed', 'lost')
      -- Upgrade requests specifically, not every referral lead that happens to
      -- carry this email address.
      and l.qualification_notes like 'UPGRADE REQUEST%'
  ) then
    raise exception
      'You already have an upgrade request with us. We will come back to you on that one.'
      using errcode = '23505';
  end if;

  /* `qualification_notes` and not a general `notes` column, because `leads`
     does not have one - and this IS qualification: it is what the rep needs to
     know before ringing back. */
  insert into public.leads (
    name, email, phone, address, location,
    monthly_bill, estimated_kw, source, stage, qualification_notes
  )
  values (
    v_profile.full_name,
    lower(v_profile.email),
    v_profile.phone,
    v_project.address,
    v_project.address,
    p_monthly_bill,
    -- Their current size, as the starting point for the expansion quote. Not a
    -- promise about the new system, just what is on the roof today.
    v_project.system_kw,
    'referral',
    'new',
    'UPGRADE REQUEST from the customer portal.' ||
      E'\n' || 'Reason: ' || coalesce(p_reason, 'not stated') ||
      case
        when v_project.id is not null
          then E'\n' || 'Existing system: ' || v_project.system_kw || ' kWp'
        else ''
      end ||
      case
        when coalesce(btrim(p_details), '') <> ''
          then E'\n\n' || btrim(p_details)
        else ''
      end
  )
  returning id into v_lead_id;

  return v_lead_id;
end;
$$;

revoke all on function public.request_upgrade(text, numeric, text) from public, anon;
grant execute on function public.request_upgrade(text, numeric, text) to authenticated;

comment on function public.request_upgrade(text, numeric, text) is
  'An existing customer asking to expand their system. Creates a referral-source lead on the CRM board; the customer never chooses their own stage, score or owner.';
