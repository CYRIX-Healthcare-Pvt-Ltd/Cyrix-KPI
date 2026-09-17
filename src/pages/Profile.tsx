import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, BookOpen, Camera, KeyRound, LifeBuoy, Medal, Plus, Trash2, UserRound, X,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  useAnnualSummary, useKpiRanking, useMyManager, useMyAssignment,
  useSetMyAvatar, useSetMyWorkEmail, useSetMyOfficialPhone, useHrNotifyCc, useSaveHrNotifyCc, currentFy,
} from '@/lib/queries'
import { emailFeedback, OFFICIAL_DOMAIN } from '@/lib/officialEmail'

import { PageLoader, Alert, Spinner } from '@/components/ui'
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

/** 1 → 1st, 2 → 2nd, 23 → 23rd. */
function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
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
/**
 * The official address for the two shared admin logins.
 *
 * HR_ADMIN and SW_ADMIN are logins rather than people, so the HR import
 * never gave either one an address and nothing in the app could add one.
 * That field is what decides whether changing a password needs an
 * emailed code — so the two accounts that can do the most were the two
 * with no second step, and no way to ask for one.
 *
 * Only these two see this. For everybody else the address is a fact HR
 * maintains on the record, and self-service would turn the field that
 * governs password recovery into one anybody with a borrowed session
 * could point somewhere else. The server enforces the same two rules
 * (migration 0105); this is here so the person typing finds out now.
 */
function WorkEmailCard({ employee }: { employee: Employee }) {
  const saved = (employee.work_email ?? '').trim()
  const [email, setEmail] = useState(saved)
  const [touched, setTouched] = useState(false)
  const [done, setDone] = useState(false)
  const setWorkEmail = useSetMyWorkEmail()
  // AuthContext keeps the employee row in plain state, not in the query
  // cache, so invalidating is not enough — this card and ChangePassword
  // both read work_email from there and would keep the old one.
  const { refresh } = useAuth()

  const problem = emailFeedback(email, touched)
  const changed = email.trim().toLowerCase() !== saved.toLowerCase()
  const blocked = !!problem || !changed || setWorkEmail.isPending

  const save = async () => {
    setDone(false)
    try {
      await setWorkEmail.mutateAsync(email)
      await refresh()
      setDone(true)
    } catch { /* shown from the mutation below */ }
  }

  return (
    <div className="card p-4">
      <p className="text-sm font-medium text-ink-900">My official email</p>
      <p className="mt-0.5 text-sm text-ink-500">
        Where a code is sent when you change your password. Without one,
        this account changes its password with no second step.
      </p>

      <div className="mt-3 flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <input
            type="email"
            className="input w-full"
            placeholder={`name@${OFFICIAL_DOMAIN}`}
            value={email}
            onChange={e => { setEmail(e.target.value); setDone(false) }}
            onBlur={() => setTouched(true)}
            disabled={setWorkEmail.isPending}
          />
          {problem && <p className="mt-1 text-xs text-cyrixRed-700">{problem}</p>}
        </div>
        <button onClick={save} disabled={blocked} className="btn-primary">
          {setWorkEmail.isPending ? <Spinner className="h-4 w-4" /> : null}
          Save
        </button>
      </div>

      {setWorkEmail.error && (
        <div className="mt-3">
          <Alert kind="error">{setWorkEmail.error.message}</Alert>
        </div>
      )}
      {done && !changed && (
        <div className="mt-3">
          <Alert kind="success">
            {saved ? `Codes will go to ${saved}.` : 'Address removed.'}
          </Alert>
        </div>
      )}
    </div>
  )
}

/**
 * Who else is copied on the notifications HR Admin receives.
 *
 * Beside the address they receive them AT, because the two are one
 * subject: "where does this reach me, and who else sees it". It sat on
 * the organisation overview, which is a screen of charts about other
 * people, and settings about your own mail do not belong among them.
 *
 * A list you add to and remove from, rather than a box of lines. The box
 * worked and answered nothing when somebody wanted a second address —
 * an empty textarea with a placeholder does not tell you it will take
 * more than one, and the way to find out was to guess.
 */
