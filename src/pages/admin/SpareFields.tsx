import { useState, useMemo } from 'react'
import clsx from 'clsx'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, ChevronUp, ChevronDown, Info } from 'lucide-react'
import { supabase, friendlyError } from '@/lib/supabase'
import { PageLoader, Alert, Spinner } from '@/components/ui'

/* ---------------------------------------------------------------------
 * Spare · custom fields
 *
 * The list an engineer fills in when tagging a spare. It is Spare's own
 * data and changes with the work, which is why an admin there still
 * maintains it — but it is also setup, so it is answerable from here
 * alongside everything else this screen decides.
 *
 * Written against `field_definitions` rather than ported from Spare's own
 * page. A port would have brought that module's dialogs, icons and types
 * into this one, and two copies of an editor for one table drift: the day
 * somebody adds a field type in one and not the other, a field appears
 * here that Spare cannot render.
 * ------------------------------------------------------------------- */

type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'dropdown' | 'boolean' | 'image' | 'barcode'

const TYPE_LABEL: Record<FieldType, string> = {
  text: 'Text',
  textarea: 'Long text',
  number: 'Number',
  date: 'Date',
  dropdown: 'Dropdown',
  boolean: 'Yes / No',
  image: 'Image upload',
  barcode: 'Item code / scan',
}

interface FieldRow {
  id: string
  field_key: string
  label: string
  field_type: FieldType
  options: string[]
  required: boolean
  /** Images only. Null means the app's own default applies. */
  image_max_count: number | null
  display_order: number
  active: boolean
}

/**
 * What an engineer is allowed to attach when the field is an image.
 *
 * A cap rather than no cap: these are photographed on a phone on a
 * service floor and stored per spare, so "as many as you like" is a
 * storage bill nobody chose. Null leaves it to the app's default, which
 * is what every field created before this had.
 */
const IMAGE_MAX_DEFAULT = 3

/**
 * "Serial Number" becomes `serial_number`.
 *
 * The key is what every tagged spare stores its answer under, so it is
 * derived once when the field is created and never again: renaming the
 * label later must not orphan the answers already recorded against it.
 */
const slugify = (label: string) =>
  label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

