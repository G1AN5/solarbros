# SolarBros — UI Architecture

How this codebase is organised, why it is organised that way, and where the
uploaded requirements ended up.

**Nothing here talks to a backend yet.** Every screen renders from
`src/mocks/index.ts`. The app runs with `npm run dev` and needs no Supabase
credentials.

> **Tip:** run the app and open **`/site-map`**. It renders this document's page
> map and data-flow tables live, generated from the navigation config, so it can
> never go stale.

---

## 1. The four portals

The application is four distinct products sharing one codebase and one database.

| Portal                         | Route     | Audience      | Purpose                                                           |
| ------------------------------ | --------- | ------------- | ----------------------------------------------------------------- |
| **Public Web Platform**        | `/`       | Anyone        | Lead generation — capture prospects, funnel into the CRM          |
| **Client Self-Service Portal** | `/portal` | `client`      | Transparency — answer customer questions without a phone call     |
| **Enterprise Operations Hub**  | `/admin`  | 5 staff roles | Run the business — CRM, projects, dispatch, supply chain, finance |
| **Field Technician Portal**    | `/field`  | `technician`  | Capture accurate data at the job site, offline-tolerant           |

Each has its own layout shell and its own access rule, declared in
`src/app/router.tsx`.

---

## 2. Folder structure

```
src/
├── app/                       Application wiring — no UI here
│   ├── router.tsx             ★ THE COMPLETE PAGE MAP. Read this first.
│   ├── navigation.ts          ★ Single source of truth for every menu + RBAC
│   └── auth/
│       ├── AuthContext.ts     Context object (separate file for Fast Refresh)
│       ├── AuthProvider.tsx   Mock auth — swap internals for Supabase Auth
│       ├── useAuth.ts         The hook every screen uses
│       ├── ProtectedRoute.tsx Route guard
│       ├── roles.ts           Where each role lands after sign-in
│       └── demo-users.ts      Dev fixtures — DELETE once auth is real
│
├── components/
│   ├── layout/                The four portal shells + logo + dev role switcher
│   ├── ui/                    Primitives: Button, Card, Badge, DataTable,
│   │                          Timeline, Progress, Tabs, StatTile, PageHeader
│   └── charts/                BarChart, FunnelChart (no chart library)
│
├── features/                  One folder per portal; one file per page
│   ├── public/                10 marketing pages
│   ├── auth/                  Login, register, forgot password
│   ├── client-portal/         9 customer screens
│   ├── admin/                 14 operations screens
│   ├── field/                 5 mobile technician screens
│   └── system/                Site map, 404
│
├── lib/
│   ├── format.ts              Currency, dates, relative time (pure)
│   ├── labels.ts              ★ Every enum's display label + status colour
│   ├── solar-estimator.ts     Sizing & savings maths (pure, unit-testable)
│   └── supabase.ts            Client placeholder — tolerant of missing env
│
├── mocks/index.ts             All sample data. One export per future DB table.
├── types/domain.ts            ★ The domain vocabulary — mirrors future schema
└── styles/                    tokens → base → layout → components → marketing → viz
```

The three ★ files are where the architecture actually lives. Everything else
follows from them.

---

## 3. How the portals connect

This is the real system. Each row is an event in one portal that creates or
changes a record another portal reads.

