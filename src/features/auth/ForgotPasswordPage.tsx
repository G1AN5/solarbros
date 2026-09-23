import { PasswordResetFlow } from './PasswordResetFlow'

/* The customer's entrance to the reset flow. The flow itself is shared with
   staff — see PasswordResetFlow for why it is one component and not two. */
export function ForgotPasswordPage() {
  return (
    <PasswordResetFlow
      signInPath="/login"
      audienceNote="Enter the email address on your account and we will send you a code to set a new password."
    />
  )
}
