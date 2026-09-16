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

/**
 * Asks the server to send the day's round-up of what is still waiting.
 *
 * The reminder has to come from somewhere, and there is still no pg_cron
 * on this project — so it comes from whoever opens the app. Every
 * signed-in browser asks once a day; the function sends one round-up per
 * desk per day and tells everybody else it has already gone, because the
 * ledger's unique key is the schedule.
 *
 * Which means a reminder arrives on a day the company is working, and
 * does not arrive on a Sunday when nobody opens it — which is the right
 * way round for a note that exists to be acted on.
 *
 * Fire and forget, like everything else here: it is nobody's business
 * but the desk's, and no screen waits on it.
 */
export function nudgeAdmins(): void {
  // In Indian time, the same day the round-up is claimed against, so a
  // browser open across midnight UTC does not ask twice.
  const day = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10)
  const KEY = 'cyrix.kpi.nudge'
  try {
    if (localStorage.getItem(KEY) === day) return
  } catch {
    // Private window, or storage blocked. Asking again is harmless — the
    // ledger on the server, not this line, is what stops a second email.
  }

  void supabase.functions.invoke('notify-hr', { body: { sweep: true } })
    .then(({ data }) => {
      /*
        Marked as done for today only if the server actually looked.

        It sends nothing outside working hours, and a browser opened at
        eight in the morning must not spend the day's one ask on a reply
        that means "not yet" — the next mount tries again.
      */
      const looked = Array.isArray((data as { results?: unknown[] } | null)?.results)
      if (!looked) return
      try { localStorage.setItem(KEY, day) } catch { /* nothing to remember it with */ }
    })
    .catch(() => {})
}
