import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { X, ChevronRight, ChevronLeft, Users, AlertCircle, Home } from 'lucide-react'
import { useTeamSubtree, type SubtreeRow } from '@/lib/queries'
import { PageLoader, ScorePill, StatusBadge, Alert } from '@/components/ui'
import { ScoreHeader, TeamBands } from '@/components/analysis'
import { teamBandShare, teamAverages, bandFor, SCORED_STATUSES } from '@/lib/bands'
import Avatar from '@/components/Avatar'
import { monthLabel } from '@/lib/fy'
import { JOB_ROLE_TOTAL, REMAINDER_TOTAL } from '@/lib/sections'
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
 * which list they are reading. For the same reason it opens with the
 * same hero and band card the team page has — a manager looking into a
 * team wants its average before its members, and answering that with the
 * same two panels means one thing to learn rather than two.
 *
 * The way out is spelled out three times over — a trail showing where
 * you are, a Back that names where it goes, and a Close that says Close.
 * People testing this said the app was confusing; a stack you can enter
 * more easily than you can leave is exactly how that happens.
 * ------------------------------------------------------------------- */

interface Crumb {
  id: string
  name: string
}

export default function TeamDrill({
  root, fy, month, onClose,
}: {
  root: Crumb
  fy: string
  month: string
  onClose: () => void
}) {
  const [trail, setTrail] = useState<Crumb[]>([root])
  const here = trail[trail.length - 1]

  const { data, isLoading, error } = useTeamSubtree(fy, month, here.id)

  // Escape goes back one level, or closes at the top. A key that always
  // closed would throw away three levels of walking on a mis-hit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (trail.length > 1) setTrail(t => t.slice(0, -1))
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, trail.length])

  // Only the first rung. The function returns the whole line so the
  // counts are honest, but a list mixing somebody's reports with their
  // reports' reports has no order anybody can read.
  const rows = useMemo(() => (data ?? []).filter(r => r.depth === 1), [data])
  const below = data?.length ?? 0
  const waiting = rows.filter(r => r.submission_status === 'submitted').length

  /**
   * Every team on this screen at once — the one being looked at, keyed
   * by the person at its head, and one for each row that heads a team of
   * their own. The whole line comes back in a single query, so the
   * colour on a row costs nothing beyond the arithmetic.
   */
  const averages = useMemo(() => teamAverages(data ?? []), [data])
  const average = averages.get(here.id) ?? null
  const scoredRows = rows.filter(r => SCORED_STATUSES.has(r.submission_status ?? ''))

  const share = useMemo(
    () => teamBandShare(rows.map(r => ({
      // The subtree function does not carry each person's own weights, so
      // the standard split is assumed. It is right for everybody without
      // ESMS, which is nearly everybody, and the alternative is a query
      // per person to refine a figure this panel only summarises.
      weights: { job: JOB_ROLE_TOTAL, esms: 0, core: REMAINDER_TOTAL },
      months: SCORED_STATUSES.has(r.submission_status ?? '')
        ? [{
            job: r.final_job_role_score,
            esms: r.final_esms_score,
            core: r.final_core_score,
            total: r.final_total_score,
          }]
        : [],
    }))),
    [rows],
  )

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-canvas">
      {/* Sticky, because the way out has to be reachable from wherever
          somebody has scrolled to in a list of forty. */}
      <header className="sticky top-0 z-10 border-b border-ink-200 bg-surface">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3 sm:gap-3">
          {/* Neutral, and deliberately not .btn-secondary: that one tints
              its hover with the ambient score colour, so on a team
              averaging 84 the way out of the screen turned green. Leaving
              is not an achievement. */}
          <button
            onClick={() => (trail.length > 1 ? setTrail(t => t.slice(0, -1)) : onClose())}
            className="btn shrink-0 border border-ink-200 bg-surface text-ink-700 hover:bg-ink-100"
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="hidden sm:inline">
              {trail.length > 1 ? `Back to ${trail[trail.length - 2].name.split(' ')[0]}` : 'Back'}
            </span>
            <span className="sm:hidden">Back</span>
          </button>

          <div className="min-w-0 flex-1 text-center sm:text-left">
            <p className="truncate text-sm font-semibold text-ink-900">
              {here.name}’s team
            </p>
            <p className="truncate text-xs text-ink-500">
              {monthLabel(month)} · {rows.length} direct
              {below > rows.length && ` · ${below} in the whole line`}
            </p>
          </div>

          {/* Red, because it is the same act as the sign-out in the app's
              own header: leaving. The app already says that in red, so
              this does too rather than inventing a second vocabulary. */}
          <button
            onClick={onClose}
            className="btn shrink-0 border border-cyrixRed-200 bg-cyrixRed-50 text-cyrixRed-700 hover:bg-cyrixRed-100"
          >
            <X className="h-4 w-4" /> Close
          </button>
        </div>

        {/* The trail. Present from the first level so it does not appear
            out of nowhere on the second, and every step is clickable so
            three levels down is one tap from the top rather than three. */}
        <nav
          aria-label="Where you are"
          className="mx-auto flex max-w-5xl flex-wrap items-center gap-0.5 px-4 pb-2.5 text-xs"
        >
          {trail.map((c, i) => (
            <span key={c.id} className="flex min-w-0 items-center gap-0.5">
              {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-ink-300" />}
              <button
                onClick={() => setTrail(t => t.slice(0, i + 1))}
                disabled={i === trail.length - 1}
                className={clsx(
                  'max-w-[40vw] truncate rounded px-1.5 py-0.5 sm:max-w-none',
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
              <ScoreHeader
                title={`${here.name.split(' ')[0]}’s team`}
                subtitle={`${rows.length} member${rows.length === 1 ? '' : 's'} · ${monthLabel(month)}`}
                score={average}
                scoreLabel="Team average"
              />

              {/* Only once somebody has been scored. A band card of four
                  dashes is a panel explaining that it has nothing to say. */}
              {scoredRows.length > 0 && (
                <TeamBands
                  share={share}
                  label={`Average by band · ${monthLabel(month)}`}
                />
              )}

              {waiting > 0 && (
                <p className="flex items-center gap-1.5 text-sm text-amber-700">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {waiting} {waiting === 1 ? 'is' : 'are'} waiting to be scored by{' '}
                  {here.name.split(' ')[0]}.
                </p>
              )}

              <div className="card divide-y divide-ink-100 overflow-hidden">
                {rows.map(r => (
                  <PersonRow
                    key={r.employee_id}
                    row={r}
                    month={month}
                    teamAverage={averages.get(r.employee_id) ?? null}
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

/*
 * Fixed columns, not a row of things pushed apart.
 *
 * Every cell after the name has a width of its own, so the badges line
 * up with the badges and the scores with the scores down a list of
 * forty. Laid out with justify-between, each row sized itself from its
 * own content and the columns wandered — a long designation on one row
 * put its score somewhere else than the row above it.
 */
function PersonRow({
  row, month, teamAverage, onDrill,
}: {
  row: SubtreeRow
  month: string
  /** This person's own team's average, null when nobody under them is scored. */
  teamAverage: number | null
  onDrill: () => void
}) {
  const needsScoring = row.submission_status === 'submitted'
  const final = SCORED_STATUSES.has(row.submission_status ?? '')
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
          <p className="mt-0.5 truncate text-xs text-amber-700">
            KPI {row.assignment_status ? row.assignment_status.replace('_', ' ') : 'not set up'}
          </p>
        )}
      </div>

      {/* Right-aligned in a fixed box: a badge that centres itself moves
          left and right as its own word gets longer. */}
      <div className="hidden w-36 shrink-0 text-right sm:block">
        <StatusBadge status={(row.submission_status as SubmissionStatus | null) ?? null} />
      </div>

      <div className="w-16 shrink-0 text-right">
        <ScorePill value={score} size="sm" />
      </div>

      {/* The column exists on every row so the ones without a team keep
          the score above them in line; only the button comes and goes. */}
      <div className="w-10 shrink-0 sm:w-[124px]">
        {row.direct_reports > 0 && (
          <ViewTeamButton
            name={row.full_name}
            count={row.direct_reports}
            average={teamAverage}
            month={month}
            onClick={onDrill}
          />
        )}
      </div>
    </div>
  )
}

/**
 * The way into somebody else's team, coloured by how that team is doing.
 *
 * The colour is the point. A manager of forty scrolling a list wants to
 * know which branches need them before they open any of them, and a row
 * of identical grey buttons says only that these people manage people.
 * Tinted, the list answers "where should I look first" while being
 * scrolled past.
 *
 * Read as an outline rather than a fill, because the score pill beside
 * it is already a filled band chip: two solid chips in one row would be
 * two scores, and only one of them is this person's.
 *
 * The average behind the colour is the team's, for the month on screen,
 * and only from people who have been scored — so it is deliberately not
 * the same figure as the year-long average in the hero above. The
 * tooltip says both the number and the month rather than leaving anyone
 * to work out which of the two a colour belongs to.
 *
 * Shared by the team list and the drill-down: these are the same control
 * doing the same job, and the two hand-written copies had already
 * drifted a padding step apart.
 */
export function ViewTeamButton({
  name, count, average, month, onClick,
}: {
  name: string
  count: number
  average: number | null
  month: string
  onClick: () => void
}) {
  const band = bandFor(average)
  const reading = band && average !== null
    ? `${name}’s team averages ${average.toFixed(1)} in ${monthLabel(month)} — ${band.label}.`
    : `Nobody in ${name}’s team has been scored for ${monthLabel(month)} yet.`

  return (
    <button
      onClick={onClick}
      className={clsx(
        // gap-1.5 rather than the .btn default of 2: at the width this
        // column can afford, two points of gap is the difference between
        // "View team" on one line and on two.
        'btn w-full border !gap-1.5 !px-1.5 !py-1.5 text-xs sm:!px-2',
        band ? band.tint : 'border-ink-200 bg-surface text-ink-700 hover:bg-ink-100',
      )}
      title={`${reading} See who reports to them.`}
      aria-label={`View ${name}’s team of ${count}. ${reading}`}
    >
      <Users className="h-3.5 w-3.5 shrink-0" />
      <span className="hidden whitespace-nowrap sm:inline">View team</span>
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  )
}
