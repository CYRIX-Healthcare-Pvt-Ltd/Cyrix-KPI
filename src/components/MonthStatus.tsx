import clsx from 'clsx'
import { CheckCircle2, CircleDashed, Clock, Undo2 } from 'lucide-react'
import { monthLabel } from '@/lib/fy'
import { bandFor } from '@/lib/bands'
import type { ManagerMonthStatusRow } from '@/types/db'

/**
 * Month-by-month completion, shared by HR and by managers.
 *
 * Same component both ways round: HR pins a month and reads down the
 * managers; a manager pins themselves and reads across the months. Only
 * the first column changes, which is why it is one component rather than
 * two tables that would drift apart.
 */

export type MonthStatusMode = 'by-manager' | 'by-month'

/** Everything a row needs said once, so the table and the bar agree. */
const STATES = [
  { key: 'scored',           label: 'Scored',   icon: CheckCircle2, cls: 'text-emerald-700', bar: 'bg-emerald-500' },
  { key: 'awaiting_manager', label: 'To score',  icon: Clock,        cls: 'text-amber-700',   bar: 'bg-amber-500' },
  { key: 'returned',         label: 'Returned', icon: Undo2,        cls: 'text-orange-700',  bar: 'bg-orange-400' },
  { key: 'not_submitted',    label: 'Not in',   icon: CircleDashed, cls: 'text-ink-400',     bar: 'bg-ink-200' },
] as const

const pctDone = (r: ManagerMonthStatusRow) =>
  r.team_size > 0 ? Math.round((r.scored / r.team_size) * 100) : 0

/** A single row's split, as one bar. Reads faster than four numbers. */
function SplitBar({ row }: { row: ManagerMonthStatusRow }) {
  if (row.team_size === 0) return <div className="h-1.5 rounded-full bg-ink-100" />
  return (
    <div className="flex h-1.5 overflow-hidden rounded-full bg-ink-100">
      {STATES.map(s => {
        const n = row[s.key]
        if (!n) return null
        return (
          <div
            key={s.key}
            className={s.bar}
            style={{ width: `${(n / row.team_size) * 100}%` }}
            title={`${n} ${s.label.toLowerCase()}`}
          />
        )
      })}
    </div>
  )
}

export function MonthStatusLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-500">
      {STATES.map(s => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className={clsx('h-2 w-2 rounded-full', s.bar)} />
          {s.label}
        </span>
      ))}
    </div>
  )
}

export function MonthStatusTable({
  rows,
  mode,
  emptyMessage = 'Nothing to show for this month.',
}: {
  rows: ManagerMonthStatusRow[]
  mode: MonthStatusMode
  emptyMessage?: string
}) {
  if (rows.length === 0) {
    return <p className="p-4 text-sm text-ink-500">{emptyMessage}</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-ink-200 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
            <th className="px-4 py-2.5">{mode === 'by-manager' ? 'Manager' : 'Month'}</th>
            <th className="px-4 py-2.5 min-w-32">Progress</th>
            <th className="px-4 py-2.5 text-right">Team</th>
            {STATES.map(s => (
              <th key={s.key} className="px-4 py-2.5 text-right">{s.label}</th>
            ))}
            <th className="px-4 py-2.5 text-right">Average</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {rows.map(r => {
            const done = pctDone(r)
            const band = bandFor(r.team_avg_score)
            return (
              <tr key={`${r.manager_id}-${r.period_month}`} className="hover:bg-ink-50">
                <td className="px-4 py-3">
                  {mode === 'by-manager' ? (
                    <>
                      <p className="font-medium text-ink-900">{r.manager_name}</p>
                      <p className="text-xs text-ink-500">
                        {r.manager_ecode}
                        {r.department && ` · ${r.department}`}
                      </p>
                    </>
                  ) : (
                    <p className="font-medium text-ink-900">{monthLabel(r.period_month)}</p>
                  )}
                </td>
                <td className="px-4 py-3">
                  <SplitBar row={r} />
                  <p className="mt-1 text-[11px] tabular-nums text-ink-500">
                    {done}% scored
                  </p>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-ink-600">
                  {r.team_size}
                </td>
                {STATES.map(s => (
                  <td
                    key={s.key}
                    className={clsx(
                      'px-4 py-3 text-right tabular-nums',
                      r[s.key] ? s.cls : 'text-ink-300',
                    )}
                  >
                    {r[s.key]}
                  </td>
                ))}
                <td className="px-4 py-3 text-right">
                  {r.team_avg_score === null ? (
                    <span className="text-ink-300">—</span>
                  ) : (
                    <span className={clsx('font-semibold tabular-nums', band?.accent)}>
                      {r.team_avg_score.toFixed(1)}
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** The headline for a month: how much of the org has actually finished it. */
export function MonthStatusSummary({ rows }: { rows: ManagerMonthStatusRow[] }) {
  const total = rows.reduce((a, r) => a + r.team_size, 0)
  const scored = rows.reduce((a, r) => a + r.scored, 0)
  const awaiting = rows.reduce((a, r) => a + r.awaiting_manager, 0)
  const notIn = rows.reduce((a, r) => a + r.not_submitted, 0)
  // "Done" is the manager having scored everyone, not merely started.
  const managersDone = rows.filter(r => r.team_size > 0 && r.scored === r.team_size).length
  const managersWithTeam = rows.filter(r => r.team_size > 0).length

  const tile = (label: string, value: string | number, sub: string, cls?: string) => (
    <div className="rounded-xl border border-ink-200/70 p-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-label text-ink-500">
        {label}
      </p>
      <p className={clsx('mt-1.5 text-xl font-semibold tabular-nums', cls ?? 'text-ink-900')}>
        {value}
      </p>
      <p className="text-xs text-ink-400">{sub}</p>
    </div>
  )

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {tile('Managers finished', `${managersDone}/${managersWithTeam}`,
        'scored their whole team')}
      {tile('Scored', scored, `of ${total} people`, 'text-emerald-700')}
      {tile('Waiting on a manager', awaiting, 'submitted, not scored',
        awaiting > 0 ? 'text-amber-700' : undefined)}
      {tile('Not submitted', notIn, 'nothing from the team member',
        notIn > 0 ? 'text-cyrixRed-700' : undefined)}
    </div>
  )
}
