-- ============================================================================
-- 0051  PAYROLL REGISTER
-- ----------------------------------------------------------------------------
-- /admin/hr was seven staff members and their pay written into the component as
-- a constant, under a heading that said "Payroll & workforce". Nothing on that
-- screen came from anywhere, and "Run payroll" was disabled with a note saying
-- statutory contributions were out of scope.
--
-- That note was right and it still is: SSS, PhilHealth, Pag-IBIG, withholding
-- tax, 13th-month pay and DOLE overtime rules all change, all interact, and all
-- carry legal consequences when they are wrong. NOTHING HERE COMPUTES ANY OF
-- THEM. What this does is let the office write down what it paid — a register
-- it can file, export and refer back to.
--
-- WHY THIS ADDS TO THE EXISTING TABLES RATHER THAN CREATING NEW ONES
-- `payroll_runs` and `payroll_lines` have existed since migration 0005, with
-- correct row-level security already on them — including the rule that an
-- employee sees their own payslip line and nobody else's. They had simply never
-- been read or written by any screen.
--
-- Adding a parallel `payroll_entries` table would have been quicker to write
-- and would have left two payroll tables in the schema, one of them dead, with
-- nothing to tell a later reader which is authoritative. A schema that contains
-- two answers to the same question does not have an answer.
--
-- WHAT WAS ACTUALLY MISSING
--   1. Deductions. `gross_pay` is generated as base + overtime + commission,
--      so there was no way to record what was withheld, and therefore no net.
--   2. A maintained run total. `payroll_runs.total_gross` defaulted to 0 and
--      nothing ever updated it, so it would have disagreed with its own lines
--      the moment anybody entered one.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. What was withheld, and what actually went out
-- ----------------------------------------------------------------------------

alter table public.payroll_lines
  add column if not exists deductions numeric(12, 2) not null default 0
    check (deductions >= 0);

/* One figure, deliberately. Separate SSS / PhilHealth / Pag-IBIG columns would
   imply the system knows the rule behind each one, and the moment a rate
   changes that implication becomes a wrong number on a payslip. */
comment on column public.payroll_lines.deductions is
  'Total withheld, including statutory contributions. One figure on purpose: separate columns would imply the system knows each rule, and it does not.';

alter table public.payroll_lines
  add column if not exists net_pay numeric(12, 2)
    generated always as (base_pay + overtime_pay + commission_pay - deductions) stored;

comment on column public.payroll_lines.net_pay is
  'Generated, so the total can never disagree with its parts — including for anyone reading the table directly or exporting it.';

alter table public.payroll_lines
  add column if not exists notes text;


-- ----------------------------------------------------------------------------
-- 2. A run total that is true
-- ----------------------------------------------------------------------------

create or replace function public.recalculate_payroll_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run uuid := coalesce(new.payroll_run_id, old.payroll_run_id);
begin
  /* Summed from the lines rather than incremented. An incremented counter
     drifts the first time a line is corrected or removed, and payroll is the
     last place anybody checks when a total looks slightly wrong. */
  update public.payroll_runs
  set total_gross = (
    select coalesce(sum(l.gross_pay), 0)
    from public.payroll_lines l
    where l.payroll_run_id = v_run
  )
  where id = v_run;

  return null;
end;
$$;

create trigger payroll_line_updates_run
  after insert or update or delete on public.payroll_lines
  for each row execute function public.recalculate_payroll_run();

revoke all on function public.recalculate_payroll_run() from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 3. Provenance on the run
-- ----------------------------------------------------------------------------

/* `approved_by` is the only person-shaped field on a run, and it was writable
   by the caller. Approval is the step that says the figures have been checked,
   so it is taken from the session — the same rule payments and refunds follow. */
create or replace function public.stamp_payroll_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'approved' and coalesce(old.status, 'draft') <> 'approved' then
    new.approved_by := (select auth.uid());
    new.approved_at := now();
  end if;

  if new.status <> 'approved' then
    new.approved_by := null;
    new.approved_at := null;
  end if;

  return new;
end;
$$;

create trigger stamp_payroll_run
  before insert or update on public.payroll_runs
  for each row execute function public.stamp_payroll_run();

revoke all on function public.stamp_payroll_run() from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 4. Housekeeping
-- ----------------------------------------------------------------------------

/* There is no DELETE policy on either table in 0007 — `for all` covers it for
   accountants and administrators, which is what a register needs: a line
   entered against the wrong person has to be removable, and the run it belongs
   to cascades to its lines. */

comment on table public.payroll_runs is
  'One payroll period. Totals are summed from its lines; nothing here computes a statutory contribution.';
comment on table public.payroll_lines is
  'What one person was paid for one period. Figures are entered by whoever runs payroll, not calculated.';
