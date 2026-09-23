-- ============================================================================
-- 0049  MANUAL INVOICES ALONGSIDE AUTOMATIC ONES
-- ----------------------------------------------------------------------------
-- `invoices` carried `unique (project_id, stage)`, and its comment explains
-- exactly why: without it, a retried trigger or a double-click bills the
-- customer twice for the same milestone. That reasoning is right and the
-- constraint stays — for the invoices the triggers raise.
--
-- What it also did, unintentionally, was cap a project at FOUR invoices for
-- its entire life. The "+ New invoice" button added in this phase exists for
-- the things that are not milestones: a chargeable service call, a part outside
-- warranty, an agreed variation. A company that does two service calls on the
-- same roof could invoice for one of them.
--
-- Found by the verification script rather than by reading the code, on its
-- second run — the first run passed because the project had no retention
-- invoice yet. A constraint that only bites the second time is exactly the kind
-- that survives testing and fails in front of a customer.
--
-- THE FIX
-- `is_manual` marks an invoice a person raised deliberately, and the uniqueness
-- rule now applies only to the automatic ones. The two triggers name the same
-- partial index in their ON CONFLICT clauses, so double-billing a milestone is
-- still impossible; a human raising a second service invoice is not.
--
-- The trigger bodies below are reproduced verbatim from 0018 with that single
-- clause changed. Rewriting the hinge of the whole system from memory is how a
-- rule gets quietly dropped.
-- ============================================================================

alter table public.invoices
  add column if not exists is_manual boolean not null default false;

comment on column public.invoices.is_manual is
  'True when a person raised this invoice rather than a milestone trigger. Only automatic invoices are unique per stage.';

alter table public.invoices
  drop constraint if exists invoices_project_id_stage_key;

create unique index if not exists invoices_auto_stage_uniq
  on public.invoices (project_id, stage)
  where not is_manual;

create or replace function public.on_contract_executed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_reference text;
  v_quotation record;
  v_lead record;
  v_milestones text[][] := array[
    ['engineering_survey',   'Engineering Survey'],
    ['permitting',           'Permitting & Approvals'],
    ['structural_mounting',  'Structural Mounting'],
    ['dc_wiring',            'DC Wiring'],
    ['ac_wiring',            'AC Wiring & Tie-in'],
    ['commissioning',        'Commissioning & Testing'],
    ['turnover',             'Turnover & Handover']
  ];
  i integer;
  v_due_days integer := public.setting_num('finance.down_payment_due_days', 7)::integer;
  v_install_days integer := public.setting_num('company.install_days', 3)::integer;
begin
  if new.status <> 'executed' or coalesce(old.status, 'draft') = 'executed' then
    return new;
  end if;

  select * into v_quotation from public.quotations where id = new.quotation_id;
  select * into v_lead from public.leads where id = new.lead_id;

  v_reference := 'SB-' || to_char(now(), 'YYYY') || '-' || nextval('public.project_ref_seq');

  insert into public.projects (
    reference, client_id, lead_id, contract_id, address,
    system_kw, system_type, contract_value, status, start_date, target_turnover
  )
  values (
    v_reference,
    new.client_id,
    new.lead_id,
    new.id,
    coalesce(v_lead.address, v_lead.location, 'Address to be confirmed'),
    coalesce(v_quotation.system_kw, 0),
    coalesce(v_quotation.system_type, 'on_grid'),
    new.contract_value,
    'planning',
    current_date,
    -- Permitting and procurement dominate the calendar, so the target allows
    -- roughly a month around the advertised installation window.
    current_date + ((v_install_days + 27) || ' days')::interval
  )
  returning id into v_project_id;

  for i in 1 .. array_length(v_milestones, 1) loop
    insert into public.project_milestones (project_id, key, label, sequence, status)
    values (v_project_id, v_milestones[i][1]::public.milestone_key, v_milestones[i][2], i, 'pending');
  end loop;

  perform public.reserve_stock_for_project(v_project_id, new.quotation_id);

  insert into public.invoices (
    invoice_number, project_id, client_id, stage, amount, status, issued_at, due_at
  )
  values (
    'INV-' || to_char(now(), 'YYYY') || '-' || nextval('public.invoice_ref_seq'),
    v_project_id,
    new.client_id,
    'down_payment',
    round(new.contract_value * new.down_payment_pct / 100, 2),
    'sent',
    current_date,
    current_date + (v_due_days || ' days')::interval
  )
  on conflict (project_id, stage) where not is_manual do nothing;

  update public.leads set stage = 'contract' where id = new.lead_id;

  perform public.write_audit(
    'Contract executed; project created',
    'contracts',
    new.id::text,
    'critical',
    jsonb_build_object('project_id', v_project_id, 'value', new.contract_value)
  );

  return new;
