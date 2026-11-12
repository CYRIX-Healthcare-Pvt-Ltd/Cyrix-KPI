import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendMail } from '../_shared/mail.ts'
import { LOGO_WHITE_PNG } from './logo.ts'

/**
 * BEMMP Quotation tracker mails (BEMMP 0042; the user, 12 Nov). Three of them, To both Coordinators, Cc the
 * engineer and the engineer's Team Lead:
 *   raised    a spare request raised (spares raised together in one mail)
 *   quote_ok  the engineer marks the customer's approval, with the signed quotation (else the Coordinator's file) attached
 *   rates     Purchase sends the rates, Cc also the Purchase person who sent them
 * Company colours: black band with the Cyrix logo as it is (inline image, the portal's own file), a red rule,
 * light grey tables.
 *
 * pg_cron calls this every two minutes when something waits (qt_mail_call), with the push key. Sent two seconds apart.
 * A send that fails is written on the rows (error), not tried again.
 *
 * Deploy:  supabase functions deploy qt-mail --no-verify-jwt
 * Secrets: PUSH_REMINDER_KEY (as push), and the mail ones in _shared/mail.ts.
 */

const APP = Deno.env.get('APP_BASE_URL') ?? 'https://app.cyrix.in'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN')
const day = (d: string | null) => (d ? d.split('-').reverse().join('-') : '')

type Req = {
  id: string; no: string; spare: string; part_no: string | null; qty: number; note: string | null
  orig_vendor: string | null; orig_rate: number | null; orig_tax: number | null
  comp_vendor: string | null; comp_rate: number | null; comp_tax: number | null
  warranty: string | null; lead_days: number | null; purchase_note: string | null; picked: string | null
  quote_date: string | null; file: string | null; signed: boolean; step: string
}
type Job = {
  ids: number[]; kind: 'raised' | 'tl_ok' | 'quote_ok' | 'rates'; to: string[]; cc: string[]
  engineer: string | null; engineer_ecode: string | null; team_lead: string | null; by: string | null
  hospital: string; district: string | null; category: string | null
  equipment: string; make: string | null; model: string | null; serial: string | null; step: string; requests: Req[]
}

const STEP: Record<string, string> = {
  tl_review: 'Team Lead review', tl_clarify: 'Team Lead clarification', coord_initial: 'Coordinator', coord_quote: 'Coordinator · quotation',
  coord_pr: 'Coordinator · PR', purchase_rates: 'Purchase · rates', pv: 'PV · pick a quote', eng_quote: 'Engineer · customer approval',
  purchase_dispatch: 'Purchase · PO and dispatch',
}
const withTax = (rate: number | null, tax: number | null) => (rate ?? 0) * (1 + (tax ?? 0) / 100)

