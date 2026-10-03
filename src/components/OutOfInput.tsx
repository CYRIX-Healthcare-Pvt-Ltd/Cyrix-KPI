/**
 * A figure typed against a target, saying what it is out of — "of 100" —
 * inside the box, so the result is read in the target's terms rather than
 * the score's. Nothing when there is no target to be out of.
 */
export default function OutOfInput({ id, target, value, disabled, onChange }: {
  id: string
  target: string
  value: string
  disabled?: boolean
  onChange: (v: string) => void
}) {
  const of = target.trim() === '' ? '' : `of ${target.trim()}`
  return (
    <div className="relative">
      <input
        id={id}
        type="number" inputMode="decimal" step="any"
        className="input"
        style={of ? { paddingRight: `${1.25 + of.length * 0.5}rem` } : undefined}
        disabled={disabled}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
      {of && (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-400">
          {of}
        </span>
      )}
    </div>
  )
}

