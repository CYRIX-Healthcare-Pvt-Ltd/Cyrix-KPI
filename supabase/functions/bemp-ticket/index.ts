import { createClient } from 'npm:@supabase/supabase-js@2'

/**
 * Travel Expense: a service call's ticket looked up in Cyrix BEMP, so the claim gets the ticket's hospital, equipment,
 * dates and its service report image by itself when the engineer types the ticket ID (the user, 10 Nov: "if we type
 * ticket id there, automatically the service report should fetch from another software").
 *
 * AP only for now: apcyrixbemp.com signs in with a user ID and password and no OTP. KL (cyrixbemp.com) asks an OTP
 * at sign-in and waits for that to be read from notifications@cyrix.in. An AP ticket starts with AP (AP143084).
 *
 * The Travel login is in the secrets BEMP_AP_USERNAME and BEMP_AP_PASSWORD, entered by the user; it never leaves this
 * function. The BEMP session is kept while this instance is warm and signed in again when it runs out.
 *
 * The search is the one BEMP's own ticket master report makes (controller/penalty_reload_ticket_master.php), and the
 * image is the one under its Service report View (crm/tikcet_sr_image/<screenshot>). Phone numbers and other
 * customer details in BEMP's answer are not passed on.
 *
 * The test accounts only, until the user says otherwise (the user, 10 Nov: "only for test account"): a test account
 * itself, or anybody with Travel opening a test account's claim, so its manager and the Travel Desk see the ticket.
 * Deploy:  supabase functions deploy bemp-ticket --no-verify-jwt
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const TEST = new Set(['E6666', 'E7777', 'E8888', 'E9999'])
const AP = 'https://apcyrixbemp.com'
const UA = 'Mozilla/5.0 (Cyrix Travel)'

let session: string | null = null // the BEMP cookie header while this instance is warm

/** The cookies a response sets, merged into the ones we hold. */
function keep(jar: Map<string, string>, res: Response) {
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';')
    const at = pair.indexOf('=')
    if (at > 0) jar.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim())
  }
}
const header = (jar: Map<string, string>) => [...jar].map(([k, v]) => `${k}=${v}`).join('; ')

async function signIn(): Promise<string> {
  const user = Deno.env.get('BEMP_AP_USERNAME'), pass = Deno.env.get('BEMP_AP_PASSWORD')
  if (!user || !pass) throw new Error('The BEMP login is not saved yet')
  const jar = new Map<string, string>()
  const first = await fetch(AP + '/', { headers: { 'User-Agent': UA } })
  keep(jar, first); await first.body?.cancel()
  const res = await fetch(AP + '/index.php', {
    method: 'POST', redirect: 'manual',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: header(jar), Referer: AP + '/' },
    body: new URLSearchParams({ username: user, password: pass, login: 'Login' }),
  })
  keep(jar, res)
  const where = res.headers.get('location') ?? ''
  const page = await res.text()
  // BEMP answers a refused sign-in with an alert on the sign-in page itself.
  const said = page.match(/alert\(\s*["']([^"']{3,120})["']/)?.[1]
  if (!/dashboard/i.test(where) && !/dashboard/i.test(page.slice(0, 4000))) throw new Error(said ? `BEMP: ${said}` : 'BEMP did not let the Travel login in')
  return header(jar)
}

interface Row { [k: string]: unknown }
async function search(cookie: string, ticket: string): Promise<Row[] | null> {
  const res = await fetch(AP + '/controller/penalty_reload_ticket_master.php', {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest', Cookie: cookie, Referer: AP + '/crm/ticket_master_report.php' },
    body: new URLSearchParams({
      ticket_search_type: 'ticket', ticket_wise: ticket, date_wise: '', contract_status_wise: '', ticket_remark_wise: '',
      date_from_wise: '', date_to_wise: '', ticket_search_status: '', days_wise: '', TicketIndent: '',
      reload_ticket_master: '50', row: '100', offset: '0', extend_data: '0',
    }),
  })
  const text = await res.text()
  try { const j = JSON.parse(text); return Array.isArray(j?.data) ? j.data as Row[] : [] } catch { return null } // not JSON: signed out
}

