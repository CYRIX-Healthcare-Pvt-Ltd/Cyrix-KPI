import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendMail } from '../_shared/mail.ts'

/**
 * My Task's one mail: to the person, when a task their manager assigned reaches them (mt_0010; the user, 24 Oct:
 * "only when assigning can we give mail notification?"). A task for a later day reaches them at 9 AM that day, so
 * its mail goes then. Nothing else in My Task mails anybody — status changes are notifications in the app.
 *
 * pg_cron calls this every five minutes (KPI 0222) with the push key. Each call claims up to 40 released tasks not
 * mailed yet — claimed first, so a task is mailed once even if two calls meet — and sends them two seconds apart:
 * Microsoft 365 takes about 30 messages a minute from one mailbox, so a task for a hundred people goes out over two
 * or three calls. A send that fails is written on the task (mail_error), not tried again.
 *
 * Deploy:  supabase functions deploy task-mail --no-verify-jwt
 * Secrets: PUSH_REMINDER_KEY (as push), and the mail ones in _shared/mail.ts.
 */

const APP = Deno.env.get('APP_BASE_URL') ?? 'https://app.cyrix.in'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const CRIT: Record<string, [string, string, string]> = {
  critical: ['Critical', '#FCEBEB', '#791F1F'],
  moderate: ['Moderate', '#FAEEDA', '#633806'],
  non_critical: ['Non-critical', '#EAF3DE', '#27500A'],
}
const longDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

type Row = {
  kind: 'assigned' | 'reminder'; id: string; email: string | null; first_name: string; title: string; details: string | null
  due_on: string; criticality: string; remarks: string | null; by_name: string | null; by_ecode: string | null
  progress: number; reminder_no: number | null; note: string | null
}
const STAGE: Record<number, string> = { 0: 'Not started', 25: 'Started · 25%', 50: 'In progress · 50%', 75: 'Almost done · 75%' }
/** Whole days past the due date, in India. */
function overdueDays(due: string) {
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.max(0, Math.round((t - Date.parse(`${due}T00:00:00Z`)) / 86_400_000))
}

/**
 * The two mails (the user, 24 Oct): a task assigned — what it is, when it is due, how critical, by whom, the remarks;
 * and a reminder — which reminder it is, the manager's note, and where the task stands: its status and how late it is.
 */