| Trigger                               | From               | To                                        | Effect                                                                |
| ------------------------------------- | ------------------ | ----------------------------------------- | --------------------------------------------------------------------- |
| Visitor completes the estimator       | `/estimator`       | `/admin/crm`                              | Creates a lead (`source: estimator`), emails a PDF quote              |
| Visitor requests a personalised quote | `/contact`         | `/admin/crm`                              | Higher-intent lead (`source: quote_request`)                          |
| Visitor books a consultation/survey   | `/booking`         | `/admin/dispatch`                         | Appointment with status `requested`                                   |
| Rep builds a quote from a package     | `/admin/quotes`    | `/admin/inventory`                        | Generates the BOM, checks stock                                       |
| Contract signed (lead → `contract`)   | `/admin/crm`       | `/admin/projects`                         | Creates project, reserves stock, issues down-payment invoice          |
| Coordinator assigns a crew            | `/admin/dispatch`  | `/field`                                  | Status `dispatched`; appears on the technician's Today list           |
| **Technician ticks a milestone**      | `/field/jobs/:id`  | `/portal/project` **+** `/admin/projects` | One write moves the customer's progress bar _and_ updates operations  |
| Technician scans serial numbers       | `/field/logging`   | `/admin/assets` + `/portal/warranty`      | Creates asset registry rows; client sees registered warranties        |
| Technician logs consumed materials    | `/field/logging`   | `/admin/inventory`                        | Deducts on-hand stock, clears the reservation                         |
| Milestone "commissioning" completes   | `/field`           | `/admin/finance`                          | Triggers the final staged invoice                                     |
| Client raises a support ticket        | `/portal/tickets`  | `/admin/tickets`                          | Triage queue; may become a dispatched repair visit                    |
| Client requests a warranty transfer   | `/portal/warranty` | `/admin/warranty`                         | Approval queue; approval rewrites asset ownership                     |
| Client requests a system upgrade      | `/portal/upgrade`  | `/admin/crm`                              | New lead (`source: referral`) — an expansion sale, not a support case |
| Any privileged action                 | All modules        | `/admin/audit`                            | Written by DB triggers to an append-only table                        |

**The single most important flow is the milestone one.** The `<Timeline>`
component in `src/components/ui/Timeline.tsx` is shared between the customer's
tracker, the admin project view, and the technician's updater. Because all three
render the same `Milestone[]`, the customer's progress bar cannot disagree with
what the technician ticked off on the roof.

---

## 4. Where the uploaded spec was consolidated

The requirements listed several capabilities more than once under different
portals. These are the merges — **worth reviewing in case any contradict your
intent.**

| Spec items                                                                   | Became                                                                                 | Why                                                                                                                                                                    |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Four separate "calendar scheduling systems" (one per portal)                 | **One** `appointments` model with four views                                           | They are the same records seen by different audiences. Separate systems would need constant reconciliation.                                                            |
| "Compare packages toggle" + "System comparison table" + "Packages pricing"   | One `/packages` page with a card ⇄ table toggle, plus an architecture comparison below | A visitor decides "which package" and "which system type" in one sitting.                                                                                              |
| "Support ticketing" + "Preventive maintenance & ticketing"                   | One `tickets` model with a `category` field                                            | Both follow the same triage → assign → dispatch → resolve lifecycle.                                                                                                   |
| "Asset & Document Vault" + "Warranty & Asset Registry"                       | **Split** into `documents` (files) and `serialized_assets` (hardware)                  | One bullet, genuinely two things. Conflating them makes warranty tracking impossible.                                                                                  |
| "Projects Portfolio" (public) vs "Projects" (admin)                          | Deliberately kept **separate**                                                         | Portfolio is curated marketing with consented photos; operational projects hold addresses and contract values. Wiring them together would leak customer data publicly. |
| "Solar estimator" + "Request personalised quotation"                         | Two entry points into one lead funnel                                                  | Different intent levels feeding the same pipeline; the `source` field distinguishes them for lead scoring.                                                             |
| "How it works" + "Flexible payment options" + "Lifetime after-sales support" | One `/how-it-works` page, three sections                                               | All three answer: "what happens after I say yes?"                                                                                                                      |
| ~18 landing-page bullets                                                     | 10 sections on `/` + 4 dedicated routes                                                | Heavy interactive pieces (estimator, booking calendar, package comparison, blog) got their own routes so the landing page stays fast and scannable.                    |

---

## 5. Roles

Seven roles, from the spec's RBAC section. Defined in `src/types/domain.ts`.

| Role                | Lands on  | Scope                                      |
| ------------------- | --------- | ------------------------------------------ |
| `client`            | `/portal` | Their own project only                     |
| `technician`        | `/field`  | Only jobs assigned to them                 |
| `sales`             | `/admin`  | CRM, quotes, projects, tickets             |
| `project_engineer`  | `/admin`  | Projects, dispatch, tickets, inventory     |
| `inventory_manager` | `/admin`  | Inventory, assets, warranty approvals      |
| `accountant`        | `/admin`  | Finance, payroll, analytics                |
| `admin`             | `/admin`  | Everything, including governance and audit |

