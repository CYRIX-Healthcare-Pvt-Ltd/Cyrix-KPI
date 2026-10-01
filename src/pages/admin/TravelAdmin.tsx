/**
 * Travel Expense — the software administrator's settings for the module,
 * shown as SW Admin's "Travel Expense" tab (the user, 1 Oct: "add in sw admin
 * also, ie image optional toggle, then each mode per km or actual fare, then
 * delete claim, type claim number").
 *
 * Three things, each also reachable inside the module itself:
 *   - whether photographs are required to close a stop or end a fare-paid leg;
 *   - what each mode pays: a rate by the kilometre, or the actual fare;
 *   - deleting a claim, found by its number.
 *
 * The database decides who may do each (travel_set_photos_required,
 * travel_set_rate, travel_delete — all the software administrator's); this
 * screen only asks. It depends on nothing but the Supabase client and the ui
 * pieces every module has.
 */
import { useState } from 'react'
import clsx from 'clsx'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, IndianRupee, Trash2 } from 'lucide-react'
import { supabase, friendlyError } from '@/lib/supabase'
import { Alert, PageLoader, Spinner } from '@/components/ui'

interface Mode { mode: string; label: string; per_km: number | null; sort_order: number; is_active: boolean }

const rupees = (n: number | null | undefined) =>
  `₹${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`

async function call(name: string, args: Record<string, unknown>) {
  const { error } = await supabase.rpc(name, args)
  if (error) throw new Error(friendlyError(error))
}

export function TravelAdmin() {
  return (
    <div className="space-y-5">
      <div>
        {/* h2, not h1: the tab shell above owns the page heading. */}
        <h2 className="text-lg font-semibold text-ink-900">Travel Expense</h2>
        <p className="mt-0.5 text-sm text-ink-500">What a trip needs and what it pays. Who has the module is on the Logins tab, with every other module.</p>
      </div>
      <Photographs />
      <Modes />
      <DeleteClaim />
    </div>
  )
}

/** Whether a stop needs its proof and a fare-paid leg its bill. Off is for trying the module where there is no camera. */
function Photographs() {
  const qc = useQueryClient()
  const { data: required, isLoading } = useQuery({
    queryKey: ['travel-admin', 'photos-required'],
    queryFn: async () => {
      const { data, error } = await supabase.from('travel_settings').select('value').eq('key', 'photos_required').maybeSingle()
      if (error) throw new Error(friendlyError(error))
      // Required unless the setting says otherwise.
      return data ? data.value !== false : true
    },
  })
  const set = useMutation({
    mutationFn: (on: boolean) => call('travel_set_photos_required', { p_on: on }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['travel-admin'] }),
  })

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
        <Camera className="h-4 w-4 text-indigo-500" />
        <h3 className="text-sm font-semibold text-ink-800">Photographs</h3>
      </div>
      <div className="space-y-3 p-4">
        {isLoading ? <Spinner className="h-5 w-5" /> : (
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink-900">Photographs are required</p>
              <p className="mt-0.5 text-sm text-ink-500">
                {required
                  ? 'A stop cannot be closed without its proof, nor a bus, train or auto leg ended without its bill.'
                  : 'Off: a stop can be closed and a fare-paid leg ended with no photograph. The claim says where one is missing.'}
              </p>
            </div>
            <button type="button" role="switch" aria-checked={!!required} aria-label="Photographs are required"
              onClick={() => set.mutate(!required)} disabled={set.isPending}
              className={clsx('relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50', required ? 'bg-green-600' : 'bg-ink-300')}>
              <span className={clsx('absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform', required && 'translate-x-5')} />
            </button>
          </div>
        )}
        {required === false && <Alert kind="warning">Switch this back on before Travel Expense is given to engineers: the photograph is the proof the claim rests on.</Alert>}
        {set.isError && <Alert kind="error">{set.error instanceof Error ? set.error.message : 'That was not saved.'}</Alert>}
      </div>
    </div>
  )
}

