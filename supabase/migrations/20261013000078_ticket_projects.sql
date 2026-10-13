-- ============================================================================
-- 0078 · A TICKET BELONGS TO THE INSTALLATION IT IS ABOUT
-- ----------------------------------------------------------------------------
-- Found sending a technician to a customer's ticket.
--
-- The customer portal raised tickets without naming the project, although a
-- customer with an installation has exactly one. The repair visit booked from
-- such a ticket had no project either, so it did not appear on the project's
-- page, and the technician sent could not record photos, serials or materials
-- against the installation they had come to repair.
--
-- The portal now sends the project. This migration makes sure a customer can
-- only name their OWN project — the insert policy checked who raised the
-- ticket and nothing else — and links the tickets and repair visits raised
-- before the change.
--
-- Also: upcoming visits booked before 0076 get the phone number that 0076
-- gives new bookings.
-- ============================================================================


-- 1. A customer may name a project only if it is theirs. Staff (and
--    technicians reporting an app problem) are unchanged.
drop policy if exists tickets_insert_client on public.tickets;
create policy tickets_insert_client on public.tickets
  for insert to authenticated
  with check (
    public.is_internal()
    or (
      client_id = (select auth.uid())
      and (project_id is null or public.owns_project(project_id))
    )
  );


-- 2. Tickets already raised by a customer with exactly one live installation.
--    Someone with two is left for the office to link; guessing would file a
--    fault against the wrong roof.
update public.tickets t
set project_id = sole.project_id
from (
  select p.client_id, (array_agg(p.id))[1] as project_id
  from public.projects p
  where p.status <> 'cancelled'
  group by p.client_id
  having count(*) = 1
) sole
where t.project_id is null
  and t.client_id = sole.client_id;


-- 3. The visits booked for those tickets follow them. Changing a visit's
--    project notifies nobody; it adds the visit's crew to the project, which
--    is what lets them record their work there.
update public.appointments a
set project_id = t.project_id
from public.tickets t
where a.ticket_id = t.id
  and a.project_id is null
  and t.project_id is not null;


-- 4. Upcoming visits booked before 0076 with no number on them. New bookings
--    take one from the enquiry; these predate that, and the crew's "Call"
--    button had nothing to dial. Same order as fill_appointment_details: the
--    visit's own enquiry, the account, then the project's enquiry or the
--    customer's latest one that has a number. Rows with nothing to fill are
--    left alone.
with found as (
  select
    a.id,
    coalesce(
      (select nullif(btrim(l.phone), '') from public.leads l where l.id = a.lead_id),
      (select nullif(btrim(pr.phone), '') from public.profiles pr where pr.id = a.client_id),
      (
        select nullif(btrim(l.phone), '')
        from public.leads l
        left join public.projects p on p.id = a.project_id
        where (p.lead_id is not null and l.id = p.lead_id)
           or (a.client_id is not null and l.converted_client_id = a.client_id)
        order by (l.id = p.lead_id) desc nulls last,
                 (nullif(btrim(l.phone), '') is not null) desc,
                 l.created_at desc
        limit 1
      )
    ) as phone
  from public.appointments a
  where nullif(btrim(coalesce(a.contact_phone, '')), '') is null
    and a.status not in ('completed', 'cancelled')
)
update public.appointments a
set contact_phone = found.phone
from found
where a.id = found.id
  and found.phone is not null;
