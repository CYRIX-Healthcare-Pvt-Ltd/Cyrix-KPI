import { supabase } from './supabase'

/**
 * Asks the server to tell HR that something is waiting for them.
 *
 * Fire and forget, and that is the design rather than a shortcut. The
 * person raising a leaver or a support question has done their part the
 * moment the row exists; whether a mail provider is having a good
 * morning is not their problem and must never turn their action into a
 * failure. So nothing here is awaited, nothing is reported, and every
 * outcome is the same as far as the caller is concerned.
 *
 * It runs from the browser because it has to: there is no pg_net and no
 * pg_cron on this project, so the database cannot make an HTTP request
 * and nothing can drain a queue on a timer. The edge function carries
 * the parts that must not be trusted to a browser — who receives it, and
 * a unique claim so a retry or a second tab cannot send twice.
 *
 * See supabase/functions/notify-hr and migration 0106.
 */

export type NotifyKind = 'support' | 'leaver' | 'record' | 'revision'

export function notifyHr(kind: NotifyKind, id: string | null | undefined): void {
  if (!id) return
  void supabase.functions
    .invoke('notify-hr', { body: { kind, id } })
    // Offline, blocked, or the function is not deployed yet. The row is
    // in the queue with its badge either way, which is what the app has
    // always relied on and still does.
    .catch(() => {})
}
