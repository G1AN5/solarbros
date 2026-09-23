-- ============================================================================
-- 0019 · DEMO REFRESH
-- ----------------------------------------------------------------------------
-- Rolls the demonstration data forward so it is always relative to today.
--
-- THE PROBLEM
-- The seed in migration 0012 wrote absolute dates. A migration runs once, so the
-- technician's installation was scheduled for the day the seed happened to be
-- applied. By the next morning the field portal shows "No jobs today", the
-- dispatch board is empty, and the whole flow looks broken — not because
-- anything is wrong, but because time passed.
--
-- That is exactly the failure you do not want five minutes before showing this
-- to somebody. Run this first and the demo is always in a sensible state:
--
--     npm run demo:refresh
--
-- WHAT IT DOES
--   * moves the demo appointments so one is today and two are upcoming
--   * rewinds the demo project to mid-installation (3 of 7 milestones)
--   * clears probe rows left behind by the verification scripts
--
-- WHAT IT DOES NOT TOUCH
-- Real data. Every statement is scoped to the demo project and the
-- @demo.solarbros.ph accounts, so running it against a live database with real
-- customers changes nothing belonging to them.
--
-- Restricted to administrators, and audited, because rewinding milestones is
-- destructive to project history — appropriate for a demo, never for real work.
-- ============================================================================

create or replace function public.refresh_demo_data()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid;
  v_moved integer := 0;
  v_client uuid := '11111111-0000-4000-8000-000000000007';
  v_tech uuid   := '11111111-0000-4000-8000-000000000006';
  v_eng uuid    := '11111111-0000-4000-8000-000000000003';
begin
  if not public.is_admin() then
    raise exception 'Only an administrator may refresh the demonstration data.';
  end if;

  select id into v_project from public.projects
  where client_id = v_client order by created_at limit 1;

  if v_project is null then
    return 'No demo project found. Nothing to refresh.';
  end if;

  /* --- Appointments: one today, two upcoming ------------------------------ */
  update public.appointments
  set scheduled_date = current_date, status = 'dispatched'
  where project_id = v_project and appointment_type = 'installation';
  get diagnostics v_moved = row_count;

  update public.appointments
  set scheduled_date = current_date + 1
  where appointment_type = 'site_survey' and status = 'requested';

  update public.appointments
  set scheduled_date = current_date + 2
  where appointment_type = 'virtual_consultation' and status = 'requested';

  /* --- Milestones: back to three complete, one in progress ----------------
     Ordered from the end backwards. Resetting a completed milestone to pending
     does not un-raise the invoice it triggered, so the invoices are cleared
     separately below rather than left dangling. */
  update public.project_milestones
  set status = 'pending', completed_at = null, completed_by = null, note = null
  where project_id = v_project and sequence > 3;

  update public.project_milestones
  set status = 'done',
      completed_at = now() - ((7 - sequence * 2) || ' days')::interval,
      completed_by = case when sequence <= 2 then v_eng else v_tech end
  where project_id = v_project and sequence <= 3;

  update public.project_milestones
  set status = 'in_progress',
      note = 'String 2 pending: awaiting MC4 connectors from the warehouse.'
  where project_id = v_project and key = 'dc_wiring';

  /* --- Invoices: keep the down payment, remove milestone-triggered ones ---
     Payments are removed first; the trigger on payments recalculates the
     invoice and project totals, so deleting in the other order would leave
     projects.amount_paid pointing at money that no longer has an invoice. */
  delete from public.payments
  where invoice_id in (
    select id from public.invoices where project_id = v_project and stage <> 'down_payment'
  );
  delete from public.invoices where project_id = v_project and stage <> 'down_payment';

  update public.projects
  set status = 'in_progress', actual_turnover = null, warranty_start_date = null,
      start_date = current_date - 20, target_turnover = current_date + 7
  where id = v_project;

  /* --- Tidy up after the verification scripts ----------------------------- */
  delete from public.leads where name in ('RLS probe', 'Settings probe');
  delete from public.quotations where reference like 'QTN-PROBE-%';
  delete from public.portfolio_items where title in ('Consent probe', 'No consent probe');
  delete from public.notifications where created_at < now() - interval '60 days';

  perform public.write_audit(
    'Demonstration data refreshed',
    'projects', v_project::text, 'warning',
    jsonb_build_object('appointments_moved', v_moved)
  );

  return format(
    'Demo refreshed. %s appointment(s) moved to today; project rewound to 3 of 7 milestones.',
    v_moved
  );
end;
$$;

-- Callable by a signed-in user; the function itself refuses anyone who is not
-- an administrator.
revoke all on function public.refresh_demo_data() from public, anon;
grant execute on function public.refresh_demo_data() to authenticated;

comment on function public.refresh_demo_data is
  'Rolls demonstration data forward to today. Admin only. Touches only the demo project and demo accounts.';
