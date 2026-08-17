import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import {
  Bell, CalendarCheck, CheckCircle2, CheckSquare, ClipboardList,
  MessageSquare, Trash2, Undo2, UserMinus, Volume2, VolumeX, X,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  useNotifications, useMarkNotificationsRead, useDismissNotification,
} from '@/lib/queries'
import {
  alertsEnabled, setAlertsEnabled, askToNotify, notifyPermission, canNotify,
  playPing, raiseAlert, newlyArrived,
} from '@/lib/alerts'
import type { NotificationKind, NotificationRow } from '@/types/db'

/**
 * "What is waiting on me?", in the one place every screen has.
 *
 * The nav badges already carry these numbers, but only beside a tab you
 * have to know to look at — which is exactly what people were missing.
 *
 * Only ever raised by somebody else's move. E1427 submitting a KPI
 * notifies E1337; E1337 approving it notifies E1427; E1427 not having
 * set one up notifies nobody, because that is their own state and the
 * dashboard already leads with it.
 *
 * Nothing here is dismissible on purpose. These are derived from live
 * state rather than stored as events, so the only way to clear one is to
 * do it; "read" affects the counter and nothing else.
 */

interface Entry {
  icon: React.ComponentType<{ className?: string }>
  /** Lower sorts first. Work that unblocks other people leads. */
  priority: number
  /** Asking you for something, rather than telling you about something. */
  action: boolean
  title: (n: number) => string
  body: string
  href: string
}

