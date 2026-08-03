import { playPing } from './ping'

/**
 * When to raise an alert, and what an alert consists of.
 *
 * The sound itself lives in ping.ts; this file decides whether anything
 * should be heard at all. Both fire only while the app is open — this is
 * not web push. Nothing arrives when the tab is closed, and nothing here
 * asks the browser for permission until somebody switches it on.
 */

const PREF_KEY = 'cyrix.alerts'
const LAST_KEY = 'cyrix.alerts.last'

/**
 * What is worth making a sound about, given what was here last time.
 *
 * Pure, and separate from the component, because the rule has three
 * edges that are each easy to get wrong and impossible to see in a
 * screenshot: no baseline means no alert, work being cleared is not an
 * event, and only the things asking something of you qualify.
 *
 * Measured on the count rather than on the unread flag. Unread is
 * cleared by opening the panel, so a second person submitting afterwards
 * would never raise it again — but two is more than one, and that is the
 * thing that actually happened.
 */
export function newlyArrived<T extends { kind: string; n: number }>(
  before: Map<string, number> | null,
  now: readonly T[],
  isActionable: (kind: string) => boolean,
): T[] {
  // The first load has no baseline. Without this every refresh pings for
  // work that has been sitting there since Tuesday.
  if (!before) return []
  return now.filter(r => isActionable(r.kind) && r.n > (before.get(r.kind) ?? 0))
}

/** On unless it has been turned off. The switch lives in the bell panel. */
export const alertsEnabled = () =>
  typeof localStorage !== 'undefined' && localStorage.getItem(PREF_KEY) !== 'off'

export const setAlertsEnabled = (on: boolean) =>
  localStorage.setItem(PREF_KEY, on ? 'on' : 'off')

/**
 * Two tabs open means two pings for one event, and it is jarring in a
 * way that reads as a bug rather than as enthusiasm. Whichever tab gets
 * there first claims the alert for a few seconds; the others stay quiet.
 *
 * localStorage rather than a BroadcastChannel because the write is
 * already synchronous and visible to every tab on the origin, and this
 * needs no listener on the other side.
 */
function claimAlert(kind: string): boolean {
  try {
    const raw = localStorage.getItem(LAST_KEY)
    if (raw) {
      const last = JSON.parse(raw) as { at: number; kind: string }
      if (last.kind === kind && Date.now() - last.at < 5_000) return false
    }
    localStorage.setItem(LAST_KEY, JSON.stringify({ at: Date.now(), kind }))
  } catch {
    // Private mode, quota, whatever. A duplicate ping beats no ping.
  }
  return true
}

export { playPing }

// ---------------------------------------------------------------------
// OS notifications
// ---------------------------------------------------------------------

export const canNotify = () => typeof Notification !== 'undefined'

export const notifyPermission = (): NotificationPermission =>
  canNotify() ? Notification.permission : 'denied'

/** Only ever called from a click — never on load. */
export async function askToNotify(): Promise<NotificationPermission> {
  if (!canNotify()) return 'denied'
  if (Notification.permission !== 'default') return Notification.permission
  try {
    return await Notification.requestPermission()
  } catch {
    return 'denied'
  }
}

export async function showNotification(
  title: string,
  body: string,
  url: string,
): Promise<void> {
  if (!canNotify() || Notification.permission !== 'granted') return

  const options: NotificationOptions = {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // One notification at a time. Three arriving at once should replace
    // each other rather than stack into a wall the user has to dismiss.
    tag: 'cyrix-kpi',
    data: { url },
  }

  // Chrome on Android refuses `new Notification()` outright and requires
  // the service worker to show it. Desktop accepts either, so the worker
  // is tried first and the constructor is the fallback.
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) {
      await reg.showNotification(title, options)
      return
    }
  } catch {
    // Fall through to the page-level constructor.
  }

  try {
    const n = new Notification(title, options)
    n.onclick = () => {
      window.focus()
      n.close()
      window.location.assign(url)
    }
  } catch {
    // Some browsers throw rather than return; a missing popup is not
    // worth breaking the render over.
  }
}

/**
 * Everything that happens when something new lands: claim it against the
 * other tabs, ping, and raise an OS notification if the app is not the
 * thing being looked at.
 */
export async function raiseAlert(args: {
  kind: string
  title: string
  body: string
  url: string
}): Promise<void> {
  if (!alertsEnabled()) return
  if (!claimAlert(args.kind)) return

  await playPing()

  // Only when the app is in the background. Looking straight at the bell
  // and being told about it by the operating system is one notification
  // too many.
  if (document.hidden) {
    await showNotification(args.title, args.body, args.url)
  }
}