end;
$$;


create or replace function public.on_milestone_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project record;
  v_pct numeric;
  v_stage public.payment_stage;
  v_due_days integer := public.setting_num('finance.milestone_due_days', 15)::integer;
  v_maint_months integer := public.setting_num('operations.maintenance_interval_months', 12)::integer;
begin
  if new.status <> 'done' or coalesce(old.status, 'pending') = 'done' then
    return new;
  end if;

  select p.*, c.delivery_pct, c.commissioning_pct
  into v_project
  from public.projects p
  left join public.contracts c on c.id = p.contract_id
  where p.id = new.project_id;

  if v_project.client_id is not null then
    insert into public.notifications (user_id, title, body, channel, category, entity, entity_id)
    values (
      v_project.client_id,
      new.label || ' completed',
      'Your installation has moved forward: ' || new.label ||
        ' is now complete. You can see the full timeline in your portal.',
      'in_app', 'milestone', 'projects', new.project_id::text
    );

    insert into public.notifications (user_id, to_email, title, body, channel, category, entity, entity_id)
    select
      v_project.client_id, pr.email,
      new.label || ' completed',
      'Your installation has moved forward: ' || new.label || ' is now complete.',
      'email', 'milestone', 'projects', new.project_id::text
    from public.profiles pr
    left join public.notification_preferences np on np.user_id = pr.id
    where pr.id = v_project.client_id and coalesce(np.milestone_email, true);
  end if;

  -- The percentage comes from the CONTRACT, not from settings: changing the
  -- company default must never rewrite what an existing customer already signed.
  if new.key = 'ac_wiring' then
    v_stage := 'delivery';
    v_pct := coalesce(v_project.delivery_pct, public.setting_num('finance.delivery_pct', 35));
  elsif new.key = 'commissioning' then
    v_stage := 'commissioning';
    v_pct := coalesce(v_project.commissioning_pct, public.setting_num('finance.commissioning_pct', 15));
  end if;

  if v_stage is not null then
    insert into public.invoices (
      invoice_number, project_id, client_id, stage, amount,
      status, issued_at, due_at, triggered_by_milestone
    )
    values (
      'INV-' || to_char(now(), 'YYYY') || '-' || nextval('public.invoice_ref_seq'),
      new.project_id, v_project.client_id, v_stage,
      round(v_project.contract_value * v_pct / 100, 2),
      'sent', current_date, current_date + (v_due_days || ' days')::interval, new.key
    )
    on conflict (project_id, stage) where not is_manual do nothing;
  end if;

  if new.key = 'turnover' then
    update public.projects
    set status = 'completed', actual_turnover = current_date, warranty_start_date = current_date
    where id = new.project_id;

    insert into public.maintenance_schedules (project_id, due_date)
    values (new.project_id, current_date + (v_maint_months || ' months')::interval);
  end if;

  perform public.write_audit(
    'Milestone completed: ' || new.label,
    'project_milestones', new.id::text, 'info',
    jsonb_build_object('project_id', new.project_id, 'key', new.key)
  );

  return new;
end;
$$;


-- The triggers themselves are unchanged and still point at these functions;
-- CREATE OR REPLACE keeps them attached.
