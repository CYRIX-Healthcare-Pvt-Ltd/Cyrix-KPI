import clsx from 'clsx'
import { RATING_SCALE, averageCoreValueRatings } from '@/lib/scoring'
import type { CorePartRating } from '@/types/db'

/*
  A core value rated in parts (0225; Ajith sir, through the user, 28 Oct): each part rated on the same five words
  as the core value was, and the core value's score is the average of its parts' points.
*/

export type PartDraft = { rating: string; goal: string }

/** The core value's 0-100 from the parts rated so far; null while none is. */
export const partsAverage = (labels: Array<string | null | undefined>) => averageCoreValueRatings(labels.map(l => l || null))

const shown = (n: number | null) => (n === null ? '—' : String(Math.round(n * 100) / 100))

function Average({ value, aside }: { value: number | null; aside?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
      <span className="text-ink-500">Average{aside && <span className="ml-2 text-xs">{aside}</span>}</span>
      <span className="font-semibold tabular-nums text-ink-900">{shown(value)}<span className="font-normal text-ink-400"> / 100</span></span>
    </div>
  )
}

/** The team member rates each part, and writes each learning goal. */
export function SelfParts({ parts, draft, onChange, editable, name }: {
  parts: CorePartRating[]
  draft: (p: CorePartRating) => PartDraft
  onChange: (p: CorePartRating, next: PartDraft) => void
  editable: boolean
  name: string
}) {
  return (
    <div className="mt-3 divide-y divide-ink-100 rounded-lg border border-ink-200">
      {parts.map(p => {
        const v = draft(p)
        return (
          <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
            {p.is_goal ? (
              <input className={clsx('input min-w-[10rem] flex-1 text-sm', editable && !v.goal.trim() && 'border-amber-400')}
                aria-label={`${p.label} for ${name}`} disabled={!editable} value={v.goal} placeholder={p.label}
                onChange={e => onChange(p, { ...v, goal: e.target.value })} />
            ) : (
              <span className="min-w-[10rem] flex-1 text-sm text-ink-800">{p.label}</span>
            )}
            <select className={clsx('input w-full sm:w-44', editable && !v.rating && 'border-amber-400')}
              aria-label={`Your rating for ${p.is_goal ? v.goal || p.label : p.label}`}
              disabled={!editable} value={v.rating} onChange={e => onChange(p, { ...v, rating: e.target.value })}>
              <option value="">Your rating…</option>
              {RATING_SCALE.map(r => <option key={r.label} value={r.label}>{r.label}</option>)}
            </select>
          </div>
        )
      })}
      <Average value={partsAverage(parts.map(p => draft(p).rating))} />
    </div>
  )
}

/** The manager rates each part, seeing what the team member gave it. */
export function ManagerParts({ parts, rating, onChange, editable, firstName }: {
  parts: CorePartRating[]
  rating: (p: CorePartRating) => string
  onChange: (p: CorePartRating, label: string) => void
  editable: boolean
  firstName: string
}) {
  return (
    <div className="mt-3 divide-y divide-ink-100 rounded-lg border border-ink-200">
      {parts.map(p => (
        <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
          <div className="min-w-[10rem] flex-1">
            <p className="text-sm text-ink-800">{p.is_goal ? p.goal || p.label : p.label}</p>
            {p.is_goal && p.goal && <p className="text-xs text-ink-400">{p.label}</p>}
            <p className="text-xs text-ink-500">{firstName}: {p.self_rating ?? 'Not rated'}</p>
          </div>
          <select className={clsx('input w-full sm:w-44', editable && !rating(p) && 'border-amber-400 ring-1 ring-amber-300')}
            aria-label={`Your rating for ${p.is_goal ? p.goal || p.label : p.label}`}
            disabled={!editable} value={rating(p)} onChange={e => onChange(p, e.target.value)}>
            <option value="">Choose a rating…</option>
            {RATING_SCALE.map(r => <option key={r.label} value={r.label}>{r.label} ({r.points})</option>)}
          </select>
        </div>
      ))}
      <Average value={partsAverage(parts.map(p => rating(p)))} aside={`${firstName} ${shown(partsAverage(parts.map(p => p.self_rating)))}`} />
    </div>
  )
}

/** Both ratings of each part, read back once the month is scored or sent. */
export function PartsTable({ parts, self, manager = true }: { parts: CorePartRating[]; self: string; manager?: boolean }) {
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-ink-200 text-sm">
      <div className={clsx('grid gap-x-3 bg-ink-50 px-3 py-1.5 text-xs font-medium text-ink-500', manager ? 'grid-cols-[1fr_5.5rem_5.5rem]' : 'grid-cols-[1fr_5.5rem]')}>
        <span>Part</span><span>{self}</span>{manager && <span>Manager</span>}
      </div>
      {parts.map(p => (
        <div key={p.id} className={clsx('grid gap-x-3 border-t border-ink-100 px-3 py-1.5', manager ? 'grid-cols-[1fr_5.5rem_5.5rem]' : 'grid-cols-[1fr_5.5rem]')}>
          <span className="min-w-0 break-words text-ink-800">
            {p.is_goal ? p.goal || p.label : p.label}
            {p.is_goal && p.goal && <span className="block text-xs text-ink-400">{p.label}</span>}
          </span>
          <span className="text-ink-700">{p.self_rating ?? '—'}</span>
          {manager && <span className="text-ink-700">{p.manager_rating ?? '—'}</span>}
        </div>
      ))}
      <div className={clsx('grid gap-x-3 border-t border-ink-200 bg-ink-50/60 px-3 py-1.5 font-medium', manager ? 'grid-cols-[1fr_5.5rem_5.5rem]' : 'grid-cols-[1fr_5.5rem]')}>
        <span className="text-ink-500">Average</span>
        <span className="tabular-nums text-ink-900">{shown(partsAverage(parts.map(p => p.self_rating)))}</span>
        {manager && <span className="tabular-nums text-ink-900">{shown(partsAverage(parts.map(p => p.manager_rating)))}</span>}
      </div>
    </div>
  )
}
