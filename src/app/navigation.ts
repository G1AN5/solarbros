/* ============================================================================
   NAVIGATION MAP
   ----------------------------------------------------------------------------
   The single source of truth for every menu in the app. Sidebars, the public
   header, the technician tab bar and the Site Map page all render from these
   arrays — so a destination can never exist in one menu but be missing from
   another.

   Adding a page = add a route in router.tsx + one entry here.

   Each internal item carries `roles`, which does two jobs at once:
     • hides menu entries the signed-in user may not open, and
     • documents the intended RBAC matrix in one readable place.
   ========================================================================== */

import type { UserRole } from '@/types/domain'
import { STAFF_ROLES } from '@/types/domain'

export interface NavItem {
  label: string
  to: string
  /** Emoji stand-ins. Swap for an icon set (lucide-react) when design is final. */
  icon?: string
  /** Omit to allow every role that can reach the surrounding portal. */
  roles?: UserRole[]
  description?: string
}

export interface NavGroup {
  heading: string
  items: NavItem[]
}

/* ============================================================================
   1. PUBLIC SITE — unauthenticated lead generation
   ========================================================================== */

export const PUBLIC_NAV: NavItem[] = [
  {
    label: 'Packages',
    to: '/packages',
    description: 'Pricing, inclusions and the on-grid / hybrid / off-grid comparison.',
  },
  {
    label: 'Estimator',
    to: '/estimator',
    description: 'Interactive savings calculator — the primary lead capture point.',
  },
  { label: 'Projects', to: '/portfolio', description: 'Gallery of completed installations.' },
  {
    label: 'How It Works',
    to: '/how-it-works',
    description: 'The end-to-end process, payment options and after-sales support.',
  },
  {
    label: 'Resources',
    to: '/blog',
    description: 'SEO blog: buying guides, maintenance tips, policy explainers.',
  },
  {
    label: 'Book a Visit',
    to: '/booking',
    description: 'Self-service calendar for consultations and site surveys.',
  },
  {
    label: 'Contact',
    to: '/contact',
    description: 'Office location, hours, service areas and FAQ.',
  },
]

/* ============================================================================
   2. CLIENT SELF-SERVICE PORTAL — /portal
   Audience: an active customer. Goal: answer their questions without a phone
   call, which is why every item mirrors something staff would otherwise be
   asked for.
   ========================================================================== */

export const CLIENT_NAV: NavGroup[] = [
  {
    heading: 'My System',
    items: [
      {
        label: 'Dashboard',
        to: '/portal',
        icon: '◈',
        description: 'Project status, balance and next appointment at a glance.',
      },
      {
        label: 'Project Tracker',
        to: '/portal/project',
        icon: '◷',
        description: 'Live milestone timeline, updated by technicians in the field.',
      },
      {
        label: 'Document Vault',
        to: '/portal/documents',
        icon: '▤',
        description: 'Contracts, receipts, permits, warranty and turnover certificates.',
      },
      {
        label: 'Warranty',
        to: '/portal/warranty',
        icon: '⛨',
        description: 'Registered serial numbers; request a transfer when selling the home.',
      },
    ],
  },
  {
    heading: 'Service',
    items: [
      {
        label: 'Appointments',
        to: '/portal/appointments',
        icon: '▦',
        description: 'Book and review installation and maintenance visits.',
      },
      {
        label: 'Support Tickets',
        to: '/portal/tickets',
        icon: '✉',
        description: 'Raise hardware or performance issues and track resolution.',
      },
      {
        label: 'Request Upgrade',
        to: '/portal/upgrade',
        icon: '⇧',
        description: 'Ask for a system expansion — feeds straight back into the CRM.',
      },
    ],
  },
  {
    heading: 'Account',
    items: [
      {
        label: 'Billing',
        to: '/portal/billing',
        icon: '₱',
        description: 'Staged invoices, payment history and downloadable receipts.',
      },
      {
        label: 'Notifications',
        to: '/portal/notifications',
        icon: '◉',
        description: 'Milestone alerts and appointment reminders (in-app / email / SMS).',
      },
      {
        label: 'Messages',
        to: '/portal/messages',
        icon: '✎',
        description: 'Talk directly to the people working on your installation.',
      },
      {
        label: 'Your Profile',
        to: '/portal/profile',
        icon: '☺',
        description: 'Your name, contact details and photo.',
      },
    ],
  },
]

/* ============================================================================
   3. ENTERPRISE OPERATIONS HUB — /admin
   Audience: internal staff. Every item is role-gated.
   ========================================================================== */

