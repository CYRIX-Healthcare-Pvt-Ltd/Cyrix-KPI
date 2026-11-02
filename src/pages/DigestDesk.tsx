import { ArrowLeft } from 'lucide-react'
import { Logo } from '@/components/Logo'
import ThemeToggle from '@/components/ThemeToggle'
import DigestAdmin from '@/pages/admin/DigestAdmin'

/**
 * Posting to Cyrix Digest, on a page of its own rather than as a KPI tab (the user, 2 Nov: "why digest
 * inside kpi module?"). The portal's Post button opens it, and the way back is the portal.
 */
export default function DigestDesk() {
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
          <div className="ml-auto"><ThemeToggle /></div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <DigestAdmin />
      </main>
    </div>
  )
}
