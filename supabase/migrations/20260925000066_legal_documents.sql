-- ============================================================================
-- 0066  LEGAL PAGES AS CONTENT, NOT AS CODE
-- ----------------------------------------------------------------------------
-- The privacy policy, terms of service and warranty terms were built by a
-- function inside LegalPage.tsx, with a comment admitting the text was
-- placeholder scaffolding and that counsel should draft the real documents.
--
-- That is a problem beyond tidiness. When counsel DOES hand over the real
-- wording — and for a Philippine installer it has to satisfy the Data Privacy
-- Act — the only way to publish it was a developer editing a TypeScript file
-- and redeploying the site. Legal text is the content most likely to be given
-- to the business as a Word document and the least likely to be safe for a
-- developer to paraphrase.
--
-- SECTIONS RATHER THAN ONE BLOB
-- The page renders headed sections, and keeping that shape means the admin
-- edits a heading and a paragraph at a time instead of one enormous textarea
-- where a stray character breaks the layout. `sections` is jsonb: an array of
-- { heading, body }.
--
-- The seed below reproduces the current scaffolding verbatim, so publishing
-- this migration changes nothing a visitor sees. It exists to be replaced.
-- ============================================================================

create table if not exists public.legal_documents (
  -- The slug in the URL: /legal/privacy, /legal/terms, /legal/warranty.
  slug text primary key,
  title text not null,
  sections jsonb not null default '[]'::jsonb,
  published boolean not null default true,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.legal_documents is
  'Privacy policy, terms and warranty text. Edited under Website Content; rendered by /legal/:document.';

create trigger legal_documents_touch
  before update on public.legal_documents
  for each row execute function public.touch_updated_at();

alter table public.legal_documents enable row level security;

-- A legal page is the most public thing on the site; a visitor must be able to
-- read it without an account.
create policy legal_read_published on public.legal_documents
  for select to anon, authenticated
  using (published);

create policy legal_read_all_staff on public.legal_documents
  for select to authenticated
  using (public.is_internal());

/* Administrators only — not sales, who may edit the blog and the portfolio.
   Publishing a privacy policy is a legal act by the company, and the people
   who maintain marketing copy are not the people who should be doing it. */
create policy legal_write_admin on public.legal_documents
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- ----------------------------------------------------------------------------
-- The current scaffolding, moved out of the bundle unchanged
-- ----------------------------------------------------------------------------

insert into public.legal_documents (slug, title, sections)
values
  ('privacy', 'Privacy Policy', jsonb_build_array(
    jsonb_build_object('heading', 'What we collect', 'body',
      'Contact details you submit through the estimator, booking and quotation forms; property details needed to size a system; and account activity within the client portal.'),
    jsonb_build_object('heading', 'Why we collect it', 'body',
      'To prepare your quotation, schedule and carry out the installation, meet our warranty obligations, and keep you informed about your own project. We do not sell your data.'),
    jsonb_build_object('heading', 'Who can see it', 'body',
      'Only the staff whose role requires it. Access is enforced by the database itself rather than by the interface, so a technician sees the jobs they are crewed on and nothing else.'),
    jsonb_build_object('heading', 'How long we keep it', 'body',
      'Project and warranty records are kept for the life of the warranty and for as long as tax and statutory record-keeping require. Enquiries that do not become projects are kept for two years.'),
    jsonb_build_object('heading', 'Your rights', 'body',
      'Under the Data Privacy Act of 2012 (RA 10173) you may ask what we hold about you, have it corrected, or ask us to erase it where we are not required to keep it. Write to us and we will respond within the statutory period.')
  )),

  ('terms', 'Terms of Service', jsonb_build_array(
    jsonb_build_object('heading', 'Estimates are not quotations', 'body',
      'The figure produced by the online estimator is indicative. It is based on the appliances and hours you entered and on standard assumptions about roof and shading. A binding price follows a free on-site survey.'),
    jsonb_build_object('heading', 'Payment', 'body',
      'Work is invoiced in stages tied to milestones, and each stage is payable when that milestone is reached. We accept bank transfer and over-the-counter deposit.'),
    jsonb_build_object('heading', 'Scheduling', 'body',
      'Installation dates depend on utility and local authority approvals, which are outside our control. We report progress on each approval in your portal rather than promise a date we cannot guarantee.'),
    jsonb_build_object('heading', 'Cancellation', 'body',
      'You may cancel before equipment is ordered at no cost. After equipment has been reserved against your project, restocking costs may apply.')
  )),

  ('warranty', 'Warranty Terms', jsonb_build_array(
    jsonb_build_object('heading', 'What is covered', 'body',
      'Panels carry the manufacturer performance warranty. Inverters and batteries carry their own manufacturer terms. Our workmanship is covered separately. The exact number of years for each is published on the home page and in your turnover certificate.'),
    jsonb_build_object('heading', 'Registration', 'body',
      'Every serial number we install is recorded against your account at the time of installation, so a claim does not depend on you having kept the paperwork.'),
    jsonb_build_object('heading', 'Making a claim', 'body',
      'Raise it from the Warranty page of your client portal. We inspect, and where the manufacturer is responsible we handle the return on your behalf.'),
    jsonb_build_object('heading', 'What is not covered', 'body',
      'Damage from modification by others, storm or flood damage beyond the design rating, and consumables. Ordinary output decline within the manufacturer performance curve is not a fault.'),
    jsonb_build_object('heading', 'Transfer', 'body',
      'Selling the property? The warranty transfers to the new owner. Start the transfer from your portal.')
  ))
on conflict (slug) do nothing;
