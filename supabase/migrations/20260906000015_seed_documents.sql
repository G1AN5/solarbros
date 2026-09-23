-- ============================================================================
-- 0015 · DEMONSTRATION DOCUMENTS
-- ----------------------------------------------------------------------------
-- The document vault is one of the client portal's headline features, and it
-- was rendering its empty state because nothing had been filed against the demo
-- project yet. These rows give it something real to show.
--
-- METADATA ONLY. `storage_path` points into a Supabase Storage bucket that does
-- not exist yet, so the download buttons stay inert — which is honest: the
-- files genuinely are not there. Wiring Storage is its own piece of work
-- (bucket policies, signed URLs with short expiry, upload from the field
-- portal) and belongs with the file-handling phase rather than here.
--
-- `is_client_visible` is exercised deliberately: the internal margin analysis
-- below is attached to the project but must NOT appear in the customer's vault.
-- It is the row to check when verifying that flag actually works.
-- ============================================================================

do $$
declare
  v_project uuid;
  v_client uuid := '11111111-0000-4000-8000-000000000007';
  v_sales uuid  := '11111111-0000-4000-8000-000000000002';
  v_eng uuid    := '11111111-0000-4000-8000-000000000003';
  v_acct uuid   := '11111111-0000-4000-8000-000000000005';
begin
  select id into v_project from public.projects
  where reference like 'SB-%' order by created_at limit 1;

  if v_project is null then
    raise notice 'No demo project found; skipping document seed.';
    return;
  end if;

  insert into public.documents
    (name, kind, project_id, client_id, storage_path, mime_type, size_kb, is_client_visible, uploaded_by, uploaded_at)
  values
    ('Quotation QTN-2026-1001.pdf', 'quotation', v_project, v_client,
     'projects/demo/quotation-2026-1001.pdf', 'application/pdf', 412, true, v_sales, now() - interval '30 days'),

    ('Signed Contract CON-2026-1001.pdf', 'contract', v_project, v_client,
     'projects/demo/contract-2026-1001.pdf', 'application/pdf', 688, true, v_sales, now() - interval '26 days'),

    ('Down Payment Invoice INV-2026-1001.pdf', 'invoice', v_project, v_client,
     'projects/demo/invoice-down-payment.pdf', 'application/pdf', 190, true, v_acct, now() - interval '25 days'),

    ('Official Receipt OR-2026-0455.pdf', 'receipt', v_project, v_client,
     'projects/demo/receipt-0455.pdf', 'application/pdf', 165, true, v_acct, now() - interval '24 days'),

    ('Site Survey Report.pdf', 'survey_report', v_project, v_client,
     'projects/demo/site-survey.pdf', 'application/pdf', 2140, true, v_eng, now() - interval '18 days'),

    ('Building Permit BP-2026-04417.pdf', 'permit', v_project, v_client,
     'projects/demo/permit-bp-04417.pdf', 'application/pdf', 520, true, v_eng, now() - interval '12 days'),

    ('Single-Line Diagram (As Designed).pdf', 'as_built', v_project, v_client,
     'projects/demo/single-line-diagram.pdf', 'application/pdf', 880, true, v_eng, now() - interval '17 days'),

    -- INTERNAL ONLY. Attached to the project, hidden from the customer.
    -- If this ever appears in /portal/documents, the is_client_visible check in
    -- the documents RLS policy has regressed.
    ('Internal Margin Analysis.xlsx', 'other', v_project, null,
     'projects/demo/internal-margin.xlsx',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     46, false, v_sales, now() - interval '29 days');
end $$;