/** What each mode pays. A change applies to legs closed after it; claims already made keep what they were made at. */
function Modes() {
  const { data: modes, isLoading } = useQuery({
    queryKey: ['travel-admin', 'modes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('travel_modes').select('mode, label, per_km, sort_order, is_active').order('sort_order')
      if (error) throw new Error(friendlyError(error))
      return (data as Mode[]).map(m => ({ ...m, per_km: m.per_km === null ? null : Number(m.per_km) }))
    },
  })
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
        <IndianRupee className="h-4 w-4 text-violet-500" />
        <h3 className="text-sm font-semibold text-ink-800">What each mode pays</h3>
        <span className="text-xs text-ink-400">· applies to legs closed from now on</span>
      </div>
      {isLoading ? <div className="p-4"><PageLoader /></div> : (
        <ul className="divide-y divide-ink-100">
          {(modes ?? []).map(m => <ModeRow key={m.mode} m={m} />)}
        </ul>
      )}
    </div>
  )
}

type Paid = 'km' | 'fare'

function ModeRow({ m }: { m: Mode }) {
  const qc = useQueryClient()
  const [paid, setPaid] = useState<Paid>(m.per_km === null ? 'fare' : 'km')
  const [rate, setRate] = useState(m.per_km?.toString() ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const save = useMutation({
    mutationFn: (perKm: number | null) => call('travel_set_rate', { p_mode: m.mode, p_per_km: perKm }),
    onSuccess: () => { setSaved(true); return qc.invalidateQueries({ queryKey: ['travel-admin'] }) },
    onError: e => setError(e instanceof Error ? e.message : 'That was not saved.'),
  })
  const changed = paid === 'fare' ? m.per_km !== null : Number(rate) !== m.per_km

  const go = () => {
    setError(null); setSaved(false)
    if (paid === 'fare') { save.mutate(null); return }
    const n = Number(rate)
    if (!rate.trim() || !Number.isFinite(n) || n <= 0) { setError('Enter a rate above zero.'); return }
    save.mutate(n)
  }

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="w-24 text-sm font-medium text-ink-900">{m.label}</span>
        <div className="inline-flex rounded-lg border border-ink-200 bg-ink-50 p-0.5" role="group" aria-label={`${m.label} is paid`}>
          {([['km', 'Per km'], ['fare', 'Actual fare']] as const).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={paid === id} onClick={() => { setPaid(id); setSaved(false); setError(null) }}
              className={clsx('rounded-md px-3 py-1.5 text-sm font-medium transition-colors', paid === id ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800')}>
              {label}
            </button>
          ))}
        </div>
        {paid === 'km' ? (
          <label className="flex items-center gap-2 text-sm text-ink-600">
            ₹
            <input className="input !w-24 !py-1.5 tabular-nums" inputMode="decimal" value={rate} aria-label={`${m.label} rate per km`}
              onChange={e => { setRate(e.target.value.replace(/[^0-9.]/g, '')); setSaved(false) }} />
            a km
          </label>
        ) : (
          <span className="text-sm text-ink-500">on the fare paid, with a photograph of the bill</span>
        )}
        <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={go} disabled={!changed || save.isPending}>
          {save.isPending && <Spinner className="h-4 w-4" />} Save
        </button>
        {saved && !changed && <span className="text-xs font-medium text-green-700">Saved</span>}
      </div>
      {error && <Alert kind="error">{error}</Alert>}
    </li>
  )
}

/** "TE-04", "te 4" and "4" are all claim number 4. */
function claimNumberOf(typed: string): number | null {
  const m = typed.trim().match(/^(?:te)?[\s-]*0*(\d{1,7})$/i)
  return m ? Number(m[1]) : null
}

interface Found { id: string; code: string; status: string; ended_at: string | null; total_amount: number; total_km: number; started_at: string; who: string }

