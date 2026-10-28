import { createClient } from 'npm:@supabase/supabase-js@2'

/**
 * Travel Expense's visit photos, removed after payment (Travel te_0083; the user, 28 Oct: "after the claim is paid,
 * after utr, we can remove images so storage wont fill"). A photo goes SW Admin's photo_keep_days after every claim
 * it stands on is paid; one on no claim, six months after it was taken. The picture leaves the te-visits bucket, the
 * row keeps its facts (removed_at).
 *
 * Called by pg_cron every night at 03:00 India time, with the push key. A hundred files a remove; each batch is marked
 * removed only once Storage has let them go, so a failure leaves them for the next night.
 *
 * Deploy:  supabase functions deploy travel-photos --no-verify-jwt
 * Secrets: PUSH_REMINDER_KEY (as push).
 */

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (req.headers.get('x-push-key') !== Deno.env.get('PUSH_REMINDER_KEY')) return json({ error: 'Not allowed' }, 403)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  const { data, error } = await db.rpc('te_photos_due', { p_limit: 500 })
  if (error) return json({ error: error.message }, 500)
  const rows = (data ?? []) as Array<{ id: string; path: string }>
  let removed = 0
  const failed: string[] = []
  for (let i = 0; i < rows.length; i += 100) {
    const part = rows.slice(i, i + 100)
    const { error: gone } = await db.storage.from('te-visits').remove(part.map(r => r.path))
    if (gone) { failed.push(gone.message); continue }
    const { error: marked } = await db.rpc('te_photos_removed', { p_ids: part.map(r => r.id) })
    if (marked) { failed.push(marked.message); continue }
    removed += part.length
  }
  return json({ due: rows.length, removed, failed })
})
