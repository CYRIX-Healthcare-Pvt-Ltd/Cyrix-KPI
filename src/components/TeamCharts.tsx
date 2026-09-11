import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { Sigma, LineChart as LineChartIcon } from 'lucide-react'
import BellCurve from '@/components/BellCurve'
import BandTrend from '@/components/BandTrend'
import { attainmentPct } from '@/lib/bands'
import { openFyMonths, monthLabel } from '@/lib/fy'
import { JOB_ROLE_TOTAL, REMAINDER_TOTAL } from '@/lib/sections'
import type { KpiAssignment, KpiSubmission } from '@/types/db'

const SCORED = new Set(['scored', 'finalized'])

/** Which band the bell curve is plotting. */
type BellMetric = 'total' | 'job' | 'esms' | 'core'

const METRIC_LABEL: Record<BellMetric, string> = {
  total: 'Total',
  job: 'Job role',
  esms: 'ESMS',
  core: 'Core values',
}

/**
 * Where each band's axis starts when nobody is below it.
 *
 * A scored team lives in the top part of its band, so starting every
 * chart at zero spends half the width drawing an empty floor. These are
 * the points below which somebody would be a genuine outlier — and the
 * axis drops past them on its own when there is one.
 */
const BELL_FLOOR: Record<BellMetric, number> = {
  total: 40, job: 20, core: 0, esms: 0,
}

type Weights = Pick<KpiAssignment, 'employee_id' | 'job_role_weight' | 'esms_weight' | 'core_values_weight'>

/**
 * Two views of the team's scores, answering different questions: are we
 * improving, and are we bunched or spread.
 *
 * These lived on My Team, between the Scoring Due panel and the list of
 * people, so a manager read two cards of charts before reaching anybody
 * waiting on them. Management asked for the list at the top of that
 * screen and the charts here, beside the rest of the analysis. They moved
 * as they were: the same figures, filters and wording.
 */
