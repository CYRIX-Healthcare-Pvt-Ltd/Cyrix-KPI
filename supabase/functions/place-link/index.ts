import { createClient } from 'npm:@supabase/supabase-js@2'

/**
 * Travel Expense: where a Google Maps share link leads (Travel te_0071; the user, 26 Oct: a place our map does not
 * have, such as our own office, found on Google Maps and its link pasted into the place search).
 *
 * A short link (maps.app.goo.gl/…) says where it goes only by redirecting, which a page cannot read across sites.
 * This follows it — Google's short-link hosts only, at most six steps — and returns the Google Maps address it ends
 * at, for the app to read the spot from. Nothing is fetched from Google Maps itself and nothing is kept.
 *
 * Signed-in people with Travel Expense only (KPI 0223: functions answer signed-in callers).
 * Deploy:  supabase functions deploy place-link --no-verify-jwt
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const SHORT = /^(maps\.app\.goo\.gl|goo\.gl)$/i
const GOOGLE = /^((www|maps)\.)?google\.(com|co\.in)$/i

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false }, global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: me } = await db.auth.getUser()
  if (!me?.user) return json({ error: 'Sign in first' }, 401)
  const { data: allowed } = await db.rpc('travel_has_access')
  if (!allowed) return json({ error: 'Travel Expense has not been given to you yet' }, 403)

  let url: URL
  try { url = new URL(String((await req.json())?.url ?? '').trim()) } catch { return json({ error: 'That is not a link' }, 400) }
  if (!SHORT.test(url.hostname)) return json({ error: 'Only a Google Maps link can be opened here' }, 400)
  for (let step = 0; step < 6 && SHORT.test(url.hostname); step++) {
    let res: Response
    try { res = await fetch(url, { redirect: 'manual' }) } catch { return json({ error: 'Google Maps could not be reached. Try again.' }, 502) }
    const next = res.headers.get('location')
    await res.body?.cancel()
    if (!(res.status >= 300 && res.status < 400) || !next) return json({ error: 'That link does not lead to a place' }, 404)
    url = new URL(next, url)
  }
  // A consent page in front of Google Maps: the address it would go on to.
  if (url.hostname === 'consent.google.com') {
    try { url = new URL(url.searchParams.get('continue') ?? '') } catch { return json({ error: 'That link does not lead to a place' }, 404) }
  }
  if (!GOOGLE.test(url.hostname)) return json({ error: 'That link does not lead to Google Maps' }, 404)
  return json({ url: url.toString() })
})
