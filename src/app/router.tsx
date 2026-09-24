import type { ReactElement } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'

import {
  Lazy,
  ContentPage,
  SettingsPage,
  AdminProjectDetailPage,
  AdminProjectsPage,
  AdminTicketsPage,
  AnalyticsPage,
  AssetRegistryPage,
  AuditLogPage,
  BillingPage,
  BlogPage,
  BlogPostPage,
  BookingPage,
  ClientAppointmentsPage,
  ClientDashboardPage,
  ClientTicketsPage,
  ClientWarrantyPage,
  CrmPipelinePage,
  DispatchPage,
  DocumentVaultPage,
  EstimatorPage,
  FieldAccountPage,
  FieldJobPage,
  FieldLoggingPage,
  FieldSchedulePage,
  FieldTodayPage,
  FinancePage,
  GovernancePage,
  HrPayrollPage,
  InventoryPage,
  LegalPage,
  MessagesPage,
  NotificationsPage,
  ProfileSettingsPage,
  OutboxPage,
  PermitsPage,
  PortfolioPage,
  ProjectTrackerPage,
  PurchasingPage,
  ResetPasswordPage,
  QuotesPage,
  SiteMapPage,
  UpgradeRequestPage,
  WarrantyApprovalsPage,
} from './lazy-pages'

import { ProtectedRoute } from './auth/ProtectedRoute'
import { RequireRole } from './auth/RequireRole'
import { rolesFor } from './auth/route-access'
import { STAFF_ROLES } from '@/types/domain'
import { ADMIN_NAV, CLIENT_NAV } from './navigation'

/* Layout shells */
import { AuthLayout } from '@/components/layout/AuthLayout'
import { ConsoleLayout } from '@/components/layout/ConsoleLayout'
import { FieldLayout } from '@/components/layout/FieldLayout'
import { PublicLayout } from '@/components/layout/PublicLayout'

/* Public site */
import { HomePage } from '@/features/public/HomePage'
import { PackagesPage } from '@/features/public/PackagesPage'
import { HowItWorksPage } from '@/features/public/HowItWorksPage'
import { ContactPage } from '@/features/public/ContactPage'

/* Auth */
import { LoginPage } from '@/features/auth/LoginPage'
import { RegisterPage } from '@/features/auth/RegisterPage'
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage'
import { StaffLoginPage } from '@/features/auth/StaffLoginPage'
import { StaffRegisterPage } from '@/features/auth/StaffRegisterPage'
import { StaffForgotPasswordPage } from '@/features/auth/StaffForgotPasswordPage'

/* Client self-service portal */

/* Enterprise operations hub */

/* Field technician portal */

/* System pages */
import { NotFoundPage } from '@/features/system/NotFoundPage'

/**
 * Wraps a staff page in the role check its own menu entry declares.
 *
 * The roles are LOOKED UP rather than written here. Listing them twice — once
 * in the sidebar, once beside the route — means the day somebody widens one and
 * forgets the other, the menu and the guard disagree and nothing complains.
 */
function guard(path: string, element: ReactElement): ReactElement {
  return <RequireRole allow={rolesFor(path)}>{element}</RequireRole>
}

