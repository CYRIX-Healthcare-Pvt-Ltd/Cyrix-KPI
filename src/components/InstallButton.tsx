import { useEffect, useState } from 'react'
import { Download, Share, PlusSquare, MonitorDown, Check, X } from 'lucide-react'
import {
  installRoute, alreadyInstalled, hasNativePrompt, promptInstall,
  subscribeToInstallability, type InstallRoute,
} from '@/lib/pwa'
import { Spinner } from '@/components/ui'

/**
 * Installing the app, offered rather than insisted on.
 *
 * This was a dialog on every sign-in until it was installed. That is as
 * much pressure as can honestly be applied — there is no way to force an
 * install, Safari offers websites no API for it at all — but pressure
 * was the wrong idea. People who want it will take it, and a modal in
 * front of somebody who has come to submit a month is a toll on the
 * thing they actually opened the app to do.
 *
 * So it lives on the profile page beside the password, where somebody
 * goes when the question is about their account rather than about a
 * number, and where the manual now says to look for it.
 */
const useRoute = (): InstallRoute => {
  const [, bump] = useState(0)
  useEffect(() => subscribeToInstallability(() => bump(n => n + 1)), [])
  return installRoute({
    standalone: alreadyInstalled(),
    hasPrompt: hasNativePrompt(),
    ua: navigator.userAgent,
    touchPoints: navigator.maxTouchPoints,
  })
}

export default function InstallButton() {
  const route = useRoute()
  const [busy, setBusy] = useState(false)
  const [steps, setSteps] = useState(false)

  // Nothing to offer somebody who already has it, and nothing worth
  // saying to a browser that cannot do it — Firefox has no install at
  // all, and a dead button is worse than no button.
  if (route === 'installed' || route === 'unsupported') return null

  const click = async () => {
    if (route !== 'prompt') { setSteps(true); return }
    setBusy(true)
    await promptInstall()
    setBusy(false)
  }

  return (
    <>
      <button onClick={click} disabled={busy} className="btn-secondary btn-press inline-flex">
        {busy
          ? <Spinner className="h-4 w-4" />
          : route === 'desktop-manual'
            ? <MonitorDown className="h-4 w-4 text-violet-600" />
            : <Download className="h-4 w-4 text-violet-600" />}
        Install the app
      </button>

      {/* Safari gives no button to any website, so the best that can be
          done is show exactly where its own one lives. */}
      {steps && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/60 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="install-steps-title"
        >
          <div className="animate-pop-in max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
            <div className="flex items-start justify-between gap-3">
              <h2 id="install-steps-title" className="text-lg font-semibold text-ink-900">
                {route === 'ios' ? 'Add it to your Home Screen' : 'Install Cyrix KPI'}
              </h2>
              <button
                onClick={() => setSteps(false)}
                aria-label="Close"
                className="btn-icon shrink-0 text-ink-400 hover:text-ink-900"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {route === 'ios' ? (
              <ol className="mt-4 space-y-3">
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
            ) : (
              <p className="mt-4 rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm text-ink-700">
                Click the install icon at the right-hand end of the address bar —
                a small screen with a downward arrow — then choose{' '}
                <strong>Install</strong>.
              </p>
            )}

            <p className="mt-4 text-xs text-ink-500">
              It opens from your home screen, fills the whole screen, and keeps you
              signed in.
            </p>
          </div>
        </div>
      )}
    </>
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