export default function TeamCharts({
  fy, team, subs, assignments, anyEsms,
}: {
  fy: string
  team: ReadonlyArray<{ id: string }>
  /** The whole year, for the whole team. */
  subs: KpiSubmission[] | undefined
  assignments: Weights[] | undefined
  /** Whether anybody on the team carries ESMS, which decides its option. */
  anyEsms: boolean
}) {
  const [chartTab, setChartTab] = useState<'trend' | 'bell'>('trend')
  const [bellMonth, setBellMonth] = useState('')
  const [bellMetric, setBellMetric] = useState<BellMetric>('total')

  /**
   * One figure per person for the bell curve.
   *
   * Always a percentage of the band being plotted, never raw points —
   * core values is 20 for most people and 15 for anyone carrying ESMS,
   * so a distribution of raw core scores would put two different scales
   * on one axis and draw a second hump that is an artefact of the
   * weighting rather than of anybody's performance.
   */
  const bell = useMemo(() => {
    const weightsOf = (id: string) => {
      const a = (assignments ?? []).find(x => x.employee_id === id)
      return {
        total: 100,
        job: Number(a?.job_role_weight ?? JOB_ROLE_TOTAL),
        esms: Number(a?.esms_weight ?? 0),
        core: Number(a?.core_values_weight ?? REMAINDER_TOTAL),
      }
    }
    const pick = (s: KpiSubmission) => ({
      total: s.final_total_score,
      job: s.final_job_role_score,
      esms: s.final_esms_score,
      core: s.final_core_score,
    }[bellMetric])

    // Their own average first, so somebody scored on six months is one
    // person on this chart rather than six.
    const people: Array<{ weight: number; value: number }> = []
    for (const member of team) {
      const rows = (subs ?? []).filter(s =>
        s.employee_id === member.id
        && SCORED.has(s.status)
        && (!bellMonth || s.period_month === bellMonth))
      const vals = rows.map(pick).filter((v): v is number => v !== null)
      if (vals.length) {
        people.push({
          weight: weightsOf(member.id)[bellMetric],
          value: vals.reduce((a, b) => a + b, 0) / vals.length,
        })
      }
    }

    /*
      Points, not shares — core values is out of 20 and that is the
      number on everybody's screen, so an axis running to 100 was
      answering a question nobody asked.

      Except when the band is not the same size for the whole team.
      Core values is 20 for most people and 15 for anyone carrying ESMS,
      and plotting both as raw points would draw the 15s to the left of
      the 20s for reasons that have nothing to do with performance. That
      case falls back to shares, and the caption says so.
    */
    const weights = new Set(people.map(p => p.weight).filter(w => w > 0))
    const mixed = weights.size > 1
    const outOf = mixed ? 100 : ([...weights][0] ?? 100)

    return {
      mixed,
      outOf,
      floor: mixed ? 40 : BELL_FLOOR[bellMetric],
      values: people
        .map(p => (mixed ? attainmentPct(p.value, p.weight) : p.value))
        .filter((v): v is number => v !== null),
    }
  }, [subs, team, assignments, bellMonth, bellMetric])

  /**
   * The team average for each finished month.
   *
   * Everyone who was scored that month, averaged — so a month where only
   * two people were scored is two people's average and says so in the
   * tooltip's month label rather than pretending to be the whole team.
   */
  const trend = useMemo(() => {
    const byMonth = new Map<string, KpiSubmission[]>()
    for (const s of subs ?? []) {
      if (!SCORED.has(s.status) || s.final_total_score === null) continue
      const list = byMonth.get(s.period_month) ?? []
      list.push(s)
      byMonth.set(s.period_month, list)
    }
    // Raw points, not shares. Job role out of 80 and core values out of
    // 20 keep the lines apart on the plot; converting both to
    // percentages would stack three lines in the seventies.
    const avg = (rows: KpiSubmission[], pick: (s: KpiSubmission) => number | null) => {
      const vals = rows.map(pick).filter((v): v is number => v !== null)
      return vals.length
        ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
        : null
    }
    return openFyMonths(fy).map(m => {
      const rows = byMonth.get(m) ?? []
      return {
        month: m,
        total: avg(rows, s => s.final_total_score),
        job: avg(rows, s => s.final_job_role_score),
        esms: avg(rows, s => s.final_esms_score),
        core: avg(rows, s => s.final_core_score),
      }
    })
  }, [subs, fy])

  return (
    // Tabs rather than two stacked cards — they are alternatives, and a
    // manager reads one at a time.
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex rounded-lg bg-ink-100 p-0.5"
          role="tablist"
          aria-label="Team chart"
        >
          {([
            ['trend', 'Team average', LineChartIcon],
            ['bell', 'Bell curve', Sigma],
          ] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              role="tab"
              aria-selected={chartTab === key}
              onClick={() => setChartTab(key)}
              className={clsx(
                'btn-press flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                chartTab === key
                  ? 'bg-surface text-ink-900 shadow-sm'
                  : 'text-ink-500 hover:text-ink-800',
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        {/* Only the bell curve's own filters, and only when it is the
            one on screen. Full width on a phone so two selects never
            end up squeezed into half a row each. */}
        {chartTab === 'bell' && (
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <select
              className="input w-full sm:w-auto"
              value={bellMonth}
              onChange={e => setBellMonth(e.target.value)}
              aria-label="Month"
            >
              <option value="">All months · average</option>
              {openFyMonths(fy).reverse().map(m => (
                <option key={m} value={m}>{monthLabel(m)} only</option>
              ))}
            </select>
            <select
              className="input w-full sm:w-auto"
              value={bellMetric}
              onChange={e => setBellMetric(e.target.value as BellMetric)}
              aria-label="Which band to plot"
            >
              <option value="total">Total</option>
              <option value="job">Job role</option>
              {anyEsms && <option value="esms">ESMS</option>}
              <option value="core">Core values</option>
            </select>
          </div>
        )}
      </div>

      <p className="mb-3 mt-3 text-xs text-ink-500">
        {chartTab === 'trend'
          ? 'Everyone who was scored that month, averaged, on the band scale.'
          : `Where the team sits on ${METRIC_LABEL[bellMetric].toLowerCase()}` +
            `${bell.mixed ? ', as a share of each person\'s own weightage' : ` out of ${bell.outOf}`}, ` +
            `${bellMonth ? `for ${monthLabel(bellMonth)}` : 'averaged over the year'}. ` +
            'Each dot on the axis is one person.' +
            (bell.mixed
              ? ' Shares rather than points here, because this band is not the same size for everyone on the team.'
              : '')}
      </p>

      {chartTab === 'trend' ? (
        <BandTrend
          points={trend}
          hasEsms={anyEsms}
          emptyMessage="No months scored yet — the lines start with your first one."
        />
      ) : (
        <BellCurve
          values={bell.values}
          outOf={bell.outOf}
          floor={bell.floor}
          emptyMessage={
            bellMonth
              ? `Fewer than three people have been scored for ${monthLabel(bellMonth)}, so there is no spread to draw yet.`
              : 'Fewer than three people have been scored yet, so there is no spread to draw.'
          }
        />
      )}
    </div>
  )
}
