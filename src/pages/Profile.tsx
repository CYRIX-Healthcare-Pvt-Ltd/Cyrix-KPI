import { useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import {
  ArrowLeft, BookOpen, Camera, Info, KeyRound, LifeBuoy, Medal, Timer, Trophy, UserRound,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  useAnnualSummary, useKpiRanking, useMyManager, useMyAssignment,
  useSetMyAvatar, currentFy,
} from '@/lib/queries'
import { bandFor } from '@/lib/bands'
import { monthLabel } from '@/lib/fy'
import { PageLoader, StatTile, Alert, Spinner } from '@/components/ui'
import Avatar from '@/components/Avatar'
import InstallButton from '@/components/InstallButton'
import {
  fileToAvatar, humanBytes, dataUrlBytes, shouldWarnAboutFace,
} from '@/lib/avatar'
import { ScoreHeader } from '@/components/analysis'
import { JOB_ROLE_TOTAL, REMAINDER_TOTAL } from '@/lib/sections'
import type { Employee } from '@/types/db'

/**
 * Your own record: who you are, who you report to, and where you stand.
 *
 * The ranking is the reason this page exists. A score out of 100 tells
 * you how you did against your own targets and nothing about how that
 * compares, which is the next question everybody asks.
 */

/**
 * "18.1 days · 15.1 late" — how long it took, then what that cost.
 *
 * The two are one line rather than two rows because they are one fact
 * read twice: the second number is the first with the cool-off period
 * taken off. Nothing is said about lateness where the counting has not
 * started, rather than claiming zero.
 */
function tatLine(
  days: number | null | undefined,
  late: number | null | undefined,
  empty = '—',
): string {
  if (days === null || days === undefined) return empty
  const base = `${days.toFixed(1)} days`
  if (late === null || late === undefined) return base
  return late > 0 ? `${base} · ${late.toFixed(1)} late` : `${base} · on time`
}

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
  label, icon: Icon, rank, of, note, emptyNote = 'No scored month yet',
  detail, detailLead,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  rank: number | null | undefined
  of: number | null | undefined
  note?: string
  emptyNote?: string
  /** Rows of working, shown on hover or tap. */
  detail?: Array<[string, string]>
  /** One sentence above them, saying what the rank is measuring. */
  detailLead?: string
}) {
  // Tapped open on touch, where there is no hover at all. The same state
  // also serves the keyboard, via focus-within on the button.
  const [open, setOpen] = useState(false)

  return (
    <div
      className={clsx('card group relative flex flex-col p-4', detail && 'cursor-help')}
      onClick={detail ? () => setOpen(v => !v) : undefined}
    >
      <p className="label !mb-0 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-ink-400" />
        {label}
        {detail && (
          <Info className="ml-auto h-3.5 w-3.5 shrink-0 text-ink-300" aria-hidden />
        )}
      </p>
      {rank == null || of == null ? (
        <>
          <p className="mt-2 text-2xl font-semibold text-ink-300">—</p>
          <p className="mt-0.5 min-h-4 text-xs text-ink-400">{emptyNote}</p>
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

      {/*
        The working, on hover — and on tap, because a phone has no hover
        and a hover-only explanation is one that does not exist there.

        Hung below the tile and pinned to its own width, so it lands where
        the eye already is instead of drifting across the row. Ignores the
        pointer entirely: it is something to read, not to aim at, and a
        panel that swallows clicks over the tile that opened it is a panel
        you cannot close.
      */}
      {detail && (
        <div
          className={clsx(
            'pointer-events-none absolute left-0 right-0 top-full z-20 mt-1.5',
            'origin-top rounded-lg border border-ink-200 bg-surface p-3 shadow-lg',
            'transition-opacity duration-150 ease-out',
            open
              ? 'opacity-100'
              : 'opacity-0 [@media(hover:hover)]:group-hover:opacity-100',
          )}
          role="note"
        >
          {detailLead && (
            <p className="mb-2 border-b border-ink-100 pb-2 text-[11px] leading-snug text-ink-600">
              {detailLead}
            </p>
          )}
          {/* Stacked on a phone. The tile is 166px there, and a label
              opposite its value in that width breaks "7 days from their
              submission" across three lines with the label wrapping into
              it. Label above value costs a line and reads. */}
          <dl className="space-y-2 sm:space-y-1.5">
            {detail.map(([k, v]) => (
              <div
                key={k}
                className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
              >
                <dt className="text-[11px] leading-tight text-ink-500">{k}</dt>
                <dd className="text-[11px] font-medium leading-tight tabular-nums text-ink-900 sm:shrink-0">
                  {v}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  )
}

/**
 * Your photo.
 *
 * Everything is done in the browser before anything is sent: squared
 * off, scaled to 128px and saved as a middling JPEG, which turns a 2 MB
 * phone picture into about 5 KB. That is small enough to sit on the
 * employee row and arrive with every list that already reads it, which
 * is why there is no upload progress bar here — there is nothing to wait
 * for.
 *
 * The only check is whether the browser can see a face, and it never
 * refuses — no detector finds every face, and most browsers cannot even
 * look. Whether it is a suitable picture of you is your reporting
 * manager's call, and they can take it down with a reason, which you
 * will see here.
 */
function AvatarCard({ employee }: { employee: Employee }) {
  // AuthContext holds the employee row in plain state rather than in the
  // query cache, so invalidating queries is not enough — the header and
  // this card both read it from there and would keep the old face.
  const { refresh } = useAuth()
  const setAvatar = useSetMyAvatar()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  /** Held back when no face was found, so it can be confirmed or dropped. */
  const [pending, setPending] = useState<
    { dataUrl: string; originalBytes: number } | null
  >(null)

  const save = async (dataUrl: string, originalBytes: number) => {
    await setAvatar.mutateAsync(dataUrl)
    await refresh()
    setPending(null)
    setNote(
      `Saved — ${humanBytes(originalBytes)} compressed to ` +
      `${humanBytes(dataUrlBytes(dataUrl))}.`,
    )
  }

  const pick = async (file: File | undefined) => {
    if (!file) return
    setError(null); setNote(null); setPending(null); setBusy(true)
    try {
      const { dataUrl, face, originalBytes } = await fileToAvatar(file)
      // A warning, never a refusal. No detector finds every face, and
      // most browsers here cannot even look — so the picture is held for
      // one confirmation rather than rejected.
      if (shouldWarnAboutFace(face)) setPending({ dataUrl, originalBytes })
      else await save(dataUrl, originalBytes)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not use that picture.')
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    setError(null); setNote(null); setBusy(true)
    try {
      await setAvatar.mutateAsync(null)
      await refresh()
      setNote('Photo removed.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove it.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={employee.full_name} src={employee.avatar} size="xl" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink-900">My photo</p>
          <p className="mt-0.5 text-sm text-ink-500">
            A clear picture of your face. It is shrunk on your phone before
            it is sent, so it stays small.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="btn-secondary btn-press cursor-pointer">
              {busy ? <Spinner className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
              {employee.avatar ? 'Change photo' : 'Add a photo'}
              <input
                type="file"
                className="hidden"
                accept="image/*"
                disabled={busy}
                onChange={e => { pick(e.target.files?.[0]); e.target.value = '' }}
              />
            </label>
            {employee.avatar && (
              <button onClick={clear} disabled={busy} className="btn-secondary">
                Remove
              </button>
            )}
          </div>
        </div>
      </div>

      {pending && (
        <div className="mt-3 flex flex-wrap items-center gap-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <img
            src={pending.dataUrl}
            alt="The picture you picked"
            className="h-16 w-16 shrink-0 rounded-full object-cover"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-amber-900">
              We could not see a face in that picture
            </p>
            <p className="mt-0.5 text-sm text-amber-800">
              Use a clear photo of yourself. If you are sure this one is
              right, carry on — your manager sees it either way.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button
                onClick={() => save(pending.dataUrl, pending.originalBytes)}
                disabled={busy || setAvatar.isPending}
                className="btn-secondary"
              >
                Use it anyway
              </button>
              <button onClick={() => setPending(null)} className="btn-secondary">
                Pick another
              </button>
            </div>
          </div>
        </div>
      )}

      {employee.avatar_removed_reason && (
        <div className="mt-3">
          <Alert kind="warning" title="Your manager removed your photo">
            <p className="italic">“{employee.avatar_removed_reason}”</p>
            <p className="mt-1">Add another one whenever you are ready.</p>
          </Alert>
        </div>
      )}
      {error && <div className="mt-3"><Alert kind="error">{error}</Alert></div>}
      {note && <div className="mt-3"><Alert kind="success">{note}</Alert></div>}
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

  /*
    Why a position is what it is, in the words somebody being ranked
    would use.

    Ranking stopped running on the raw percentage in migration 0096.
    Without the 120% ceiling one tripled target could carry a year, so
    both positions now come off the 1–5 slab, where 190% and 95% are
    equally a 5. That is a real change in how somebody is placed against
    their colleagues, and it should be legible from the tile rather than
    only from a migration nobody outside this repository will read.
  */
  const BAND_RANK_RULE =
    'Ranked on your 1–5 bands rather than the raw percentage, so one '
    + 'exceptional row cannot carry a year. Your job role band counts for '
    + 'six tenths and core values for four. Where two people come out '
    + 'level, the higher job role band goes first.'

  const bandRows: Array<[string, string]> = [
    ['Job role band',
      ranking?.job_band != null ? `${ranking.job_band} of 5` : '—'],
    ['Core values band',
      ranking?.core_band != null ? `${ranking.core_band} of 5` : '—'],
    // The figure actually sorted on, so the two lines above visibly add
    // up to it and the rule is checkable rather than merely stated.
    ['Ranked on',
      ranking?.rank_value != null ? Number(ranking.rank_value).toFixed(2) : '—'],
  ]

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

      {/* Two across even on the narrowest phone. Stacked, these tiles
          pushed the details card most of a screen down, and the ranks are
          a set — reading one without the others beside it loses half the
          point. */}
      <div className={clsx(
        'grid-fill grid grid-cols-2 gap-3',
        isManager ? 'lg:grid-cols-5' : 'lg:grid-cols-4',
      )}>
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
          detailLead={BAND_RANK_RULE}
          detail={bandRows}
        />
        <RankTile
          label="Cyrix rank"
          icon={Trophy}
          rank={ranking?.org_rank}
          of={ranking?.org_of}
          note="scored across Cyrix"
          detailLead={BAND_RANK_RULE}
          detail={bandRows}
        />
        {/*
          Managers only. Everyone is ranked on their own score; only a
          manager is also holding other people's months open, and this is
          the number that says by how long.

          "Team TAT" rather than plain "Turnaround", and the caption
          names the field: the tile appears for managers and nobody else,
          which the manager seeing it has no way to know. Saying "among
          managers" is what turns "1st of 1" from a puzzle into a fact.
        */}
        {isManager && (
          <RankTile
            label="Team scoring rank"
            icon={Timer}
            rank={ranking?.mgr_rank}
            of={ranking?.mgr_of}
            note={
              ranking?.completion_pct == null
                ? 'among managers'
                : `${ranking.completion_pct}% done · among managers`
            }
            emptyNote="Nothing owed yet"
            // Plain words. An earlier draft said "submissions answerable"
            // and "turned around in time", which is precise and means
            // nothing to the person being measured by it.
            /*
              The rule this position was actually computed from.

              It said "ranked on how much of your team's work is scored,
              then on how long what is left has been waiting", which
              described the old sort and is simply no longer true. A
              caption that explains a number by the wrong rule is worse
              than none: it is checkable, and it fails the check.
            */
            detailLead={
              'Mostly your team’s own standing — seven tenths of it. '
              + 'The rest is turnaround: two tenths how quickly you score '
              + 'what arrives, one tenth how promptly your team sends it. '
              + 'The whole figure is then scaled by how much of the year '
              + 'you have actually scored, so being quick on a little '
              + 'counts for little.'
            }
            detail={[
              ['Months your team owes',
                ranking?.due_months != null ? String(ranking.due_months) : '—'],
              ['You have scored',
                ranking?.scored_months != null ? String(ranking.scored_months) : '—'],
              // Two clocks, kept apart. Blended into one they produced
              // 49.3 days for a manager who actually scores in under
              // three — true, and unreadable as either fact.
              // Their half of the wait. A manager can be quick and still
              // be carrying a team that sends everything in weeks late,
              // and only this line would say so.
              ['Team submits in',
                tatLine(ranking?.submit_tat, ranking?.submit_delay)],
              ['Completion TAT',
                tatLine(ranking?.completion_tat, ranking?.completion_delay)],
              ['Pending TAT',
                tatLine(ranking?.pending_tat, ranking?.pending_delay,
                        'nothing waiting')],
              // The rule those "late" figures were measured against. A
              // number that says someone is late without saying late
              // against what is an accusation, not a metric.
              ['Allowance',
                `${ranking?.tm_grace_days ?? 3} days to submit · ` +
                `${ranking?.mgr_grace_days ?? 5} to score`],
              ...(ranking?.tat_starts_from
                ? [['Counted from',
                    monthLabel(ranking.tat_starts_from)] as [string, string]]
                : []),
            ]}
          />
        )}
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

      <AvatarCard employee={employee} />

      {/* Beside the password, because this is where somebody comes when
          the question is about themselves rather than about a number. */}
      <div className="flex flex-wrap gap-2">
        <Link
          to="/help"
          className="btn-secondary btn-press inline-flex"
        >
          <BookOpen className="h-4 w-4" /> What I can do
        </Link>
        <Link
          to="/change-password"
          className="btn-secondary btn-press inline-flex"
        >
          <KeyRound className="h-4 w-4" /> Change my password
        </Link>
        {/* Beside the manual on purpose. That one answers what the app
            does; this one is where you go when the answer is not in it,
            and the two questions arrive together. */}
        <Link
          to="/support"
          className="btn-secondary btn-press inline-flex"
        >
          <LifeBuoy className="h-4 w-4" /> Contact support
        </Link>
        {/* Renders nothing where it is already installed, or where the
            browser cannot install at all. */}
        <InstallButton />
      </div>
    </div>
  )
}
