import { useEffect, useState } from 'react'
import { Download, Share, PlusSquare, MonitorDown, Check } from 'lucide-react'
import {
  installRoute, alreadyInstalled, hasNativePrompt, promptInstall,
  subscribeToInstallability, installPromptSnoozed, snoozeInstallPrompt,
  type InstallRoute,
} from '@/lib/pwa'
import { Spinner } from '@/components/ui'

/**
 * Asking people to run this from their home screen rather than a tab.
 *
 * It matters more here than it looks. This is a phone-first app used on
 * a service floor, and an installed copy opens in one tap, keeps its own
 * session, fills the screen without a browser toolbar eating the bottom
 * of the KPI form, and is the only way the notification handler in
 * sw-notifications.js is ever reached from a closed app.
 *
 * What it is not is a wall. There is no way to force an install — Safari
 * has no programmatic install at all and Firefox has none either — so a
 * screen that refused to go away would lock those people out of a system
 * they are required to use. It asks on every sign-in until it is done,
 * which is as much pressure as can be applied honestly, and it always
 * leaves the door open.
 */
export default function InstallPrompt() {
  const [, bump] = useState(0)
  const [busy, setBusy] = useState(false)
  const [snoozed, setSnoozed] = useState(installPromptSnoozed)

  // beforeinstallprompt can land after this has already rendered, which
  // is what turns a page of instructions into a single button.
  useEffect(() => subscribeToInstallability(() => bump(n => n + 1)), [])

  const route: InstallRoute = installRoute({
    standalone: alreadyInstalled(),
    hasPrompt: hasNativePrompt(),
    ua: navigator.userAgent,
    touchPoints: navigator.maxTouchPoints,
  })

  // Nothing to say to somebody already installed, and nothing worth
  // saying to a browser that cannot do it at all.
  if (route === 'installed' || route === 'unsupported' || snoozed) return null

  const install = async () => {
    setBusy(true)
    const outcome = await promptInstall()
    setBusy(false)
    // Declining is an answer. Pushing the same dialog again in the same
    // session is how a prompt becomes something people learn to swat.
    if (outcome === 'dismissed') dismiss()
  }

  const dismiss = () => { snoozeInstallPrompt(); setSnoozed(true) }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/60 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-title"
    >
      <div className="animate-pop-in max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-100">
            {route === 'desktop-manual'
              ? <MonitorDown className="h-5 w-5 text-violet-700" />
              : <Download className="h-5 w-5 text-violet-700" />}
          </span>
          <div className="min-w-0">
            <h2 id="install-title" className="text-lg font-semibold text-ink-900">
              {route === 'ios'
                ? 'Add Cyrix KPI to your Home Screen'
                : 'Install Cyrix KPI'}
            </h2>
            <p className="mt-1 text-sm text-ink-600">
              {route === 'desktop-manual'
                ? 'Runs in its own window, without a browser tab to lose.'
                : 'Opens straight from your home screen, fills the whole screen, '
                  + 'and keeps you signed in.'}
            </p>
          </div>
        </div>

        {route === 'prompt' && (
          <button
            onClick={install}
            disabled={busy}
            className="btn-primary mt-5 w-full justify-center"
          >
            {busy ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}
            Install now
          </button>
        )}

        {/* Safari gives no button to any website, so the best that can be
            done is show exactly where its own one lives. The icons are
            the ones on screen, in the order they are tapped. */}
        {route === 'ios' && (
          <ol className="mt-5 space-y-3">
            <Step n={1} icon={Share}>
              Tap the <strong>Share</strong> button at the bottom of Safari
            </Step>
            <Step n={2} icon={PlusSquare}>
              Scroll down and choose <strong>Add to Home Screen</strong>
            </Step>
            <Step n={3} icon={Check}>
              Tap <strong>Add</strong>. Open it from your home screen from now on
            </Step>
          </ol>
        )}

        {route === 'desktop-manual' && (
          <p className="mt-5 rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm text-ink-700">
            Click the install icon at the right-hand end of the address bar —
            a small screen with a downward arrow — then choose{' '}
            <strong>Install</strong>.
          </p>
        )}

        <button
          onClick={dismiss}
          className="mt-4 w-full py-2 text-sm font-medium text-ink-500 hover:text-ink-800"
        >
          {route === 'prompt' ? 'Not now' : 'Continue in the browser'}
        </button>

        <p className="mt-1 text-center text-xs text-ink-400">
          You will be asked again next time you sign in.
        </p>
      </div>
    </div>
  )
}

function Step({
  n, icon: Icon, children,
}: {
  n: number
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <li className="flex items-center gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-900 text-xs font-semibold text-white">
        {n}
      </span>
      <Icon className="h-4 w-4 shrink-0 text-violet-600" />
      <span className="min-w-0 text-sm text-ink-700">{children}</span>
    </li>
  )
}
