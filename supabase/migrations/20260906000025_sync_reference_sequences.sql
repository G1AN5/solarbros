-- ============================================================================
-- 0025 · SYNCHRONISE THE REFERENCE SEQUENCES WITH THE DATA
-- ----------------------------------------------------------------------------
-- The seed wrote reference numbers explicitly — 'CON-2026-1001', 'TKT-2026-1001'
-- and so on — without advancing the sequences those numbers came from. Writing
-- an explicit value does not move a sequence; only `nextval` does. So every
-- sequence still pointed at a number the seed had already used.
--
-- The result: the FIRST genuine record created after a fresh restore collides
-- with a demo one and is rejected on the unique constraint, with an error about
-- nothing the user did. The second attempt succeeds, because the failed call
-- consumed a number. That is a horrible bug to diagnose — it happens once,
-- looks random, and goes away when you retry.
--
-- Found by `npm run verify:contracts`, which raised a real contract and hit
-- `duplicate key value violates unique constraint "contracts_reference_key"`.
--
-- THE FIX IS THE STANDARD ONE
-- `setval` past the highest number already in the table. Written as a loop over
-- every reference column rather than five hand-written statements, because
-- three of the five were already fine and it was pure luck which — a fix that
-- only covers the one you noticed leaves the same trap for the next person.
--
-- Safe to re-run, and worth re-running after any restore or reseed. It only
-- ever moves a sequence forward.
-- ============================================================================

do $$
declare
  target record;
  v_max bigint;
  v_current bigint;
begin
  for target in
    select *
    from (values
      ('projects',        'reference',       'project_ref_seq'),
      ('quotations',      'reference',       'quotation_ref_seq'),
      ('contracts',       'reference',       'contract_ref_seq'),
      ('invoices',        'invoice_number',  'invoice_ref_seq'),
      ('tickets',         'reference',       'ticket_ref_seq'),
      ('purchase_orders', 'po_number',       'po_ref_seq'),
      ('warranty_claims', 'claim_reference', 'rma_ref_seq')
    ) as t(table_name, column_name, sequence_name)
  loop
    -- Skip anything not present in this database rather than aborting the whole
    -- migration: the table list is allowed to drift ahead of the schema.
    if to_regclass('public.' || target.table_name) is null
       or to_regclass('public.' || target.sequence_name) is null then
      continue;
    end if;

    /* The numeric suffix after the last hyphen. `substring(... from '[0-9]+$')`
       rather than splitting, so a reference in an unexpected shape yields NULL
       and is ignored instead of raising. */
    execute format(
      'select coalesce(max((substring(%I from ''[0-9]+$''))::bigint), 0) from public.%I',
      target.column_name, target.table_name
    ) into v_max;

    execute format('select last_value from public.%I', target.sequence_name) into v_current;

    if v_max >= v_current then
      -- `false` means the NEXT nextval returns exactly v_max + 1.
      execute format('select setval(''public.%I'', %s, false)', target.sequence_name, v_max + 1);
      raise notice 'Sequence % advanced from % to %', target.sequence_name, v_current, v_max + 1;
    end if;
  end loop;
end;
$$;
