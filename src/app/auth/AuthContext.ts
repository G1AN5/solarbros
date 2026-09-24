import { createContext } from 'react'

import type { User, UserRole } from '@/types/domain'

/* ============================================================================
   AuthContext
   ----------------------------------------------------------------------------
   The context object lives in its own file, separate from the provider
   component, so Vite's Fast Refresh keeps working — a module that exports both
   a component and a non-component loses hot-reload state.

   WHY `status` EXISTS AND WHY IT MATTERS
   Restoring a Supabase session from storage is asynchronous. For the first few
   frames after a page load, the user is signed in but the app does not know it
   yet. A guard that treats "no user" as "not signed in" therefore bounces
   everybody to /login on every refresh — the single most common bug in Supabase
   applications.

   Three states, not a boolean:
     loading           we do not know yet. Render nothing that depends on auth.
     authenticated     session restored and the profile has been loaded.
     unauthenticated   genuinely signed out.
   ========================================================================== */

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

/** Every auth action reports failure the same way, so callers can show it. */
export interface AuthResult {
  error: string | null
}

export interface SignUpInput {
  email: string
  password: string
  fullName: string
  phone?: string
  /** Optional project reference typed on the registration form. */
  projectReference?: string
  /**
   * The role a STAFF registrant says the company assigned them.
   *
   * A claim, not a grant. Migration 0052 parks the account on 'client' and
   * INACTIVE until an administrator approves it, so nothing is conferred by
   * asking — which is what makes it safe to accept from a public form.
   * Absent for a customer signing up.
   */
  requestedRole?: UserRole
}

export interface AuthState {
  user: User | null
  status: AuthStatus
  /** Convenience for `status === 'authenticated'`. */
  isAuthenticated: boolean
  signIn: (email: string, password: string) => Promise<AuthResult>
  signUp: (input: SignUpInput) => Promise<AuthResult & { needsEmailConfirmation: boolean }>
  signOut: () => Promise<void>
  requestPasswordReset: (email: string) => Promise<AuthResult>
  /**
   * Exchange the six-digit code from a recovery email for a session.
   *
   * The code IS the proof of identity — possession of the mailbox. Supabase
   * expires it after an hour and invalidates it on first use, which is what
   * makes emailing it acceptable.
   */
  verifyResetCode: (email: string, code: string) => Promise<AuthResult>

  /** Sets a new password for the session established by a code or a link. */
  updatePassword: (password: string) => Promise<AuthResult>

  /**
   * Re-read the signed-in user's profile row.
   *
   * The profile is loaded once when the session appears, so editing your own
   * name or photo would otherwise leave the old one in the sidebar and the top
   * bar until the next full reload — which reads as the save having failed.
   */
  refreshProfile: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)
