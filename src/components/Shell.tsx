import { useState } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import clsx from 'clsx'
import {
  LayoutDashboard, ClipboardList, Users, CheckSquare, CalendarCheck,
  LogOut, Menu, X, KeyRound, Building2, BarChart3, UserMinus,
  ShieldAlert, Trash2, Timer, MessageSquare,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  usePendingCounts, useRemovalRequests, useAnnualSummary,
  usePendingRecordRequests, useOpenScoreQueries, currentFy,
} from '@/lib/queries'
import { useBaseScore, useScoreTheme } from '@/contexts/ScoreThemeContext'
import Notifications from './Notifications'
import StartMonthPrompt from './StartMonthPrompt'
import InstallPrompt from './InstallPrompt'
import Avatar from './Avatar'
import { Logo, LogoMark } from './Logo'

/**
 * What each tab's icon is coloured, by what the tab is for.
 *
 * Not decoration — the colours are the ones the rest of the app already
 * uses for these meanings, so a tab is recognisable before the label is
 * read. Green is somewhere work gets completed, amber is somewhere
 * something is waiting on you, red is somewhere things get taken away,
 * and the neutral ones are places you go to look rather than to act.
 *
 * Keyed by route so it is one list rather than a colour repeated beside
 * every icon in four separate arrays. A route with no entry gets the
 * plain icon colour, which is a fine default rather than a bug.
 */
const NAV_TINT: Record<string, string> = {
  '/':                 'text-sky-600',      // overview
  '/my-kpi':           'text-violet-600',   // the year's agreement
  '/history':          'text-emerald-600',  // the monthly job, done
  '/team':             'text-indigo-600',   // people
  '/approvals':        'text-emerald-600',  // approve — go
  '/queries':          'text-amber-600',    // somebody is waiting
  '/deletions':        'text-cyrixRed-600', // records removed
  '/admin':            'text-sky-600',
  '/admin/employees':  'text-indigo-600',   // people
  '/admin/reports':    'text-sky-600',      // looking, not acting
  '/admin/requests':   'text-cyrixRed-600', // leavers
  '/admin/queries':    'text-amber-600',
  '/admin/logins':     'text-cyrixRed-600', // security
  '/admin/timing':     'text-amber-600',    // deadlines
}

interface NavItem {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  end?: boolean
  badge?: number
  /**
   * A queue rather than a place: worth a tab while something is in it,
   * and worth the space back when there is not.
   */
  queue?: boolean
}

