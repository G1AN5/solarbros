// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { leakedPasswordProblem, sha1Hex, timesPwned } from '../password-check'

/* SHA-1 of "password" is 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8: the
   service is asked for range 5BAA6 and the match is made on the rest. */
const PREFIX = '5BAA6'
const SUFFIX = '1E4C9B93F3F0682250B6CF8331B7EE68FD8'

function answering(body: string, ok = true) {
  return vi.fn(
    async () => new Response(body, { status: ok ? 200 : 503 }),
  ) as unknown as typeof fetch
}

describe('sha1Hex', () => {
  it('produces the uppercase hex the service indexes by', async () => {
    expect(await sha1Hex('password')).toBe(PREFIX + SUFFIX)
  })
})

describe('timesPwned', () => {
  it('sends only the first five characters of the hash', async () => {
    const fetcher = answering('')
    await timesPwned('password', fetcher)
    const [url, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${PREFIX}`)
    expect(String(url)).not.toContain(SUFFIX)
    expect((init as RequestInit).headers).toEqual({ 'Add-Padding': 'true' })
  })

  it('reads the count for a matching suffix', async () => {
    const body = `0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n${SUFFIX}:3861493\r\n00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2`
    expect(await timesPwned('password', answering(body))).toBe(3861493)
  })

  it('reads 0 when the suffix is absent, or only present as padding', async () => {
    expect(await timesPwned('password', answering('0018A45C4D1DEF81644B54AB7F969B88D65:1'))).toBe(0)
    expect(await timesPwned('password', answering(`${SUFFIX}:0`))).toBe(0)
  })

  it('gives up quietly when the service cannot be reached', async () => {
    const failing = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    expect(await timesPwned('password', failing)).toBeNull()
    expect(await timesPwned('password', answering('', false))).toBeNull()
  })
})

describe('leakedPasswordProblem', () => {
  it('explains a breached password and passes a clean or unchecked one', async () => {
    expect(await leakedPasswordProblem('password', answering(`${SUFFIX}:2`))).toMatch(
      /2 known data breaches/,
    )
    expect(await leakedPasswordProblem('password', answering(`${SUFFIX}:1`))).toMatch(
      /1 known data breach,/,
    )
    expect(await leakedPasswordProblem('password', answering(''))).toBeNull()
    expect(await leakedPasswordProblem('password', answering('', false))).toBeNull()
  })
})