const STATUS_WORDS: Record<string, string> = { submitted: 'with the manager', approved: 'approved', returned: 'sent back' }

/**
 * Deleting a claim, found by its number. The claim is shown before it goes —
 * whose it is, where it stands, what it comes to — because a number typed
 * one digit out is somebody else's travel.
 */
function DeleteClaim() {
  const [typed, setTyped] = useState('')
  const [found, setFound] = useState<Found | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const number = claimNumberOf(typed)

  const lookUp = async () => {
    setError(null); setNotice(null); setFound(null)
    if (!number) { setError('Type a claim number, like TE-04.'); return }
    setBusy(true)
    try {
      const { data, error: err } = await supabase.from('travel_trips')
        .select('id, code, status, started_at, ended_at, total_amount, total_km, employee_id').eq('number', number).maybeSingle()
      if (err) throw new Error(friendlyError(err))
      if (!data) { setError(`There is no claim TE-${number < 10 ? '0' : ''}${number}.`); return }
      const { data: emp } = await supabase.from('employees').select('full_name, ecode').eq('id', data.employee_id).maybeSingle()
      setFound({ ...data, total_amount: Number(data.total_amount), total_km: Number(data.total_km), who: emp ? `${emp.full_name.trim()} (${emp.ecode})` : 'an employee' })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That claim could not be looked up.')
    } finally { setBusy(false) }
  }

  const remove = async () => {
    if (!found) return
    setBusy(true); setError(null)
    try {
      /*
        Its photographs first. Storage files do not go with the row, and once
        the trip is gone the rule that says who may remove them has nothing to
        check against — they would be left where nobody could reach them.
      */
      const bucket = supabase.storage.from('travel-proofs')
      const { data: files } = await bucket.list(found.id)
      if (files?.length) {
        const { error: rmErr } = await bucket.remove(files.map(f => `${found.id}/${f.name}`))
        if (rmErr) throw new Error(friendlyError(rmErr))
      }
      await call('travel_delete', { p_trip_id: found.id })
      setNotice(`Deleted ${found.code}. Its number is not used again.`)
      setFound(null); setTyped('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That claim was not deleted.')
    } finally { setBusy(false) }
  }

  const stands = found && (found.status === 'open' ? (found.ended_at ? 'not submitted' : 'still on the road') : STATUS_WORDS[found.status] ?? found.status)

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
        <Trash2 className="h-4 w-4 text-cyrixRed-600" />
        <h3 className="text-sm font-semibold text-ink-800">Delete a claim</h3>
        <span className="text-xs text-ink-400">· software administrator only</span>
      </div>
      <div className="space-y-3 p-4">
        {error && <Alert kind="error">{error}</Alert>}
        {notice && <Alert kind="success">{notice}</Alert>}
        <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); void lookUp() }}>
          <label className="block w-40">
            <span className="label">Claim number</span>
            <input className="input mt-1 font-mono" value={typed} onChange={e => { setTyped(e.target.value); setFound(null) }} placeholder="TE-04" />
          </label>
          <button type="submit" className="btn-secondary" disabled={busy || !typed.trim()}>
            {busy && !found && <Spinner className="h-4 w-4" />} Find
          </button>
        </form>
        {found && (
          <div className="space-y-3 rounded-lg border border-cyrixRed-200 bg-cyrixRed-50 p-3">
            <p className="text-sm text-cyrixRed-900">
              <span className="font-mono font-semibold">{found.code}</span> — {found.who}, started {new Date(found.started_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })},
              {' '}{stands}, {rupees(found.total_amount)} over {found.total_km.toLocaleString('en-IN', { maximumFractionDigits: 1 })} km.
              {' '}Its legs, stops and photographs go with it. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button type="button" className="btn-danger" onClick={remove} disabled={busy}>
                {busy ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />} Delete {found.code}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setFound(null)} disabled={busy}>Keep it</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
