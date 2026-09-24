import { Suspense, lazy, type ReactNode } from 'react'

import { Loader } from '@/components/ui/Loader'

/* ============================================================================
   CODE SPLITTING
   ----------------------------------------------------------------------------
   Each portal is loaded only when somebody actually navigates into it.

   WHY THIS MATTERS MORE THAN USUAL HERE
   Before splitting, the bundle was one 785 KB file: a prospect reading the
   homepage on mobile data downloaded the entire operations hub, the payroll
   screens and the field portal in order to see a price list. None of which
   they can even open.

   The public marketing site is the entry point for every visitor, so it stays
   eager and small. The three authenticated portals, and the heavier public
   pages that only some visitors open, load on demand.

   React.lazy needs a default export, so each import maps the named export
   across. Suspense boundaries live on the layout routes below.
   ========================================================================== */

/* Heavier public pages */
export const BlogPage = lazy(() =>
  import('@/features/public/BlogPage').then((m) => ({ default: m.BlogPage })),
)
export const BlogPostPage = lazy(() =>
  import('@/features/public/BlogPostPage').then((m) => ({ default: m.BlogPostPage })),
)
export const BookingPage = lazy(() =>
  import('@/features/public/BookingPage').then((m) => ({ default: m.BookingPage })),
)
export const EstimatorPage = lazy(() =>
  import('@/features/public/EstimatorPage').then((m) => ({ default: m.EstimatorPage })),
)
export const LegalPage = lazy(() =>
  import('@/features/public/LegalPage').then((m) => ({ default: m.LegalPage })),
)
export const PortfolioPage = lazy(() =>
  import('@/features/public/PortfolioPage').then((m) => ({ default: m.PortfolioPage })),
)

/* Client self-service portal */
export const BillingPage = lazy(() =>
  import('@/features/client-portal/BillingPage').then((m) => ({ default: m.BillingPage })),
)
export const ClientAppointmentsPage = lazy(() =>
  import('@/features/client-portal/ClientAppointmentsPage').then((m) => ({
    default: m.ClientAppointmentsPage,
  })),
)
export const ClientDashboardPage = lazy(() =>
  import('@/features/client-portal/ClientDashboardPage').then((m) => ({
    default: m.ClientDashboardPage,
  })),
)
export const ClientTicketsPage = lazy(() =>
  import('@/features/client-portal/ClientTicketsPage').then((m) => ({
    default: m.ClientTicketsPage,
  })),
)
export const ClientWarrantyPage = lazy(() =>
  import('@/features/client-portal/ClientWarrantyPage').then((m) => ({
    default: m.ClientWarrantyPage,
  })),
)
export const DocumentVaultPage = lazy(() =>
  import('@/features/client-portal/DocumentVaultPage').then((m) => ({
    default: m.DocumentVaultPage,
  })),
)
export const NotificationsPage = lazy(() =>
  import('@/features/client-portal/NotificationsPage').then((m) => ({
    default: m.NotificationsPage,
  })),
)
export const ProjectTrackerPage = lazy(() =>
  import('@/features/client-portal/ProjectTrackerPage').then((m) => ({
    default: m.ProjectTrackerPage,
  })),
)
export const UpgradeRequestPage = lazy(() =>
  import('@/features/client-portal/UpgradeRequestPage').then((m) => ({
    default: m.UpgradeRequestPage,
  })),
)