export const router = createBrowserRouter([
  /* ---------------------------------------------------------------- PUBLIC */
  {
    path: '/',
    element: (
      <Lazy>
        <PublicLayout />
      </Lazy>
    ),
    errorElement: <NotFoundPage />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'packages', element: <PackagesPage /> },
      { path: 'portfolio', element: <PortfolioPage /> },
      { path: 'estimator', element: <EstimatorPage /> },
      { path: 'booking', element: <BookingPage /> },
      { path: 'how-it-works', element: <HowItWorksPage /> },
      { path: 'blog', element: <BlogPage /> },
      { path: 'blog/:slug', element: <BlogPostPage /> },
      { path: 'contact', element: <ContactPage /> },
      { path: 'legal/:document', element: <LegalPage /> },
      /* Developer aid: a rendered map of every route in the app. */
      { path: 'site-map', element: <SiteMapPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },

  /* ------------------------------------------------------------------ AUTH */
  {
    element: (
      <Lazy>
        <AuthLayout />
      </Lazy>
    ),
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/reset-password', element: <ResetPasswordPage /> },
      /* ------------------------------------------------- STAFF ENTRANCE
         Separate from the customer's. Unlisted, excluded in robots.txt and
         marked noindex — but being unlisted is NOT the security. Anybody who
         finds /staff/register can submit it, and gets an account parked on the
         'client' role and inactive until an administrator approves the role
         they claimed. Obscurity keeps the page out of a customer's way; the
         database is what keeps it harmless.

         The customer's own pages stay at /login and /register so the two
         audiences never meet a form meant for the other. */
      { path: '/staff/login', element: <StaffLoginPage /> },
      { path: '/staff/register', element: <StaffRegisterPage /> },
      { path: '/staff/forgot-password', element: <StaffForgotPasswordPage /> },

      // The old address, kept so any link already circulated still works.
      { path: '/team', element: <Navigate to="/staff/login" replace /> },
    ],
  },

  /* -------------------------------------------------- CLIENT PORTAL (/portal)
     Only the `client` role. Staff who need to see a customer's view use the
     admin project detail page instead, so client data access stays auditable. */
  {
    element: <ProtectedRoute allow={['client']} />,
    children: [
      {
        path: '/portal',
        element: (
          <Lazy>
            <ConsoleLayout nav={CLIENT_NAV} portalName="Client Portal" />
          </Lazy>
        ),
        children: [
          { index: true, element: <ClientDashboardPage /> },
          { path: 'project', element: <ProjectTrackerPage /> },
          { path: 'documents', element: <DocumentVaultPage /> },
          { path: 'warranty', element: <ClientWarrantyPage /> },
          { path: 'appointments', element: <ClientAppointmentsPage /> },
          { path: 'tickets', element: <ClientTicketsPage /> },
          { path: 'upgrade', element: <UpgradeRequestPage /> },
          { path: 'billing', element: <BillingPage /> },
          { path: 'notifications', element: <NotificationsPage /> },
          { path: 'messages', element: <MessagesPage /> },
          { path: 'profile', element: <ProfileSettingsPage /> },
        ],
      },
    ],
  },

  /* ------------------------------------------- OPERATIONS HUB (/admin)
     TWO gates, asking different questions.

       ProtectedRoute  may you be in the operations hub at all?
       guard(...)      may you open THIS page?

     The second one used to be missing. `roles` on a menu item hid the link and
     nothing more, so a sales rep who typed /admin/hr or /admin/audit got the
     page — empty, because RLS refuses the data, but open. `guard` reads the
     same menu entry, so the link and the door now agree by construction.

     Neither is the security boundary. RLS is, and it is verified separately by
     `npm run verify:rls`. */
  {
    element: <ProtectedRoute allow={STAFF_ROLES} />,
    children: [
      {
        path: '/admin',
        element: (
          <Lazy>
            <ConsoleLayout nav={ADMIN_NAV} portalName="Operations Hub" />
          </Lazy>
        ),
        children: [
          { index: true, element: guard('/admin', <AnalyticsPage />) },
          { path: 'crm', element: guard('/admin/crm', <CrmPipelinePage />) },
          { path: 'quotes', element: guard('/admin/quotes', <QuotesPage />) },
          { path: 'projects', element: guard('/admin/projects', <AdminProjectsPage />) },
          {
            path: 'projects/:projectId',
            element: guard('/admin/projects/:projectId', <AdminProjectDetailPage />),
          },
          { path: 'dispatch', element: guard('/admin/dispatch', <DispatchPage />) },
          { path: 'tickets', element: guard('/admin/tickets', <AdminTicketsPage />) },
          { path: 'permits', element: guard('/admin/permits', <PermitsPage />) },
          { path: 'inventory', element: guard('/admin/inventory', <InventoryPage />) },
          { path: 'purchasing', element: guard('/admin/purchasing', <PurchasingPage />) },
          { path: 'assets', element: guard('/admin/assets', <AssetRegistryPage />) },
          { path: 'warranty', element: guard('/admin/warranty', <WarrantyApprovalsPage />) },
          { path: 'finance', element: guard('/admin/finance', <FinancePage />) },
          { path: 'hr', element: guard('/admin/hr', <HrPayrollPage />) },
          { path: 'content', element: guard('/admin/content', <ContentPage />) },
          { path: 'settings', element: guard('/admin/settings', <SettingsPage />) },
          { path: 'governance', element: guard('/admin/governance', <GovernancePage />) },
          { path: 'outbox', element: guard('/admin/outbox', <OutboxPage />) },
          { path: 'audit', element: guard('/admin/audit', <AuditLogPage />) },
          { path: 'messages', element: guard('/admin/messages', <MessagesPage />) },
          { path: 'profile', element: guard('/admin/profile', <ProfileSettingsPage />) },
        ],
      },
    ],
  },

  /* --------------------------------------------- FIELD PORTAL (/field)
     Technicians only. Admins are redirected to /admin by ProtectedRoute — use
     the dev RoleSwitcher to preview this portal. */
  {
    element: <ProtectedRoute allow={['technician']} />,
    children: [
      {
        path: '/field',
        element: (
          <Lazy>
            <FieldLayout />
          </Lazy>
        ),
        children: [
          { index: true, element: <FieldTodayPage /> },
          { path: 'jobs/:jobId', element: <FieldJobPage /> },
          { path: 'schedule', element: <FieldSchedulePage /> },
          { path: 'logging', element: <FieldLoggingPage /> },
          { path: 'messages', element: <MessagesPage /> },
          { path: 'profile', element: <ProfileSettingsPage /> },
          { path: 'account', element: <FieldAccountPage /> },
        ],
      },
    ],
  },

  /* Legacy/short aliases so old links and typos still land somewhere sensible. */
  { path: '/dashboard', element: <Navigate to="/portal" replace /> },
  { path: '*', element: <NotFoundPage /> },
])
