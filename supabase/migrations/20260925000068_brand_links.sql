-- ============================================================================
-- 0068  TWO CORRECTIONS TO THE BRAND STRIP
-- ----------------------------------------------------------------------------
-- 0067 seeded the nine brand names already configured, filling in websites only
-- where they were unambiguous. Two were left blank and both turned out to be
-- answerable:
--
--   Ginza      — ginzapower.com
--   SolaHestia — has no site served over HTTPS
--
-- SolaHestia is removed rather than left as a dead name. A logo in a strip of
-- suppliers that cannot be clicked, next to eight that can, reads as broken;
-- and linking a page that is not served securely would put a browser warning
-- in front of a prospect who was doing nothing more than checking a supplier.
-- It can be added back from Website Content the day they publish one.
--
-- Done as a migration rather than by hand so that a fresh database comes up
-- matching this one. Both are ordinary content edits from here on — the Brands
-- tab does all of it without SQL.
-- ============================================================================

update public.brands
set website_url = 'https://ginzapower.com'
where lower(name) = 'ginza'
  and website_url is null;

delete from public.brands
where lower(name) = 'solahestia';