/* Enterprise operations hub */
export const SettingsPage = lazy(() =>
  import('@/features/admin/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)
export const ContentPage = lazy(() =>
  import('@/features/admin/ContentPage').then((m) => ({ default: m.ContentPage })),
)
export const AdminProjectDetailPage = lazy(() =>
  import('@/features/admin/AdminProjectDetailPage').then((m) => ({
    default: m.AdminProjectDetailPage,
  })),
)
export const AdminProjectsPage = lazy(() =>
  import('@/features/admin/AdminProjectsPage').then((m) => ({ default: m.AdminProjectsPage })),
)
export const AdminTicketsPage = lazy(() =>
  import('@/features/admin/AdminTicketsPage').then((m) => ({ default: m.AdminTicketsPage })),
)
export const AnalyticsPage = lazy(() =>
  import('@/features/admin/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })),
)
export const AssetRegistryPage = lazy(() =>
  import('@/features/admin/AssetRegistryPage').then((m) => ({ default: m.AssetRegistryPage })),
)
export const AuditLogPage = lazy(() =>
  import('@/features/admin/AuditLogPage').then((m) => ({ default: m.AuditLogPage })),
)
export const CrmPipelinePage = lazy(() =>
  import('@/features/admin/CrmPipelinePage').then((m) => ({ default: m.CrmPipelinePage })),
)
export const DispatchPage = lazy(() =>
  import('@/features/admin/DispatchPage').then((m) => ({ default: m.DispatchPage })),
)
export const FinancePage = lazy(() =>
  import('@/features/admin/FinancePage').then((m) => ({ default: m.FinancePage })),
)
/* Shared by all three portals — one page, mounted at three paths. */
export const ProfileSettingsPage = lazy(() =>
  import('@/features/account/ProfileSettingsPage').then((m) => ({
    default: m.ProfileSettingsPage,
  })),
)

export const GovernancePage = lazy(() =>
  import('@/features/admin/GovernancePage').then((m) => ({ default: m.GovernancePage })),
)
export const HrPayrollPage = lazy(() =>
  import('@/features/admin/HrPayrollPage').then((m) => ({ default: m.HrPayrollPage })),
)
export const ResetPasswordPage = lazy(() =>
  import('@/features/auth/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })),
)

export const OutboxPage = lazy(() =>
  import('@/features/admin/OutboxPage').then((m) => ({ default: m.OutboxPage })),
)

export const PermitsPage = lazy(() =>
  import('@/features/admin/PermitsPage').then((m) => ({ default: m.PermitsPage })),
)

export const PurchasingPage = lazy(() =>
  import('@/features/admin/PurchasingPage').then((m) => ({ default: m.PurchasingPage })),
)

export const InventoryPage = lazy(() =>
  import('@/features/admin/InventoryPage').then((m) => ({ default: m.InventoryPage })),
)
export const QuotesPage = lazy(() =>
  import('@/features/admin/QuotesPage').then((m) => ({ default: m.QuotesPage })),
)
export const WarrantyApprovalsPage = lazy(() =>
  import('@/features/admin/WarrantyApprovalsPage').then((m) => ({
    default: m.WarrantyApprovalsPage,
  })),
)

/* Field technician portal */
export const FieldAccountPage = lazy(() =>
  import('@/features/field/FieldAccountPage').then((m) => ({ default: m.FieldAccountPage })),
)
export const FieldJobPage = lazy(() =>
  import('@/features/field/FieldJobPage').then((m) => ({ default: m.FieldJobPage })),
)
export const FieldLoggingPage = lazy(() =>
  import('@/features/field/FieldLoggingPage').then((m) => ({ default: m.FieldLoggingPage })),
)
export const FieldSchedulePage = lazy(() =>
  import('@/features/field/FieldSchedulePage').then((m) => ({ default: m.FieldSchedulePage })),
)
export const FieldTodayPage = lazy(() =>
  import('@/features/field/FieldTodayPage').then((m) => ({ default: m.FieldTodayPage })),
)

/* Development reference */
export const SiteMapPage = lazy(() =>
  import('@/features/system/SiteMapPage').then((m) => ({ default: m.SiteMapPage })),
)

/* ============================================================================
   ROUTER — the application's complete page map
   ----------------------------------------------------------------------------
   Four top-level areas, each with its own layout shell and access rules:

     /              PublicLayout    → anyone           (lead generation)
     /login …       AuthLayout      → anyone           (sign in / register)
     /portal/*      ConsoleLayout   → client           (self-service portal)
     /admin/*       ConsoleLayout   → staff roles      (operations hub)
     /field/*       FieldLayout     → technician       (mobile job site)

   HOW THE AREAS CONNECT
     public /estimator ──submits──▶ creates a Lead ──▶ /admin/crm
     public /booking   ──submits──▶ creates an Appointment ──▶ /admin/dispatch
     /admin/crm  ──contract signed──▶ creates a Project ──▶ /admin/projects
     /admin/dispatch ──assigns──▶ /field (technician's Today list)
     /field  ──milestone ticked──▶ /admin/projects AND /portal/project
     /portal/tickets ──raises──▶ /admin/tickets ──▶ /admin/dispatch

   Visit /site-map in the running app for a rendered version of this diagram.

   PERFORMANCE NOTE: every page is imported eagerly for now, which keeps the
   structure obvious while the UI is being reviewed. Before launch, convert the
   three portal groups to React.lazy() so a public visitor never downloads the
   admin bundle.
   ========================================================================== */

/**
 * Wraps a layout so its lazily-loaded children have somewhere to suspend.
 *
 * `Loader` stays invisible for its first 400ms, so a chunk that arrives in tens
 * of milliseconds never flashes a spinner — while a slow connection gets moving
 * reassurance instead of a blank screen. The delay lives in the CSS animation,
 * so nothing re-renders when it appears.
 */
export function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Loader page label="Loading…" />}>{children}</Suspense>
}
