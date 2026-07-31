import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import {
  LayoutDashboard, ClipboardList, Users, CheckSquare, History,
  LogOut, Menu, X,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

const navItems = [
  { to: '/',         label: 'Dashboard', icon: LayoutDashboard, managerOnly: false, end: true },
  { to: '/my-kpi',   label: 'My KPI',    icon: ClipboardList,   managerOnly: false },
  { to: '/history',  label: 'History',   icon: History,         managerOnly: false },
  { to: '/team',     label: 'My Team',   icon: Users,           managerOnly: true },
  { to: '/approvals',label: 'Approvals', icon: CheckSquare,     managerOnly: true },
]

export default function Shell() {
  const { employee, isManager, isHrAdmin, signOut } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  const visible = navItems.filter(i => !i.managerOnly || isManager || isHrAdmin)

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  const initials = (employee?.full_name ?? '?')
    .split(' ')
    .slice(0, 2)
    .map(p => p[0])
    .join('')
    .toUpperCase()

  return (
    <div className="min-h-screen">
      {/* ---- top bar ---- */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          <button
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 md:hidden"
            onClick={() => setMenuOpen(v => !v)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-700 text-sm font-bold text-white">
              C
            </div>
            <span className="font-semibold text-slate-900">Cyrix KPI</span>
          </div>

          {/* desktop nav */}
          <nav className="ml-6 hidden items-center gap-1 md:flex">
            {visible.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-brand-50 text-brand-800'
                      : 'text-slate-600 hover:bg-slate-100',
                  )
                }
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight text-slate-900">
                {employee?.full_name}
              </p>
              <p className="text-xs leading-tight text-slate-500">
                {employee?.ecode}
                {isHrAdmin && ' · HR'}
              </p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
              {initials}
            </div>
            <button
              onClick={handleSignOut}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>

        {/* mobile nav drawer */}
        {menuOpen && (
          <nav className="border-t border-slate-200 bg-white px-3 py-2 md:hidden">
            {visible.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium',
                    isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-700',
                  )
                }
              >
                <item.icon className="h-4.5 w-4.5" />
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 pb-24 md:pb-6">
        <Outlet />
      </main>

      {/* ---- bottom tab bar (phones) ---- */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white md:hidden">
        <div
          className="grid"
          style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))` }}
        >
          {visible.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                clsx(
                  'flex flex-col items-center gap-1 px-1 py-2.5 text-[11px] font-medium',
                  isActive ? 'text-brand-700' : 'text-slate-500',
                )
              }
            >
              <item.icon className="h-5 w-5" />
              <span className="truncate">{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
