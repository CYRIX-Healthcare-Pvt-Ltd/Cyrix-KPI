/**
 * Notifications on this device (KPI migration 0154).
 *
 * One registration at "/" (public/push-sw.js) for the whole platform, and
 * one subscription per device, saved against whoever is signed in when
 * they allow it. Signing out takes it off them. The same file is in the portal's
 * src/lib/push.ts (Cyrix Platform) — change one, change the other.
 *
 * iPhone and iPad only deliver to an installed app (iOS 16.4 on), so a
 * browser tab there is told to add Cyrix to the Home Screen first.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type PushState = 'on' | 'ask' | 'blocked' | 'install-first' | 'unsupported'

const standalone = () => {
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      || (navigator as { standalone?: boolean }).standalone === true
  } catch { return false }
}
const apple = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)

export function pushState(): PushState {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (!supported) return apple() && !standalone() ? 'install-first' : 'unsupported'
  if (Notification.permission === 'granted') return 'on'
  if (Notification.permission === 'denied') return 'blocked'
  return 'ask'
}

const b64 = (s: string) => {
  const p = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(p), c => c.charCodeAt(0))
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register('/push-sw.js', { scope: '/' })
  if (reg.active) return reg
  const w = reg.installing ?? reg.waiting
  await new Promise<void>(res => {
    if (!w) return res()
    w.addEventListener('statechange', () => { if (w.state === 'activated') res() })
  })
  return reg
}

/** Subscribed and saved for this person. Quietly does nothing without permission. */
export async function syncPush(db: SupabaseClient): Promise<void> {
  if (pushState() !== 'on') return
  const { data: key } = await db.from('app_settings').select('value').eq('key', 'push_public_key').maybeSingle()
  if (!key?.value) return
  const reg = await registration()
  const sub = await reg.pushManager.getSubscription()
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(String(key.value)) })
  const j = sub.toJSON()
  await db.rpc('save_push_subscription', {
    p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth, p_user_agent: navigator.userAgent,
  })
}

/** The browser's own question, then the subscription. */
export async function enablePush(db: SupabaseClient): Promise<PushState> {
  if (pushState() !== 'ask') return pushState()
  await Notification.requestPermission()
  if (pushState() === 'on') await syncPush(db)
  return pushState()
}

/** Before signing out: this device stops being theirs. */
export async function dropPush(db: SupabaseClient): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) return
    const reg = await navigator.serviceWorker.getRegistration('/')
    const sub = await reg?.pushManager.getSubscription()
    if (!sub) return
    await db.rpc('drop_push_subscription', { p_endpoint: sub.endpoint })
    await sub.unsubscribe()
  } catch { /* signing out must not wait on this */ }
}
