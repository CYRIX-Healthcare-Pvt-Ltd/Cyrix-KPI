/**
 * Two more Travel mails, in the look of words.ts (Travel te_0132; the user, 6 Nov: "add check box, ie claim, advance,
 * vehicle, deputation"):
 *   claimWords  a claim the Travel Desk has approved
 *   depWords    a deputation the reporting manager has approved
 * Each to the person, copied to the manager, the Travel Desk and whoever SW Admin ticked for it (Mail copies).
 */

export type ClaimRow = {
  id: string; number: string | null; month: string; amount: number | null
  name: string; ecode: string; designation: string | null; email: string | null
  manager_name: string | null; manager_email: string | null; manager_at: string | null
  desk_name: string | null; desk_at: string | null; desk_note: string | null
  desk_emails: string[] | null; copy_emails: string[] | null
  employee_id?: string; from_day?: string | null; to_day?: string | null
}
export type DepRow = {
  id: string; state: string; from_day: string; to_day: string; letter_name: string | null; note: string | null
  name: string; ecode: string; designation: string | null; email: string | null
  manager_name: string | null; manager_email: string | null; decided_at: string | null
  desk_emails: string[] | null; copy_emails: string[] | null
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const rupees = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN')
const day = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: iso.length === 10 ? 'UTC' : 'Asia/Kolkata' })
const monthYear = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** The person; copies to the manager, the Travel Desk and the ticked people — each once. */
export function copiesTo(r: { email: string | null; manager_email: string | null; desk_emails: string[] | null; copy_emails: string[] | null }) {
  const clean = (s: string | null | undefined) => (s ?? '').trim().toLowerCase() || null
  const to = [clean(r.email)].filter((x): x is string => !!x)
  const cc = [...new Set([clean(r.manager_email), ...(r.desk_emails ?? []).map(clean), ...(r.copy_emails ?? []).map(clean)]
    .filter((x): x is string => !!x && !to.includes(x)))]
  return to.length ? { to, cc } : { to: cc.slice(0, 1), cc: cc.slice(1) }
}

