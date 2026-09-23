/* ============================================================================
   create-customer-account  (deployed as `manage-staff`)
   ----------------------------------------------------------------------------
   Creates a CUSTOMER portal account on somebody's behalf. That is all it does
   now, and the name is a historical one kept so the deployed function does not
   have to be re-pointed.

   WHAT IT USED TO DO, AND WHY IT NO LONGER DOES
   It created staff accounts with a chosen role, and changed the role of an
   existing one. Both are gone:

     · Staff now register themselves at /staff/register, claim a role, and an
       administrator approves the claim. A wrong role is then a disagreement
       between two people rather than one person's slip at a dropdown.

     · Migration 0052 refuses EVERY change to `profiles.role` that did not come
       through `approve_staff`. The service_role key bypasses row-level
       security, but it does not bypass a trigger — so the old code path was
       already dead when this was rewritten. Deleting it is bookkeeping, not a
       new restriction.

   WHY IT SURVIVES AT ALL
   A customer rings the office and asks somebody to set their portal up. And the
   verification scripts need to create test accounts without `auth.signUp`,
   whose confirmation emails are rate-limited by Supabase's built-in sender to a
   couple an hour — which would make the suites unrunnable rather than merely
   slow.

   THE AUTHORISATION CHAIN, unchanged:
     1. A bearer token is present         -> otherwise 401
     2. It resolves to a real user        -> otherwise 401
     3. That user's profile role is admin -> otherwise 403

   Step 3 reads the role from the database using the CALLER's token, never from
   anything the caller sent. A body claiming `{ "role": "admin" }` proves
   nothing.

   DEPLOY WITH
       npx supabase functions deploy manage-staff
   ========================================================================== */

import { createClient } from 'jsr:@supabase/supabase-js@2'

/* Customers only. A staff role cannot be created here at any price — the
   database refuses it, and asking would only produce a confusing failure. */
const ALLOWED_ROLES = ['client'] as const

type Role = (typeof ALLOWED_ROLES)[number]

interface CreateCustomerBody {
  action: 'create'
  email: string
  fullName: string
  role: Role
  phone?: string
  /** Optional. One is generated when omitted, and returned once. */
  password?: string
}

type RequestBody = CreateCustomerBody

/* CORS. The browser sends a preflight OPTIONS before any POST carrying an
   Authorization header, and without a response to it the real request never
   leaves the page. */
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

/**
 * A readable temporary password that still has real entropy.
 *
 * It is shown to the administrator once so they can pass it on, and the new
 * member is told to change it. Ambiguous characters are excluded because this
 * gets read aloud or copied by hand more often than anyone would like.
 */
function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(14))
  return 'SB-' + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  /* --- 1. Is there a token at all? -------------------------------------- */
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Not signed in.' }, 401)

  /* --- 2. Does it belong to a real user? --------------------------------
     This client is built with the ANON key and the caller's token, so it is
     subject to exactly the same RLS as the browser. It is used only to work
     out who is asking. */
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const {
    data: { user: caller },
    error: callerError,
  } = await asCaller.auth.getUser()

  if (callerError || !caller) return json({ error: 'Your session is not valid.' }, 401)

  /* --- 3. Is that user an administrator? --------------------------------
     Read from the database, never from the request body. */
  const { data: callerProfile } = await asCaller
    .from('profiles')
    .select('role, full_name')
    .eq('id', caller.id)
    .maybeSingle()

  if (callerProfile?.role !== 'admin') {
    return json({ error: 'Only an administrator may manage staff accounts.' }, 403)
  }

  /* --- Past this point the caller is a verified administrator ------------ */
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Malformed request.' }, 400)
  }

  /* ====================================================== CREATE A MEMBER */
  if (body.action === 'create') {
    const { email, fullName, role, phone } = body

    if (!email?.trim() || !fullName?.trim()) {
      return json({ error: 'An email address and full name are required.' }, 400)
    }
    /* Checked against the list itself rather than against a second copy of
       'client' written out here, so the permitted set and the guard that
       enforces it cannot drift apart. */
    if (!ALLOWED_ROLES.includes(role)) {
      return json(
        {
          error:
            'This endpoint only creates customer accounts. Staff register themselves at /staff/register and an administrator approves the role they claim.',
        },
        400,
      )
    }

    const password = body.password?.trim() || generatePassword()

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      /* Confirmed on creation: an administrator has just spoken to this
         person and typed their address, so there is nobody to verify it to.
         A customer who registers themselves still confirms by email. */
      email_confirm: true,
      user_metadata: { full_name: fullName.trim(), phone: phone ?? null },
    })

    if (createError) {
      const already = createError.message.includes('already been registered')
      return json(
        { error: already ? 'An account already exists for that email.' : createError.message },
        already ? 409 : 400,
      )
    }

    /* `handle_new_user()` has already created the profile on the 'client'
       role, which is the only role this endpoint produces — so `role` is
       deliberately NOT written here. Touching it would be refused by the
       immutability trigger in migration 0052 even with the service_role key. */
    const { error: roleError } = await admin
      .from('profiles')
      .update({ full_name: fullName.trim(), phone: phone ?? null })
      .eq('id', created.user.id)

    if (roleError) {
      // Leaving a half-made account behind is worse than failing outright.
      await admin.auth.admin.deleteUser(created.user.id)
      return json({ error: `Could not assign the role: ${roleError.message}` }, 500)
    }

    // Nothing else records the creation, so it is logged here against the
    // administrator who asked for it.
    await admin.from('audit_log').insert({
      actor_id: caller.id,
      actor_name: callerProfile.full_name,
      actor_role: 'admin',
      action: `Created a customer portal account for ${email}`,
      entity: 'profiles',
      entity_id: created.user.id,
      severity: 'warning',
      metadata: { email, created_by: caller.email },
    })

    return json({
      ok: true,
      userId: created.user.id,
      email: created.user.email,
      role,
      // Returned exactly once. It is never stored anywhere in plain text.
      temporaryPassword: body.password ? null : password,
    })
  }

  /* The `set_role` action was removed. `approve_staff` (migration 0052) is the
     only route by which a role changes, and the trigger behind it refuses this
     one regardless of the key used. */

  return json({ error: 'Unknown action.' }, 400)
})