const s = (v: unknown) => (typeof v === 'string' && v.trim() && !/^0000-00-00/.test(v) ? v.trim() : null)

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false }, global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: me } = await db.auth.getUser()
  if (!me?.user) return json({ error: 'Sign in first' }, 401)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const asked = await req.json().catch(() => ({})) as { ticket?: unknown; claim?: unknown }
  const { data: prof } = await admin.from('profiles').select('ecode').eq('id', me.user.id).maybeSingle()
  let open = TEST.has(String(prof?.ecode ?? '').toUpperCase())
  if (!open && typeof asked.claim === 'string' && /^[0-9a-f-]{36}$/i.test(asked.claim)) {
    const { data: allowed } = await db.rpc('travel_has_access')
    const { data: claim } = await admin.from('te_claims').select('employee_id').eq('id', asked.claim).maybeSingle()
    const { data: owner } = claim ? await admin.from('profiles').select('ecode').eq('id', claim.employee_id).maybeSingle() : { data: null }
    open = !!allowed && TEST.has(String(owner?.ecode ?? '').toUpperCase())
  }
  if (!open) return json({ error: 'Ticket lookup is not open for you yet' }, 403)

  const ticket = String(asked.ticket ?? '').trim().toUpperCase()
  if (!/^AP\d{3,}$/.test(ticket)) return json({ error: /^\d+$/.test(ticket) ? 'KL tickets are not connected yet' : 'Not a ticket ID' }, 400)

  let rows: Row[] | null = null
  try {
    if (session) rows = await search(session, ticket)
    if (rows === null) { session = await signIn(); rows = await search(session, ticket) }
  } catch (e) { session = null; return json({ error: (e as Error).message }, 502) }
  if (rows === null) { session = null; return json({ error: 'BEMP did not answer the search' }, 502) }

  const row = rows.find(r => String(r.ticket_id ?? '').toUpperCase() === ticket)
  if (!row) return json({ error: `Ticket ${ticket} not found in BEMP` }, 404)

  // The service report image (BEMP serves these openly; fetched here so the app can attach it to the claim).
  let image: string | null = null, imageType: string | null = null, imageNote: string | null = null
  const shot = s(row.screenshot)
  if (shot && /^[\w.-]+$/.test(shot)) {
    // The image folder refuses a request that does not come from BEMP's own report page.
    const res = await fetch(`${AP}/crm/tikcet_sr_image/${shot}`, { headers: { 'User-Agent': UA, Cookie: session ?? '', Referer: AP + '/crm/ticket_master_report.php', Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' } })
    const type = res.headers.get('content-type') ?? ''
    if (res.ok && /^image\//.test(type)) {
      const bytes = new Uint8Array(await res.arrayBuffer())
      if (bytes.length <= 8 * 1024 * 1024) {
        let bin = ''
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        image = btoa(bin); imageType = type
      }
      else imageNote = 'too large'
    } else { imageNote = `${res.status} ${type}`; await res.body?.cancel() }
  }

  return json({
    ticket: {
      id: ticket, state: s(row.state_name), status: s(row.status),
      hospital: s(row.facility_name), city: s(row.city_name), department: s(row.department_name),
      equipment: s(row.item_desc), model: s(row.item_model), make: s(row.manufacturer_name), barcode: s(row.barcode_no),
      engineer: s(row.emp_name), engineer_code: s(row.assigned_to),
      logged: s(row.ticket_logging_date), resolved: s(row.ticket_resolved_date),
      closure: s(row.closure_method), work: s(row.transaction_detail),
    },
    image, image_type: imageType, image_name: shot, image_note: shot ? imageNote : 'no report image in BEMP',
  })
})
