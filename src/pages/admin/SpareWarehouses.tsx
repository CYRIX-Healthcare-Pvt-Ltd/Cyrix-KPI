import { useState, useMemo } from 'react'
import clsx from 'clsx'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Info } from 'lucide-react'
import { supabase, friendlyError } from '@/lib/supabase'
import { PageLoader, Alert, Spinner } from '@/components/ui'

/* ---------------------------------------------------------------------
 * Spare · warehouses
 *
 * Every tagged spare names the warehouse it sits in, and it is the one
 * required field on the tag form — so a warehouse that does not exist
 * here cannot be picked there, and the form cannot be completed at all.
 *
 * Spare has its own screen for this, but it was taken out of that
 * module's navigation when its setup moved here: the route survives and
 * nothing links to it, so the only way in was to know the URL. This is
 * that screen, on the platform's own administration page next to the
 * roles and the custom fields.
 *
 * Written against `facilities` rather than ported, for the same reason
 * SpareFields was: two editors for one table drift, and the day one of
 * them learns a column the other does not, they start disagreeing about
 * what a warehouse is.
 * ------------------------------------------------------------------- */

interface WarehouseRow {
  id: string
  name: string
  city: string | null
  district: string | null
  active: boolean
  /**
   * Spares filed here, soft-deleted ones included.
   *
   * The count decides whether the row can be deleted, and the database
   * counts a soft-deleted spare exactly the same way: `equipment` still
   * holds the row, and its foreign key is ON DELETE NO ACTION. Filtering
   * them out would show a zero next to a Delete that then fails.
   */
  spares: number
}

