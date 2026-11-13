import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, Mic, Pause, Play, Search } from 'lucide-react'
import { Alert, PageLoader } from '@/components/ui'
import { supabase, friendlyError } from '@/lib/supabase'

/*
  SW Admin → Travel Expense → Feedback (Travel te_0158; management, 13 Nov: "directly comes to sw admin, and mainly
  voice, so sw admin can hear and improve"). Newest first; press ▶ to listen; New → Seen → Done, and Done tells the
  person in the Travel bell. Search, sort and filters as every admin table.
*/
type Status = 'new' | 'seen' | 'done'
interface Row {
  id: string; ecode: string; name: string; function_name: string | null; page: string | null; note: string | null
  audio_path: string | null; seconds: number | null; device: string | null; status: Status; created_at: string
  done_at: string | null; done_by: string | null
}
const LABEL: Record<Status, string> = { new: 'New', seen: 'Seen', done: 'Done' }
const CHIP: Record<Status, string> = {
  new: 'bg-cyrixRed-100 text-cyrixRed-800', seen: 'bg-amber-100 text-amber-800', done: 'bg-emerald-100 text-emerald-800',
}
/** The page in plain words, from its address. */
function pageName(p: string | null) {
  const s = (p ?? '').replace(/^\/travel/, '') || '/'
  if (s === '/') return 'Summary'
  if (s.startsWith('/claims')) return 'My claims'
  if (s.startsWith('/claim/')) return 'Claim page'
  if (s.startsWith('/photos')) return 'Visit photos'
  if (s.startsWith('/profile')) return 'My profile'
  if (s.startsWith('/approvals')) return 'Approvals'
  if (s.startsWith('/bookings')) return 'Bookings'
  if (s.startsWith('/policy')) return 'Travel policy'
  return s
}
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
const mmss = (s: number | null) => s == null ? '' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const phone = (ua: string | null) => !ua ? '' : /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : ''

export default function TravelFeedback() {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['te_feedback'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('te_feedback_list')
      if (error) throw new Error(friendlyError(error))
      return (data ?? []) as Row[]
    },
    refetchInterval: 60_000,
  })
  const [show, setShow] = useState<Status | 'all'>('new')
  const [q, setQ] = useState('')
  const [asc, setAsc] = useState(false)
  const [err, setErr] = useState<{ id: string; text: string } | null>(null)

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (data ?? [])
      .filter(r => show === 'all' || r.status === show)
      .filter(r => !t || `${r.name} ${r.ecode} ${r.note ?? ''} ${pageName(r.page)} ${r.function_name ?? ''}`.toLowerCase().includes(t))
      .sort((a, b) => (asc ? 1 : -1) * a.created_at.localeCompare(b.created_at))
  }, [data, show, q, asc])
  const count = (s: Status) => (data ?? []).filter(r => r.status === s).length

  const set = async (id: string, status: Status) => {
    setErr(null)
    const { error } = await supabase.rpc('te_feedback_set', { p_id: id, p_status: status })
    if (error) { setErr({ id, text: friendlyError(error) }); return }
    await qc.invalidateQueries({ queryKey: ['te_feedback'] })
  }

  if (isLoading) return <PageLoader />
  if (error) return <Alert kind="error">{(error as Error).message}</Alert>
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(['new', 'seen', 'done', 'all'] as const).map(s => (
          <button key={s} type="button" onClick={() => setShow(s)}
            className={clsx('rounded-full px-3 py-1.5 text-sm font-medium', show === s ? 'bg-violet-600 text-white' : 'bg-ink-100 text-ink-700 hover:bg-ink-200')}>
            {s === 'all' ? `All ${(data ?? []).length}` : `${LABEL[s]} ${count(s)}`}
          </button>
        ))}
        <button type="button" onClick={() => setAsc(a => !a)} className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-ink-600 hover:bg-ink-100">
          Date {asc ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
        </button>
      </div>
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Name, E-code or words" className="input w-full pl-9" />
      </label>
      {rows.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-500">No feedback here</div>
      ) : (
        <ul className="space-y-2">
          {rows.map(r => (
            <li key={r.id} className="card p-3">
              <div className="flex items-start gap-3">
                {r.audio_path ? <Player path={r.audio_path} /> : (
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink-100 text-ink-400"><Mic className="h-5 w-5" /></span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 text-sm font-semibold text-ink-900">{r.name} ({r.ecode})</p>
                    <span className={clsx('shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold', CHIP[r.status])}>{LABEL[r.status]}</span>
                  </div>
                  <p className="text-xs text-ink-500">
                    {[pageName(r.page), r.audio_path ? mmss(r.seconds) : 'Typed', when(r.created_at), phone(r.device)].filter(Boolean).join(' · ')}
                  </p>
                  {r.note && <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-ink-50 px-2.5 py-1.5 text-sm text-ink-800">{r.note}</p>}
                  {r.status === 'done' && r.done_by && <p className="mt-1 text-xs text-emerald-700">Done by {r.done_by}</p>}
                </div>
              </div>
              {r.status !== 'done' && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" disabled={r.status === 'seen'} onClick={() => void set(r.id, 'seen')} className="btn-secondary">Seen</button>
                  <button type="button" onClick={() => void set(r.id, 'done')} className="btn-primary">Done</button>
                </div>
              )}
              {err?.id === r.id && <p role="alert" className="mt-2 text-sm font-medium text-cyrixRed-700">{err.text}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** ▶ for one recording: a short-lived link from the private bucket, asked for when pressed. */
function Player({ path }: { path: string }) {
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [fail, setFail] = useState(false)
  const toggle = async () => {
    if (audio) { if (playing) { audio.pause(); setPlaying(false) } else { void audio.play(); setPlaying(true) } return }
    const { data, error } = await supabase.storage.from('te-feedback').createSignedUrl(path, 600)
    if (error || !data) { setFail(true); return }
    const a = new Audio(data.signedUrl)
    a.onended = () => setPlaying(false)
    a.onerror = () => { setFail(true); setPlaying(false) }
    setAudio(a)
    void a.play()
    setPlaying(true)
  }
  return (
    <button type="button" onClick={() => void toggle()} aria-label={playing ? 'Pause' : 'Listen'} title={fail ? 'Could not play' : 'Listen'}
      className={clsx('flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white active:scale-95', fail ? 'bg-ink-400' : 'bg-cyrixRed-600 hover:bg-cyrixRed-700')}>
      {playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
    </button>
  )
}
