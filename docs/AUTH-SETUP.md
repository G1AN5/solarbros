# Authentication setup

The parts of sign-in, registration and password reset that live in the Supabase
dashboard rather than in this repository — and why each one matters.

Nothing here is optional. The application assumes all of it.

---

## 1. Who can get an account, and how

There are three routes in and they are deliberately different.

| Who               | Where                                           | What they get                                                   |
| ----------------- | ----------------------------------------------- | --------------------------------------------------------------- |
| **Customer**      | `/register` on the public site                  | The `client` role, immediately. Confirmed by email.             |
| **Staff**         | `/staff/register` — unlisted, you send the link | Nothing, until an administrator approves the role they claimed  |
| **Administrator** | Supabase dashboard, by hand                     | Everything. This is the only way an administrator is ever made. |

**A role can only change by approving a registration.** Migration `0052` puts a
trigger on `profiles` that refuses every other route — including an
administrator with full `UPDATE` rights, and including the `service_role` key,
because a trigger fires regardless of row-level security. There is no dropdown
anywhere in the application, and adding one would not work.

That also means **a customer can never become staff**. They have no pending
registration to approve, so there is nothing to approve.

> To change somebody's role later — a technician promoted to project engineer —
> do it in the SQL editor, with one statement:
>
> ```sql
> select public.grant_staff_role('them@company.com', 'project_engineer');
> select public.grant_admin('them@company.com');          -- administrators
> ```
>
> Both are revoked from `anon`, `authenticated` and `service_role`, so neither
> can be reached from a browser session however the caller is signed in. Each
> writes a `critical` audit row.
>
> These also let you **set the team up without waiting on email**. Create each
> account under Authentication → Users with _Auto Confirm User_ ticked — that
> sends no message at all — then grant the role here. Useful because the
> built-in sender allows only about two emails an hour, which is not enough to
> register five people in one sitting.

---

## 2. Turn on email confirmation

**Authentication → Sign In / Providers → Email**

- **Confirm email: ON**

Without it, anybody can register with an address they do not own. With it, a new
account has no session until the link in the email is clicked — which is also
why the staff approval queue never fills up with addresses that do not exist.

> This is already enabled on the current project. `npm run verify:staff-approval`
> reports it, because the probe account gets no session back.

---

## 3. Send a CODE for password resets, not a link

**Authentication → Emails → Reset Password**

Replace the body with something that includes `{{ .Token }}`:

```html
<h2>Reset your SolarBros password</h2>

<p>Your code is:</p>
<p style="font-size:28px;letter-spacing:6px;font-weight:700">{{ .Token }}</p>

<p>
  Type it on the page where you asked for it. It works once and expires in one hour. If you did not
  ask for this, ignore this email — nothing has changed.
</p>
```

**Why a code rather than the default link.** A link is opened by whatever
handles the email — a scanner, a preview pane, a corporate mail filter — and
each of those consumes the single-use token before the person ever clicks it.
The result is a reset that appears broken for reasons nobody can see. A code is
typed by a human on the page that requested it, so the reset also finishes in
the same tab and session.

**Both still work.** If you leave the default template, the link lands on
`/reset-password` and sets the password there. `PasswordResetFlow` tells the
person to click it if that is what they received. Changing the template is the
better experience, not a requirement for the app to function.

---

## 4. Configure real SMTP before launch

**Project Settings → Authentication → SMTP Settings**

Supabase's built-in sender is rate-limited to **about two messages an hour** and
is intended for development only. That is enough to demonstrate a registration
and not enough to run a business: on a busy morning the third person to register
simply never receives anything, and there is no error anywhere for you to find.

Any transactional provider works — Resend, SendGrid, Amazon SES, or the
company's own mail server.

> The verification scripts feel this directly. `verify:onboarding` sidesteps it
> by creating its customer through the `manage-staff` Edge Function, which sends
> no confirmation email. The two staff suites cannot: they exist to test
> self-registration, which is `auth.signUp`, which sends one. So on the built-in
> sender those two **skip** after a couple of runs — reported as a skip rather
> than a failure, because a suite that exits non-zero for an environmental
> reason teaches people to ignore it exiting non-zero.

---

## 5. Session and lockout behaviour

**Authentication → Sessions**

Worth setting deliberately rather than leaving at the default:

- **Time-box user sessions** — how long a signed-in session lasts before
  re-authentication. A warehouse PC that stays signed in indefinitely is the
  realistic threat here, not a remote attacker.
- **Refresh token rotation** — on.

**Deactivating somebody takes effect within the hour, not instantly.** Setting
`is_active = false` makes `current_user_role()` return NULL, which denies every
staff policy across all 39 tables — but an already-issued JWT stays valid until
it expires. For an immediate lockout, also revoke their sessions under
**Authentication → Users**.

---

## 6. What is deliberately NOT in the application

- **Multi-factor authentication.** Configured in the Supabase dashboard if you
  want it. The Governance screen says so rather than offering a toggle that
  does nothing.
- **Account deletion.** Deactivation keeps the person's history attached to the
  records they created; deleting the account would cascade and take that with
  it. Deactivate instead, and delete in the dashboard only if you genuinely mean
  to erase them.
- **Password policy beyond a length minimum.** Supabase enforces its own; the
  forms ask for eight characters.

---

## 7. Checking it

```bash
npm run verify:staff-approval   # registration grants nothing; only approval moves a role
npm run verify:staff            # what an approved role reaches; deactivation revokes
npm run verify:rls              # every role sees only what it should
npm run verify:onboarding       # a prospect becomes a customer
```

> On Supabase's built-in email sender these two **skip** rather than fail: it
> allows roughly two messages an hour, and every registration sends a
> confirmation. That is a limit worth taking seriously beyond the tests — on the
> built-in sender, the third person to register in an hour silently receives
> nothing at all. Configure SMTP.

`verify:staff-approval` is the one to run after any change to roles or
policies. It asserts the things that would be quietest if they broke: that a
pending account is refused everything, that an administrator cannot set a role
directly, and that a customer cannot be promoted by anybody.