function words(j: Job) {
  const r = j.requests[0]
  const many = j.requests.length > 1
  const nos = j.requests.map(x => x.no).join(', ')
  const spares = j.requests.map(x => `${x.spare} × ${x.qty}`).join(', ')
  const equip = [j.equipment, j.make, j.model].filter(Boolean).join(' · ')
  const now = STEP[j.step] ?? j.step
  const link = `${APP}/bemmp/?q=${r.id}`
  const firstName = (n: string | null) => (n ?? '').trim().split(/\s+/)[0]

  let title: string, lead: string, subject: string
  const rows: Array<[string, string]> = []
  let extra = ''
  if (j.kind === 'raised' || j.kind === 'tl_ok') {
    // The first mail goes at the Team Lead's approval (the user, 12 Nov); a Team Lead's own request mails when raised.
    const ok = j.kind === 'tl_ok'
    title = `${ok ? 'Spare request approved' : 'New spare request'} · ${nos}`
    subject = `[${nos}] ${ok ? 'Spare request approved by the Team Lead' : 'New spare request'} · ${many ? `${j.requests.length} spares` : r.spare} · ${j.hospital}`
    lead = ok
      ? `${esc(j.by ?? j.team_lead)} approved ${esc(j.engineer)}’s ${many ? `${j.requests.length} spare requests` : 'spare request'}. It is with the ${esc(now)}.`
      : `${esc(j.engineer)} raised ${many ? `${j.requests.length} spare requests` : 'a spare request'}. It is with the ${esc(now)}.`
    rows.push(['Engineer', esc(`${j.engineer ?? ''}${j.engineer_ecode ? ` (${j.engineer_ecode})` : ''}`)])
    rows.push(['Hospital', esc([j.hospital, j.district, j.category].filter(Boolean).join(' · '))])
    rows.push(['Equipment', esc(equip) + (j.serial ? ` · <span style="color:#777">S/N ${esc(j.serial)}</span>` : '')])
    for (const x of j.requests) rows.push([many ? x.no : 'Spare', `<b>${esc(x.spare)} × ${x.qty}</b>${x.part_no ? ` · <span style="color:#777">${esc(x.part_no)}</span>` : ''}`])
    if (r.note) rows.push(['Engineer’s note', esc(r.note)])
  } else if (j.kind === 'quote_ok') {
    title = `Quotation approved · ${r.no}`
    subject = `[${r.no}] Quotation approved by the customer · ${j.hospital}`
    lead = `${esc(firstName(j.by) ? j.by : j.engineer)} says the customer approved the quotation. It is with the Coordinator to raise the PR.`
    rows.push(['Hospital', esc(j.hospital)])
    rows.push(['Equipment', esc(equip)])
    rows.push(['Spare', `<b>${esc(r.spare)} × ${r.qty}</b>`])
    const pick = r.picked === 'original' ? ['Original', r.orig_vendor, withTax(r.orig_rate, r.orig_tax)] : r.picked === 'compatible' ? ['Compatible', r.comp_vendor, withTax(r.comp_rate, r.comp_tax)] : null
    if (pick && pick[2]) rows.push(['Quotation', esc(`${pick[0]} · ${pick[1] ?? ''} · ${inr(pick[2] as number)} with tax${r.quote_date ? ' · ' + day(r.quote_date) : ''}`)])
    else if (r.quote_date) rows.push(['Quotation date', esc(day(r.quote_date))])
    if (r.file) extra = `<p style="margin:12px 0 0;font-size:12px;color:#555">📎 ${r.signed ? 'The signed quotation is attached.' : 'The quotation is attached.'}</p>`
  } else {
    title = `Rates from Purchase · ${r.no}`
    subject = `[${r.no}] Rates from Purchase · ${r.spare} · ${j.hospital}`
    lead = `${esc(j.by ?? 'Purchase')} sent the rates for ${esc(r.spare)} × ${r.qty}. It is with the ${esc(now)}.`
    rows.push(['Hospital', esc(j.hospital)])
    rows.push(['Equipment', esc(equip)])
    const cols: Array<[string, string | null, number | null, number | null]> = []
    if (r.orig_rate) cols.push(['Original', r.orig_vendor, r.orig_rate, r.orig_tax])
    if (r.comp_rate) cols.push(['Compatible', r.comp_vendor, r.comp_rate, r.comp_tax])
    const cell = 'padding:7px 10px;background:#f7f7f7;border-bottom:2px solid #fff'
    const head = 'padding:7px 10px;background:#f2f2f2;color:#555;border-bottom:2px solid #fff;width:34%'
    extra = `<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:12px">
      <tr><td style="${head}"></td>${cols.map(c => `<td style="${cell};font-weight:600">${c[0]}</td>`).join('')}</tr>
      <tr><td style="${head}">Vendor</td>${cols.map(c => `<td style="${cell}">${esc(c[1])}</td>`).join('')}</tr>
      <tr><td style="${head}">Rate + tax</td>${cols.map(c => `<td style="${cell}">${inr(c[2] ?? 0)} + ${Number(c[3] ?? 0)}%</td>`).join('')}</tr>
      <tr><td style="${head}">Total</td>${cols.map(c => `<td style="${cell}"><b>${inr(withTax(c[2], c[3]))}</b></td>`).join('')}</tr>
      ${r.warranty || r.lead_days ? `<tr><td style="${head}">Warranty · lead time</td><td style="${cell}" colspan="${cols.length}">${esc([r.warranty, r.lead_days ? `${r.lead_days} days` : ''].filter(Boolean).join(' · '))}</td></tr>` : ''}
    </table>${r.purchase_note ? `<p style="margin:10px 0 0;font-size:13px;color:#444"><b>Purchase:</b> ${esc(r.purchase_note)}</p>` : ''}`
  }
  rows.push(['Now with', `<span style="background:#c8102e;color:#fff;padding:2px 9px;border-radius:99px;font-size:12px">${esc(now)}</span>`])

  const k = 'padding:7px 10px;background:#f2f2f2;color:#555;width:34%;border-bottom:2px solid #fff;vertical-align:top'
  const v = 'padding:7px 10px;background:#f7f7f7;border-bottom:2px solid #fff'
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#eeeeee;font-family:Segoe UI,Arial,sans-serif;color:#1a1a1a">
<div style="max-width:580px;margin:0 auto;background:#ffffff;border:1px solid #d9d9d9;border-radius:10px;overflow:hidden">
  <div style="background:#111111;padding:14px 20px"><table style="width:100%;border-collapse:collapse"><tr>
    <td><img src="cid:cyrixlogo" alt="Cyrix" width="104" height="40" style="display:block;border:0"></td>
    <td style="text-align:right;color:#ffffff;font-size:11px;letter-spacing:2px">QUOTATION TRACKER</td></tr></table></div>
  <div style="height:4px;background:#c8102e"></div>
  <div style="padding:22px 20px">
    <p style="margin:0 0 6px;font-size:19px;font-weight:600;color:#111">${esc(title)}</p>
    <p style="margin:0 0 14px;font-size:14px;color:#444">${lead}</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">${rows.map(([a, b]) => `<tr><td style="${k}">${a}</td><td style="${v}">${b}</td></tr>`).join('')}</table>
    ${extra}
    <div style="text-align:center;margin:22px 0 4px"><a href="${link}" style="display:inline-block;background:#c8102e;color:#ffffff;text-decoration:none;padding:11px 24px;border-radius:8px;font-size:14px;font-weight:600">Open request</a></div>
  </div>
  <div style="background:#f2f2f2;padding:10px 20px;color:#777;font-size:11px;text-align:center">Sent by app.cyrix.in · BEMMP · Quotation tracker</div>
</div></body></html>`
  const text = [title, '', lead.replace(/<[^>]+>/g, ''), '', ...rows.map(([a, b]) => `${a}: ${b.replace(/<[^>]+>/g, '')}`), '', `Open: ${link}`].join('\n')
  return { subject, html, text }
}

const b64 = (bytes: Uint8Array) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (req.headers.get('x-push-key') !== Deno.env.get('PUSH_REMINDER_KEY')) return json({ error: 'Not allowed' }, 403)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  const { data, error } = await db.rpc('qt_mail_claim', { p_limit: 20 })
  if (error) return json({ error: error.message }, 500)
  const jobs = (data ?? []) as Job[]
  let sent = 0, failed = 0
  for (const [i, j] of jobs.entries()) {
    try {
      if (!j.to.length && !j.cc.length) throw new Error('No work email for the Coordinators, the engineer or the Team Lead')
      const attachments: Array<{ name: string; type: string; base64: string; cid?: string }> = [
        { name: 'cyrix-logo.png', type: 'image/png', base64: LOGO_WHITE_PNG, cid: 'cyrixlogo' },
      ]
      const r = j.requests[0]
      if (j.kind === 'quote_ok' && r.file) {
        const { data: blob, error: fe } = await db.storage.from('qt-photos').download(r.file)
        if (fe || !blob) throw new Error(`Quotation file not found: ${fe?.message ?? r.file}`)
        const ext = (r.file.split('.').pop() ?? 'pdf').toLowerCase()
        attachments.push({ name: `${r.no} ${r.signed ? 'signed quotation' : 'quotation'}.${ext}`, type: blob.type || (ext === 'pdf' ? 'application/pdf' : 'image/jpeg'), base64: b64(new Uint8Array(await blob.arrayBuffer())) })
      }
      const to = j.to.length ? j.to : j.cc
      const cc = j.to.length ? j.cc : []
      await sendMail(db as never, { to, cc, ...words(j), attachments })
      await db.rpc('qt_mail_done', { p_ids: j.ids, p_error: null })
      sent++
    } catch (e) {
      failed++
      await db.rpc('qt_mail_done', { p_ids: j.ids, p_error: (e as Error).message.slice(0, 500) })
    }
    if (i < jobs.length - 1) await new Promise(res => setTimeout(res, 2000))
  }
  return json({ claimed: jobs.length, sent, failed })
})
