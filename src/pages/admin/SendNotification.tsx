import { useState } from 'react'
import clsx from 'clsx'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, Send, Loader2, ChevronDown, ChevronRight, Check, Smartphone } from 'lucide-react'
import { supabase, friendlyError } from '@/lib/supabase'
import { Alert } from '@/components/ui'
import MultiPick from '@/components/MultiPick'

/**
 * A message to people (0154–0159; the user, 10 Oct). It lands in the
 * notifications of everyone it is for, and on their phone or desktop too
 * where they have turned that on. Two sub-tabs: Send, and History — what
 * this desk has sent, and to whom. HR and SW Admin each see only their
 * own; the automatic reminders belong to both.
 */
type Kind = 'all' | 'person' | 'manager' | 'function' | 'department'
type Desk = 'hr' | 'sw'
const KINDS: Array<[Kind, string]> = [
  ['all', 'Everyone'],
  ['person', 'People'],
  ['manager', 'Managers and everyone under them'],
  ['function', 'Functions'],
  ['department', 'Departments'],
]

interface Preview { people: number; devices: number; reachable: number; name: string | null }
interface Person { ecode: string; full_name: string; devices: number; read?: boolean }
interface Sent {
  id: string; kind: 'manual' | 'reminder'; title: string; body: string
  target: { kind: string; value?: string; values?: string[]; side?: string } | null
  people: number | null; devices: number | null; delivered: number | null; created_at: string
  sent_as?: Desk | null
}
interface Options {
  functions: string[]; departments: string[]; devices: number; people: number
  managers: Array<{ ecode: string; name: string; n: number }>
  everyone: Array<{ ecode: string; name: string }>
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export default function SendNotification({ desk = 'hr' }: { desk?: Desk }) {
  const [tab, setTab] = useState<'send' | 'history'>('send')
  return (
    <div className="space-y-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-ink-900">
        <BellRing className="h-5 w-5 text-cyrixRed-600" />
        Send notification
      </h2>
      <div className="flex gap-1 border-b border-ink-200">
        {(['send', 'history'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={clsx('-mb-px border-b-2 px-4 py-2 text-sm font-medium',
              tab === t ? 'border-cyrixRed-600 text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-800')}>
            {t === 'send' ? 'Send' : 'History'}
          </button>
        ))}
      </div>
      {tab === 'send' ? <SendForm desk={desk} onSent={() => {}} /> : <History desk={desk} />}
    </div>
  )
}

function SendForm({ desk }: { desk: Desk; onSent: () => void }) {
  const qc = useQueryClient()
  const [kind, setKind] = useState<Kind>('all')
  const [values, setValues] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [done, setDone] = useState<string | null>(null)
  const [showWho, setShowWho] = useState(false)
  const target = kind === 'all' ? { kind } : { kind, values }
  const ready = kind === 'all' || values.length > 0
  const key = [kind, values.join('|')]

  const { data: options } = useQuery({
    queryKey: ['push_options'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('push_audience_options')
      if (error) throw new Error(friendlyError(error))
      return data as Options
    },
  })
  const { data: preview, error: previewError } = useQuery({
    enabled: ready,
    queryKey: ['push_preview', ...key],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('push_audience_preview', { p_target: target })
      if (error) throw new Error(friendlyError(error))
      return data as Preview
    },
  })
  const { data: who, isFetching: whoLoading } = useQuery({
    enabled: ready && showWho,
    queryKey: ['push_people', ...key],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('push_audience_people', { p_target: target })
      if (error) throw new Error(friendlyError(error))
      return data as Person[]
    },
  })

  const send = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('push', {
        body: { action: 'send', as: desk, target, title: title.trim(), body: body.trim() },
      })
      if (error) {
        const ctx = (error as { context?: Response }).context
        const msg = ctx ? (await ctx.json().catch(() => null))?.error : null
        throw new Error(msg ?? error.message)
      }
      return data as { people: number; devices: number; delivered: number; failed: number }
    },
    onSuccess: r => {
      setDone(`Sent to ${plural(r.people, 'person', 'people')}` +
        (r.delivered ? `, and to ${plural(r.delivered, 'device')}` : '') +
        (r.failed ? ` · ${plural(r.failed, 'device')} could not be reached` : '') + '.')
      setBody(''); setTitle('')
      qc.invalidateQueries({ queryKey: ['push_messages'] })
    },
  })

  return (
    <div className="space-y-4">
      {done && <Alert kind="success">{done}</Alert>}
      {send.error && <Alert kind="error">{(send.error as Error).message}</Alert>}

      <div className="card space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="push-to">Send to</label>
            <select id="push-to" className="input" value={kind} onChange={e => { setKind(e.target.value as Kind); setValues([]); setShowWho(false) }}>
              {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          {kind !== 'all' && (
            <div>
              <label className="label" htmlFor="push-group">
                {kind === 'person' ? 'People' : kind === 'manager' ? 'Managers' : kind === 'function' ? 'Functions' : 'Departments'}
              </label>
              <MultiPick id="push-group" value={values} onChange={setValues}
                placeholder={kind === 'person' ? 'Search by name or E-code' : 'Choose…'}
                options={kind === 'person'
                  ? (options?.everyone ?? []).map(m => ({ value: m.ecode, label: m.name, hint: m.ecode }))
                  : kind === 'manager'
                  ? (options?.managers ?? []).map(m => ({ value: m.ecode, label: m.name, hint: `${m.ecode} · ${m.n}` }))
                  : ((kind === 'function' ? options?.functions : options?.departments) ?? []).map(o => ({ value: o, label: o }))} />
            </div>
          )}
        </div>

        <div>
          <label className="label" htmlFor="push-title">Title</label>
          <input id="push-title" className="input" maxLength={80} placeholder="Cyrix" value={title} onChange={e => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="push-body">Message</label>
          <textarea id="push-body" className="input min-h-[96px]" maxLength={400} placeholder="Type the message"
            value={body} onChange={e => setBody(e.target.value)} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* One click (the user, 10 Oct: "why after 1 send another send button?"). */}
          <button className="btn-primary" disabled={send.isPending || !ready || !body.trim() || !preview || preview.people === 0}
            onClick={() => { setDone(null); send.mutate() }}>
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {preview?.people ? `Send to ${plural(preview.people, 'person', 'people')}` : 'Send notification'}
          </button>
          {ready && previewError && <span className="text-sm text-cyrixRed-700">{(previewError as Error).message}</span>}
          {ready && preview && (
            <button type="button" onClick={() => setShowWho(s => !s)} disabled={preview.people === 0}
              className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900">
              {preview.people === 0 ? 'Nobody active matches' : (
                <>
                  {showWho ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  {plural(preview.people, 'recipient')} · {plural(preview.devices, 'device')}
                </>
              )}
            </button>
          )}
        </div>

        {showWho && ready && <People rows={who} loading={whoLoading} />}
      </div>
    </div>
  )
}

/** Names, E-codes, devices; and for a sent message, whether they have read it. */
function People({ rows, loading, withRead }: { rows: Person[] | undefined; loading: boolean; withRead?: boolean }) {
  if (loading && !rows) return <p className="flex items-center gap-2 text-sm text-ink-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
  if (!rows?.length) return null
  return (
    <div className="max-h-72 overflow-y-auto rounded-lg border border-ink-200">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-ink-50">
          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">E-code</th>
            <th className="px-3 py-2 text-center">Device</th>
            {withRead && <th className="px-3 py-2 text-center">Read</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {rows.map(p => (
            <tr key={p.ecode}>
              <td className="px-3 py-1.5 text-ink-900">{p.full_name}</td>
              <td className="px-3 py-1.5 tabular-nums text-ink-600">{p.ecode}</td>
              <td className="px-3 py-1.5 text-center">{p.devices ? <Smartphone className="mx-auto h-4 w-4 text-emerald-600" /> : <span className="text-ink-300">—</span>}</td>
              {withRead && <td className="px-3 py-1.5 text-center">{p.read ? <Check className="mx-auto h-4 w-4 text-emerald-600" /> : <span className="text-ink-300">—</span>}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function History({ desk }: { desk: Desk }) {
  const [open, setOpen] = useState<string | null>(null)
  const { data: history, isLoading } = useQuery({
    queryKey: ['push_messages', desk],
    queryFn: async () => {
      const { data, error } = await supabase.from('push_messages').select('*').or(`sent_as.eq.${desk},kind.eq.reminder`).order('created_at', { ascending: false }).limit(100)
      if (error) throw new Error(friendlyError(error))
      return data as Sent[]
    },
  })
  const { data: recipients, isFetching } = useQuery({
    enabled: !!open,
    queryKey: ['push_recipients', open],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('push_recipients', { p_message: open })
      if (error) throw new Error(friendlyError(error))
      return data as Person[]
    },
  })

  const who = (t: Sent['target']) => {
    if (!t) return '—'
    if (t.kind === 'reminder') return t.side === 'manager' ? 'Reminder · managers' : t.side === 'open' ? 'Month open · everyone with a KPI' : 'Reminder · team members'
    const k = KINDS.find(([v]) => v === t.kind)?.[1] ?? t.kind
    const list = t.values ?? (t.value ? [t.value] : [])
    return list.length ? `${k}: ${list.join(', ')}` : k
  }

  if (isLoading) return <p className="flex items-center gap-2 text-sm text-ink-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
  if (!history?.length) return <p className="text-sm text-ink-500">Nothing sent yet.</p>

  return (
    <div className="card divide-y divide-ink-100 overflow-hidden">
      {history.map(h => (
        <div key={h.id}>
          <button type="button" onClick={() => setOpen(o => (o === h.id ? null : h.id))}
            className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-ink-50">
            {open === h.id ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm"><span className="font-medium text-ink-900">{h.title}</span> <span className="text-ink-600">{h.body}</span></p>
              <p className="mt-0.5 text-xs text-ink-500">{who(h.target)}</p>
            </div>
            <div className="shrink-0 text-right text-xs text-ink-500">
              <p>{new Date(h.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
              <p className="mt-0.5 tabular-nums">{plural(h.people ?? 0, 'person', 'people')} · {plural(h.delivered ?? 0, 'device')}</p>
            </div>
          </button>
          {open === h.id && (
            <div className="px-4 pb-4">
              {h.kind === 'reminder'
                ? <p className="text-sm text-ink-500">Reminders go to devices only.</p>
                : <People rows={recipients} loading={isFetching} withRead />}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