export default function Shell() {
  const { employee, isManager, isHrAdmin, isSwAdmin, signOut } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const fy = currentFy()

  const { data: counts } = usePendingCounts(
    isManager ? employee?.id : undefined, fy,
  )
  const { data: removals } = useRemovalRequests('pending')
  const { data: recordRequests } = usePendingRecordRequests(isManager || isHrAdmin)
  const { data: openQueries } = useOpenScoreQueries(isManager && !isHrAdmin)

  // Set here rather than on the dashboard so the tint survives navigation —
  // every screen carries the signed-in person's band, not just the one that
  // happens to display their score. isSuccess distinguishes "nothing scored
  // yet", which is neutral grey, from "not answered yet", which is nothing.
  const { data: annual, isSuccess: annualLoaded } = useAnnualSummary(employee?.id, fy)
  useBaseScore(employee?.id, annual?.avg_total_score, annualLoaded)
  const { scopeStyle } = useScoreTheme()

  // HR administers the system rather than being appraised by it, so they
  // get the admin surfaces instead of a personal KPI.
  // Deletion and revision requests stop at 'pending_manager' first, so
  // the manager needs a route to them or every request appears to vanish.
  // Not SW Admin: the two stages are the reporting manager and HR by
  // design, and a deletion reason names an employee, a month and why
  // their record is disputed. That is appraisal content, and SW Admin
  // administers logins.
  const records: NavItem = {
    to: '/deletions', label: 'Records', icon: Trash2,
    badge: recordRequests ?? 0,
    queue: true,
  }

  // A queue like the others: it appears when somebody has asked
  // something, and takes its slot back when nobody has.
  const queries: NavItem = {
    to: '/queries', label: 'Queries', icon: MessageSquare,
    badge: openQueries ?? 0,
    queue: true,
  }

  const allItems: NavItem[] = isSwAdmin && !isHrAdmin
    ? [
        { to: '/admin/logins', label: 'Logins', icon: ShieldAlert, end: true },
        { to: '/admin/timing', label: 'KPI Timing', icon: Timer },
      ]
    : isHrAdmin
    ? [
        { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
        { to: '/admin/employees', label: 'Employees', icon: Building2 },
        { to: '/admin/reports', label: 'Reports', icon: BarChart3 },
        {
          // Managers flag people who have resigned; HR deactivates them.
          // This was briefly labelled "Joiners", which is the opposite of
          // what it holds.
          to: '/admin/requests', label: 'Leavers', icon: UserMinus,
          badge: removals?.length ?? 0,
        },
        // HR watches every query, and never answers one. Always present
        // rather than badge-gated: it is an oversight surface, and an
        // oversight surface that only appears when something is wrong is
        // one nobody knows exists.
        { to: '/admin/queries', label: 'Queries', icon: MessageSquare },
        records,
        ...(isSwAdmin
          ? [
              { to: '/admin/logins', label: 'Logins', icon: ShieldAlert },
              { to: '/admin/timing', label: 'KPI Timing', icon: Timer },
            ]
          : []),
      ]
    : [
        { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
        { to: '/my-kpi', label: 'My KPI', icon: ClipboardList },
        // "History" is where the monthly assessment is actually done, but
        // the name only described the half of the screen that looks
        // backwards — so people went looking for somewhere to submit and
        // did not find it. "Assessments" is the word the app already uses
        // for this ("You cannot start monthly assessments until…"), and a
        // calendar tick says months rather than archive.
        { to: '/history', label: 'Assessments', icon: CalendarCheck },
        ...(isManager
          ? [
              { to: '/team', label: 'My Team', icon: Users, badge: counts?.scoring ?? 0 },
              {
                to: '/approvals', label: 'Approvals', icon: CheckSquare,
                badge: counts?.approvals ?? 0, queue: true,
              },
              queries,
              records,
            ]
          : []),
      ]

  /*
    Six tabs on a 375px screen is five characters each, which is how
    "Approvals" and "Records" ended up sharing a row with nothing in
    either of them. A queue with an empty tray is not a destination, so
    it gives its slot back until something arrives — and reappears with
    a badge on it, which is a better prompt than a permanent tab nobody
    reads.

    Still shown while you are standing on it: a page whose own tab has
    vanished underneath it is disorienting, and clearing the last item
    in a queue is exactly when that would happen.
  */
  const items = allItems.filter(
    item => !item.queue || (item.badge ?? 0) > 0 || pathname.startsWith(item.to),
  )

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-ink-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          <button
            className="btn-icon lg:hidden"
            onClick={() => setMenuOpen(v => !v)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          <div className="flex items-center gap-2.5">
            <LogoMark className="h-8 w-8" />
            <Logo className="hidden text-[15px] sm:inline-flex" showSubtitle={false} />
            <span className="text-[11px] font-semibold uppercase tracking-label text-ink-400">
              KPI
            </span>
          </div>

          {/* lg, not md. Between the two the tabs, the name and three
              icon buttons are wider than the bar, so the whole page
              scrolled sideways — and HR carries more tabs than anyone,
              so trimming padding would only move the width it breaks at.
              The bottom nav covers tablets instead. */}
          <nav className="ml-6 hidden items-center gap-1 lg:flex">
            {items.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className="nav-link"
              >
                <item.icon className={clsx('h-4 w-4', NAV_TINT[item.to])} />
                {item.label}
                <Badge count={item.badge} />
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {/* The name was the obvious place to look for your own record
                and did nothing, so it is now the way in. One target
                covering the name and the avatar: they read as one thing,
                and two adjacent links to the same page is a thumb trap. */}
            <NavLink
              to="/me"
              className="nav-profile btn-press flex items-center gap-3 rounded-lg py-1 pl-2 pr-1"
              aria-label="My profile"
              title="My profile"
            >
              {/* lg, not sm. The desktop nav appears at md, and between md
                  and lg the tabs plus the name plus three icon buttons are
                  wider than the bar — the page scrolled sideways by about
                  the width of this block. The avatar stays, and it is the
                  same link. */}
              <span className="hidden text-right lg:block">
                <span className="block text-sm font-medium leading-tight text-ink-900">
                  {employee?.full_name}
                </span>
                <span className="block text-xs leading-tight text-ink-500">
                  {employee?.ecode}
                  {isHrAdmin && ' · HR Admin'}
                </span>
              </span>
              <Avatar name={employee?.full_name} src={employee?.avatar} size="sm" />
            </NavLink>
            {/* Not for SW Admin: their remit is logins, and every kind of
                notification there is names an appraisal. */}
            <Notifications enabled={!isSwAdmin || isHrAdmin} />
            <NavLink
              to="/change-password"
              className="btn-icon"
              aria-label="Change password"
              title="Change password"
            >
              {/* A key is the thing you change; leaving is the thing you
                  cannot undo by clicking again. Same logic as the tabs. */}
              <KeyRound className="h-4.5 w-4.5 text-sky-600" />
            </NavLink>
            <button
              onClick={handleSignOut}
              className="btn-icon"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-4.5 w-4.5 text-cyrixRed-600" />
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav className="border-t border-ink-200 bg-white px-3 py-2 lg:hidden">
            {items.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMenuOpen(false)}
                className="nav-link !py-3"
              >
                <item.icon className={clsx('h-4.5 w-4.5', NAV_TINT[item.to])} />
                {item.label}
                <Badge count={item.badge} />
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      {/*
        The page's own tint lands here rather than on :root, so a screen
        reporting on somebody else colours itself and nothing above it.
        Without this the team average reached the nav, and every tab —
        Records, Approvals, the lot — hovered in the team's colour on the
        team pages.
      */}
      <main
        style={scopeStyle}
        className="mx-auto max-w-7xl px-4 py-6 pb-24 lg:pb-6"
      >
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white lg:hidden">
        <div
          className="grid"
          style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
        >
          {items.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                clsx(
                  'relative flex flex-col items-center gap-1 px-1 py-2.5 text-[11px] font-medium transition-colors',
                  // The page's colour, matching the desktop tab above it.
                  isActive ? 'text-[color:var(--page-strong)]' : 'text-ink-400',
                )
              }
            >
              <span className="relative">
                <item.icon className={clsx('h-5 w-5', NAV_TINT[item.to])} />
                {!!item.badge && item.badge > 0 && (
                  <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-cyrixRed-600 px-1 text-[10px] font-bold text-white">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}
              </span>
              <span className="truncate">{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Outside main, above the nav: questions about the account and the
          device rather than about whichever screen happens to be open.
          Both render nothing at all once answered.

          Install first in the source so the start month paints on top of
          it. Only one person in a hundred is missing a start month, but
          that question has no dismiss and this one does, so the one that
          cannot be put off has to be the one in front. */}
      <InstallPrompt />
      <StartMonthPrompt />
    </div>
  )
}

/** Red because a badge here always means someone is waiting on you. */
function Badge({ count }: { count?: number }) {
  if (!count || count <= 0) return null
  return (
    <span className="ml-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-cyrixRed-600 px-1.5 text-[11px] font-bold text-white">
      {count > 99 ? '99+' : count}
    </span>
  )
}
