-- ============================================================================
-- 0027 · THE MILESTONE STATE MACHINE
-- ----------------------------------------------------------------------------
-- Until now `project_milestones.status` was a free-for-all. Any of the seven
-- stages could be marked done at any time, in any order, by anyone the policy
-- let through. A technician could complete "Turnover & Handover" on their first
-- day on site, which would notify the customer that their installation was
-- finished and raise the final invoice.
--
-- Three rules, which are the flow diagram's L1-B branch expressed as data:
--
--   1. ORDER. A stage cannot start or finish while an earlier one is unfinished.
--
--   2. THE SYNCHRONISE GATE. Structural mounting is where the two parallel
--      tracks rejoin: nothing physical may begin until the permits are approved
--      AND the materials are on site. Sending a crew before either is the
--      expensive mistake this whole module exists to prevent — a wasted day, or
--      worse, work that has to come down again because the LGU said no.
--
--   3. NOTHING IS EVER HARD-BLOCKED FOR AN ADMINISTRATOR. Reality does not
--      respect state machines: a permit arrives by text message, a delivery is
--      part-received and the crew is already there. An administrator can force
--      any transition, and forcing one writes an audit entry at `warning`.
--
-- Rule 3 follows the same principle as the permits screen. A system that cannot
-- be overridden gets worked around outside itself, and then the records are
-- fiction. One that can be overridden, and says who did it, stays true.
-- ============================================================================


-- ============================================================================
-- 1 · IS THE GATE OPEN?
-- ----------------------------------------------------------------------------
-- Exposed as its own function so the UI can ask the same question the trigger
-- asks, and explain the answer before somebody clicks. A gate that only speaks
-- when refusing is a gate people learn to resent.
-- ============================================================================