export const ADMIN_NAV: NavGroup[] = [
  {
    heading: 'Overview',
    items: [
      {
        label: 'Analytics',
        to: '/admin',
        icon: '◨',
        roles: ['admin', 'accountant', 'sales'],
        description: 'Executive KPIs: revenue, conversion, utilisation, stock turnaround.',
      },
    ],
  },
  {
    heading: 'Revenue',
    items: [
      {
        label: 'Leads & Pipeline',
        to: '/admin/crm',
        icon: '◐',
        roles: ['admin', 'sales'],
        description: 'Kanban pipeline with lead scoring. Receives leads from the public estimator.',
      },
      {
        label: 'Quotations & BOM',
        to: '/admin/quotes',
        icon: '▧',
        roles: ['admin', 'sales', 'accountant'],
        description: 'Generate quotes; auto-build the Bill of Materials and reserve stock.',
      },
    ],
  },
  {
    heading: 'Operations',
    items: [
      {
        label: 'Projects',
        to: '/admin/projects',
        icon: '▣',
        roles: ['admin', 'project_engineer', 'sales'],
        description: 'Installation tracking across all seven milestones.',
      },
      {
        label: 'Dispatch Board',
        to: '/admin/dispatch',
        icon: '▦',
        roles: ['admin', 'project_engineer'],
        description: 'Assign technicians to surveys, installations and maintenance visits.',
      },
      {
        label: 'Permits & Approvals',
        to: '/admin/permits',
        icon: '⚖',
        roles: ['admin', 'project_engineer'],
        description:
          "External approvals — LGU, electrical, utility, net metering. Decisions are recorded on the authority's behalf and audited as proxy entries.",
      },
      {
        label: 'Support Tickets',
        to: '/admin/tickets',
        icon: '✉',
        roles: ['admin', 'project_engineer', 'sales'],
        description: 'Queue of client-raised issues; converts into dispatched service visits.',
      },
    ],
  },
  {
    heading: 'Supply Chain',
    items: [
      {
        label: 'Inventory',
        to: '/admin/inventory',
        icon: '▩',
        roles: ['admin', 'inventory_manager', 'project_engineer'],
        description: 'Real-time stock, reservations against signed contracts, reorder alerts.',
      },
      {
        label: 'Purchasing',
        to: '/admin/purchasing',
        icon: '⇩',
        roles: ['admin', 'inventory_manager', 'accountant'],
        description:
          'Purchase orders, supplier confirmations and goods receipt. Receiving a delivery is what raises the warehouse balance.',
      },
      {
        label: 'Asset Registry',
        to: '/admin/assets',
        icon: '⛨',
        roles: ['admin', 'inventory_manager'],
        description: 'Serial-number registry mapping installed hardware to warranties.',
      },
      {
        label: 'Warranty Approvals',
        to: '/admin/warranty',
        icon: '✓',
        roles: ['admin', 'inventory_manager'],
        description: 'Review client-submitted registrations and transfer requests.',
      },
    ],
  },
  {
    heading: 'Finance & People',
    items: [
      {
        label: 'Invoicing',
        to: '/admin/finance',
        icon: '₱',
        roles: ['admin', 'accountant'],
        description:
          'Staged milestone invoices, collections and ageing. Payments arrive by bank transfer and are recorded here by hand.',
      },
      {
        label: 'Payroll register',
        to: '/admin/hr',
        icon: '◍',
        roles: ['admin', 'accountant'],
        description:
          'What was paid, to whom, for which period. A record rather than a calculator — statutory contributions are worked out elsewhere and entered here.',
      },
    ],
  },
  {
    heading: 'Governance',
    items: [
      {
        label: 'Website Content',
        to: '/admin/content',
        icon: '\u25a4',
        roles: ['sales', 'admin'],
        description: 'Portfolio, blog and customer reviews shown on the public site',
      },
      {
        label: 'Business Settings',
        to: '/admin/settings',
        icon: '\u2699',
        // Every internal role can SEE the rules they work under; the database
        // decides which of them each role may actually change.
        roles: ['sales', 'project_engineer', 'inventory_manager', 'accountant', 'admin'],
        description: 'Pricing, discount limits, lead scoring, payment terms and thresholds',
      },
      {
        label: 'Roles & Access',
        to: '/admin/governance',
        icon: '⚿',
        roles: ['admin'],
        description: 'RBAC matrix — which role may read or write each module.',
      },
      {
        label: 'Notification Outbox',
        to: '/admin/outbox',
        icon: '✉',
        roles: ['admin'],
        description:
          'Every email and SMS the system has raised, and whether it was delivered. Outbound messaging is the part that fails silently.',
      },
      {
        label: 'Audit Log',
        to: '/admin/audit',
        icon: '☰',
        roles: ['admin'],
        description: 'Immutable record of privileged actions, for compliance review.',
      },
      {
        label: 'Messages',
        to: '/admin/messages',
        icon: '✎',
        /* No `roles`: every staff role can message every other. */
        description: 'Direct messages with colleagues and your own customers.',
      },
      {
        label: 'Your Profile',
        to: '/admin/profile',
        icon: '☺',
        /* No `roles`, so every staff role gets it. Everybody has a name and a
           face, whatever they are allowed to read. */
        description: 'Your name, contact details and photo.',
      },
    ],
  },
]

/* ============================================================================
   4. FIELD TECHNICIAN PORTAL — /field
   Mobile-first. Deliberately only FOUR destinations: a technician on a roof in
   the sun needs large tap targets and no menu diving.
   ========================================================================== */

export const FIELD_NAV: NavItem[] = [
  {
    label: 'Today',
    to: '/field',
    icon: '☀',
    description: "The technician's assigned jobs for the day, with addresses and materials.",
  },
  {
    label: 'Schedule',
    to: '/field/schedule',
    icon: '▦',
    description: 'Upcoming week, pushed from the admin Dispatch Board.',
  },
  {
    label: 'Logging',
    to: '/field/logging',
    icon: '⛭',
    description: 'Geotagged photos, serial-number scanning and consumed-material logging.',
  },
  {
    label: 'Messages',
    to: '/field/messages',
    icon: '✎',
    description: 'Reach the office or the customer whose roof you are standing on.',
  },
  {
    label: 'Account',
    to: '/field/account',
    icon: '◉',
    description: 'Profile, offline sync status and sign-out.',
  },
]

/** Every role that may enter the Operations Hub. Re-exported for the router. */
export { STAFF_ROLES }