/** "1 month" / "3 months" — said often enough here to be worth a helper. */
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`

const CATALOGUE: Record<NotificationKind, Entry> = {
  approvals: {
    icon: CheckSquare, priority: 1, action: true,
    title: n => `${plural(n, 'KPI')} waiting for your approval`,
    body: 'Nobody can start a monthly assessment until their KPI is approved.',
    href: '/approvals',
  },
  scoring: {
    icon: ClipboardList, priority: 2, action: true,
    title: n => `${plural(n, 'month')} waiting for your score`,
    body: 'Your team have sent theirs in. The manager score is yours to enter.',
    href: '/team',
  },
  // Above the record requests: this one is somebody waiting on an answer
  // about their own appraisal, and the month cannot close until it comes.
  score_query: {
    icon: MessageSquare, priority: 3, action: true,
    title: n => `${plural(n, 'query')} about your scoring`,
    body: 'A team member has asked about rows you scored. The month stays open until you reply.',
    href: '/queries',
  },
  records_manager: {
    icon: Trash2, priority: 3, action: true,
    title: n => `${plural(n, 'record request')} for you`,
    body: 'A deletion or a KPI revision needs your decision before it reaches HR.',
    href: '/deletions',
  },
  records_hr: {
    icon: Trash2, priority: 4, action: true,
    title: n => `${plural(n, 'record request')} at HR`,
    body: 'The reporting manager has approved these. They are waiting on you.',
    href: '/deletions',
  },
  leavers: {
    icon: UserMinus, priority: 5, action: true,
    title: n => `${plural(n, 'leaver')} to process`,
    body: 'A manager has flagged someone as having left.',
    href: '/admin/requests',
  },
  kpi_rejected: {
    icon: Undo2, priority: 6, action: true,
    title: () => 'Your manager sent your KPI back',
    body: 'Make the changes they asked for, then submit it again.',
    href: '/my-kpi',
  },
  month_returned: {
    icon: Undo2, priority: 7, action: true,
    title: n => `${plural(n, 'month')} sent back to you`,
    body: 'Your manager has asked for a correction before scoring it.',
    href: '/history',
  },
  // The two below are news rather than work, so they sit at the bottom
  // and the database stops returning them after a month.
  kpi_approved: {
    icon: CheckCircle2, priority: 8, action: false,
    title: () => 'Your KPI has been approved',
    body: 'Monthly assessments are open — start with the months already gone.',
    href: '/history',
  },
  month_scored: {
    icon: CalendarCheck, priority: 9, action: false,
    title: n => `${plural(n, 'month')} scored`,
    body: 'Your manager has finished. The result is on your record.',
    href: '/history',
  },
  score_query_answered: {
    icon: MessageSquare, priority: 10, action: false,
    title: n => `${plural(n, 'query')} answered`,
    body: 'Your manager has replied to what you asked about.',
    href: '/history',
  },
}

export default function Notifications({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  const { employee } = useAuth()
  const { data } = useNotifications(employee?.id, enabled)
  const markRead = useMarkNotificationsRead()
  const dismiss = useDismissNotification()

  // Which rows were new at the moment the panel opened.
  //
  // Opening marks everything read, so without this snapshot the dots
  // would vanish from under the pointer — the badge is what should
  // clear, not the answer to "which of these is new".
  const [wasUnread, setWasUnread] = useState<Set<string>>(new Set())

  const rows = useMemo(
    () => [...(data ?? [])]
      // A kind the app does not know about is a database ahead of a
      // deployment, which is a normal state during a rollout. Skip it
      // rather than render an empty row.
      .filter((r): r is NotificationRow => r.kind in CATALOGUE)
      .sort((a, b) => CATALOGUE[a.kind].priority - CATALOGUE[b.kind].priority),
    [data],
  )
  const unreadCount = rows.filter(r => r.unread).length

  const [alertsOn, setAlertsOn] = useState(() => alertsEnabled())
  const [permission, setPermission] = useState(() => notifyPermission())

  /**
   * Ping when something new lands.
   *
   * Compared against what was here last time rather than against the
   * unread flag: unread is cleared by reading, so a second person
   * submitting after you have opened the panel would not raise it again.
   * A count that went up is the actual event.
   */
  const seen = useRef<Map<string, number> | null>(null)

  useEffect(() => {
    if (!data) return

    const now = new Map(rows.map(r => [r.kind, r.n]))
    const before = seen.current
    seen.current = now

    // Only the things asking something of you. An approval coming back or
    // a month being scored still appears in the tray with a dot, but a
    // sound for news you cannot act on is the kind of thing that gets an
    // app muted for good.
    const top = newlyArrived(before, rows, k => CATALOGUE[k as NotificationKind].action)
      .sort((a, b) => CATALOGUE[a.kind].priority - CATALOGUE[b.kind].priority)[0]
    if (!top) return

    const e = CATALOGUE[top.kind]
    void raiseAlert({
      kind: top.kind,
      title: e.title(top.n),
      body: e.body,
      url: e.href,
    })
  }, [data, rows])

  useEffect(() => {
    if (!open) return

    const onPointer = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }

    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!enabled) return null

  /**
   * Turning alerts on is the only place permission is ever asked for, and
   * it doubles as the gesture browsers require before they will play
   * audio — so the confirmation ping is both a preview of the sound and
   * the thing that unlocks it for the rest of the session.
   */
  const toggleAlerts = async () => {
    const next = !alertsOn
    setAlertsOn(next)
    setAlertsEnabled(next)
    if (!next) return

    void playPing()
    if (canNotify() && Notification.permission === 'default') {
      setPermission(await askToNotify())
    }
  }

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next) {
      setWasUnread(new Set(rows.filter(r => r.unread).map(r => r.kind)))
      if (unreadCount > 0) markRead.mutate()
    }
  }

  return (
    <div className="relative" ref={wrap}>
      <button
        onClick={toggle}
        className="btn-icon relative"
        aria-label={
          unreadCount > 0 ? `Notifications, ${unreadCount} new` : 'Notifications'
        }
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Notifications"
      >
        {/* Amber like every other "something is waiting on you" in the
            app. The red count on top of it means unread specifically. */}
        <Bell className={clsx('h-4.5 w-4.5', unreadCount > 0 ? 'text-amber-500' : 'text-amber-600')} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-cyrixRed-600 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          // Hung off the button on a desktop, and off the viewport on a
          // phone. The bell sits about 100px in from the right edge on a
          // 375px screen, so anchoring the panel to it puts a third of
          // the panel off the left of the display — capping the width
          // does not help, because the anchor is the problem.
          //
          // The mobile offset is the header's own height plus the same
          // safe-area inset the body uses, so it clears the header on a
          // notched phone as well as a flat one.
          className="animate-pop-in fixed inset-x-3 top-[calc(env(safe-area-inset-top)_+_3.75rem)] z-40 origin-top overflow-hidden rounded-xl border border-ink-200 bg-white shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[22rem] sm:origin-top-right"
        >
          <div className="flex items-center gap-2 border-b border-ink-200 bg-ink-50 px-4 py-2">
            <h2 className="flex-1 text-sm font-semibold text-ink-800">Notifications</h2>
            <span className="text-xs text-ink-400">
              {rows.length === 0 ? 'All clear' : plural(rows.length, 'item')}
            </span>
            {/* In the header rather than a row of its own: it is a setting
                somebody touches twice a year, and it was taking as much
                height as an actual notification. */}
            <button
              onClick={toggleAlerts}
              role="switch"
              aria-checked={alertsOn}
              className="btn-icon -mr-1.5 !p-1.5"
              aria-label={alertsOn ? 'Turn alerts off' : 'Turn alerts on'}
              title={
                !alertsOn
                  ? 'Alerts are off — no sound, no pop-ups'
                  : permission === 'granted'
                  ? 'Alerts on: a ping, and a pop-up when the app is in the background'
                  : permission === 'denied'
                  ? 'Alerts on: ping only — your browser is blocking pop-ups for this site'
                  : 'Alerts on: ping only. Turn off and on again to allow pop-ups'
              }
            >
              {alertsOn
                ? <Volume2 className="h-4 w-4" />
                : <VolumeX className="h-4 w-4 text-ink-300" />}
            </button>
          </div>

          {rows.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <CheckCircle2 className="mx-auto h-6 w-6 text-emerald-600" />
              <p className="mt-2 text-sm font-medium text-ink-700">
                Nothing needs you right now
              </p>
              <p className="mt-0.5 text-xs text-ink-400">
                Anything waiting on you will show up here.
              </p>
            </div>
          ) : (
            <ul className="max-h-[24rem] divide-y divide-ink-100 overflow-y-auto">
              {rows.map(r => {
                const e = CATALOGUE[r.kind]
                const isNew = wasUnread.has(r.kind)
                return (
                  <li key={r.kind} className="group relative">
                    <Link
                      to={e.href}
                      onClick={() => setOpen(false)}
                      className="flex gap-3 px-4 py-3 transition-colors hover:bg-ink-50"
                    >
                      <e.icon
                        className={clsx(
                          'mt-0.5 h-4 w-4 shrink-0',
                          e.action ? 'text-cyrixRed-600' : 'text-ink-400',
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink-900">
                          {e.title(r.n)}
                        </p>
                        <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
                          {e.body}
                        </p>
                      </div>
                      {/* Room kept for the clear button whether or not it
                          is showing, so the text does not reflow under
                          the pointer on hover. */}
                      <span className="w-4 shrink-0">
                        {isNew && (
                          <span
                            className="mt-1.5 block h-2 w-2 rounded-full bg-cyrixRed-600"
                            aria-label="New"
                          />
                        )}
                      </span>
                    </Link>

                    {/*
                      Only on the news. There is no clear button on an
                      approval waiting for you, because the way to clear
                      that is to approve it — and a tray you can empty
                      without doing anything is a tray nobody trusts.

                      Always present on touch, revealed on hover on a
                      pointer: there is no hover on a phone, so a
                      hover-only control is one that does not exist there.
                    */}
                    {!e.action && (
                      <button
                        onClick={() => dismiss.mutate(r.kind)}
                        disabled={dismiss.isPending}
                        aria-label={`Clear "${e.title(r.n)}"`}
                        title="Clear"
                        className="btn-icon absolute right-2 top-2 !p-1.5 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

        </div>
      )}
    </div>
  )
}
