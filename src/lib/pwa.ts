/**
 * Getting the app onto people's home screens.
 *
 * There is no such thing as forcing an install. The browser owns that
 * decision and every platform answers it differently, so the honest
 * shape of this is: work out which of four situations somebody is in,
 * and ask in the only way that situation allows.
 *
 *   prompt          Chrome/Edge has offered us its install dialog. One
 *                   button, one tap, done.
 *   ios             Safari never offers one. The only route is Share →
 *                   Add to Home Screen, by hand, so all we can do is
 *                   show where it is.
 *   desktop-manual  Installable, but the browser is keeping its own
 *                   install button in the address bar rather than
 *                   handing us one.
 *   unsupported     Firefox and anything locked down. Nagging somebody
 *                   about a button that does not exist on their machine
 *                   is worse than not asking, so we do not ask.
 *
 * The two events matter more than they look. beforeinstallprompt fires
 * once, early, and is the only handle on the native dialog — miss it and
 * the button cannot exist. So it is captured in main.tsx before React
 * mounts, not in a component that has not rendered yet.
 */

/** Chrome's install event. Not in lib.dom, so declared here. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type InstallRoute =
  | 'installed'
  | 'prompt'
  | 'ios'
  | 'desktop-manual'
  | 'unsupported'

/**
 * Which of the four, from three facts.
 *
 * Pure and separate from the component because the branches are exactly
 * where this goes wrong, and every one of them needs a different phone
 * to see for real.
 */
export function installRoute(opts: {
  standalone: boolean
  hasPrompt: boolean
  ua: string
  /** iPadOS 13+ claims to be a Mac. Touch points are what give it away. */
  touchPoints?: number
}): InstallRoute {
  if (opts.standalone) return 'installed'
  if (opts.hasPrompt) return 'prompt'

  const ua = opts.ua
  const iPhone = /iPad|iPhone|iPod/.test(ua)
  const iPadPretendingToBeAMac = /Macintosh/.test(ua) && (opts.touchPoints ?? 0) > 1
  if (iPhone || iPadPretendingToBeAMac) {
    // Only Safari can add to the home screen. Chrome and Firefox on iOS
    // are Safari underneath but do not offer it, so pointing at a Share
    // menu that has no such entry would just be wrong.
    const realSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)
    return realSafari ? 'ios' : 'unsupported'
  }

  const chromium = /Chrome|Chromium|Edg\//.test(ua) && !/OPR\//.test(ua)

  // On a phone, no captured event means one of two things: it is already
  // installed — Chrome stops offering once it is — or Chrome has decided
  // not to offer yet. Neither is worth a dialog, and there is no address
  // bar icon to point at, so the honest answer on mobile is silence.
  const mobile = /Android|Mobile/.test(ua)
  if (mobile) return 'unsupported'

  // Chromium on a desktop keeps its own install control in the address
  // bar. It is installable; we simply have no button to offer.
  return chromium ? 'desktop-manual' : 'unsupported'
}

/**
 * Is the app already running from the home screen or the dock?
 *
 * Note what this actually answers: how THIS window was opened, not
 * whether the app is on the device. Somebody who has installed it and
 * then follows a WhatsApp link lands in an ordinary tab, where every
 * check below is false — see askTheBrowserWhatIsInstalled().
 */
export function isInstalled(): boolean {
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: window-controls-overlay)').matches ||
      // Safari's own, predating the media query and still the only one
      // that answers on an iPhone.
      (navigator as { standalone?: boolean }).standalone === true
    )
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------
// The captured event, and who wants to know about it.
// ---------------------------------------------------------------------

let deferred: BeforeInstallPromptEvent | null = null
let installed = false
const listeners = new Set<() => void>()

const announce = () => listeners.forEach(fn => fn())

/**
 * "I already installed it — why is it still asking?"
 *
 * Because display-mode only describes the window you are in. Open the
 * app from the home screen and it is standalone; follow a link to the
 * same address and you are in a tab, where nothing above can tell that
 * the icon is sitting on the next screen along.
 *
 * getInstalledRelatedApps is the one API that can, and it needs the
 * manifest to name itself under related_applications (see
 * vite.config.ts). Chromium only, HTTPS only, and it may simply refuse —
 * so every failure means "carry on and ask", never a thrown error.
 */
async function askTheBrowserWhatIsInstalled(): Promise<void> {
  const nav = navigator as {
    getInstalledRelatedApps?: () => Promise<Array<{ platform?: string }>>
  }
  if (typeof nav.getInstalledRelatedApps !== 'function') return
  try {
    const apps = await nav.getInstalledRelatedApps()
    if (apps.some(a => a.platform === 'webapp')) {
      installed = true
      announce()
    }
  } catch { /* not supported here; asking again is the safe failure */ }
}

/** Call once, before React mounts. The event will not wait. */
export function watchInstallability(): void {
  installed = isInstalled()
  if (!installed) void askTheBrowserWhatIsInstalled()

  window.addEventListener('beforeinstallprompt', e => {
    // Without this Chrome shows its own mini-infobar and never gives us
    // the event to use later.
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    announce()
  })

  window.addEventListener('appinstalled', () => {
    installed = true
    deferred = null
    announce()
  })
}

export function subscribeToInstallability(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export const hasNativePrompt = () => deferred !== null
export const alreadyInstalled = () => installed || isInstalled()

/**
 * Show Chrome's dialog and wait for the answer.
 *
 * The captured event is single-use: once prompted it cannot be prompted
 * again, so it is dropped either way. Chrome hands us a fresh one if the
 * person declines and the page is reloaded.
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = deferred
  if (!e) return 'unavailable'
  deferred = null
  try {
    await e.prompt()
    const { outcome } = await e.userChoice
    if (outcome === 'accepted') installed = true
    announce()
    return outcome
  } catch {
    announce()
    return 'unavailable'
  }
}

// ---------------------------------------------------------------------
// "Not now"
// ---------------------------------------------------------------------

/**
 * Deliberately sessionStorage rather than localStorage.
 *
 * A permanent dismissal is how an install prompt quietly stops existing:
 * one tap on the wrong day and the person never sees it again. This
 * lasts until the tab closes, so it does not trap anybody inside a
 * screen they cannot leave, and it is back at the next sign-in.
 */
const SNOOZE_KEY = 'cyrix.installPrompt.snoozed'

export const installPromptSnoozed = (): boolean => {
  try { return sessionStorage.getItem(SNOOZE_KEY) === '1' } catch { return false }
}

export const snoozeInstallPrompt = (): void => {
  try { sessionStorage.setItem(SNOOZE_KEY, '1') } catch { /* private mode */ }
}
