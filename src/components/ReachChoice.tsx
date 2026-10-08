import clsx from 'clsx'
import type { TemplateReach } from '@/lib/queries'

/**
 * How far back a change reaches.
 *
 * The same three choices wherever a KPI change meets a month — a template
 * and, from SW Admin, one person's KPI (0146) — because it
 * is the same question: assigning one to somebody who already has a KPI
 * and editing one twenty-three people carry differ only in how many
 * people are on the other end.
 *
 * Radio buttons rather than a dropdown. Two of the three rewrite a month
 * somebody has already been scored on, and a choice with that in it
 * should be read rather than opened.
 */
const REACH: Array<{ key: TemplateReach; label: string; what: string }> = [
  {
    key: 'forward',
    label: 'From now on',
    what: 'Months not filed in yet take the new rows. Anything submitted, '
      + 'scored or finalised keeps exactly what it was assessed on.',
  },
  {
    key: 'keep',
    label: 'All months, keep the figures',
    what: 'Every month takes the new rows. What people typed stays wherever '
      + 'the KRA is still there, and the scores are worked out again.',
  },
  {
    key: 'clean',
    label: 'All months, start clean',
    what: 'Every month takes the new rows with nothing filled in. Use this '
      + 'when the KPI was wrong from April and the figures against it were '
      + 'measuring the wrong thing.',
  },
]

export default function ReachChoice({
  value, onChange, name,
}: {
  value: TemplateReach
  onChange: (v: TemplateReach) => void
  /** Unique per instance, or two panels share one radio group. */
  name: string
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="label !mb-1">How far back</legend>
      {REACH.map(r => (
        <label
          key={r.key}
          className={clsx(
            'flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5',
            value === r.key
              ? 'border-violet-300 bg-violet-50/60'
              : 'border-ink-200 hover:bg-ink-50',
          )}
        >
          <input
            type="radio"
            name={name}
            checked={value === r.key}
            onChange={() => onChange(r.key)}
            className="mt-0.5 shrink-0"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink-900">{r.label}</span>
            <span className="mt-0.5 block text-xs leading-snug text-ink-500">{r.what}</span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}

/**
 * Asked once more before a change is applied (the user, 8 Oct: "a warning
 * pop up … briefly explain what it will happen in simpler English").
 * Plain lines for the choice that is ticked, then Yes or Go back.
 */
const WARN: Record<TemplateReach, { title: string; lines: string[] }> = {
  forward: {
    title: 'Change from now on?',
    lines: [
      'Months not filed yet get the new KPI.',
      'Months already submitted, scored or finalised stay as they are.',
    ],
  },
  keep: {
    title: 'Change every month and keep the figures?',
    lines: [
      'Every month this year gets the new KPI, including ones already scored.',
      'Figures already typed stay where the same KRA is still there.',
      'Scores are worked out again, so they may go up or down.',
    ],
  },
  clean: {
    title: 'Change every month and start clean?',
    lines: [
      'Every month this year gets the new KPI, including ones already scored.',
      'All figures typed so far are cleared and must be filled in again.',
      'Scores for those months are lost. This cannot be undone.',
    ],
  },
}

export function ReachConfirm({
  reach, who, busy, onConfirm, onCancel,
}: {
  reach: TemplateReach
  /** e.g. "254 people" or "Kevin's KPI" — who it lands on. */
  who?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const w = WARN[reach]
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-shade/60 p-0 sm:items-center sm:p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="reach-confirm-title"
      onClick={e => { if (e.target === e.currentTarget && !busy) onCancel() }}
    >
      <div className="animate-pop-in max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl">
        <h2 id="reach-confirm-title" className="text-base font-semibold text-ink-900">{w.title}</h2>
        {who && <p className="mt-0.5 text-sm text-ink-500">This applies to {who}.</p>}
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-ink-800">
          {w.lines.map(l => <li key={l}>{l}</li>)}
        </ul>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            onClick={onConfirm}
            disabled={busy}
            className={clsx('btn-primary', reach === 'clean' && '!bg-cyrixRed-600 hover:!bg-cyrixRed-700')}
            autoFocus
          >
            Yes, apply
          </button>
          <button onClick={onCancel} disabled={busy} className="btn-secondary">Go back</button>
        </div>
      </div>
    </div>
  )
}
