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
 *
 * Private BEMMP (the user, 14 Nov): Care360's tickets live in FieldPro (cyrixpvtbemp.kaspontech.com, by Kaspon) as
 * PMPT IDs (PMPT_000023). Its app signs in at privatebempapi.kaspontech.com/chpvtbemp/fp_sass_login/ (user ID and
 * password, no OTP; the Travel login is in BEMP_PVT_USERNAME / BEMP_PVT_PASSWORD, entered by the user) and reads a job
 * with get_ticket_details/?ticket_id=…, the call behind its Job Report's Job Details. The resolution image is the
 * completed job's own, under privatebempapi.kaspontech.com/.
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
const PVT_API = 'https://privatebempapi.kaspontech.com/chpvtbemp/'
const PVT_FILES = 'https://privatebempapi.kaspontech.com/'
let pvtToken: string | null = null // FieldPro's token while this instance is warm

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
  if (!user || !pass) throw new Error('Ticket look-up is not set up yet')
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
  if (!/dashboard/i.test(where) && !/dashboard/i.test(page.slice(0, 4000))) throw new Error(said ? `Ticket look-up: ${said}` : 'Ticket look-up could not sign in')
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

const s = (v: unknown) => (typeof v === 'string' && v.trim() && !/^0000-00-00/.test(v) ? v.trim() : typeof v === 'number' ? String(v) : null)

/* ------------------------------------------------------------------ FieldPro (private BEMMP) -- */

async function pvtSignIn(): Promise<string> {
  const user = Deno.env.get('BEMP_PVT_USERNAME'), pass = Deno.env.get('BEMP_PVT_PASSWORD')
  if (!user || !pass) throw new Error('Ticket look-up is not set up yet')
  const res = await fetch(PVT_API + 'fp_sass_login/', {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username: user, password: pass, device_type: 'web', device_model: 'chrome', app_version: '1.0', device_os: 'Win32', device_token: null, login_flag: 1, dic_flag: 0 }),
  })
  const j = await res.json().catch(() => null) as { response?: { response_code?: unknown; token?: unknown; message?: unknown } } | null
  const r = j?.response
  if (String(r?.response_code) !== '200' || typeof r?.token !== 'string' || !r.token) {
    throw new Error(`Ticket look-up: ${typeof r?.message === 'string' && r.message ? r.message : `could not sign in (${res.status})`}`)
  }
  return r.token
}

const pvtHeaders = (token: string) => ({ 'User-Agent': UA, Accept: 'application/json', Authorization: `Bearer ${token}`, Origin: 'https://cyrixpvtbemp.kaspontech.com', Referer: 'https://cyrixpvtbemp.kaspontech.com/' })

/** The job, 'none' when FieldPro has no such job, or null when the token was refused (sign in again). */
async function pvtJob(token: string, ticket: string): Promise<Row | 'none' | null> {
  const res = await fetch(`${PVT_API}get_ticket_details/?ticket_id=${encodeURIComponent(ticket)}`, { headers: pvtHeaders(token) })
  if (res.status === 401 || res.status === 403) { await res.body?.cancel(); return null }
  const j = await res.json().catch(() => null) as { response?: { response_code?: unknown; data?: unknown } } | null
  if (!j?.response) return null
  const data = j.response.data
  const row = Array.isArray(data) ? data[0] : data
  return String(j.response.response_code) === '200' && row && typeof row === 'object' ? row as Row : 'none'
}

/** The first image path of a resolution_image value (a path, a list, or several joined by commas). */
function firstPath(v: unknown): string | null {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []
  for (const x of list) { const p = typeof x === 'string' ? x.trim() : ''; if (p && p !== 'null') return p }
  return null
}