`/admin/governance` renders the full permission matrix, **generated** from the
`roles` field on each item in `src/app/navigation.ts` — so the documentation of
who-can-see-what cannot drift from the actual navigation.

### ⚠️ Security: this is navigation, not enforcement

Every role check in this codebase decides **what to render**. None of it stops a
determined user, who can edit client-side JavaScript or call the API directly.

**Before any real data goes in, every table needs Row Level Security policies in
Postgres.** Treat the matrix on `/admin/governance` as the _spec_ those policies
must implement, and test them against the database directly — passing in the UI
proves nothing.

---

## 6. Previewing all four portals

There is no backend, so sign-in is mocked. Two ways in:

1. **The ⚙ button, bottom-right of every screen** (development only) — switch to
   any of the seven roles and jump straight to that portal.
2. **`/login`** — the dev panel at the bottom of the form has a button per role.

The chosen role is stored in `localStorage` so a refresh keeps you signed in.
Both helpers are wrapped in `import.meta.env.DEV` and cannot reach production.

---

## 7. Design system

No CSS framework — a token-based system in `src/styles/`, loaded in order:

| File             | Contains                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `tokens.css`     | Every colour, space, radius, shadow. **Change the brand here and all ~50 screens re-skin.** |
| `base.css`       | Element resets and focus styles                                                             |
| `layout.css`     | The four portal shells + layout helpers (`.stack`, `.row`, `.grid`)                         |
| `components.css` | Button, Card, Badge, Table, Timeline, Kanban, Tabs, …                                       |
| `marketing.css`  | Public-site-only styling (hero, pricing, calendar, FAQ)                                     |
| `viz.css`        | Chart palette — validated separately, see below                                             |

No component hard-codes a hex value. Migrating to Tailwind later is possible
without touching component logic, since the classes are already semantic.

### Chart colours are deliberately _not_ brand amber

Charts use a validated blue palette, for two reasons:

1. Amber sits below 3:1 contrast on white — poor for data marks.
2. Keeping data ink distinct from action ink stops the dashboard becoming an
   undifferentiated amber wash.

The single-series colour and the ordinal funnel ramp were both checked with a
palette validator against this app's actual white chart surface (monotone
lightness, ≥0.06 step gaps, single hue, contrast). Details in `viz.css`.

---

## 8. What is intentionally unfinished

| Area              | State           | Note                                                                                                                                        |
| ----------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| All data          | Mock            | `src/mocks/index.ts`; one export per future table                                                                                           |
| Auth              | Mock            | Swap `AuthProvider` internals; the context shape stays                                                                                      |
| Payments          | UI only         | The "Pay now" button is inert. A live gateway means PCI scope + webhook reconciliation — scope separately.                                  |
| Payroll           | UI template     | As the spec scoped it. SSS/PhilHealth/Pag-IBIG, BIR withholding and 13th-month are **not** implemented.                                     |
| Drag-and-drop CRM | Not implemented | Card markup and drop targets exist; add `@dnd-kit/core` when prioritised.                                                                   |
| Offline sync      | UI stub         | Field portal shows sync state. Real version needs a service worker + IndexedDB write queue.                                                 |
| Maps              | Placeholders    | Dispatch routing, site location, office map                                                                                                 |
| Legal copy        | Placeholder     | Marked with a visible warning banner on the page                                                                                            |
| Code splitting    | Not done        | Every page imports eagerly. Convert the three portals to `React.lazy()` before launch so a public visitor never downloads the admin bundle. |
| Icons             | Emoji           | Swap for `lucide-react` when the design is final                                                                                            |

---

## 9. Connecting the backend

The migration path each screen expects:

1. Create the schema as **migration files** in `supabase/migrations/`, using
   `src/types/domain.ts` as the specification.
2. Enable **RLS on every table** and write policies matching
   `/admin/governance`.
3. Fill `.env.local` from `.env.example`.
4. `npx supabase gen types typescript --linked | Out-File -Encoding utf8 src/types/database.ts`
5. Uncomment the `Database` generic in `src/lib/supabase.ts`.
6. Per screen: replace the `@/mocks` import with a TanStack Query hook.
   `QueryClientProvider` is already wired in `src/App.tsx`.

Because the mock shapes already match `src/types/domain.ts`, **no component
markup needs to change** — only the line that fetches the data.
