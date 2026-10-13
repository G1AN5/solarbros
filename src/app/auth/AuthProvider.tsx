import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'

import { AuthContext, type AuthState, type AuthStatus, type SignUpInput } from './AuthContext'
import { leakedPasswordProblem } from '@/lib/password-check'
import { supabase } from '@/lib/supabase'
import type { User } from '@/types/domain'

/* ============================================================================
   AuthProvider — real Supabase authentication.
   ----------------------------------------------------------------------------
   Signs users in against Supabase Auth, then loads their application profile
   (which carries the role) from the `profiles` table.

   THE ROLE COMES FROM THE DATABASE, NEVER FROM THE BROWSER
   The browser can claim any role it likes, so the role is read server-side from
   `profiles` and every Postgres policy resolves it independently through
   `current_user_role()`. What this provider holds is a copy used purely to
   decide what to RENDER. If the two ever disagreed, the database would win and
   the user would simply see empty screens — which is the correct failure mode.

   TWO SUBTLETIES THAT CAUSE MOST SUPABASE AUTH BUGS
   --------------------------------------------------------------------------
   1. SESSION RESTORE IS ASYNCHRONOUS.
      On a page refresh the session is read from storage after the first render.
      Treating "no user yet" as "signed out" bounces everyone to /login on every
      refresh. That is why `status` starts at 'loading' and the route guard
      waits for it.

   2. NEVER AWAIT SUPABASE INSIDE onAuthStateChange.
      The callback runs while the client holds an internal lock; issuing another
      Supabase call from inside it can deadlock, and the symptom is an app that
      hangs on load intermittently and is miserable to diagnose. So the callback
      only ever sets local state, and the profile fetch happens in a separate
      effect keyed on the user id.

   THERE IS NO LONGER A DEMO MODE.
   This provider used to fall back to local fixtures when .env.local was absent,
   and shipped a role switcher that signed in as any of seven seeded accounts
   with a password committed to the repository. Convenient while the UI was
   being built; indefensible in something being deployed.

   Both are deleted rather than hidden behind `import.meta.env.DEV`. A dev-only
   guard is one build flag away from being wrong, and the accounts it depended
   on were real rows in the live database. Without credentials the app now shows
   a clear "not connected" message instead of a working fake.
   ========================================================================== */

/** Shown when somebody tries to sign in against an app with no backend. */
const NOT_CONFIGURED =
  'This application is not connected to its database. Copy .env.example to .env.local and add your Supabase keys.'