create or replace function public.project_gate_status(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_permits_total integer;
  v_permits_approved integer;
  v_permits_rejected integer;
  v_reservations integer;
  v_short integer;
begin
  select count(*),
         count(*) filter (where status = 'approved'),
         count(*) filter (where status = 'rejected')
  into v_permits_total, v_permits_approved, v_permits_rejected
  from public.permits
  where project_id = p_project_id;

  select count(*), count(*) filter (where status = 'short')
  into v_reservations, v_short
  from public.stock_reservations
  where project_id = p_project_id;

  return jsonb_build_object(
    -- No permits tracked means nobody has said which are needed yet, so the
    -- gate stays shut. Silence is not approval.
    'permits_ready', v_permits_total > 0 and v_permits_approved = v_permits_total,
    'permits_total', v_permits_total,
    'permits_approved', v_permits_approved,
    'permits_rejected', v_permits_rejected,
    'materials_ready', v_reservations > 0 and v_short = 0,
    'reservations', v_reservations,
    'reservations_short', v_short
  );
end;
$$;

revoke all on function public.project_gate_status(uuid) from public, anon;
grant execute on function public.project_gate_status(uuid) to authenticated;


-- ============================================================================
-- 2 · THE STATE MACHINE
-- ============================================================================

create or replace function public.enforce_milestone_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blocker record;
  v_gate jsonb;
  v_is_admin boolean := public.is_admin();
  v_forced boolean := false;
begin
  -- Only interested in moving forward. Anyone may reopen or block a stage.
  if new.status not in ('in_progress', 'done')
     or new.status = coalesce(old.status, 'pending') then
    return new;
  end if;

  -- 'done' needs a timestamp (there is a constraint) and, more usefully, needs
  -- to say who. Taken from the session rather than the request.
  if new.status = 'done' then
    if new.completed_at is null then
      new.completed_at := now();
    end if;
    if new.completed_by is null then
      new.completed_by := (select auth.uid());
    end if;
  end if;

  /* --- Rule 1: order ------------------------------------------------------ */
  select key, label, sequence, status into v_blocker
  from public.project_milestones
  where project_id = new.project_id
    and sequence < new.sequence
    and status <> 'done'
  order by sequence
  limit 1;

  if v_blocker.key is not null then
    if not v_is_admin then
      raise exception
        'Cannot start % — % is still %. Stages have to be completed in order.',
        new.label, v_blocker.label, replace(v_blocker.status::text, '_', ' ')
        using errcode = '42501';
    end if;
    v_forced := true;
  end if;

  /* --- Rule 2: the synchronise gate --------------------------------------- */
  if new.key = 'structural_mounting' then
    v_gate := public.project_gate_status(new.project_id);

    if not (v_gate ->> 'permits_ready')::boolean or not (v_gate ->> 'materials_ready')::boolean then
      if not v_is_admin then
        raise exception
          'Physical work cannot start yet. Permits approved: % of %. Materials on site: %. Both have to be clear before a crew is sent.',
          v_gate ->> 'permits_approved',
          v_gate ->> 'permits_total',
          case when (v_gate ->> 'materials_ready')::boolean then 'yes' else 'no' end
          using errcode = '42501';
      end if;
      v_forced := true;
    end if;
  end if;

  /* --- Rule 3: an override is allowed, and is recorded -------------------- */
  if v_forced then
    perform public.write_audit(
      'Milestone "' || new.label || '" forced past its preconditions',
      'project_milestones',
      new.id::text,
      'warning',
      jsonb_build_object(
        'project_id', new.project_id,
        'milestone', new.key,
        'new_status', new.status,
        'blocked_by', coalesce(v_blocker.key::text, 'synchronise gate'),
        'gate', v_gate,
        'override', true
      )
    );
  end if;

  return new;
end;
$$;

create trigger milestones_ordered
  before update on public.project_milestones
  for each row execute function public.enforce_milestone_order();

revoke all on function public.enforce_milestone_order() from public, anon, authenticated;


-- ============================================================================
-- 3 · THE PROJECT STATUS FOLLOWS ITS MILESTONES
-- ----------------------------------------------------------------------------
-- It was set once at creation and never moved, so every project stayed in
-- 'planning' for ever while its milestones marched on. Derived here instead,
-- because two places recording the same fact eventually disagree — and the one
-- a customer sees on their tracker should not be the one that is wrong.
-- ============================================================================

create or replace function public.sync_project_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
  v_done integer;
  v_started integer;
  v_current public.project_status;
begin
  select count(*),
         count(*) filter (where status = 'done'),
         count(*) filter (where status in ('done', 'in_progress'))
  into v_total, v_done, v_started
  from public.project_milestones
  where project_id = new.project_id;

  select status into v_current from public.projects where id = new.project_id;

  -- A project put on hold or cancelled by a person stays that way. Progress on
  -- a milestone is not a decision to resume.
  if v_current in ('on_hold', 'cancelled') then
    return new;
  end if;

  if v_done = v_total and v_total > 0 then
    update public.projects
    set status = 'completed', actual_turnover = coalesce(actual_turnover, current_date)
    where id = new.project_id and status <> 'completed';
  elsif v_started > 0 then
    update public.projects
    set status = 'in_progress'
    where id = new.project_id and status = 'planning';
  end if;

  return new;
end;
$$;

create trigger milestone_syncs_project_status
  after update on public.project_milestones
  for each row execute function public.sync_project_status();

revoke all on function public.sync_project_status() from public, anon, authenticated;


-- ============================================================================
-- 4 · PERMITS DRIVE THE PERMITTING MILESTONE
-- ----------------------------------------------------------------------------
-- The permitting stage IS the permits; asking somebody to tick it separately
-- means it is eventually ticked when the permits are not in, or left unticked
-- when they are. Neither is useful.
--
-- A rejection blocks the stage rather than silently leaving it pending, so the
-- tracker shows a problem instead of an absence — a stalled project and a
-- refused permit look identical otherwise.
-- ============================================================================

create or replace function public.sync_permitting_milestone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gate jsonb := public.project_gate_status(new.project_id);
begin
  if (v_gate ->> 'permits_rejected')::integer > 0 then
    update public.project_milestones
    set status = 'blocked',
        note = 'A permit application was rejected. See Permits & Approvals.'
    where project_id = new.project_id
      and key = 'permitting'
      and status <> 'done';

  elsif (v_gate ->> 'permits_ready')::boolean then
    update public.project_milestones
    set status = 'done',
        completed_at = coalesce(completed_at, now()),
        completed_by = coalesce(completed_by, (select auth.uid())),
        note = 'All tracked permits approved.'
    where project_id = new.project_id
      and key = 'permitting'
      and status <> 'done';
  end if;

  return new;
end;
$$;

create trigger permit_syncs_milestone
  after insert or update on public.permits
  for each row execute function public.sync_permitting_milestone();

revoke all on function public.sync_permitting_milestone() from public, anon, authenticated;

comment on function public.project_gate_status(uuid) is
  'Are the permits approved and the materials on site? Asked by the trigger and by the UI, so the answer is the same.';
