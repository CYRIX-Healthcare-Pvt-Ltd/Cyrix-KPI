import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { useKpiReport, currentFy, type ReportDim } from '@/lib/queries'

/**
 * Completion split by function or department.
 *
 * Colours were chosen by running the palette validator rather than by
 * eye. Emerald-600 and amber-600 pass the lightness band, the chroma
 * floor, the normal-vision floor and contrast against the surface; their
 * protanopia separation is ΔE 7.9, inside the band that is only
 * permitted alongside a second encoding. That second encoding is here
 * and is not decoration: every row carries its percentage as text, the
 * two segments are separated by a surface-coloured gap, and the legend
 * names both. Nothing is identified by hue alone.
 *
 * "Not submitted" is deliberately not a third colour. It is the unfilled
 * track — an absence reads better as empty space than as a grey segment
 * competing with the two real states, and it keeps the palette at two.
 */
const SERIES = [
  { key: 'scored', label: 'Scored', fill: '#059669' },
  { key: 'to_score', label: 'Waiting on manager', fill: '#d97706' },
] as const

/** Enough rows to see the shape, few enough to read. */
const TOP_N = 8

export default function CompletionByDimension() {
  const fy = currentFy()
  const [dim, setDim] = useState<Extract<ReportDim, 'function' | 'department'>>('function')
  const [showAll, setShowAll] = useState(false)

  const { data, isFetching } = useKpiReport(fy, { groupBy: [dim] })

  const all = useMemo(
    () => (data ?? [])
      .map(r => ({
        name: (dim === 'function' ? r.function_name : r.department) ?? 'Unassigned',
        team: Number(r.team),
        scored: Number(r.scored),
        toScore: Number(r.to_score),
      }))
      .sort((a, b) => b.team - a.team),
    [data, dim],
  )

  const rows = useMemo(() => {
    if (showAll) return all
    // Everything past the top few becomes one row rather than a long
    // tail of single-person slivers nobody reads — until it is asked for.
    const head = all.slice(0, TOP_N)
    const tail = all.slice(TOP_N)
    if (tail.length) {
      head.push({
        name: `${tail.length} others`,
        team: tail.reduce((a, r) => a + r.team, 0),
        scored: tail.reduce((a, r) => a + r.scored, 0),
        toScore: tail.reduce((a, r) => a + r.toScore, 0),
      })
    }
    return head
  }, [all, showAll])

  const hidden = Math.max(0, all.length - TOP_N)

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink-800">
            Completion by {dim === 'function' ? 'function' : 'department'}
          </h3>
          <p className="mt-0.5 text-xs text-ink-500">
            Every month of FY {fy} so far.{' '}
            {showAll
              ? `All ${all.length}.`
              : hidden > 0 ? `Largest ${TOP_N} shown.` : ''}
          </p>
        </div>

        <div className="flex rounded-lg border border-ink-200 p-0.5">
          {(['function', 'department'] as const).map(d => (
            <button
              key={d}
              // Switching dimension collapses again: 46 functions and 17
              // departments are different lists, and carrying "expanded"
              // across them means landing in a scrolled view of something
              // you did not ask to see in full.
              onClick={() => { setDim(d); setShowAll(false) }}
              className={clsx(
                'rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                dim === d ? 'bg-ink-900 text-onInk' : 'text-ink-500 hover:text-ink-800',
              )}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* Fixed height either way, so expanding scrolls inside the card
          rather than pushing the rest of the dashboard down the page. */}
      <ul className="mt-4 h-[21.5rem] space-y-3 overflow-y-auto pr-1">
        {rows.length === 0 ? (
          <li className="py-8 text-center text-sm text-ink-400">
            {isFetching ? 'Loading…' : 'Nothing to show yet.'}
          </li>
        ) : (
          rows.map((r, i) => {
            const pct = (n: number) => (r.team ? (n / r.team) * 100 : 0)
            const done = pct(r.scored)
            const isOthers = !showAll && hidden > 0 && i === rows.length - 1
            return (
              <li
                key={r.name}
                onClick={isOthers ? () => setShowAll(true) : undefined}
                className={clsx(
                  isOthers && 'cursor-pointer rounded-md hover:bg-ink-50',
                )}
                title={isOthers ? `Show all ${all.length}` : undefined}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span
                    className={clsx(
                      'truncate text-xs font-medium',
                      isOthers ? 'text-ink-900 underline decoration-ink-300 underline-offset-2'
                               : 'text-ink-700',
                    )}
                  >
                    {r.name}
                  </span>
                  {/* The percentage in text, not colour — this is what
                      makes the palette legal for red-green readers. */}
                  <span className="shrink-0 text-xs tabular-nums text-ink-500">
                    {done.toFixed(done >= 10 ? 0 : 1)}%
                    <span className="text-ink-300"> of {r.team.toLocaleString()}</span>
                  </span>
                </div>
                <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-ink-100">
                  {SERIES.map(s => {
                    const value = s.key === 'scored' ? r.scored : r.toScore
                    if (!value) return null
                    return (
                      <div
                        key={s.key}
                        className="h-full"
                        style={{
                          width: `${pct(value)}%`,
                          background: s.fill,
                          // A surface-coloured gap so two adjacent fills
                          // never read as one longer bar.
                          marginRight: 2,
                        }}
                        title={`${s.label}: ${value.toLocaleString()}`}
                      />
                    )
                  })}
                </div>
              </li>
            )
          })
        )}
      </ul>

      {/* Two series, so a legend is always present. */}
      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-ink-100 pt-3">
        {SERIES.map(s => (
          <li key={s.key} className="flex items-center gap-1.5 text-xs text-ink-600">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.fill }} />
            {s.label}
          </li>
        ))}
        <li className="flex items-center gap-1.5 text-xs text-ink-600">
          <span className="h-2.5 w-2.5 rounded-sm bg-ink-100 ring-1 ring-inset ring-ink-200" />
          Not submitted
        </li>
        {hidden > 0 && (
          <li className="ml-auto">
            <button
              onClick={() => setShowAll(v => !v)}
              className="text-xs font-medium text-ink-500 underline decoration-ink-300 underline-offset-2 hover:text-ink-900"
            >
              {showAll ? `Show largest ${TOP_N}` : `Show all ${all.length}`}
            </button>
          </li>
        )}
      </ul>
    </div>
  )
}
