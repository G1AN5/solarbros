-- ============================================================================
-- 0074  THE CUSTOMER'S SIDE OF THE CONVERSATION
-- ----------------------------------------------------------------------------
-- A customer could see their quotation's existence (the read policy has been
-- there since 0007) and nothing else: not what was in it, and no way to say
-- yes. Accepting happened when a rep pressed "Customer accepted" on their
-- behalf, on the strength of a phone call. That still works — it is how most
-- customers will answer — but the customer can now answer for themselves.
--
-- Three small functions, each the whole of its authorisation:
--
--   respond_to_quotation        accept or decline one of YOUR sent quotations
--   quotation_items_for_client  what is in it — descriptions and quantities,
--                               never the unit cost the company pays
--   rate_ticket                 one to five stars on a ticket we resolved
--
-- Plus the review policy, which let a customer attach a testimonial to any
-- project id they cared to type.
-- ============================================================================


create or replace function public.respond_to_quotation(
  p_quotation_id uuid,
  p_accept boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_quotation record;
begin
  if v_uid is null then
    raise exception 'Please sign in again.' using errcode = '42501';
  end if;

  select q.id, q.status, q.valid_until, l.converted_client_id
    into v_quotation
  from public.quotations q
  join public.leads l on l.id = q.lead_id
  where q.id = p_quotation_id;

  if not found or v_quotation.converted_client_id is distinct from v_uid then
    raise exception 'That quotation is not on your account.' using errcode = '42501';
  end if;

  if v_quotation.status <> 'sent' then
    raise exception 'This quotation has already been answered or is no longer open.'
      using errcode = '22023';
  end if;

  if v_quotation.valid_until is not null and v_quotation.valid_until < current_date then
    raise exception 'This quotation has expired. Ask us for an updated one — prices may have moved.'
      using errcode = '22023';
  end if;

  if not p_accept and length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Please tell us briefly why, so we can do better.' using errcode = '22023';
  end if;

  update public.quotations
  set status = case when p_accept then 'accepted'::public.quotation_status else 'rejected'::public.quotation_status end,
      responded_at = now(),
      rejection_reason = case when p_accept then null else left(btrim(p_reason), 500) end
  where id = p_quotation_id;
end;
$$;

revoke all on function public.respond_to_quotation(uuid, boolean, text) from public, anon;
grant execute on function public.respond_to_quotation(uuid, boolean, text) to authenticated;


create or replace function public.quotation_items_for_client(p_quotation_id uuid)
returns table (description text, quantity numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select ql.description, ql.quantity
  from public.quotation_lines ql
  join public.quotations q on q.id = ql.quotation_id
  join public.leads l on l.id = q.lead_id
  where ql.quotation_id = p_quotation_id
    and q.status in ('sent', 'accepted', 'rejected', 'expired')
    and (l.converted_client_id = (select auth.uid()) or public.is_staff())
  order by ql.sort_order;
$$;

revoke all on function public.quotation_items_for_client(uuid) from public, anon;
grant execute on function public.quotation_items_for_client(uuid) to authenticated;


/* The customer's read policy (0007) listed sent, accepted and rejected. An
   expired quotation disappeared from their portal the day it lapsed, taking
   the record of what they had been offered with it. */
drop policy if exists quotations_read_own on public.quotations;
create policy quotations_read_own on public.quotations
  for select to authenticated
  using (
    status in ('sent', 'accepted', 'rejected', 'expired')
    and exists (
      select 1 from public.leads l
      where l.id = quotations.lead_id
        and l.converted_client_id = (select auth.uid())
    )
  );


create or replace function public.rate_ticket(p_ticket_id uuid, p_rating integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Choose between one and five stars.' using errcode = '22023';
  end if;

  update public.tickets
  set satisfaction_rating = p_rating
  where id = p_ticket_id
    and client_id = (select auth.uid())
    and status in ('resolved', 'closed');

  if not found then
    raise exception 'You can rate a ticket once we have resolved it.' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.rate_ticket(uuid, integer) from public, anon;
grant execute on function public.rate_ticket(uuid, integer) to authenticated;


/* A review is the customer's own words about their own installation. The old
   check confirmed only whose name was on it. */
drop policy if exists reviews_insert_client on public.reviews;
create policy reviews_insert_client on public.reviews
  for insert to authenticated
  with check (
    client_id = (select auth.uid())
    and (project_id is null or public.owns_project(project_id))
    and status = 'pending'
    and not published
  );
