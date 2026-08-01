import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import {
  LayoutDashboard, ClipboardList, Users, CheckSquare, History,
  LogOut, Menu, X, KeyRound, Building2, BarChart3, UserPlus,
  ShieldAlert, Trash2,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  usePendingCounts, useRemovalRequests, useAnnualSummary, currentFy,
} from '@/lib/queries'
import { useBaseScore } from '@/contexts/ScoreThemeContext'
import { Logo, LogoMark } from './Logo'

interface NavItem {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  end?: boolean
  badge?: number
}

export default function Shell() {
  const { employee, isManager, isHrAdmin, isSwAdmin, signOut } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const fy = currentFy()

  const { data: counts } = usePendingCounts(
    isManager ? employee?.id : undefined, fy,
  )
  const { data: removals } = useRemovalRequests('pending')

  // Set here rather than on the dashboard so the tint survives navigation —
  // every screen carries the signed-in person's band, not just the one that
  // happens to display their score.
  const { data: annual } = useAnnualSummary(employee?.id, fy)
  useBaseScore(annual?.avg_total_score)

  // HR administers the system rather than being appraised by it, so they
  // get the admin surfaces instead of a personal KPI.
  const items: NavItem[] = isSwAdmin && !isHrAdmin
    ? [
        { to: '/admin/logins', label: 'Logins', icon: ShieldAlert, end: true },
        { to: '/deletions', label: 'Deletions', icon: Trash2 },
      ]
    : isHrAdmin
    ? [
        { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
        { to: '/admin/employees', label: 'Employees', icon: Building2 },
        { to: '/admin/reports', label: 'Reports', icon: BarChart3 },
        {
          to: '/admin/requests', label: 'Requests', icon: UserPlus,
          badge: removals?.length ?? 0,
        },
        { to: '/deletions', label: 'Deletions', icon: Trash2 },
        ...(isSwAdmin ? [{ to: '/admin/logins', label: 'Logins', icon: ShieldAlert }] : []),
      ]
    : [
        { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
        { to: '/my-kpi', label: 'My KPI', icon: ClipboardList },
        { to: '/history', label: 'History', icon: History },
        ...(isManager
          ? [
              { to: '/team', label: 'My Team', icon: Users, badge: counts?.scoring ?? 0 },
              { to: '/approvals', label: 'Approvals', icon: CheckSquare, badge: counts?.approvals ?? 0 },
            ]
          : []),
      ]

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  const initials = (employee?.full_name ?? '?')
    .split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase()

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-ink-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          <button
            className="rounded-lg p-2 text-ink-600 hover:bg-ink-100 md:hidden"
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

          <nav className="ml-6 hidden items-center gap-1 md:flex">
            {items.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className="nav-link"
              >
                <item.icon className="h-4 w-4" />
                {item.label}
                <Badge count={item.badge} />
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight text-ink-900">
                {employee?.full_name}
              </p>
              <p className="text-xs leading-tight text-ink-500">
                {employee?.ecode}
                {isHrAdmin && ' · HR Admin'}
              </p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-100 text-xs font-semibold text-ink-700">
              {initials}
            </div>
            <NavLink
              to="/change-password"
              className="rounded-lg p-2 text-ink-500 hover:bg-ink-100 hover:text-ink-900"
              aria-label="Change password"
              title="Change password"
            >
              <KeyRound className="h-4.5 w-4.5" />
            </NavLink>
            <button
              onClick={handleSignOut}
              className="rounded-lg p-2 text-ink-500 hover:bg-ink-100 hover:text-ink-900"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav className="border-t border-ink-200 bg-white px-3 py-2 md:hidden">
            {items.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMenuOpen(false)}
                className="nav-link !py-3"
              >
                <item.icon className="h-4.5 w-4.5" />
                {item.label}
                <Badge count={item.badge} />
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 pb-24 md:pb-6">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white md:hidden">
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
                  isActive ? 'text-[color:var(--score-strong)]' : 'text-ink-400',
                )
              }
            >
              <span className="relative">
                <item.icon className="h-5 w-5" />
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
