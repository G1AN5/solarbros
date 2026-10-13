/* ============================================================================
   Leaked-password check — Have I Been Pwned, by k-anonymity.
   ----------------------------------------------------------------------------
   Supabase can refuse breached passwords itself, but only on the Pro plan.
   Until that setting is on, the app's own forms ask the same service before a
   password is set: sign-up (customer and staff), password reset, and a
   technician changing theirs.

   WHAT LEAVES THE BROWSER
   The first five characters of the password's SHA-1 hash — nothing else. The
   service answers with every breached hash that starts the same way (several
   hundred), padded so the size of the answer gives nothing away, and the
   match is made here. Neither the password nor its full hash is ever sent.

   WHAT IT IS NOT
   A server rule. Somebody calling the Auth API directly is not checked; this
   protects people using the app from picking a password that attackers try
   first. Supabase's own setting is the server-side version, and makes this
   redundant the day it is switched on.

   If the service cannot be reached, the password is accepted. An outage at a
   third party must not stop somebody resetting their password.
   ========================================================================== */

const RANGE_URL = 'https://api.pwnedpasswords.com/range/'
const TIMEOUT_MS = 4000

/** Uppercase hex SHA-1, the form the service indexes by. */
export async function sha1Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

/**
 * How many times `password` appears in known breaches: 0 when it does not,
 * `null` when the check could not be made.
 */
export async function timesPwned(
  password: string,
  fetcher: typeof fetch = fetch,
): Promise<number | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const hash = await sha1Hex(password)
    const response = await fetcher(RANGE_URL + hash.slice(0, 5), {
      headers: { 'Add-Padding': 'true' },
      signal: controller.signal,
    })
    if (!response.ok) return null

    const suffix = hash.slice(5)
    for (const line of (await response.text()).split('\n')) {
      const [candidate, count] = line.trim().split(':')
      // Padding lines carry a count of 0, so a match on one still reads as safe.
      if (candidate === suffix) return Number(count) || 0
    }
    return 0
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** A sentence to show if `password` has been in a breach, otherwise null. */
export async function leakedPasswordProblem(
  password: string,
  fetcher?: typeof fetch,
): Promise<string | null> {
  const count = await timesPwned(password, fetcher)
  if (!count) return null
  return (
    `That password has turned up in ${count.toLocaleString('en-PH')} known data ` +
    `breach${count === 1 ? '' : 'es'}, so it is one of the first that attackers try. ` +
    'Please choose a different one.'
  )
}