export default function SpareFields() {
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [type, setType] = useState<FieldType>('text')
  const [options, setOptions] = useState('')
  const [required, setRequired] = useState(false)
  const [imageMax, setImageMax] = useState(IMAGE_MAX_DEFAULT)
  const [confirming, setConfirming] = useState<FieldRow | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['spare_fields'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('field_definitions')
        .select('id, field_key, label, field_type, options, required, image_max_count, display_order, active')
        .order('display_order')
      if (error) throw new Error(friendlyError(error))
      return (data ?? []) as FieldRow[]
    },
  })

  const rows = useMemo(() => data ?? [], [data])

  // A single mutation for every write here: they all touch one table and
  // all end the same way, and three near-identical hooks would only be
  // three places to forget the invalidation.
  // The callback returns a PostgREST builder, which is thenable rather
  // than a real Promise — awaited here so both read the same.
  const save = useMutation({
    mutationFn: async (fn: () => PromiseLike<{ error: unknown }>) => {
      const { error } = await fn()
      if (error) throw new Error(friendlyError(error))
    },
    onSuccess: () => { setError(null); qc.invalidateQueries({ queryKey: ['spare_fields'] }) },
    onError: e => setError(e instanceof Error ? e.message : 'Could not save that.'),
  })

  const add = () => {
    const trimmed = label.trim()
    if (!trimmed) return
    const key = slugify(trimmed)
    if (!key) { setError('That label has no letters or numbers in it.'); return }
    if (rows.some(r => r.field_key === key)) {
      setError(`There is already a field keyed ${key}.`)
      return
    }
    const list = type === 'dropdown'
      ? options.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
      : []
    if (type === 'dropdown' && list.length === 0) {
      setError('A dropdown needs at least one choice.')
      return
    }
    save.mutate(() => supabase.from('field_definitions').insert({
      field_key: key,
      label: trimmed,
      field_type: type,
      options: list,
      required,
      // Only meaningful for an image field, and left null on the rest so
      // the column says "not applicable" rather than a number nothing reads.
      image_max_count: type === 'image' ? imageMax : null,
      display_order: (rows.at(-1)?.display_order ?? 0) + 1,
    }) as never)
    setLabel(''); setOptions(''); setRequired(false); setImageMax(IMAGE_MAX_DEFAULT)
  }

  /** Swaps two rows' order values, which is the whole of reordering. */
  const move = (row: FieldRow, delta: -1 | 1) => {
    const i = rows.findIndex(r => r.id === row.id)
    const other = rows[i + delta]
    if (!other) return
    save.mutate(async () => {
      const a = await supabase.from('field_definitions')
        .update({ display_order: other.display_order }).eq('id', row.id)
      if (a.error) return a
      return supabase.from('field_definitions')
        .update({ display_order: row.display_order }).eq('id', other.id)
    })
  }

  if (isLoading) return <PageLoader label="Loading the fields…" />

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-semibold text-ink-900">Custom fields</h3>
        <p className="mt-0.5 text-sm text-ink-500">
          What an engineer is asked for when tagging a spare, in this order.
        </p>
      </div>

      <div className="flex gap-3 rounded-xl border border-ink-200/70 bg-ink-50 p-4 text-sm text-ink-600">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
        <div>
          <p className="font-medium text-ink-900">Turning one off is not deleting it</p>
          <p className="mt-1">
            An inactive field stops being asked for and keeps every answer
            already recorded against it. Deleting removes the field; the
            answers stay on each spare under its key, unreadable from any
            screen. Turn it off unless you mean to lose it.
          </p>
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <div className="card space-y-3 p-4">
        <p className="text-sm font-medium text-ink-900">Add a field</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <input
            className="input"
            placeholder="Label — e.g. Serial number"
            value={label}
            onChange={e => setLabel(e.target.value)}
          />
          <select className="input sm:w-44" value={type} onChange={e => setType(e.target.value as FieldType)}>
            {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button onClick={add} disabled={save.isPending || !label.trim()} className="btn-primary">
            {save.isPending ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            Add
          </button>
        </div>
        {type === 'dropdown' && (
          <textarea
            className="input"
            rows={2}
            placeholder="The choices, one per line or separated by commas"
            value={options}
            onChange={e => setOptions(e.target.value)}
          />
        )}

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[color:var(--score-accent)]"
              checked={required}
              onChange={e => setRequired(e.target.checked)}
            />
            <span className="text-sm text-ink-700">Mandatory</span>
            <span className="text-xs text-ink-400">— a spare cannot be saved without it</span>
          </label>

          {/* Only for images, because it is the only type where "how many"
              is a question. Shown inline rather than behind a second step:
              somebody adding a photo field is deciding both at once. */}
          {type === 'image' && (
            <label className="inline-flex items-center gap-2">
              <span className="text-sm text-ink-700">Up to</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={10}
                className="input w-20"
                value={imageMax}
                onChange={e => setImageMax(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
              />
              <span className="text-sm text-ink-700">image{imageMax === 1 ? '' : 's'}</span>
            </label>
          )}
        </div>
        {label.trim() && (
          <p className="text-xs text-ink-500">
            Stored as <code className="font-mono">{slugify(label) || '—'}</code>, which is
            fixed once the field exists — renaming the label later leaves it alone, so
            answers already recorded stay findable.
          </p>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-ink-200">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-left text-xs uppercase tracking-label text-ink-400">
            <tr>
              <th className="px-3 py-2.5">Field</th>
              <th className="px-3 py-2.5">Type</th>
              {/* "Active", not "Asked for" — the first person to see the
                  latter asked what it meant, which is the whole test a
                  column header has to pass. It is also what Spare's own
                  screen calls it, so the two agree. */}
              <th className="px-3 py-2.5">Active</th>
              <th className="px-3 py-2.5">Mandatory</th>
              <th className="px-3 py-2.5 text-right">Order</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-ink-500">
                  No fields yet. A spare will be tagged with its warehouse and code alone.
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={r.id} className={clsx(!r.active && 'opacity-50')}>
                <td className="px-3 py-2.5">
                  <span className="font-medium text-ink-900">{r.label}</span>
                  <span className="ml-2 font-mono text-xs text-ink-400">{r.field_key}</span>
                </td>
                <td className="px-3 py-2.5 text-ink-600">
                  {TYPE_LABEL[r.field_type] ?? r.field_type}
                  {r.field_type === 'dropdown' && r.options?.length > 0 && (
                    <span className="ml-1 text-xs text-ink-400">({r.options.length} choices)</span>
                  )}
                  {/* The cap sits with the type because it is part of what
                      the type means here, and it is editable in place —
                      "up to 3" becoming "up to 5" is not worth a dialog. */}
                  {r.field_type === 'image' && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs text-ink-500">
                      up to
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={10}
                        aria-label={`Maximum images for ${r.label}`}
                        className="input h-7 w-14 px-1.5 py-0 text-center text-xs"
                        defaultValue={r.image_max_count ?? IMAGE_MAX_DEFAULT}
                        disabled={save.isPending}
                        onBlur={e => {
                          const next = Math.min(10, Math.max(1, Number(e.target.value) || 1))
                          e.target.value = String(next)
                          if (next === (r.image_max_count ?? IMAGE_MAX_DEFAULT)) return
                          save.mutate(() => supabase.from('field_definitions')
                            .update({ image_max_count: next }).eq('id', r.id))
                        }}
                      />
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <label
                    className="inline-flex cursor-pointer items-center gap-2"
                    title="Whether engineers are shown this field when tagging a spare"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[color:var(--score-accent)]"
                      checked={r.active}
                      disabled={save.isPending}
                      onChange={e => save.mutate(() => supabase.from('field_definitions')
                        .update({ active: e.target.checked }).eq('id', r.id))}
                    />
                    <span className="text-xs text-ink-500">{r.active ? 'Shown' : 'Hidden'}</span>
                  </label>
                </td>
                {/* Mandatory only bites while the field is shown at all,
                    so it reads as disabled on a hidden one rather than
                    claiming a rule nothing enforces. */}
                <td className="px-3 py-2.5">
                  <label
                    className={clsx(
                      'inline-flex items-center gap-2',
                      r.active ? 'cursor-pointer' : 'cursor-not-allowed opacity-50',
                    )}
                    title={r.active
                      ? 'A spare cannot be saved without an answer'
                      : 'The field is hidden, so nothing is required'}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[color:var(--score-accent)]"
                      checked={r.required}
                      disabled={save.isPending || !r.active}
                      onChange={e => save.mutate(() => supabase.from('field_definitions')
                        .update({ required: e.target.checked }).eq('id', r.id))}
                    />
                    <span className="text-xs text-ink-500">{r.required ? 'Required' : 'Optional'}</span>
                  </label>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex justify-end gap-1">
                    <button
                      onClick={() => move(r, -1)}
                      disabled={i === 0 || save.isPending}
                      className="btn-icon disabled:opacity-30"
                      aria-label={`Move ${r.label} up`}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => move(r, 1)}
                      disabled={i === rows.length - 1 || save.isPending}
                      className="btn-icon disabled:opacity-30"
                      aria-label={`Move ${r.label} down`}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <button
                    onClick={() => setConfirming(r)}
                    disabled={save.isPending}
                    className="btn-icon"
                    aria-label={`Delete ${r.label}`}
                  >
                    <Trash2 className="h-4 w-4 text-cyrixRed-600" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Typed rather than clicked. Deleting a field leaves every answer
          already given for it stranded on the spares, and a confirmation
          somebody can dismiss by reflex is not one. */}
      {confirming && (
        <DeleteField
          field={confirming}
          busy={save.isPending}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            save.mutate(() => supabase.from('field_definitions').delete().eq('id', confirming.id))
            setConfirming(null)
          }}
        />
      )}
    </div>
  )
}

function DeleteField({
  field, busy, onCancel, onConfirm,
}: {
  field: FieldRow; busy: boolean; onCancel: () => void; onConfirm: () => void
}) {
  const [typed, setTyped] = useState('')
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-shade/60 p-4">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-ink-200 bg-surface p-5 shadow-2xl">
        <div>
          <h4 className="font-semibold text-ink-900">Delete “{field.label}”?</h4>
          <p className="mt-1 text-sm text-ink-600">
            Engineers stop being asked for it. Every answer already recorded stays on
            each spare under <code className="font-mono">{field.field_key}</code> and
            becomes unreadable from any screen. Turning it off instead keeps both.
          </p>
        </div>
        <label className="block text-sm">
          <span className="text-ink-600">Type the field key to confirm</span>
          <input
            autoFocus
            className="input mt-1 font-mono"
            placeholder={field.field_key}
            value={typed}
            onChange={e => setTyped(e.target.value)}
          />
        </label>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="btn-secondary">Cancel</button>
          <button
            onClick={onConfirm}
            disabled={busy || typed.trim() !== field.field_key}
            className="btn-danger"
          >
            Delete the field
          </button>
        </div>
      </div>
    </div>
  )
}
