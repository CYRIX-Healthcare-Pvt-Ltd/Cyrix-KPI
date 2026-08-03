import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { ArrowLeft, KeyRound, Medal, Trophy, UserRound } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  useAnnualSummary, useKpiRanking, useMyManager, useMyAssignment, currentFy,
} from '@/lib/queries'
import { bandFor } from '@/lib/bands'
import { PageLoader, StatTile } from '@/components/ui'
import { ScoreHeader } from '@/components/analysis'
import { JOB_ROLE_TOTAL, REMAINDER_TOTAL } from '@/lib/sections'

/**
 * Your own record: who you are, who you report to, and where you stand.
 *
 * The ranking is the reason this page exists. A score out of 100 tells
 * you how you did against your own targets and nothing about how that
 * compares, which is the next question everybody asks.
 */

/** 1 → 1st, 2 → 2nd, 23 → 23rd. */
function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

/**
 * A rank, sized so the number reads before the caption does.
 *
 * Deliberately not a percentile or a medal for the top three: this is an
 * appraisal, and turning it into a game changes what people optimise
 * for. It states a position and the field it was measured against.
 */
function RankTile({
  label, icon: Icon, rank, of, note,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  rank: number | null | undefined
  of: number | null | undefined
  note?: string
}) {
  return (
    <div className="card flex flex-col p-4">
      <p className="label !mb-0 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-ink-400" />
        {label}
      </p>
      {rank == null || of == null ? (
        <>
          <p className="mt-2 text-2xl font-semibold text-ink-300">—</p>
          <p className="mt-0.5 min-h-4 text-xs text-ink-400">
            No scored month yet
          </p>
        </>
      ) : (
        <>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-ink-900">
            {ordinal(rank)}
            <span className="ml-1.5 text-base font-normal text-ink-400">
              of {of}
            </span>
          </p>
          <p className="mt-0.5 min-h-4 text-xs text-ink-400">{note}</p>
        </>
      )}
    </div>
  )
}

/** One line of the details card. Empty values read as "—", never blank. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 px-4 py-3">
      <p className="w-40 shrink-0 text-xs font-semibold uppercase tracking-label text-ink-500">
        {label}
      </p>
      <div className="min-w-0 flex-1 text-sm text-ink-900">
        {children ?? <span className="text-ink-300">—</span>}
      </div>
    </div>
  )
}

export default function Profile() {
  const { employee, isManager, directReportCount, isHrAdmin } = useAuth()
  const fy = currentFy()

  const { data: annual } = useAnnualSummary(employee?.id, fy)
  const { data: ranking } = useKpiRanking(employee?.id, fy)
  const { data: manager } = useMyManager(employee?.reporting_manager_id)
  const { data: assignment } = useMyAssignment(employee?.id, fy)

  if (!employee) return <PageLoader />

  const esmsWeight = Number(assignment?.assignment?.esms_weight ?? 0)
  const coreWeight = Number(
    assignment?.assignment?.core_values_weight ?? (REMAINDER_TOTAL - esmsWeight),
  )
  const band = bandFor(annual?.avg_total_score)

  // Unscored peers are worth naming rather than hiding: "3rd of 4" reads
  // as a small team until you know eleven others have not been assessed.
  const teamUnscored = (ranking?.team_size ?? 0) - (ranking?.team_of ?? 0)

  return (
    <div className="space-y-5">
      <div>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-ink-600 hover:text-ink-900"
        >
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </Link>
      </div>

      <ScoreHeader
        title={employee.full_name}
        subtitle={`${employee.ecode}${
          employee.designation ? ` · ${employee.designation}` : ''
        } · FY ${fy}`}
        score={annual?.avg_total_score}
        scoreLabel="Year average"
      />

      {/* Two across even on the narrowest phone. Stacked, these four
          tiles pushed the details card most of a screen down, and the
          two ranks are a pair — reading one without the other beside it
          loses half the point. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <RankTile
          label="Team rank"
          icon={Medal}
          rank={ranking?.team_rank}
          of={ranking?.team_of}
          // Says where the denominator came from. "2nd of 8" on a team of
          // sixteen invites the wrong conclusion unless the other eight
          // are accounted for.
          note={
            teamUnscored > 0
              ? `${ranking?.team_of} of ${ranking?.team_size} scored so far`
              : 'everyone in your team'
          }
        />
        <RankTile
          label="Cyrix rank"
          icon={Trophy}
          rank={ranking?.org_rank}
          of={ranking?.org_of}
          note="scored across Cyrix"
        />
        <StatTile
          label="Months scored"
          value={annual?.months_scored ?? 0}
          sub="of 12"
        />
        <StatTile
          label="Performance"
          value={
            band
              ? <span className={clsx('text-xl', band.accent)}>{band.label}</span>
              : <span className="text-ink-300">—</span>
          }
          sub={band ? 'on the year average' : 'not scored yet'}
        />
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-ink-200 bg-ink-50 px-4 py-2.5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-800">
            <UserRound className="h-4 w-4 text-ink-400" /> My details
          </h3>
        </div>
        <div className="divide-y divide-ink-100">
          <Row label="Employee code">{employee.ecode}</Row>
          <Row label="Designation">{employee.designation}</Row>
          <Row label="Function">{employee.function_name}</Row>
          <Row label="Department">{employee.department}</Row>
          <Row label="Grade">{employee.grade}</Row>
          {/* Location, work email and date of joining are all still on the
              employee record — they are just not shown here. None of them
              was populated by the HR import, so every one of them was a
              dash, and a list of dashes reads as a broken page rather
              than as fields nobody filled in. */}
          <Row label="Reporting manager">
            {manager ? (
              <>
                {manager.full_name}
                <span className="ml-2 text-xs text-ink-500">{manager.ecode}</span>
              </>
            ) : null}
          </Row>
          {isManager && (
            <Row label="My team">
              <Link to="/team" className="link-accent hover:underline">
                {directReportCount} direct report
                {directReportCount === 1 ? '' : 's'}
              </Link>
            </Row>
          )}
          {isHrAdmin && <Row label="Role">HR Admin</Row>}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-ink-200 bg-ink-50 px-4 py-2.5">
          <h3 className="text-sm font-semibold text-ink-800">
            How my 100% is split
          </h3>
        </div>
        <div className="divide-y divide-ink-100">
          <Row label="Job role">{JOB_ROLE_TOTAL}%</Row>
          {esmsWeight > 0 && <Row label="ESMS">{esmsWeight}%</Row>}
          <Row label="Core values">{coreWeight}%</Row>
        </div>
        <div className="border-t border-ink-100 px-4 py-3">
          <Link to="/my-kpi" className="link-accent text-sm hover:underline">
            See my KPI for the year →
          </Link>
        </div>
      </div>

      <Link
        to="/change-password"
        className="btn-secondary btn-press inline-flex"
      >
        <KeyRound className="h-4 w-4" /> Change my password
      </Link>
    </div>
  )
}