function page(o: { first: string; lead: string; tag: string; big: string; small: string; lines: Array<[string, string]>; note?: string; link: string; button: string; copies: string; table?: string }) {
  const row = (k: string, v: string) =>
    `<tr><td style="color:#888780;padding:5px 12px 5px 0;width:44%;font-size:13px;vertical-align:top">${esc(k)}</td><td style="padding:5px 0;font-size:13px;vertical-align:top">${esc(v)}</td></tr>`
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#F1EFE8;font-family:Segoe UI,Arial,sans-serif;color:#2C2C2A">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #D3D1C7;border-radius:12px;padding:24px">
  <div style="font-size:20px;font-weight:600;letter-spacing:1px;margin-bottom:18px">CYRI<span style="color:#E30613">X</span> <span style="font-size:12px;font-weight:400;color:#888780;letter-spacing:0">Travel Expense</span></div>
  <p style="margin:0 0 6px;font-size:15px">Dear ${esc(o.first)},</p>
  <p style="margin:0 0 18px;font-size:15px;color:#5F5E5A">${esc(o.lead)}</p>
  <div style="background:#EEEDFE;border-radius:10px;padding:14px 16px;margin-bottom:18px">
    <span style="float:right;background:#EAF3DE;color:#27500A;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:600">Approved</span>
    <p style="margin:0;font-size:12px;color:#534AB7;font-weight:600;letter-spacing:.5px">${esc(o.tag)}</p>
    <p style="margin:4px 0 2px;font-size:26px;font-weight:700;color:#26215C">${esc(o.big)}</p>
    <p style="margin:0;font-size:13px;color:#3C3489">${esc(o.small)}</p>
  </div>
  ${o.table ?? ''}
  <table style="width:100%;border-collapse:collapse;margin-bottom:16px">${o.lines.map(([k, v]) => row(k, v)).join('')}</table>
  ${o.note ? `<div style="background:#F1EFE8;border-radius:8px;padding:9px 12px;font-size:13px;margin-bottom:16px;white-space:pre-wrap">${esc(o.note)}</div>` : ''}
  <a href="${o.link}" style="display:inline-block;background:#2C2C2A;color:#F1EFE8;text-decoration:none;border-radius:8px;padding:10px 18px;font-size:14px;font-weight:600">${esc(o.button)}</a>
  <p style="margin:20px 0 0;font-size:12px;color:#888780">${esc(o.copies)}</p>
</div></body></html>`
}

export function claimWords(r: ClaimRow, app = 'https://app.cyrix.in') {
  const first = r.name.split(' ')[0]
  const amount = rupees(r.amount ?? 0)
  const no = r.number ?? `${monthYear(r.month)} claim`
  const link = `${app}/travel/claim/${r.id}`
  const subject = `Travel claim ${no} approved · ${amount} · ${r.name} (${r.ecode})`
  const lead = `Your travel claim ${no} for ${monthYear(r.month)} of ${amount} has been approved by the Travel Desk.`
  const lines: Array<[string, string]> = [
    ['Claim no.', no],
    ['Month', monthYear(r.month)],
    ['Employee', `${r.name} (${r.ecode})${r.designation ? ' · ' + r.designation : ''}`],
    ['Amount', amount],
    ['Reporting manager', `${r.manager_name ?? '—'}${r.manager_at ? ' · approved ' + day(r.manager_at) : ''}`],
    ['Travel Desk', `${r.desk_name ?? '—'}${r.desk_at ? ' · approved ' + day(r.desk_at) : ''}`],
  ]
  const note = r.desk_note ? `${r.desk_name ?? 'Travel Desk'} (Travel Desk): ${r.desk_note}` : undefined
  const copies = `Sent to ${r.name}, with copies to ${r.manager_name ? `${r.manager_name} (reporting manager), ` : ''}the Travel Desk${r.copy_emails?.length ? ' and others' : ''}.`
  const text = [`Dear ${first},`, '', lead, '', ...lines.map(([k, v]) => `${k}: ${v}`), '', ...(note ? [note, ''] : []), `Open the claim: ${link}`, '', copies].join('\n')
  return { subject, text, html: page({ first, lead, tag: `TRAVEL CLAIM ${no.toUpperCase()}`, big: amount, small: monthYear(r.month), lines, note, link, button: 'Open the claim', copies }) }
}

export function depWords(r: DepRow, app = 'https://app.cyrix.in') {
  const first = r.name.split(' ')[0]
  const n = Math.round((Date.parse(r.to_day) - Date.parse(r.from_day)) / 86400000) + 1
  const range = `${day(r.from_day)} – ${day(r.to_day)}`
  const link = `${app}/travel/profile?tab=deputation`
  const subject = `Deputation to ${r.state} approved · ${range} · ${r.name} (${r.ecode})`
  const lead = `Your deputation to ${r.state} from ${range} has been approved by ${r.manager_name ?? 'your reporting manager'}.`
  const lines: Array<[string, string]> = [
    ['Employee', `${r.name} (${r.ecode})${r.designation ? ' · ' + r.designation : ''}`],
    ['State', r.state],
    ['Dates', `${range} · ${n} ${n === 1 ? 'day' : 'days'}`],
    ...(r.letter_name ? [['Letter', r.letter_name] as [string, string]] : []),
    ['Approved by', `${r.manager_name ?? '—'}${r.decided_at ? ' · ' + day(r.decided_at) : ''}`],
  ]
  const note = r.note ? `${r.manager_name ?? 'Manager'}: ${r.note}` : undefined
  const copies = `Sent to ${r.name}, with copies to ${r.manager_name ? `${r.manager_name} (reporting manager), ` : ''}the Travel Desk${r.copy_emails?.length ? ' and others' : ''}.`
  const text = [`Dear ${first},`, '', lead, '', ...lines.map(([k, v]) => `${k}: ${v}`), '', ...(note ? [note, ''] : []), `Open Deputation: ${link}`, '', copies].join('\n')
  return { subject, text, html: page({ first, lead, tag: 'DEPUTATION', big: r.state, small: `${range} · ${n} ${n === 1 ? 'day' : 'days'}`, lines, note, link, button: 'Open Deputation', copies }) }
}

/*
  A person's claims approved together, in one mail (te_0138; the user, 9 Nov: "build the combined mail"): the total on
  top, then a row a claim — its number (a link), dates, the day the manager approved it and its amount — and a Total.
*/
const dates = (a?: string | null, b?: string | null) => {
  if (!a) return '—'
  const f = (x: string) => new Date(`${x}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return !b || a === b ? f(a) : `${f(a)} – ${f(b)}`
}
export function claimsWords(rs: ClaimRow[], app = 'https://app.cyrix.in') {
  const r = rs[0], first = r.name.split(' ')[0]
  const sum = rs.reduce((t, x) => t + Number(x.amount ?? 0), 0), amount = rupees(sum)
  const nos = rs.map(x => x.number ?? `${monthYear(x.month)} claim`)
  const months = [...new Set(rs.map(x => monthYear(x.month)))].join(', ')
  const link = `${app}/travel/`
  const subject = `Travel claims ${nos.join(', ')} approved · ${amount} · ${r.name} (${r.ecode})`
  const lead = `Your ${rs.length} travel claims of ${amount} have been approved by the Travel Desk.`
  const lastDesk = rs.map(x => x.desk_at).filter((x): x is string => !!x).sort().pop()
  const lines: Array<[string, string]> = [
    ['Employee', `${r.name} (${r.ecode})${r.designation ? ' · ' + r.designation : ''}`],
    ['Reporting manager', r.manager_name ?? '—'],
    ['Travel Desk', `${r.desk_name ?? '—'}${lastDesk ? ' · approved ' + day(lastDesk) : ''}`],
  ]
  const td = 'padding:6px 8px 6px 0;font-size:13px;border-bottom:1px solid #F1EFE8'
  const head = (t: string, right = false) =>
    `<td style="padding:6px ${right ? '0' : '8px'} 6px 0;font-size:12px;color:#888780;border-bottom:1px solid #D3D1C7${right ? ';text-align:right' : ''}">${t}</td>`
  const rows = rs.map((x, i) =>
    `<tr><td style="${td}"><a href="${app}/travel/claim/${x.id}" style="color:#185FA5;text-decoration:none;font-weight:600">${esc(nos[i])}</a></td>` +
    `<td style="${td}">${esc(dates(x.from_day, x.to_day))}</td><td style="${td}">${x.manager_at ? esc(day(x.manager_at)) : '—'}</td>` +
    `<td style="${td};text-align:right">${esc(rupees(Number(x.amount ?? 0)))}</td></tr>`).join('')
  const table = `<table style="width:100%;border-collapse:collapse;margin-bottom:16px"><tr>${head('Claim')}${head('Dates')}${head('Manager approved')}${head('Amount', true)}</tr>${rows}` +
    `<tr><td colspan="3" style="padding:8px 0;font-size:13px;font-weight:700">Total</td><td style="padding:8px 0;font-size:13px;font-weight:700;text-align:right">${esc(amount)}</td></tr></table>`
  const notes = rs.flatMap((x, i) => (x.desk_note ? [`${nos[i]}: ${x.desk_note}`] : []))
  const note = notes.length ? [`${r.desk_name ?? 'Travel Desk'} (Travel Desk)`, ...notes].join('\n') : undefined
  const copies = `Sent to ${r.name}, with copies to ${r.manager_name ? `${r.manager_name} (reporting manager), ` : ''}the Travel Desk${r.copy_emails?.length ? ' and others' : ''}.`
  const text = [`Dear ${first},`, '', lead, '',
    ...rs.map((x, i) => `${nos[i]} · ${dates(x.from_day, x.to_day)} · ${rupees(Number(x.amount ?? 0))}`), `Total: ${amount}`, '',
    ...lines.map(([k, v]) => `${k}: ${v}`), '', ...(note ? [note, ''] : []), `Open my claims: ${link}`, '', copies].join('\n')
  return { subject, text, html: page({ first, lead, tag: `${rs.length} TRAVEL CLAIMS`, big: amount, small: months, lines, note, link, button: 'Open my claims', copies, table }) }
}
