-- ============================================================================
-- 0020 · PUBLIC CONTENT: FAQs, and the last of the hardcoded company copy
-- ----------------------------------------------------------------------------
-- The final things the marketing site was reading from a TypeScript file:
-- frequently asked questions, the service-area list, the brands installed, and
-- the trust figures in the hero.
--
-- These change more often than almost anything else in the application. A new
-- service area opens, a brand is dropped, the "homes powered" counter ticks
-- past a round number worth advertising. None of that should require a deploy,
-- and a marketing site that is out of date because updating it is inconvenient
-- is worse than one with fewer numbers on it.
--
-- FAQs get their own table rather than a setting, because they are a LIST that
-- is reordered, added to and retired. Settings are single values.
-- ============================================================================

create table public.faqs (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text not null,
  category text not null default 'General',
  sort_order integer not null default 0,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index faqs_published_idx on public.faqs (published, sort_order);

create trigger faqs_touch
  before update on public.faqs
  for each row execute function public.touch_updated_at();

alter table public.faqs enable row level security;

create policy faqs_read_published on public.faqs
  for select to anon, authenticated
  using (published);

create policy faqs_read_all_staff on public.faqs
  for select to authenticated
  using (public.is_internal());

create policy faqs_write_staff on public.faqs
  for all to authenticated
  using (public.has_role('sales', 'admin'))
  with check (public.has_role('sales', 'admin'));


insert into public.faqs (question, answer, category, sort_order) values
  ('How long does installation take?',
   'Most residential systems are completed in 3 working days once permits are secured. Commercial rooftops typically run 2 to 6 weeks depending on size and structural work.',
   'Installation', 1),
  ('What warranty do I get?',
   'Panels carry a 25-year performance warranty, inverters 5 to 10 years depending on brand, and batteries 10 years. Our workmanship warranty is 2 years, with lifetime after-sales support.',
   'Warranty', 2),
  ('Do you handle net-metering applications?',
   'Yes. We prepare and file the complete distribution-utility application on your behalf, including the electrical plans signed by our professional electrical engineer.',
   'Permits', 3),
  ('What happens during a brownout?',
   'On-grid systems shut down for safety (anti-islanding). Hybrid and off-grid systems with batteries keep your essential loads running automatically.',
   'Technical', 4),
  ('Can I pay in instalments?',
   'Yes. We offer staged payments (down payment, delivery, commissioning) and partner with several banks and in-house financing providers for 12 to 36 month terms.',
   'Payment', 5),
  ('How much roof space do I need?',
   'About 6 square metres per kilowatt. A typical 6 kW home system needs roughly 36 square metres of unshaded roof. We confirm the exact figure during the free site survey.',
   'Technical', 6);


-- ============================================================================
-- The remaining company copy, as settings
-- ----------------------------------------------------------------------------
-- Lists are stored as JSON arrays. The read helper in the frontend parses them;
-- setting_num() is not involved, so no database trigger depends on the shape.
-- ============================================================================

insert into public.settings
  (key, value, category, label, description, value_type, unit, min_value, max_value, editable_by, is_public, sort_order)
values
  ('company.service_areas',
   '["Paranaque","Metro Manila","Cavite","Laguna","Rizal","Batangas","Bulacan","Pampanga"]',
   'company', 'Service areas',
   'Where the company installs. Shown on the contact page and the homepage. One entry per line.',
   'text', null, null, null, array['admin', 'sales']::public.user_role[], true, 10),

  ('company.brands',
   '["Canadian Solar","JA Solar","Deye","Huawei","Growatt","Pylontech"]',
   'company', 'Brands installed',
   'Logos strip on the homepage. One entry per line.',
   'text', null, null, null, array['admin', 'sales']::public.user_role[], true, 11),

  ('company.homes_powered', '1240', 'company', 'Homes powered',
   'Trust figure in the hero. Worth updating when it passes a round number.',
   'number', 'homes', 0, 1000000, array['admin', 'sales']::public.user_role[], true, 12),

  ('company.businesses_powered', '86', 'company', 'Businesses powered', null,
   'number', 'businesses', 0, 100000, array['admin', 'sales']::public.user_role[], true, 13),

  ('company.tagline', '"Power your home or business with the sun."',
   'company', 'Tagline', null, 'text', null, null, null,
   array['admin', 'sales']::public.user_role[], true, 14),

  ('company.facebook', '"facebook.com/solarbrosph"', 'company', 'Facebook page',
   null, 'text', null, null, null, array['admin', 'sales']::public.user_role[], true, 15)

on conflict (key) do nothing;