function words(r: Row) {
  const by = (r.by_name ?? 'Your manager').split(' ')[0]
  const [crit, bg, ink] = CRIT[r.criticality] ?? CRIT.moderate
  const late = overdueDays(r.due_on)
  const reminder = r.kind === 'reminder'
  const subject = reminder
    ? `Reminder ${r.reminder_no ?? 1} from ${by} · ${r.title} · ${late > 0 ? `${late} ${late === 1 ? 'day' : 'days'} overdue` : `due ${shortDay(r.due_on)}`}`
    : `New task from ${by} · ${r.title} · due ${shortDay(r.due_on)}`
  const lead = reminder ? `${by} has sent you a reminder about this task.` : `${by} has assigned you a task.`
  const link = `${APP}/tasks/my-task`
  const lines: Array<[string, string, string?]> = reminder
    ? [['Due date', `<b>${longDay(r.due_on)}</b>`, longDay(r.due_on)],
       ...(late > 0 ? [['Overdue', `<b style="color:#A32D2D">${late} ${late === 1 ? 'day' : 'days'}</b>`, `${late} ${late === 1 ? 'day' : 'days'}`] as [string, string, string]] : []),
       ['Status', STAGE[r.progress] ?? 'Not started'],
       ['How critical', `<span style="background:${bg};color:${ink};border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600">${crit}</span>`, crit]]
    : [['Due date', `<b>${longDay(r.due_on)}</b>`, longDay(r.due_on)],
       ['How critical', `<span style="background:${bg};color:${ink};border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600">${crit}</span>`, crit],
       ['Assigned by', esc(`${r.by_name ?? by}${r.by_ecode ? ' · ' + r.by_ecode : ''}`), `${r.by_name ?? by}${r.by_ecode ? ' · ' + r.by_ecode : ''}`]]
  const text = [
    `Hello ${r.first_name},`, '', reminder ? `${lead} (Reminder ${r.reminder_no ?? 1})` : lead, '',
    ...(reminder && r.note ? [`${by}: ${r.note}`, ''] : []),
    r.title, r.details ?? '', '',
    ...lines.map(([k, v, plain]) => `${k}: ${plain ?? v}`),
    !reminder && r.remarks ? `Remarks: ${r.remarks}` : '', '', `Open My Task: ${link}`,
  ].filter((l, i, arr) => l !== '' || arr[i - 1] !== '').join('\n')
  const row = (k: string, v: string) => `<tr><td style="color:#888780;padding:3px 0;width:110px;font-size:13px">${k}</td><td style="padding:3px 0;font-size:13px">${v}</td></tr>`
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#F1EFE8;font-family:Segoe UI,Arial,sans-serif;color:#2C2C2A">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #D3D1C7;border-radius:12px;padding:24px">
  <div style="font-size:20px;font-weight:600;letter-spacing:1px;margin-bottom:18px">CYRI<span style="color:#E30613">X</span> <span style="font-size:12px;font-weight:400;color:#888780;letter-spacing:0">My Task</span></div>
  <p style="margin:0 0 6px;font-size:15px">Hello ${esc(r.first_name)},</p>
  <p style="margin:0 0 16px;font-size:15px;color:#5F5E5A">${esc(lead)}${reminder ? ` <span style="background:#EEEDFE;color:#3C3489;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600">Reminder ${r.reminder_no ?? 1}</span>` : ''}</p>
  ${reminder && r.note ? `<div style="background:#EEEDFE;color:#26215C;border-radius:8px;padding:9px 12px;font-size:14px;margin-bottom:12px;white-space:pre-wrap"><b>${esc(by)}</b> · ${esc(r.note)}</div>` : ''}
  <div style="border:1px solid #D3D1C7;border-radius:10px;padding:14px 16px;margin-bottom:18px">
    <p style="margin:0 0 4px;font-size:16px;font-weight:600">${esc(r.title)}</p>
    ${r.details ? `<p style="margin:0 0 12px;font-size:14px;color:#5F5E5A;white-space:pre-wrap">${esc(r.details)}</p>` : ''}
    <table style="width:100%;border-collapse:collapse">${lines.map(([k, v]) => row(k, v)).join('')}</table>
    ${!reminder && r.remarks ? `<div style="margin-top:12px;background:#E1F5EE;color:#085041;border-radius:8px;padding:9px 12px;font-size:13px;white-space:pre-wrap"><b>Remarks</b> · ${esc(r.remarks)}</div>` : ''}
  </div>
  <a href="${link}" style="display:inline-block;background:#2C2C2A;color:#F1EFE8;text-decoration:none;border-radius:8px;padding:10px 18px;font-size:14px;font-weight:600">Open My Task</a>
</div></body></html>`
  return { subject, text, html }
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (req.headers.get('x-push-key') !== Deno.env.get('PUSH_REMINDER_KEY')) return json({ error: 'Not allowed' }, 403)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  const { data, error } = await db.rpc('task_mail_claim', { p_limit: 40 })
  if (error) return json({ error: error.message }, 500)
  const rows = (data ?? []) as Row[]
  let sent = 0, failed = 0, noAddress = 0
  for (const [i, r] of rows.entries()) {
    if (!r.email) { noAddress++; await db.rpc('task_mail_failed', { p_id: r.id, p_error: 'No work email on the employee record' }); continue }
    try {
      await sendMail(db as never, { to: [r.email], ...words(r) })
      sent++
    } catch (e) {
      failed++
      await db.rpc('task_mail_failed', { p_id: r.id, p_error: (e as Error).message })
    }
    // About 30 a minute from one mailbox.
    if (i < rows.length - 1) await new Promise(res => setTimeout(res, 2000))
  }
  return json({ claimed: rows.length, sent, failed, noAddress })
})
