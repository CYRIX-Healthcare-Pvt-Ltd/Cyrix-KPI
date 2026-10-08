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
