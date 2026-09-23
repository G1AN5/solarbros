-- ============================================================================
-- 0034 · TICKET REFERENCES FROM THE SEQUENCE
-- ----------------------------------------------------------------------------
-- `useRaiseTicket` generated its reference in the browser:
--
--     `TKT-${year}-${Math.floor(Math.random() * 9000 + 1000)}`
--
-- `tickets.reference` is UNIQUE, and the seeded tickets are TKT-2026-1000 and
-- TKT-2026-1001 — both inside that random range. So a customer raising a ticket
-- had a real chance of colliding and being refused, for reasons entirely
-- outside their control, on the screen they use when something is already
-- wrong.
--
-- Random numbers do not avoid collisions; sequences do. Same fix as quotations
-- and contracts in 0024, and purchase orders in 0026 — worth naming as a
-- pattern, because this is the fourth table where a reference was invented
-- outside the database.
-- ============================================================================

alter table public.tickets
  alter column reference set default
    'TKT-' || to_char(now(), 'YYYY') || '-' || nextval('public.ticket_ref_seq')::text;

comment on column public.tickets.reference is
  'TKT-<year>-<sequence>. From a sequence — a browser-generated random number collides.';