export default function SpareWarehouses() {
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [district, setDistrict] = useState('')
  const [confirming, setConfirming] = useState<WarehouseRow | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['spare_warehouses'],
    queryFn: async () => {
      // The count comes back embedded rather than as a query per row:
      // one request that stays one request however many warehouses there
      // are, and it is aggregated in the database rather than by pulling
      // every equipment row down to tally in the browser.
      const { data, error } = await supabase
        .from('facilities')
        .select('id, name, city, district, active, equipment(count)')
        .order('name')
      if (error) throw new Error(friendlyError(error))
      return (data ?? []).map(r => {
        const { equipment, ...rest } = r as typeof r & { equipment: { count: number }[] }
        return { ...rest, spares: equipment?.[0]?.count ?? 0 } as WarehouseRow
      })
    },
  })

  const rows = useMemo(() => data ?? [], [data])

  const save = useMutation({
    mutationFn: async (fn: () => PromiseLike<{ error: unknown }>) => {
      const { error } = await fn()
      if (error) throw new Error(friendlyError(error))
    },
    onSuccess: () => { setError(null); qc.invalidateQueries({ queryKey: ['spare_warehouses'] }) },
    onError: e => setError(e instanceof Error ? e.message : 'Could not save that.'),
  })

  const add = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    if (rows.some(r => r.name.toLowerCase() === trimmed.toLowerCase())) {
      setError(`There is already a warehouse called ${trimmed}.`)
      return
    }
    save.mutate(async () => {
      // The insert policy asks that you name yourself as the creator, so
      // the row cannot be filed under anybody else. Read from the session
      // rather than from app state: it is the same value the policy
      // compares against, so the two can never disagree.
      const { data: auth } = await supabase.auth.getUser()
      const uid = auth.user?.id
      if (!uid) return { error: { message: 'Your session has expired — sign in again.' } }
      return supabase.from('facilities').insert({
        name: trimmed,
        city: city.trim() || null,
        district: district.trim() || null,
        created_by: uid,
      })
    })
    setName(''); setCity(''); setDistrict('')
  }

  /** Renames in place. Blank is refused; the picker needs something to show. */
  const rename = (row: WarehouseRow, field: 'name' | 'city' | 'district', next: string) => {
    const value = next.trim()
    if (field === 'name' && !value) { setError('A warehouse needs a name.'); return }
    const current = row[field] ?? ''
    if (value === current) return
    save.mutate(() => supabase.from('facilities')
      .update({ [field]: field === 'name' ? value : value || null }).eq('id', row.id))
  }

  if (isLoading) return <PageLoader label="Loading the warehouses…" />

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-semibold text-ink-900">Warehouses</h3>
        <p className="mt-0.5 text-sm text-ink-500">
          Where a spare sits. This is the only field the tag form insists on.
        </p>
      </div>

      <div className="flex gap-3 rounded-xl border border-ink-200/70 bg-ink-50 p-4 text-sm text-ink-600">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
        <div>
          <p className="font-medium text-ink-900">Turning one off is not deleting it</p>
          <p className="mt-1">
            An inactive warehouse stops being offered for new spares and keeps
            every spare already filed there. A warehouse that holds any spare
            cannot be deleted at all — the spares would be left pointing at
            nothing — so turning it off is how a site that has closed is
            retired.
          </p>
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <div className="card space-y-3 p-4">
        <p className="text-sm font-medium text-ink-900">Add a warehouse</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <input
            className="input"
            placeholder="Name — e.g. WH Vytilla"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add() }}
          />
          {/* Broadest to narrowest reading left to right, matching how an
              address is said aloud here: the district contains the city. */}
          <input
            className="input"
            placeholder="District — e.g. Ernakulam"
            value={district}
            onChange={e => setDistrict(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add() }}
          />
          <input
            className="input"
            placeholder="City — e.g. Vytilla"
            value={city}
            onChange={e => setCity(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add() }}
          />
          <button onClick={add} disabled={save.isPending || !name.trim()} className="btn-primary">
            {save.isPending ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            Add
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-ink-200">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-left text-xs uppercase tracking-label text-ink-400">
            <tr>
              <th className="px-3 py-2.5">Warehouse</th>
              <th className="px-3 py-2.5">District</th>
              <th className="px-3 py-2.5">City</th>
              <th className="px-3 py-2.5 text-right">Spares</th>
              <th className="px-3 py-2.5">Active</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-ink-500">
                  No warehouses yet. Until one exists, no spare can be tagged at all.
                </td>
              </tr>
            )}
            {rows.map(r => (
              <tr key={r.id} className={clsx(!r.active && 'opacity-50')}>
                {/* Edited where they are read. Renaming a warehouse is a
                    typo correction far more often than it is a decision,
                    and a dialog for it is a dialog in the way. */}
                <td className="px-3 py-2.5">
                  <input
                    aria-label={`Name of ${r.name}`}
                    className="input h-8 w-44 py-0 font-medium"
                    defaultValue={r.name}
                    disabled={save.isPending}
                    onBlur={e => rename(r, 'name', e.target.value)}
                  />
                </td>
                <td className="px-3 py-2.5">
                  <input
                    aria-label={`District of ${r.name}`}
                    className="input h-8 w-36 py-0"
                    defaultValue={r.district ?? ''}
                    disabled={save.isPending}
                    onBlur={e => rename(r, 'district', e.target.value)}
                  />
                </td>
                <td className="px-3 py-2.5">
                  <input
                    aria-label={`City of ${r.name}`}
                    className="input h-8 w-36 py-0"
                    defaultValue={r.city ?? ''}
                    disabled={save.isPending}
                    onBlur={e => rename(r, 'city', e.target.value)}
                  />
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink-600">{r.spares}</td>
                <td className="px-3 py-2.5">
                  <label
                    className="inline-flex cursor-pointer items-center gap-2"
                    title="Whether engineers can file a new spare here"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[color:var(--score-accent)]"
                      checked={r.active}
                      disabled={save.isPending}
                      /*
                       * Captured on the event, not read inside the
                       * callback. mutate() defers, and by the time it runs
                       * React has re-rendered this controlled checkbox back
                       * to r.active — so a deferred read returns the value
                       * it started with and writes what was already there.
                       */
                      onChange={e => {
                        const next = e.target.checked
                        save.mutate(() => supabase.from('facilities')
                          .update({ active: next }).eq('id', r.id))
                      }}
                    />
                    <span className="text-xs text-ink-500">{r.active ? 'Open' : 'Closed'}</span>
                  </label>
                </td>
                <td className="px-3 py-2.5 text-right">
                  {/* Disabled rather than hidden when spares are filed
                      here: the reason is the point, and a button that has
                      vanished explains nothing. */}
                  <button
                    onClick={() => r.spares > 0
                      ? setError(`${r.name} holds ${r.spares} spare${r.spares === 1 ? '' : 's'} — turn it off instead of deleting it.`)
                      : setConfirming(r)}
                    disabled={save.isPending}
                    className={clsx('btn-icon', r.spares > 0 ? 'text-ink-300' : 'text-cyrixRed-600')}
                    title={r.spares > 0
                      ? `${r.name} holds ${r.spares} spare${r.spares === 1 ? '' : 's'} and cannot be deleted`
                      : `Delete ${r.name}`}
                    aria-label={`Delete ${r.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-shade/60 p-4">
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-ink-200 bg-surface p-5 shadow-2xl">
            <div>
              <h4 className="font-semibold text-ink-900">Delete “{confirming.name}”?</h4>
              <p className="mt-1 text-sm text-ink-600">
                No spare is filed here, so nothing is left behind. Anyone who
                was given access to this warehouse alone loses it. Turning it
                off instead keeps it on record.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirming(null)} className="btn-secondary">Cancel</button>
              <button
                onClick={() => {
                  save.mutate(() => supabase.from('facilities').delete().eq('id', confirming.id))
                  setConfirming(null)
                }}
                disabled={save.isPending}
                className="btn-danger"
              >
                Delete the warehouse
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