function NotifyCcCard() {
  const { data: cc } = useHrNotifyCc()
  const save = useSaveHrNotifyCc()
  const [draft, setDraft] = useState('')
  const [touched, setTouched] = useState(false)

  const list = cc ?? []
  const next = draft.trim().toLowerCase()
  const problem = emailFeedback(draft, touched)
  const duplicate = next !== '' && list.some(a => a.toLowerCase() === next)
  const canAdd = next !== '' && !problem && !duplicate && !save.isPending

  const add = async () => {
    if (!canAdd) return
    try { await save.mutateAsync([...list, next]); setDraft(''); setTouched(false) }
    catch { /* shown below */ }
  }
  const remove = (who: string) => save.mutate(list.filter(a => a !== who))

  return (
    <div className="card p-4">
      <p className="text-sm font-medium text-ink-900">Who else is copied</p>
      <p className="mt-0.5 text-sm text-ink-500">
        Support questions, leavers, records and KPI revisions are emailed to you
        as they arrive. Anyone here is copied on all of them. Up to ten official
        @{OFFICIAL_DOMAIN} addresses.
      </p>

      {list.length > 0 && (
        <ul className="mt-3 divide-y divide-ink-100 rounded-lg border border-ink-200">
          {list.map(who => (
            <li key={who} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm text-ink-800">{who}</span>
              <button
                onClick={() => remove(who)}
                disabled={save.isPending}
                aria-label={`Stop copying ${who}`}
                className="btn-icon"
              >
                <X className="h-4 w-4 text-ink-400" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {list.length < 10 && (
        <div className="mt-3 flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <input
              type="email"
              className="input w-full"
              placeholder={`colleague@${OFFICIAL_DOMAIN}`}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={() => setTouched(true)}
              // Enter is what a hand does after typing an address.
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void add() } }}
              disabled={save.isPending}
            />
            {problem && <p className="mt-1 text-xs text-cyrixRed-700">{problem}</p>}
            {!problem && duplicate && (
              <p className="mt-1 text-xs text-ink-500">Already on the list.</p>
            )}
          </div>
          <button onClick={add} disabled={!canAdd} className="btn-secondary">
            {save.isPending ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            Add
          </button>
        </div>
      )}

      <p className="mt-2 text-xs text-ink-400">
        {list.length === 0
          ? 'Nobody else is copied — these come to you alone.'
          : `${list.length} of 10 copied.`}
      </p>

      {save.error && (
        <div className="mt-3"><Alert kind="error">{save.error.message}</Alert></div>
      )}
    </div>
  )
}

/**
 * The one line of My details a person edits themselves.
 *
 * Revive Lab's route card starts its contact number from it, so it is worth
 * keeping current — and a row that reads as a value until you press Edit,
 * rather than a form sitting open in the middle of a list of facts.
 */
function OfficialNumberRow({ current }: { current: string | null | undefined }) {
  const { refresh } = useAuth()
  const save = useSetMyOfficialPhone()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(current ?? '')
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      await save.mutateAsync(value)
      await refresh()
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that number.')
    }
  }

  return (
    <Row label="Official number">
      {editing ? (
        <form onSubmit={submit} className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input !py-1.5 w-48"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder="+91 98470 12345"
              autoFocus
            />
            <button type="submit" className="btn-primary !py-1.5" disabled={save.isPending}>
              {save.isPending && <Spinner className="h-4 w-4" />} Save
            </button>
            <button
              type="button"
              className="btn-secondary !py-1.5"
              onClick={() => { setEditing(false); setValue(current ?? ''); setError(null) }}
            >
              Cancel
            </button>
          </div>
          {error && <p className="text-xs text-cyrixRed-700">{error}</p>}
        </form>
      ) : (
        <span className="inline-flex flex-wrap items-center gap-3">
          {current
            ? <span className="tabular-nums">{current}</span>
            : <span className="text-ink-400">Not added yet</span>}
          <button
            type="button"
            className="text-xs font-medium text-ink-500 underline-offset-2 hover:text-ink-900 hover:underline"
            onClick={() => { setValue(current ?? ''); setEditing(true) }}
          >
            {current ? 'Edit' : 'Add'}
          </button>
        </span>
      )}
    </Row>
  )
}

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
  const { employee, isManager, directReportCount, isHrAdmin, isSwAdmin } = useAuth()
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

      {/*
        The rank sits with the name, not in a tile below it.

        One position, next to the score it comes from, counted against
        the whole team rather than the part of it scored so far: "2nd of
        17" is the team, and 15 of them having been scored is a fact
        about the month, not about where somebody stands.
      */}
      <ScoreHeader
        title={employee.full_name}
        subtitle={`${employee.ecode}${
          employee.designation ? ` · ${employee.designation}` : ''
        } · FY ${fy}`}
        score={annual?.avg_total_score}
        scoreLabel="Year average"
      >
        {ranking?.team_rank != null && ranking?.team_size ? (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <Medal className="h-4 w-4 self-center text-white/40" />
            <span className="text-[11px] font-semibold uppercase tracking-label text-white/40">
              Team rank
            </span>
            <span className="text-lg font-semibold text-white">
              {ordinal(ranking.team_rank)}
            </span>
            <span className="text-sm text-white/50">of {ranking.team_size}</span>
          </div>
        ) : (
          <p className="text-sm text-white/50">
            No scored month yet, so there is no team rank.
          </p>
        )}
      </ScoreHeader>

      <div className="card overflow-hidden">
        <div className="border-b border-ink-200 bg-ink-50 px-4 py-2.5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-800">
            <UserRound className="h-4 w-4 text-ink-400" /> My details
          </h3>
        </div>
        <div className="divide-y divide-ink-100">
          <Row label="Employee code">{employee.ecode}</Row>
          {/* Set by HR and SW admin, not here: it is where password codes
              are sent. Shown so everybody can see which address that is. */}
          <Row label="Mail ID">{employee.work_email}</Row>
          <OfficialNumberRow current={employee.official_phone} />
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
          <Row label="Months scored">
            {annual?.months_scored ?? 0}
            <span className="ml-2 text-xs text-ink-500">of 12</span>
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

      {/* The two shared logins only. See WorkEmailCard. */}
      {(isHrAdmin || isSwAdmin) && <WorkEmailCard employee={employee} />}
      {/* HR Admin only: the CC list is theirs, and the RPC enforces it. */}
      {isHrAdmin && <NotifyCcCard />}

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
        {/* The way into Records the rest of the time. Its tab is a queue
            and only shows while a request is waiting for a decision, so
            without this a manager had no way back to what was decided or
            to what they asked for. Not HR: Records sits in their own bar. */}
        {isManager && !isHrAdmin && (
          <Link
            to="/deletions"
            className="btn-secondary btn-press inline-flex"
          >
            <Trash2 className="h-4 w-4" /> Records
          </Link>
        )}
        {/* Renders nothing where it is already installed, or where the
            browser cannot install at all. */}
        <InstallButton />
      </div>
    </div>
  )
}