async function pvtLookup(ticket: string): Promise<Response> {
  let job: Row | 'none' | null = null
  try {
    if (pvtToken) job = await pvtJob(pvtToken, ticket)
    if (job === null) { pvtToken = await pvtSignIn(); job = await pvtJob(pvtToken, ticket) }
  } catch (e) { pvtToken = null; return json({ error: (e as Error).message }, 502) }
  if (job === null) { pvtToken = null; return json({ error: 'Ticket look-up did not answer, try again' }, 502) }
  if (job === 'none') return json({ error: `Ticket ${ticket} not found` }, 404)

  // The job's own line among the equipment's completed jobs: its dates, its comment and its resolution image.
  const done = (Array.isArray(job.completed_tickets) ? job.completed_tickets as Row[] : []).find(t => String(t.ticket_id ?? '').toUpperCase() === ticket) ?? null
  const visits = Array.isArray(job.visit_details) ? job.visit_details as Row[] : []
  const visit = visits.find(v => String(v.ticket_id ?? '').toUpperCase() === ticket) ?? visits[visits.length - 1] ?? null

  let image: string | null = null, imageType: string | null = null, imageNote: string | null = null, imageName: string | null = null
  const path = firstPath(done?.resolution_image) ?? firstPath(job.resolution_image)
  if (path) {
    const url = /^https?:\/\//i.test(path) ? path : PVT_FILES + path.replace(/^\/+/, '')
    imageName = path.split('/').pop() ?? null
    try {
      const res = await fetch(url, { headers: { ...pvtHeaders(pvtToken ?? ''), Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' } })
      const type = res.headers.get('content-type') ?? ''
      if (res.ok && /^image\//.test(type)) {
        const bytes = new Uint8Array(await res.arrayBuffer())
        if (bytes.length <= 8 * 1024 * 1024) {
          let bin = ''
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
          image = btoa(bin); imageType = type
        } else imageNote = 'too large'
      } else { imageNote = `${res.status} ${type}`; await res.body?.cancel() }
    } catch (e) { imageNote = (e as Error).message }
  }

  // "2026-01-24 10:25:30" as the AP answers carry it, "24-01-2026 10:25:30".
  const dmy = (v: unknown) => { const m = s(v)?.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/); return m ? `${m[3]}-${m[2]}-${m[1]}${m[4] ? ' ' + m[4] : ''}` : s(v) }
  const finished = [...visits].reverse().find(v => /complet/i.test(String(v.status_name ?? v.ticket_status ?? ''))) ?? null
  return json({
    ticket: {
      id: ticket, source: 'pvt', status: done ? 'completed' : s(finished?.status_name) ?? s(job.ticket_type_name),
      hospital: s(job.customer_name), city: s(job.location) ?? s(job.location_name), state: s(job.zone_name), department: s(job.facility_department_name),
      equipment: s(job.equipment_name), model: s(job.part_number), make: s(job.model), barcode: s(job.serial_no),
      // The assigned BME, as FieldPro's Job Report shows it; else whoever visited.
      engineer: s(job.technician) ?? s(visit?.technician_name), engineer_code: s(job.technician_code),
      logged: s(done?.raised_date) ?? s(job.raised_date_time) ?? s(job.job_logged_date),
      resolved: dmy(finished?.ticket_end_date) ?? s(done?.completed_date),
      closure: null, work: s(done?.resolution_summary) ?? s(job.problem),
    },
    image, image_type: imageType, image_name: imageName, image_note: path ? imageNote : 'no resolution image in FieldPro',
  })
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false }, global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  // The service role (a check run from the server side) may look up any ticket.
  const service = (req.headers.get('Authorization') ?? '') === `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
  const { data: me } = service ? { data: null } : await db.auth.getUser()
  if (!service && !me?.user) return json({ error: 'Sign in first' }, 401)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const asked = await req.json().catch(() => ({})) as { ticket?: unknown; claim?: unknown }
  const { data: prof } = service ? { data: null } : await admin.from('profiles').select('ecode').eq('id', me!.user!.id).maybeSingle()
  let open = service || TEST.has(String(prof?.ecode ?? '').toUpperCase())
  if (!open && typeof asked.claim === 'string' && /^[0-9a-f-]{36}$/i.test(asked.claim)) {
    const { data: allowed } = await db.rpc('travel_has_access')
    const { data: claim } = await admin.from('te_claims').select('employee_id').eq('id', asked.claim).maybeSingle()
    const { data: owner } = claim ? await admin.from('profiles').select('ecode').eq('id', claim.employee_id).maybeSingle() : { data: null }
    open = !!allowed && TEST.has(String(owner?.ecode ?? '').toUpperCase())
  }
  if (!open) return json({ error: 'Ticket lookup is not open for you yet' }, 403)

  const ticket = String(asked.ticket ?? '').trim().toUpperCase()
  if (/^PMPT_\d{3,}$/.test(ticket)) return await pvtLookup(ticket)
  if (!/^AP\d{3,}$/.test(ticket)) return json({ error: /^\d+$/.test(ticket) ? 'KL tickets are not connected yet' : 'Not a ticket ID' }, 400)

  let rows: Row[] | null = null
  try {
    if (session) rows = await search(session, ticket)
    if (rows === null) { session = await signIn(); rows = await search(session, ticket) }
  } catch (e) { session = null; return json({ error: (e as Error).message }, 502) }
  if (rows === null) { session = null; return json({ error: 'Ticket look-up did not answer, try again' }, 502) }

  const row = rows.find(r => String(r.ticket_id ?? '').toUpperCase() === ticket)
  if (!row) return json({ error: `Ticket ${ticket} not found` }, 404)

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
