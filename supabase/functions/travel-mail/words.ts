/**
 * The mail for an expense advance the Travel Desk has approved (Travel te_0067; the user, 24 Oct: "once the advance
 * is approved by travel desk, a mail should go to requested emp, his reporting manager, travel desk, regarding
 * advance amount given to this emp"). One mail to the person, copied to the manager and the Travel Desk: the
 * advance as HR's request form has it (Advance Request format.xlsx), who approved it and when, and how it is
 * settled under HR's rules. Plain TypeScript, so the preview renders exactly what is sent.
 */

export type AdvanceRow = {
  id: string; number: string; amount: number; purpose: string; reason: string; cost_centre: string | null
  base_name: string | null; base_state: string; dest_name: string; month: string; created_at: string
  name: string; ecode: string; designation: string | null; email: string | null
  manager_name: string | null; manager_ecode: string | null; manager_email: string | null; manager_at: string | null; manager_note: string | null
  desk_name: string | null; desk_at: string | null; desk_note: string | null
  desk_emails: string[] | null
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const rupees = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN')
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
const monthYear = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen',
  'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
function below1000(n: number): string {
  const h = Math.floor(n / 100), r = n % 100
  const tail = r < 20 ? ONES[r] : `${TENS[Math.floor(r / 10)]}${r % 10 ? ' ' + ONES[r % 10] : ''}`
  return [h ? `${ONES[h]} Hundred` : '', tail].filter(Boolean).join(' ')
}
/** An amount in words the Indian way — lakh and crore — as a voucher says it: "Rupees Five Thousand Only". */
export function inWords(amount: number): string {
  let n = Math.round(amount)
  if (n === 0) return 'Rupees Zero Only'
  const parts: string[] = []
  for (const [size, name] of [[10_000_000, 'Crore'], [100_000, 'Lakh'], [1000, 'Thousand']] as const) {
    const q = Math.floor(n / size)
    if (q) { parts.push(`${below1000(q)} ${name}`); n %= size }
  }
  if (n) parts.push(below1000(n))
  return `Rupees ${parts.join(' ')} Only`
}

export function words(r: AdvanceRow, app = 'https://app.cyrix.in') {
  const first = r.name.split(' ')[0]
  const amount = rupees(r.amount)
  const from = monthYear(r.month)
  const link = `${app}/travel/advances`
  const subject = `Expense advance ${r.number} approved · ${amount} · ${r.name} (${r.ecode})`
  const lead = `Your expense advance ${r.number} of ${amount} has been approved by the Travel Desk.`
  const base = [r.base_name, r.base_state].filter(Boolean).join(', ')
  // HR's request form, in its order, then who approved it.
  const lines: Array<[string, string]> = [
    ['Advance no.', r.number],
    ['Request date', day(r.created_at)],
    ['Employee code', r.ecode],
    ['Employee name', `${r.name}${r.designation ? ' · ' + r.designation : ''}`],
    ['Advance amount', `${amount} (${inWords(r.amount)})`],
    ['Purpose of advance (work details)', r.purpose],
    ['Reason for advance', r.reason],
    ['Base location', base],
    ['Travel destination (To)', r.dest_name],
    ['Project or cost centre', r.cost_centre ?? '—'],
    ['Reporting manager', `${r.manager_name ?? '—'}${r.manager_at ? ' · approved ' + day(r.manager_at) : ''}`],
    ['Travel Desk', `${r.desk_name ?? '—'}${r.desk_at ? ' · approved ' + day(r.desk_at) : ''}`],
  ]
  const notes: Array<[string, string]> = [
    ...(r.manager_note ? [[`${r.manager_name ?? 'Manager'} (reporting manager)`, r.manager_note] as [string, string]] : []),
    ...(r.desk_note ? [[`${r.desk_name ?? 'Travel Desk'} (Travel Desk)`, r.desk_note] as [string, string]] : []),
  ]
  const settle = [
    `This advance is deducted from your expense claims from ${from}. Whatever a month's claims do not use is deducted from the following month's, until it is fully settled.`,
    'No further advance can be requested until it is settled.',
  ]
  const copies = `Sent to ${r.name}, with copies to ${r.manager_name ? `${r.manager_name} (reporting manager) and ` : ''}the Travel Desk.`

  const text = [
    `Dear ${first},`, '', lead, '',
    ...lines.map(([k, v]) => `${k}: ${v}`), '',
    ...notes.map(([k, v]) => `${k}: ${v}`), ...(notes.length ? [''] : []),
    'Settlement', ...settle, '',
    `Open My advance: ${link}`, '', copies,
  ].join('\n')

  const row = (k: string, v: string, strong = false) =>
    `<tr><td style="color:#888780;padding:5px 12px 5px 0;width:44%;font-size:13px;vertical-align:top">${esc(k)}</td><td style="padding:5px 0;font-size:13px;vertical-align:top;${strong ? 'font-weight:600' : ''}">${esc(v)}</td></tr>`
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#F1EFE8;font-family:Segoe UI,Arial,sans-serif;color:#2C2C2A">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #D3D1C7;border-radius:12px;padding:24px">
  <div style="font-size:20px;font-weight:600;letter-spacing:1px;margin-bottom:18px">CYRI<span style="color:#E30613">X</span> <span style="font-size:12px;font-weight:400;color:#888780;letter-spacing:0">Travel Expense</span></div>
  <p style="margin:0 0 6px;font-size:15px">Dear ${esc(first)},</p>
  <p style="margin:0 0 18px;font-size:15px;color:#5F5E5A">Your expense advance <b style="color:#2C2C2A">${esc(r.number)}</b> of <b style="color:#2C2C2A">${esc(amount)}</b> has been approved by the Travel Desk.</p>
  <div style="background:#EEEDFE;border-radius:10px;padding:14px 16px;margin-bottom:18px">
    <span style="float:right;background:#EAF3DE;color:#27500A;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:600">Approved</span>
    <p style="margin:0;font-size:12px;color:#534AB7;font-weight:600;letter-spacing:.5px">EXPENSE ADVANCE ${esc(r.number)}</p>
    <p style="margin:4px 0 2px;font-size:28px;font-weight:700;color:#26215C">${esc(amount)}</p>
    <p style="margin:0;font-size:13px;color:#3C3489">${esc(inWords(r.amount))}</p>
  </div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:16px">${lines.map(([k, v], i) => row(k, v, i === 0 || i === 4)).join('')}</table>
  ${notes.map(([k, v]) => `<div style="background:#F1EFE8;border-radius:8px;padding:9px 12px;font-size:13px;margin-bottom:8px;white-space:pre-wrap"><b>${esc(k)}</b> · ${esc(v)}</div>`).join('')}
  <div style="background:#E1F5EE;color:#085041;border-radius:8px;padding:11px 14px;font-size:13px;margin:8px 0 20px">
    <b>Settlement</b><br>${settle.map(esc).join('<br>')}
  </div>
  <a href="${link}" style="display:inline-block;background:#2C2C2A;color:#F1EFE8;text-decoration:none;border-radius:8px;padding:10px 18px;font-size:14px;font-weight:600">Open My advance</a>
  <p style="margin:20px 0 0;font-size:12px;color:#888780">${esc(copies)}</p>
</div></body></html>`
  return { subject, text, html }
}

/** Who it goes to: the person; copies to the manager and the Travel Desk — each once, and only addresses on record. */
export function recipients(r: AdvanceRow) {
  const clean = (s: string | null | undefined) => (s ?? '').trim().toLowerCase() || null
  const to = [clean(r.email)].filter((x): x is string => !!x)
  const cc = [...new Set([clean(r.manager_email), ...(r.desk_emails ?? []).map(clean)].filter((x): x is string => !!x && !to.includes(x)))]
  return to.length ? { to, cc } : { to: cc.slice(0, 1), cc: cc.slice(1) }
}
