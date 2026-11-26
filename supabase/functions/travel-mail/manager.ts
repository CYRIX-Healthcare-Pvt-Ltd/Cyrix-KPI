/**
 * The mail to the Travel Desk when a reporting manager approves an expense advance (Travel te_0128; the user, 5 Nov:
 * "travel desk told they want to receive mail when manager approves the advance, ie body says manager approved the
 * advance"). To the Travel Desk, copied to nobody: the advance as the request form has it, who approved it and when,
 * the manager's edit if there was one, and a button to their approvals. Same look as words.ts.
 */
import { inWords, type AdvanceRow } from './words.ts'

export type ManagerRow = AdvanceRow & { edit_note: string | null; edited_name: string | null; edited_at: string | null }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const rupees = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN')
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })

export function managerWords(r: ManagerRow, app = 'https://app.cyrix.in') {
  const amount = rupees(r.amount)
  const manager = r.manager_name ? `${r.manager_name}${r.manager_ecode ? ` (${r.manager_ecode})` : ''}` : 'The reporting manager'
  const link = `${app}/travel/approvals?view=advances`
  const subject = `Advance ${r.number} approved by the manager · ${amount} · ${r.name} (${r.ecode})`
  const base = [r.base_name, r.base_state].filter(Boolean).join(', ')
  const lines: Array<[string, string]> = [
    ['Advance no.', r.number],
    ['Request date', when(r.created_at)],
    ['Employee code', r.ecode],
    ['Employee name', `${r.name}${r.designation ? ' · ' + r.designation : ''}`],
    ['Advance amount', `${amount} (${inWords(r.amount)})`],
    ['Purpose of advance (work details)', r.purpose],
    ['Reason for advance', r.reason],
    ['Base location', base],
    ['Travel destination (To)', r.dest_name],
    ['Project or cost centre', r.cost_centre ?? '—'],
    ['Reporting manager', `${manager}${r.manager_at ? ' · approved ' + when(r.manager_at) : ''}`],
  ]
  const notes: Array<[string, string]> = [
    ...(r.edit_note ? [[`Edited by ${r.edited_name ?? r.manager_name ?? 'the manager'}`, r.edit_note] as [string, string]] : []),
    ...(r.manager_note ? [[`${r.manager_name ?? 'Manager'} (reporting manager)`, r.manager_note] as [string, string]] : []),
  ]

  const text = [
    'Dear Travel Desk,', '',
    `${manager} has approved expense advance ${r.number} of ${amount} for ${r.name} (${r.ecode}). It is now waiting for your approval.`, '',
    ...lines.map(([k, v]) => `${k}: ${v}`), '',
    ...notes.map(([k, v]) => `${k}: ${v}`), ...(notes.length ? [''] : []),
    `Open Approvals: ${link}`,
  ].join('\n')

  const row = (k: string, v: string, strong = false) =>
    `<tr><td style="color:#888780;padding:5px 12px 5px 0;width:44%;font-size:13px;vertical-align:top">${esc(k)}</td><td style="padding:5px 0;font-size:13px;vertical-align:top;${strong ? 'font-weight:600' : ''}">${esc(v)}</td></tr>`
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#F1EFE8;font-family:Segoe UI,Arial,sans-serif;color:#2C2C2A">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #D3D1C7;border-radius:12px;padding:24px">
  <div style="font-size:20px;font-weight:600;letter-spacing:1px;margin-bottom:18px">CYRI<span style="color:#E30613">X</span> <span style="font-size:12px;font-weight:400;color:#888780;letter-spacing:0">Travel Expense</span></div>
  <p style="margin:0 0 6px;font-size:15px">Dear Travel Desk,</p>
  <p style="margin:0 0 18px;font-size:15px;color:#5F5E5A"><b style="color:#2C2C2A">${esc(manager)}</b> has approved expense advance <b style="color:#2C2C2A">${esc(r.number)}</b> of <b style="color:#2C2C2A">${esc(amount)}</b> for <b style="color:#2C2C2A">${esc(r.name)} (${esc(r.ecode)})</b>. It is now waiting for your approval.</p>
  <div style="background:#EEEDFE;border-radius:10px;padding:14px 16px;margin-bottom:18px">
    <span style="float:right;background:#E6F1FB;color:#0C447C;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:600">With Travel Desk</span>
    <p style="margin:0;font-size:12px;color:#534AB7;font-weight:600;letter-spacing:.5px">EXPENSE ADVANCE ${esc(r.number)}</p>
    <p style="margin:4px 0 2px;font-size:28px;font-weight:700;color:#26215C">${esc(amount)}</p>
    <p style="margin:0;font-size:13px;color:#3C3489">${esc(inWords(r.amount))}</p>
  </div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:16px">${lines.map(([k, v], i) => row(k, v, i === 0 || i === 4)).join('')}</table>
  ${notes.map(([k, v]) => `<div style="background:#FAEEDA;color:#633806;border-radius:8px;padding:9px 12px;font-size:13px;margin-bottom:8px;white-space:pre-wrap"><b>${esc(k)}</b> · ${esc(v)}</div>`).join('')}
  <a href="${link}" style="display:inline-block;margin-top:8px;background:#2C2C2A;color:#F1EFE8;text-decoration:none;border-radius:8px;padding:10px 18px;font-size:14px;font-weight:600">Open Approvals → Advances</a>
  <p style="margin:20px 0 0;font-size:12px;color:#888780">Sent to the Travel Desk.</p>
</div></body></html>`
  return { subject, text, html }
}
