// qt-pdf: a quotation's Word file made into its PDF on our own server, LibreOffice in Gotenberg on Render, so the PDF
// is laid out as the Word file is: fonts and spacing as uploaded (the user, 19 Nov: "the font, the sentence spacing all
// should be same of what uploaded"). Nobody installs anything. Only quotation makers (qt_can_make) may call it.
// Body: the .docx itself (up to 15 MB); the answer is the PDF. Body "wake": the server, asleep when unused, is woken
// as a quotation is opened, so it is ready by Preview.
// Secrets: QT_PDF_URL (the Render service), QT_PDF_USER and QT_PDF_PASS (its basic auth). Deployed with --no-verify-jwt;
// the caller is checked here.
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MAX = 15 * 1024 * 1024

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false }, global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: me } = await db.auth.getUser()
  if (!me?.user) return json({ error: 'Sign in again to make the PDF.' }, 401)
  const { data: can } = await db.rpc('qt_can_make')
  if (can !== true) return json({ error: 'Only a quotation maker can make the PDF.' }, 403)

  const base = (Deno.env.get('QT_PDF_URL') ?? '').replace(/\/+$/, '')
  if (!base) return json({ error: 'The PDF could not be made.' }, 503)
  const user = Deno.env.get('QT_PDF_USER') ?? ''
  const headers: Record<string, string> = user ? { Authorization: `Basic ${btoa(`${user}:${Deno.env.get('QT_PDF_PASS') ?? ''}`)}` } : {}

  const buf = new Uint8Array(await req.arrayBuffer())
  if (buf.length === 4 && new TextDecoder().decode(buf) === 'wake') {
    // A free server takes about a minute to wake; this waits for it, the person does not.
    const ok = await fetch(`${base}/health`, { headers, signal: AbortSignal.timeout(110_000) }).then((r) => r.ok).catch(() => false)
    return json({ ok })
  }
  if (buf.length > MAX) return json({ error: 'The Word file is too big.' }, 400)
  // A .docx is a zip: "PK" first.
  if (buf.length < 100 || buf[0] !== 0x50 || buf[1] !== 0x4b) return json({ error: 'Not a Word file.' }, 400)

  const form = new FormData()
  form.append('files', new Blob([buf], { type: DOCX }), 'quotation.docx')
  let res: Response
  try {
    res = await fetch(`${base}/forms/libreoffice/convert`, { method: 'POST', body: form, headers, signal: AbortSignal.timeout(110_000) })
  } catch {
    return json({ error: 'The PDF server did not answer. Try again in a minute.' }, 504)
  }
  if (!res.ok) return json({ error: 'The PDF could not be made.' }, 502)
  const pdf = new Uint8Array(await res.arrayBuffer())
  if (pdf.length < 500 || new TextDecoder().decode(pdf.slice(0, 4)) !== '%PDF') return json({ error: 'The PDF could not be made.' }, 502)
  return new Response(pdf, { headers: { ...CORS, 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' } })
})
