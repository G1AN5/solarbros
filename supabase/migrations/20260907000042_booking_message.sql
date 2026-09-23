-- ============================================================================
-- 0042  LEAD-TIME MESSAGE
-- ----------------------------------------------------------------------------
-- The refusal read "We need at least 24  hours notice" - two spaces, because
-- the format string in 0038 has a space after the % placeholder as well as
-- before the word. It is a small thing, and it is on the message a prospective
-- customer reads at the exact moment we are turning their booking down, which
-- is the worst place in the application to look careless.
--
-- The function is reproduced verbatim from 0038 apart from that one string.
-- Everything else - the notice rule, the capacity re-check, the validation
-- helpers, the grants - is unchanged, deliberately: a "quick fix" that quietly
-- rewrites a security-definer function is how a rule gets lost.
-- ============================================================================

create or replace function public.request_booking(
  p_appointment_type text,
  p_scheduled_date date,
  p_time_slot text,
  p_name text,
  p_email text,
  p_phone text,
  p_address text default null,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead_id uuid;
  v_type public.appointment_type;
  v_capacity integer := public.setting_num('operations.slots_per_hour', 2)::integer;
  v_lead_hours integer := public.setting_num('operations.booking_lead_hours', 24)::integer;
  v_taken integer;
begin
  perform public.validate_public_contact(p_name, p_email);
  perform public.check_public_form_rate(p_email);

  if p_appointment_type not in ('virtual_consultation', 'site_survey') then
    raise exception 'That kind of visit cannot be booked from the website.' using errcode = '22023';
  end if;
  v_type := p_appointment_type::public.appointment_type;

  if p_scheduled_date is null or p_scheduled_date < current_date then
    raise exception 'Please choose a date that has not already passed.' using errcode = '22023';
  end if;

  if p_scheduled_date > current_date + interval '180 days' then
    raise exception 'We only take bookings six months ahead.' using errcode = '22023';
  end if;

  if p_time_slot !~ '^[0-2][0-9]:[0-5][0-9]$' then
    raise exception 'Please choose a time slot.' using errcode = '22023';
  end if;

  /* --- NOTICE AND CAPACITY, checked at the moment of writing -------------
     The greyed-out calendar is a courtesy. Two people can be looking at the
     same free slot at the same instant, and whoever presses second has to be
     the one refused — otherwise both are promised the same 9am. */
  if (p_scheduled_date + p_time_slot::time) <= (now() + make_interval(hours => v_lead_hours)) then
    raise exception
      'We need at least % hours notice for a visit. Please choose a later slot.', v_lead_hours
      using errcode = '22023';
  end if;

  select count(*) into v_taken
  from public.appointments a
  where a.scheduled_date = p_scheduled_date
    and a.time_slot = p_time_slot
    and a.status <> 'cancelled';

  if v_taken >= v_capacity then
    raise exception 'That slot has just been taken. Please choose another time.'
      using errcode = '23505';
  end if;

  insert into public.leads (name, email, phone, address, location, source)
  values (
    trim(p_name),
    lower(trim(p_email)),
    nullif(left(trim(coalesce(p_phone, '')), 40), ''),
    nullif(left(trim(coalesce(p_address, '')), 300), ''),
    nullif(left(trim(coalesce(p_address, '')), 300), ''),
    'quote_request'
  )
  returning id into v_lead_id;

  insert into public.appointments (
    appointment_type, status, scheduled_date, time_slot,
    lead_id, contact_name, contact_phone, address, notes
  )
  values (
    v_type,
    'requested',
    p_scheduled_date,
    p_time_slot,
    v_lead_id,
    trim(p_name),
    nullif(left(trim(coalesce(p_phone, '')), 40), ''),
    nullif(left(trim(coalesce(p_address, '')), 300), ''),
    nullif(left(trim(coalesce(p_notes, '')), 2000), '')
  );
end;
$$;

revoke all on function public.request_booking(text, date, text, text, text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.request_booking(text, date, text, text, text, text, text, text)
  to anon, authenticated;
