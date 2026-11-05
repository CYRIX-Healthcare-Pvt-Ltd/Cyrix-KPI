import { ArrowLeft, LogOut } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { Logo } from '@/components/Logo'
import ThemeToggle from '@/components/ThemeToggle'
import Avatar from '@/components/Avatar'
import { useAuth } from '@/contexts/AuthContext'
import DigestAdmin from '@/pages/admin/DigestAdmin'

/**
 * Posting to Cyrix Digest, on a page of its own rather than as a KPI tab (the user, 2 Nov: "why digest
 * inside kpi module?"). The portal's Post button opens it, and the way back is the portal. Its bar carries
 * the same name, light/dark and sign out as every other Cyrix page (the user, 5 Nov: "did you see the nav bar?").
 */
export default function DigestDesk() {
  const { employee, signOut } = useAuth()
  const handleSignOut = async () => {
    await signOut()
    // The portal owns the session: signing out here signs out of everything, and the way back is the portal.
    window.location.assign('/')
  }
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-ink-200 bg-surface">
        <div className="flex h-14 items-center gap-3 px-4 sm:h-16">
          <a href="/" className="btn-icon" aria-label="Back to the portal" title="Back to the portal">
            <ArrowLeft className="h-5 w-5" />
          </a>
          {/* Its width stated (300 x 92 art), as in KPI's header: Safari otherwise sizes the link at 300 px. */}
          <a href="/" className="btn-press flex shrink-0 items-center rounded-lg py-1 pr-1" aria-label="All Cyrix modules">
            <Logo className="h-9 w-[calc(2.25rem*300/92)] sm:h-11 sm:w-[calc(2.75rem*300/92)]" />
          </a>
          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-3">
            <NavLink to="/me" className="nav-profile btn-press flex items-center gap-3 rounded-lg py-1 pl-2 pr-1" aria-label="My profile" title="My profile">
              <span className="hidden text-right lg:block">
                <span className="block text-sm font-medium leading-tight text-ink-900">{employee?.full_name}</span>
                <span className="block text-xs leading-tight text-ink-500">{employee?.ecode}</span>
              </span>
              <Avatar name={employee?.full_name} src={employee?.avatar} size="header" />
            </NavLink>
            <ThemeToggle />
            <button onClick={() => void handleSignOut()} className="btn-icon" aria-label="Sign out" title="Sign out">
              <LogOut className="h-4.5 w-4.5 text-cyrixRed-600" />
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <DigestAdmin />
      </main>
    </div>
  )
}
