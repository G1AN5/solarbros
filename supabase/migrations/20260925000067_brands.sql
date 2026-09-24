-- ============================================================================
-- 0067  THE BRANDS STRIP, AS CONTENT
-- ----------------------------------------------------------------------------
-- "Trusted brands we install" was a comma-separated string in a settings row:
--
--     company.brands = "Canadian Solar,JA Solar,Deye,Ginza,SRNE,..."
--
-- which is fine for names and cannot hold a logo or a link. A logo dropped in
-- a folder would mean a developer and a deploy every time a supplier changes,
-- and a filename convention for somebody to get wrong.
--
-- A table instead: name, logo, website, order, active. The administrator adds
-- a brand and uploads its logo from the portal, and the strip on the home page
-- changes immediately. Logos go in the existing `public-media` bucket, which is
-- already public-read and already restricted to sales and admin for writes.
--
-- `company.brands` is left in place. Nothing reads it after this migration, but
-- deleting a settings row that somebody may have edited is not worth the two
-- kilobytes — and if this table is empty the strip falls back to it, so the
-- home page never loses the section during setup.
-- ============================================================================

create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  /* Path within `public-media`, or a full URL. Null renders the name as text,
     which is what the strip did before and is a perfectly good fallback for a
     supplier whose logo nobody has to hand. */
  logo_url text,
  website_url text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.brands is
  'Equipment brands shown on the home page strip. Edited under Website Content.';

create trigger brands_touch
  before update on public.brands
  for each row execute function public.touch_updated_at();

alter table public.brands enable row level security;

create policy brands_read_public on public.brands
  for select to anon, authenticated
  using (is_active);

create policy brands_read_all_staff on public.brands
  for select to authenticated
  using (public.is_internal());

-- The same pair who maintain the rest of the marketing content.
create policy brands_write_staff on public.brands
  for all to authenticated
  using (public.has_role('sales', 'admin'))
  with check (public.has_role('sales', 'admin'));


-- ----------------------------------------------------------------------------
-- Seeded from the names already configured
-- ----------------------------------------------------------------------------
-- Websites filled in where they are unambiguous; logos are left null because
-- a logo is the supplier's property and has to be uploaded deliberately rather
-- than hot-linked from their site.

insert into public.brands (name, website_url, sort_order)
select v.name, v.website_url, v.sort_order
from (values
  ('Canadian Solar', 'https://www.canadiansolar.com/', 1),
  ('JA Solar',       'https://www.jasolar.com/',       2),
  ('Deye',           'https://www.deyeinverter.com/',  3),
  ('Ginza',          null,                             4),
  ('SRNE',           'https://www.srnesolar.com/',     5),
  ('Osda',           'https://www.osdasolar.com/',     6),
  ('SolaHestia',     null,                             7),
  ('Solis',          'https://www.solisinverters.com/', 8),
  ('Seraphim',       'https://www.seraphim-energy.com/', 9)
) as v(name, website_url, sort_order)
where not exists (select 1 from public.brands);
