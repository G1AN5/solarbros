import { Link } from 'react-router-dom'

import { PasswordResetFlow } from './PasswordResetFlow'

/* ============================================================================
   The staff entrance to the reset flow.
   ----------------------------------------------------------------------------
   Separate from the customer's so that a reset started from the staff portal
   finishes there, rather than dropping an employee on a customer sign-in page
   and leaving them to work out where they actually belong.

   The flow, and every rule in it, is shared. Only the wording and the return
   path differ.
   ========================================================================== */

export function StaffForgotPasswordPage() {
  return (
    <div className="stack">
      <PasswordResetFlow
        signInPath="/staff/login"
        audienceNote="Enter your work email address and we will send you a code to set a new password."
      />
      <p className="xs dim center">
        Not a SolarBros employee?{' '}
        <Link to="/forgot-password" style={{ color: 'var(--text-brand)' }}>
          Reset a customer account instead
        </Link>
        .
      </p>
    </div>
  )
}
