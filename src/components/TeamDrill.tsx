import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { X, ChevronRight, ChevronLeft, Users, AlertCircle, Home } from 'lucide-react'
import { useTeamSubtree, type SubtreeRow } from '@/lib/queries'
import { PageLoader, ScorePill, StatusBadge, Alert } from '@/components/ui'
import Avatar from '@/components/Avatar'
import { monthLabel } from '@/lib/fy'
import type { SubmissionStatus } from '@/types/db'

/* ---------------------------------------------------------------------
 * Looking down the line
 *
 * A manager's team screen shows their own reports. This shows anybody
 * else's, one level at a time, walking down the branch — because a
 * divisional manager whose reports manage teams of their own could
 * previously see the reports and nothing under them.
 *
 * The whole screen rather than a small box in the middle of one: it is a
 * list of people with scores, which is the same thing the page behind it
 * is, and a cramped panel over a full one is how somebody loses track of
 * which list they are reading.
 *
 * Which is also why the way out is spelled out three times over — a
 * trail showing where you are, a Back that names where it goes, and a
 * Close that says Close. People testing this said the app was confusing;
 * a stack you can enter more easily than you can leave is exactly how
 * that happens.
 * ------------------------------------------------------------------- */

interface Crumb {
  id: string
  name: string
}

const SCORED = new Set(['scored', 'finalized'])

export default function TeamDrill({
  root, fy, month, onClose,
}: {
  /** Whose team this opened on. */
  root: Crumb
  fy: string
  month: string
  onClose: () => void
}) {
  // The trail, deepest last. It is the navigation and the position
  // indicator at once, so there is nothing to keep in step.
  const [trail, setTrail] = useState<Crumb[]>([root])
  const here = trail[trail.length - 1]

  const { data, isLoading, error } = useTeamSubtree(fy, month, here.id)

  // Escape goes back one level, or closes at the top. A key that always
  // closed would throw away three levels of walking on a mis-hit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setTrail(t => (t.length > 1 ? t.slice(0, -1) : t))
      if (trail.length === 1) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, trail.length])

  // Only the first rung. The function returns the whole line so the
  // counts below are honest, but a list mixing somebody's reports with
  // their reports' reports has no order anybody can read.
  const rows = (data ?? []).filter(r => r.depth === 1)
  const below = (data ?? []).length
  const waiting = rows.filter(r => r.submission_status === 'submitted').length

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-canvas">
      {/* Sticky, because the way out has to be reachable from wherever
          somebody has scrolled to in a list of forty. */}
      <header className="sticky top-0 z-10 border-b border-ink-200 bg-surface">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <button
            onClick={() => (trail.length > 1 ? setTrail(t => t.slice(0, -1)) : onClose())}
            className="btn-secondary shrink-0"
          >
            <ChevronLeft className="h-4 w-4" />
            {trail.length > 1 ? `Back to ${trail[trail.length - 2].name.split(' ')[0]}` : 'Back'}
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink-900">
              {here.name}’s team
            </p>
            <p className="truncate text-xs text-ink-500">
              {monthLabel(month)} · {rows.length} direct
              {below > rows.length && ` · ${below} in the whole line`}
            </p>
          </div>

          <button onClick={onClose} className="btn-secondary shrink-0">
            <X className="h-4 w-4" /> Close
          </button>
        </div>

        {/* The trail. Present from the first level so it does not appear
            out of nowhere on the second, and every step is clickable so
            three levels down is one tap from the top rather than three. */}
        <nav
          aria-label="Where you are"
          className="mx-auto flex max-w-5xl flex-wrap items-center gap-1 px-4 pb-2.5 text-xs"
        >
          {trail.map((c, i) => (
            <span key={c.id} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-ink-300" />}
              <button
                onClick={() => setTrail(t => t.slice(0, i + 1))}
                disabled={i === trail.length - 1}
                className={clsx(
                  'rounded px-1.5 py-0.5',
                  i === trail.length - 1
                    ? 'font-semibold text-ink-900'
                    : 'text-ink-500 underline-offset-2 hover:bg-ink-100 hover:underline',
                )}
              >
                {i === 0 && <Home className="mr-1 inline h-3 w-3 align-[-1px]" />}
                {c.name}
              </button>
            </span>
          ))}
        </nav>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-4 px-4 py-5">
          {error && <Alert kind="error">{(error as Error).message}</Alert>}

          {isLoading ? (
            <PageLoader label={`Loading ${here.name.split(' ')[0]}’s team…`} />
          ) : rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-ink-300 px-6 py-12 text-center">
              <Users className="mx-auto mb-2 h-6 w-6 text-ink-300" />
              <p className="text-sm text-ink-500">
                {here.name} has nobody reporting to them.
              </p>
            </div>
          ) : (
            <>
              {waiting > 0 && (
                <p className="flex items-center gap-1.5 text-sm text-amber-700">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {waiting} of these {waiting === 1 ? 'is' : 'are'} waiting to be scored by{' '}
                  {here.name.split(' ')[0]}.
                </p>
              )}

              <div className="card divide-y divide-ink-100 overflow-hidden">
                {rows.map(r => (
                  <PersonRow
                    key={r.employee_id}
                    row={r}
                    onDrill={() => setTrail(t => [...t, { id: r.employee_id, name: r.full_name }])}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function PersonRow({ row, onDrill }: { row: SubtreeRow; onDrill: () => void }) {
  const needsScoring = row.submission_status === 'submitted'
  const final = SCORED.has(row.submission_status ?? '')
  const score = final ? row.final_total_score : row.self_total_score

  return (
    <div
      className={clsx(
        'flex items-center gap-3 p-4',
        // The same amber edge the team list uses for the same meaning, so
        // the two screens are one idea rather than two conventions.
        needsScoring ? 'border-l-4 border-amber-500 bg-amber-50/60 pl-3' : 'hover:bg-ink-50',
      )}
    >
      <Avatar name={row.full_name} src={row.avatar} size="sm" />

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-ink-900">{row.full_name}</p>
        <p className="truncate text-xs text-ink-500">
          {row.ecode}
          {row.designation && ` · ${row.designation}`}
        </p>
        {row.assignment_status !== 'active' && (
          <p className="mt-1 text-xs text-amber-700">
            KPI {row.assignment_status ? row.assignment_status.replace('_', ' ') : 'not set up'}
          </p>
        )}
      </div>

      <div className="hidden shrink-0 sm:block">
        <StatusBadge status={(row.submission_status as SubmissionStatus | null) ?? null} />
      </div>

      <div className="w-20 shrink-0 text-right">
        <ScorePill value={score} size="sm" />
      </div>

      {/* Only where there is something to go into. A button that opens an
          empty list is a button that teaches people not to press it. */}
      {row.direct_reports > 0 ? (
        <button onClick={onDrill} className="btn-secondary shrink-0 !px-2.5 !py-1.5 text-xs">
          <Users className="h-3.5 w-3.5" />
          View team
          <span className="ml-0.5 tabular-nums opacity-70">{row.direct_reports}</span>
        </button>
      ) : (
        // Held open so the rows above and below still line up.
        <span className="w-[104px] shrink-0" aria-hidden />
      )}
    </div>
  )
}
