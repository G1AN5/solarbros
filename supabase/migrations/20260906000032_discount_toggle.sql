-- ============================================================================
-- 0032 · DISCOUNTING CAN BE SWITCHED OFF ENTIRELY
-- ----------------------------------------------------------------------------
-- The quotation builder has a discount slider, defaulting to 0%, with an
-- authority limit above which an administrator must approve. That is the right
-- shape for a company that negotiates.
--
-- It is the wrong shape for one that does not. A published price list with a
-- discount control sitting under it invites every rep to use it, and invites
-- every customer who hears about it to ask. Some companies would rather the
-- control did not exist.
--
-- So it becomes a setting rather than a decision baked into the screen. Off,
-- the slider is not rendered and every quotation is at list price. On, it works
-- as before within the authority limit.
--
-- Two settings rather than one, because they answer different questions:
--
--   discount_enabled          may we discount at all?
--   discount_authority_pct    how much before someone senior signs off?
--
-- Collapsing them into "authority = 0" would half-work: the slider would still
-- be on screen, every movement of it would be refused, and the rep would learn
-- that the system is broken rather than that the policy is no discounting.
-- ============================================================================

insert into public.settings
  (key, value, category, label, description, value_type, unit, min_value, max_value, editable_by, is_public, sort_order)
values
  ('sales.discount_enabled', 'true', 'sales',
   'Allow discounts on quotations',
   'Turn this off and the discount control disappears from the quotation builder: every quote goes out at list price. Turn it on to let representatives discount up to their authority, with anything above that needing administrator approval.',
   'boolean', null, null, null, array['admin']::public.user_role[], false, 0)
on conflict (key) do nothing;


-- ----------------------------------------------------------------------------
-- The screen hiding a control is a courtesy, not a control. Enforce it where it
-- cannot be gone around: the discount-authority trigger from 0008 already runs
-- on every quotation write, so the switch is checked in the same place.
-- ----------------------------------------------------------------------------

create or replace function public.enforce_discount_authority()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit numeric := public.setting_num('sales.discount_authority_pct', 10);
  v_enabled boolean := coalesce(
    (select value = 'true'::jsonb from public.settings where key = 'sales.discount_enabled'),
    true
  );
begin
  if coalesce(new.discount_pct, 0) <= 0 then
    return new;
  end if;

  if not v_enabled then
    raise exception
      'Discounting is switched off. Quotations go out at list price — an administrator can change this in Settings.'
      using errcode = '42501';
  end if;

  if new.discount_pct > v_limit and new.discount_approved_by is null then
    raise exception
      'A discount of %.2f%% exceeds the standard authority and needs administrator approval before this quotation can be sent.',
      new.discount_pct
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_discount_authority() from public, anon, authenticated;
