/**
 * The mail for an out-of-policy vehicle (Travel te_0096): approved by the Travel Desk, or removed later by the
 * manager (the user, 3 Nov: "after approval a mail will go to requested person and his reporting manager … like
 * advance mail goes"). One mail to the person, copied to the manager and the Travel Desk. Same look as words.ts.
 */

export type VehicleRow = {
  id: string; number: string; kind: 'approved' | 'removed'; mode: string; label: string
  from_day: string; to_day: string; until: string; reason: string; letter_name: string | null; created_at: string
  name: string; ecode: string; designation: string | null; grade: string | null; email: string | null
  manager_name: string | null; manager_ecode: string | null; manager_email: string | null; manager_at: string | null
  desk_name: string | null; desk_at: string | null
  removed_name: string | null; removed_at: string | null; note: string | null
  desk_emails: string[] | null
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const day = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: iso.length === 10 ? 'UTC' : 'Asia/Kolkata' })
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1

export function vehicleWords(r: VehicleRow, app = 'https://app.cyrix.in') {
  const first = r.name.split(' ')[0]
  const removed = r.kind === 'removed'
  const range = `${day(r.from_day)} – ${day(r.to_day)}`
  const n = days(r.from_day, r.to_day)
  const link = `${app}/travel/profile?tab=vehicle`
  const subject = `${r.label} ${removed ? 'approval removed' : 'approved'} ${r.number} · ${range} · ${r.name} (${r.ecode})`
  const lead = removed
    ? `Your ${r.label.toLowerCase()} approval ${r.number} has been removed by ${r.removed_name ?? 'your reporting manager'}.`
    : `Your request to use ${r.label.toLowerCase()} for travel, outside your grade's policy, has been approved.`
  const lines: Array<[string, string]> = [
    ['Approval no.', r.number],
    ['Request date', day(r.created_at)],
    ['Employee code', r.ecode],
    ['Employee name', `${r.name}${r.designation ? ' · ' + r.designation : ''}`],
    ['Grade', r.grade ?? '—'],
    ['Vehicle', r.label],
    ['Approved for', `${range} · ${n} ${n === 1 ? 'day' : 'days'}`],
    ['Reason', r.reason],
    ...(r.letter_name ? [['Letter', r.letter_name] as [string, string]] : []),
    ['Reporting manager', `${r.manager_name ?? '—'}${r.manager_at ? ' · approved ' + day(r.manager_at) : ''}`],
    ['Travel Desk', `${r.desk_name ?? '—'}${r.desk_at ? ' · approved ' + day(r.desk_at) : ''}`],
    ...(removed ? [['Removed', `${r.removed_name ?? '—'}${r.removed_at ? ' · ' + day(r.removed_at) : ''}`] as [string, string]] : []),
  ]
  const after = removed
    ? [`Rides by ${r.label.toLowerCase()} up to ${day(r.until)} stay approved.`, `From ${day(r.removed_at ?? r.until)} they are out of policy again.`]
    : [`Rides by ${r.label.toLowerCase()} from ${day(r.from_day)} to ${day(r.to_day)} are allowed on your claims.`, 'On other days they are still out of policy.']
  const copies = `Sent to ${r.name}, with copies to ${r.manager_name ? `${r.manager_name} (reporting manager) and ` : ''}the Travel Desk.`

  const text = [
    `Dear ${first},`, '', lead, '',
    ...lines.map(([k, v]) => `${k}: ${v}`), '',
    ...(removed && r.note ? [`Reason for removal: ${r.note}`, ''] : []),
    ...after, '',
    `Open My profile → Vehicle: ${link}`, '', copies,
  ].join('\n')

  const row = (k: string, v: string, strong = false) =>
    `<tr><td style="color:#888780;padding:5px 12px 5px 0;width:44%;font-size:13px;vertical-align:top">${esc(k)}</td><td style="padding:5px 0;font-size:13px;vertical-align:top;${strong ? 'font-weight:600' : ''}">${esc(v)}</td></tr>`
  const badge = removed
    ? '<span style="float:right;background:#F1EFE8;color:#444441;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:600">Removed</span>'
    : '<span style="float:right;background:#EAF3DE;color:#27500A;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:600">Approved</span>'
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#F1EFE8;font-family:Segoe UI,Arial,sans-serif;color:#2C2C2A">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #D3D1C7;border-radius:12px;padding:24px">
  <div style="font-size:20px;font-weight:600;letter-spacing:1px;margin-bottom:18px">CYRI<span style="color:#E30613">X</span> <span style="font-size:12px;font-weight:400;color:#888780;letter-spacing:0">Travel Expense</span></div>
  <p style="margin:0 0 6px;font-size:15px">Dear ${esc(first)},</p>
  <p style="margin:0 0 18px;font-size:15px;color:#5F5E5A">${esc(lead)}</p>
  <div style="background:#EEEDFE;border-radius:10px;padding:14px 16px;margin-bottom:18px">
    ${badge}
    <p style="margin:0;font-size:12px;color:#534AB7;font-weight:600;letter-spacing:.5px">VEHICLE APPROVAL ${esc(r.number)}</p>
    <p style="margin:4px 0 2px;font-size:28px;font-weight:700;color:#26215C">${esc(r.label)}</p>
    <p style="margin:0;font-size:13px;color:#3C3489">${esc(range)} · ${n} ${n === 1 ? 'day' : 'days'}</p>
  </div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:16px">${lines.map(([k, v], i) => row(k, v, i === 0 || i === 5)).join('')}</table>
  ${removed && r.note ? `<div style="background:#FCEBEB;color:#791F1F;border-radius:8px;padding:9px 12px;font-size:13px;margin-bottom:8px;white-space:pre-wrap"><b>Reason for removal</b> · ${esc(r.note)}</div>` : ''}
  <div style="background:#E1F5EE;color:#085041;border-radius:8px;padding:11px 14px;font-size:13px;margin:8px 0 20px">
    <b>On your claims</b><br>${after.map(esc).join('<br>')}
  </div>
  <a href="${link}" style="display:inline-block;background:#2C2C2A;color:#F1EFE8;text-decoration:none;border-radius:8px;padding:10px 18px;font-size:14px;font-weight:600">Open My profile → Vehicle</a>
  <p style="margin:20px 0 0;font-size:12px;color:#888780">${esc(copies)}</p>
</div></body></html>`
  return { subject, text, html }
}
