import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileSpreadsheet, Globe, Loader2, Users } from 'lucide-react'
import MultiPick from '@/components/MultiPick'
import { supabase } from '@/lib/supabase'

type Way = 'direct' | 'fns' | 'mgrs' | 'people'
const WAYS: Array<[Way, string]> = [['direct', 'Direct reportees'], ['fns', 'Function'], ['mgrs', 'Team of'], ['people', 'People']]

export interface Audience { direct: string[]; fns: string[]; mgrs: string[]; ecodes: string[] }

/**
 * Who a Digest post goes to (0242; the user, 2 Nov: "select function, reportees, ecode or name (multiple ecode or
 * name and upload excel only ecode also) it should be very user friendly"; "send to mandatory, default as all").
 */
export default function DigestSendTo({ to, value, onTo, onChange }: {
  to: 'all' | 'chosen'
  value: Audience
  onTo: (to: 'all' | 'chosen') => void
  onChange: (v: Audience) => void
}) {
  const chosen = to === 'chosen'
  // One of the four ways a post (the user, 2 Nov: "it should able to choose any of the 4, not more than that"):
  // another way starts the choice afresh.
  const [way, setWay] = useState<Way>(value.fns.length ? 'fns' : value.mgrs.length ? 'mgrs' : value.ecodes.length ? 'people' : 'direct')
  const pickWay = (k: Way) => { if (k === way) return; setWay(k); setUpload(null); onChange({ direct: [], fns: [], mgrs: [], ecodes: [] }) }
  const { data: opts } = useQuery({
    queryKey: ['digest_audience_options'],
    enabled: chosen,
    staleTime: 10 * 60_000,
    queryFn: async () => ((await supabase.rpc('digest_audience_options')).data ?? { functions: [], managers: [] }) as {
      functions: Array<{ name: string; n: number }>; managers: Array<{ ecode: string; name: string; n: number; fns: string[] | null }>
    },
  })
  const { data: people = [] } = useQuery({
    queryKey: ['digest_people'],
    enabled: chosen,
    staleTime: 10 * 60_000,
    queryFn: async () => ((await supabase.rpc('digest_people_options')).data ?? []) as Array<{ ecode: string; name: string }>,
  })
  const picked = value.direct.length + value.fns.length + value.mgrs.length + value.ecodes.length > 0
  const { data: reach, isFetching } = useQuery({
    queryKey: ['digest_audience_count', value],
    enabled: chosen && picked,
    queryFn: async () => ((await supabase.rpc('digest_audience_count', {
      p_functions: value.fns, p_managers: value.mgrs, p_ecodes: value.ecodes, p_direct: value.direct,
    })).data ?? 0) as number,
  })

  // An Excel of E-codes: every cell that is somebody's E-code, wherever it is in the sheet.
  const file = useRef<HTMLInputElement>(null)
  const [upload, setUpload] = useState<{ added: number; unknown: string[] } | null>(null)
  const [reading, setReading] = useState(false)
  const readSheet = async (f: File) => {
    setReading(true)
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await f.arrayBuffer())
      const known = new Map(people.map(p => [p.ecode.toUpperCase(), p.ecode]))
      const found = new Set<string>(), unknown = new Set<string>()
      for (const name of wb.SheetNames) {
        for (const row of XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1 })) {
          for (const c of row) {
            const v = String(c ?? '').trim().toUpperCase()
            if (!v) continue
            if (known.has(v)) found.add(known.get(v)!)
            else if (/^[A-Z]{1,3}\d{3,6}$/.test(v)) unknown.add(v)
          }
        }
      }
      const before = new Set(value.ecodes)
      onChange({ ...value, ecodes: [...before, ...[...found].filter(e => !before.has(e))] })
      setUpload({ added: [...found].filter(e => !before.has(e)).length, unknown: [...unknown] })
    } catch {
      setUpload({ added: 0, unknown: ['That file could not be read — use an Excel (.xlsx) file'] })
    } finally {
      setReading(false)
      if (file.current) file.current.value = ''
    }
  }

  // A function chosen narrows the managers to those with people in it; each includes the manager.
  const managers = (sel: string[]) => (opts?.managers ?? [])
    .filter(m => !value.fns.length || sel.includes(m.ecode) || (m.fns ?? []).some(f => value.fns.includes(f)))
    .map(m => ({ value: m.ecode, label: m.name, hint: m.ecode }))

  const choice = (k: 'all' | 'chosen', label: string, Icon: typeof Globe) => (
    <button type="button" aria-pressed={to === k} onClick={() => onTo(k)}
      className={to === k ? 'btn-primary justify-center' : 'btn-secondary justify-center'}>
      <Icon className="h-4 w-4" /> {label}
    </button>
  )

  return (
    // Set off so the desks notice it (the user, 2 Nov: "show this send to field emphasised").
    <div className="max-w-2xl rounded-xl border-2 border-violet-400/70 bg-violet-500/10 p-3">
      <div className="flex items-center gap-2">
        <span className="label">Send to <span className="text-red-600">*</span></span>
      </div>
      <div className="mt-1 grid max-w-xs grid-cols-2 gap-2">
        {choice('all', 'Everyone', Globe)}
        {choice('chosen', 'Chosen people', Users)}
      </div>
      {chosen && (
        <div className="mt-2 space-y-3 rounded-xl border border-ink-200 bg-ink-50/60 p-3">

          {/* Which way, as a dropdown (the user, 2 Nov: "make it dropdown"). */}
          <select className="input" value={way} onChange={e => pickWay(e.target.value as Way)} aria-label="Choose by">
            {WAYS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          {way === 'direct' && (
            <MultiPick id="dg-to-direct" value={value.direct} onChange={direct => onChange({ ...value, direct })} placeholder="Manager's name or E-code"
              options={managers(value.direct)} />
          )}
          {way === 'fns' && (
            <MultiPick id="dg-to-fn" value={value.fns} onChange={fns => onChange({ ...value, fns })} placeholder="Choose functions"
              options={(opts?.functions ?? []).map(f => ({ value: f.name, label: f.name, hint: String(f.n) }))} />
          )}
          {way === 'mgrs' && (
            <MultiPick id="dg-to-mgr" value={value.mgrs} onChange={mgrs => onChange({ ...value, mgrs })} placeholder="Manager's name or E-code"
              options={managers(value.mgrs)} />
          )}
          {way === 'people' && (
            <div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                <MultiPick id="dg-to-people" value={value.ecodes} onChange={ecodes => onChange({ ...value, ecodes })} placeholder="Name or E-code"
                  options={people.map(p => ({ value: p.ecode, label: p.name, hint: p.ecode }))} />
                <button type="button" className="btn-secondary justify-center" disabled={reading || !people.length} onClick={() => file.current?.click()}>
                  {reading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 text-emerald-600" />} Upload E-codes
                </button>
                <input ref={file} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) void readSheet(f) }} />
              </div>
              {upload && (
                <p className="mt-1 text-sm text-ink-600">
                  {upload.added} added
                  {upload.unknown.length > 0 && <span className="text-cyrixRed-600"> · Not found: {upload.unknown.slice(0, 10).join(', ')}{upload.unknown.length > 10 ? ` +${upload.unknown.length - 10}` : ''}</span>}
                </p>
              )}
            </div>
          )}
          <p className="text-sm font-semibold text-ink-900">
            {!picked ? <span className="text-cyrixRed-600">Choose at least one</span>
              : isFetching ? <Loader2 className="inline h-4 w-4 animate-spin" />
              : `Reaches ${reach ?? 0} ${reach === 1 ? 'person' : 'people'}`}
          </p>
        </div>
      )}
    </div>
  )
}