/** Turn Supabase's error into something worth showing a person. */
function readableError(message: string): string {
  if (message.includes('Invalid login credentials')) {
    return 'That email and password do not match an account.'
  }
  if (message.includes('Email not confirmed')) {
    return 'Please confirm your email address first — check your inbox.'
  }
  if (message.includes('already registered')) {
    return 'An account already exists for that email address. Try signing in.'
  }
  if (message.includes('Password should be')) {
    return 'Please choose a longer password — at least 6 characters.'
  }
  return message
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)

  /* Starts at 'loading' because the session genuinely is not known until
     Supabase has read it back from storage. Treating "no user yet" as "signed
     out" bounces everybody to /login on every refresh. */
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')

  /* --- Subscribe to the session -------------------------------- */
  useEffect(() => {
    if (!supabase) return

    let active = true

    // Existing session, if any. Runs once on mount.
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      // No session means we are done: there is no profile to wait for.
      if (!data.session) setStatus('unauthenticated')
    })

    // Sign-in, sign-out and token refresh. Deliberately does NO async work —
    // see note 2 in the header.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (!nextSession) {
        setUser(null)
        setStatus('unauthenticated')
      }
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  /* --- Load the profile whenever the signed-in user changes ----- */
  const userId = session?.user?.id
  useEffect(() => {
    if (!supabase || !userId) return

    let active = true

    async function loadProfile(client: NonNullable<typeof supabase>, id: string) {
      const { data, error } = await client
        .from('profiles')
        .select('id, full_name, email, role, avatar_initials, avatar_url, phone, address')
        .eq('id', id)
        .maybeSingle()

      if (!active) return

      if (error || !data) {
        // The profile is created by a database trigger on sign-up, so a brand
        // new account can briefly arrive here before the row is visible.
        // Fall back to the auth record rather than trapping the user on a
        // spinner; the next load will pick up the real profile.
        const authUser = session?.user
        setUser({
          id,
          fullName: (authUser?.user_metadata?.full_name as string) ?? authUser?.email ?? 'Account',
          email: authUser?.email ?? '',
          role: 'client',
          avatarInitials: '??',
          avatarUrl: null,
          phone: null,
          address: null,
        })
        setStatus('authenticated')
        if (import.meta.env.DEV && error) {
          console.warn('[SolarBros] Could not load profile:', error.message)
        }
        return
      }

      setUser({
        id: data.id,
        fullName: data.full_name,
        email: data.email,
        role: data.role,
        avatarInitials: data.avatar_initials ?? '??',
        avatarUrl: data.avatar_url ?? null,
        phone: data.phone ?? null,
        address: data.address ?? null,
      })
      setStatus('authenticated')
    }

    void loadProfile(supabase, userId)

    return () => {
      active = false
    }
    // `session` is intentionally not a dependency: re-running on every token
    // refresh would refetch the profile every hour for no benefit. The user id
    // is the only thing that changes who we are.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  /* --- Actions ------------------------------------------------------------ */

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) return { error: NOT_CONFIGURED }

    setStatus('loading')
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (error) {
      setStatus('unauthenticated')
      return { error: readableError(error.message) }
    }
    // The profile effect flips status to 'authenticated' once it has loaded.
    return { error: null }
  }, [])

  const signUp = useCallback(async (input: SignUpInput) => {
    if (!supabase) return { error: NOT_CONFIGURED, needsEmailConfirmation: false }

    // Breached passwords are refused here because Supabase's own check needs
    // the Pro plan. See lib/password-check.ts.
    const leaked = await leakedPasswordProblem(input.password)
    if (leaked) return { error: leaked, needsEmailConfirmation: false }

    const { data, error } = await supabase.auth.signUp({
      email: input.email.trim(),
      password: input.password,
      options: {
        /* Read by handle_new_user(). `requested_role` is a CLAIM and grants
           nothing — migration 0052 parks the account on 'client', inactive,
           until an administrator approves it. The role itself is never taken
           from here, because everything in this object came from the browser. */
        data: {
          full_name: input.fullName,
          phone: input.phone ?? null,
          project_reference: input.projectReference ?? null,
          requested_role: input.requestedRole ?? null,
        },
        emailRedirectTo: `${window.location.origin}${
          input.requestedRole ? '/staff/login' : '/login'
        }`,
      },
    })

    if (error) return { error: readableError(error.message), needsEmailConfirmation: false }

    // When email confirmation is on, Supabase returns a user but no session.
    return { error: null, needsEmailConfirmation: !data.session }
  }, [])

  const signOut = useCallback(async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    setUser(null)
    setSession(null)
    setStatus('unauthenticated')
  }, [])

  const requestPasswordReset = useCallback(async (email: string) => {
    if (!supabase) return { error: null }
    /* The link has to land somewhere that can actually CHANGE the password.
       It used to point at /login: Supabase would establish a recovery session,
       the visitor would arrive signed in, and there was no way to set a new
       password — so the one thing they came to do was impossible. */
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    return { error: error ? readableError(error.message) : null }
  }, [])

  /**
   * Turn the code from a recovery email into a session.
   *
   * `type: 'recovery'` is what tells Supabase this token came from a password
   * reset rather than a sign-up confirmation or a magic link; the wrong type is
   * rejected even when the code itself is correct.
   *
   * Whether the email carries a CODE or a LINK is decided by the email template
   * in the Supabase dashboard, not here. With `{{ .Token }}` in the template
   * this path is used; with `{{ .ConfirmationURL }}` the link lands on
   * /reset-password and establishes the same kind of session. Both end at
   * `updatePassword`, so either template works.
   */
  const verifyResetCode = useCallback(async (email: string, code: string) => {
    if (!supabase) return { error: NOT_CONFIGURED }

    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'recovery',
    })

    if (error) {
      /* Supabase's own wording here is "Token has expired or is invalid", which
         sends people hunting for a typo when the real cause is usually that
         they requested a second code and are typing the first. */
      return {
        error:
          'That code is not valid, or it has expired. Request a new one — and use the most recent email if you asked more than once.',
      }
    }
    return { error: null }
  }, [])

  /**
   * Set a new password.
   *
   * Works on whatever session is current, which after a recovery link is the
   * temporary one Supabase established from the token in the URL. That token is
   * single-use and short-lived, which is what makes the emailed link safe to
   * send: possession of the mailbox is the proof of identity.
   */
  const updatePassword = useCallback(async (password: string) => {
    if (!supabase) return { error: null }
    const leaked = await leakedPasswordProblem(password)
    if (leaked) return { error: leaked }
    const { error } = await supabase.auth.updateUser({ password })
    return { error: error ? readableError(error.message) : null }
  }, [])

  /* Re-reads the profile row on demand. The effect above runs only when the
     signed-in user CHANGES, which never happens when somebody edits their own
     name — so without this the sidebar keeps showing the old one. */
  const refreshProfile = useCallback(async () => {
    if (!supabase || !userId) return

    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, avatar_initials, avatar_url, phone, address')
      .eq('id', userId)
      .maybeSingle()

    if (!data) return

    setUser({
      id: data.id,
      fullName: data.full_name,
      email: data.email,
      role: data.role,
      avatarInitials: data.avatar_initials ?? '??',
      avatarUrl: data.avatar_url ?? null,
      phone: data.phone ?? null,
      address: data.address ?? null,
    })
  }, [userId])

  const value = useMemo<AuthState>(
    () => ({
      user,
      status,
      isAuthenticated: status === 'authenticated' && user !== null,
      signIn,
      signUp,
      signOut,
      requestPasswordReset,
      verifyResetCode,
      updatePassword,
      refreshProfile,
    }),
    [
      user,
      status,
      signIn,
      signUp,
      signOut,
      requestPasswordReset,
      verifyResetCode,
      updatePassword,
      refreshProfile,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
