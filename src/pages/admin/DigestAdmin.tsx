import { useState } from 'react'
import clsx from 'clsx'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Newspaper, Video, ImagePlus, Loader2, Send, Pencil, Trash2, ChevronDown, ChevronRight, Heart, MessageCircle, MousePointerClick, X, Search, BarChart3, Plus,
} from 'lucide-react'
import { supabase, friendlyError } from '@/lib/supabase'
import { Alert } from '@/components/ui'

/**
 * Posting to Cyrix Digest (0163), for HR Admin and IT Admin: news, or a
 * meeting with its date, time and link. A new post goes into everybody's
 * notifications and to their devices; an edit does not send again. Each
 * post shows its likes and comments, and a meeting shows who clicked Join,
 * how often, first and last.
 */
type Kind = 'news' | 'meeting' | 'poll'
/** A named colour, or any colour as #rrggbb (0168; the user: "need more colours picker also"). */
type Hue = string
const HUES: Array<[Hue, string, string]> = [
  ['red', '#f43f5e', '#ce2434'], ['orange', '#fb923c', '#ea580c'], ['amber', '#fbbf24', '#d97706'], ['green', '#4ade80', '#16a34a'],
  ['teal', '#2dd4bf', '#0d9488'], ['blue', '#60a5fa', '#2563eb'], ['violet', '#a78bfa', '#7c3aed'], ['pink', '#f472b6', '#db2777'],
]
/** More ready-made ones, stored as their colour. */
const MORE: Hue[] = ['#4f46e5', '#0891b2', '#65a30d', '#a16207', '#be123c', '#334155']
const grad = (h: Hue) => {
  const x = HUES.find(([k]) => k === h)
  if (x) return `linear-gradient(135deg, ${x[1]}, ${x[2]})`
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h)
  if (!m) return 'linear-gradient(135deg, #a78bfa, #7c3aed)'
  const [r, g, b] = m.slice(1).map(v => parseInt(v, 16))
  const light = (v: number) => Math.round(v + (255 - v) * 0.35)
  return `linear-gradient(135deg, rgb(${light(r)} ${light(g)} ${light(b)}), ${h})`
}

interface Row {
  id: string; kind: Kind; title: string; body: string; image_url: string | null; color: Hue
  meet_at: string | null; meet_minutes: number | null; meet_link: string | null; meet_place: string | null
  posted_as: 'hr' | 'it' | 'mkt'; author: string | null; created_at: string; likes: number; comments: number; joined: number; clicks: number
  /** Posted by this desk: only then can it be edited or deleted (0165). */
  mine: boolean
}
interface Draft {
  id: string | null; kind: Kind; title: string; body: string; image_url: string | null; color: Hue
  date: string; minutes: number; link: string; place: string
  /** A poll (0167): its options, single or multiple choice, and when it closes. */
  options: string[]; multi: boolean; closes: string
}
const EMPTY: Draft = { id: null, kind: 'news', title: '', body: '', image_url: null, color: 'violet', date: '', minutes: 60, link: '', place: '', options: ['', ''], multi: false, closes: '' }
const local = (iso: string) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }
const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** A photo, made no bigger than it needs to be, into the public digest bucket. */
async function upload(file: File): Promise<string> {
  const img = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height))
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  const blob: Blob = await new Promise(r => c.toBlob(b => r(b!), 'image/jpeg', 0.82))
  const path = `${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from('digest').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' })
  if (error) throw new Error(friendlyError(error))
  return supabase.storage.from('digest').getPublicUrl(path).data.publicUrl
}

export default function DigestAdmin() {
  const qc = useQueryClient()
  const [d, setD] = useState<Draft>(EMPTY)
  const [uploading, setUploading] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  // Finding a post (the user, 10 Oct: "search and filter dates also").
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const set = (p: Partial<Draft>) => setD(x => ({ ...x, ...p }))

  const { data: rows } = useQuery({
    queryKey: ['digest_admin'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('digest_admin_list')
      if (error) throw new Error(friendlyError(error))
      return data as Row[]
    },
  })

  const save = useMutation({
    mutationFn: async () => {
      const isNew = !d.id
      const { data: id, error } = await supabase.rpc('digest_save', {
        p_id: d.id, p_kind: d.kind, p_title: d.title, p_body: d.body, p_image_url: d.image_url ?? '', p_color: d.color,
        p_meet_at: d.kind === 'meeting' && d.date ? new Date(d.date).toISOString() : null,
        p_meet_minutes: d.kind === 'meeting' ? d.minutes : null,
        p_meet_link: d.kind === 'meeting' ? d.link : null, p_meet_place: d.kind === 'meeting' ? d.place : null,
      })
      if (error) throw new Error(friendlyError(error))
      if (d.kind === 'poll') {
        const { error: pe } = await supabase.rpc('digest_set_poll', {
          p_id: id, p_options: d.options, p_closes_at: d.closes ? new Date(d.closes).toISOString() : null, p_multi: d.multi,
        })
        if (pe) throw new Error(friendlyError(pe))
      }
      if (!isNew) return { isNew, people: 0 }
      // A new post tells everybody; an edit does not.
      const { data: sent } = await supabase.functions.invoke('push', { body: { action: 'digest', post_id: id } })
      return { isNew, people: (sent as { people?: number } | null)?.people ?? 0 }
    },
    onSuccess: r => {
      setDone(r.isNew ? `Posted. ${r.people} people were notified.` : 'Saved.')
      setD(EMPTY)
      qc.invalidateQueries({ queryKey: ['digest_admin'] })
    },
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('digest_remove', { p_id: id })
      if (error) throw new Error(friendlyError(error))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['digest_admin'] }),
  })

  const pick = async (f: File | undefined) => {
    if (!f) return
    setUploading(true)
    try { set({ image_url: await upload(f) }) } catch (e) { setDone(null); alert((e as Error).message) } finally { setUploading(false) }
  }
  const ready = d.title.trim() && (d.kind === 'news'
    || (d.kind === 'poll' && d.options.filter(o => o.trim()).length >= 2)
    || (d.kind === 'meeting' && d.date && /^https:\/\//.test(d.link.trim())))

  return (
    <div className="space-y-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-ink-900">
        <Newspaper className="h-5 w-5 text-violet-600" />
        Cyrix Digest
      </h2>

      {done && <Alert kind="success">{done}</Alert>}
      {save.error && <Alert kind="error">{(save.error as Error).message}</Alert>}

      <div className="card space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          {(['news', 'meeting', 'poll'] as const).map(k => (
            <button key={k} type="button" onClick={() => set({ kind: k })}
              className={clsx('inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-medium',
                d.kind === k ? 'border-violet-600 bg-violet-600 text-white shadow-sm' : 'border-ink-300 text-ink-700 hover:border-violet-400 hover:text-violet-700')}>
              {k === 'news' ? <Newspaper className="h-4 w-4" /> : k === 'poll' ? <BarChart3 className="h-4 w-4" /> : <Video className="h-4 w-4" />}
              {k === 'news' ? 'News' : k === 'poll' ? 'Poll' : 'Meeting'}
            </button>
          ))}
          {d.id && (
            <button type="button" onClick={() => setD(EMPTY)} className="ml-auto inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800">
              <X className="h-4 w-4" /> Stop editing
            </button>
          )}
        </div>

        <div>
          <label className="label" htmlFor="dg-title">{d.kind === 'poll' ? 'Question' : 'Title'}</label>
          <input id="dg-title" className="input" maxLength={120} value={d.title} onChange={e => set({ title: e.target.value })}
            placeholder={d.kind === 'meeting' ? 'Quarterly town hall' : d.kind === 'poll' ? 'Which day suits the team lunch?' : 'Diwali celebration at all offices'} />
        </div>
        <div>
          <label className="label" htmlFor="dg-body">Description</label>
          <textarea id="dg-body" className="input min-h-[110px]" maxLength={4000} value={d.body} onChange={e => set({ body: e.target.value })}
            placeholder={d.kind === 'meeting' ? 'Q2 results, new modules and questions' : 'Lunch, rangoli and prizes on 30 Oct'} />
        </div>

        {d.kind === 'poll' && (
          <div className="space-y-3">
            <span className="label">Options</span>
            {d.options.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <input className="input" maxLength={120} value={o} placeholder={`Option ${i + 1}`}
                  onChange={e => set({ options: d.options.map((x, k) => (k === i ? e.target.value : x)) })} />
                {d.options.length > 2 && (
                  <button type="button" className="btn-icon" title="Remove option" onClick={() => set({ options: d.options.filter((_, k) => k !== i) })}><X className="h-4 w-4" /></button>
                )}
              </div>
            ))}
            {d.options.length < 6 && (
              <button type="button" className="btn-secondary !px-3 !py-1.5 text-sm" onClick={() => set({ options: [...d.options, ''] })}>
                <Plus className="h-4 w-4" /> Add option
              </button>
            )}
            <div className="flex flex-wrap items-end gap-4">
              <label className="inline-flex items-center gap-2 text-sm text-ink-800">
                <input type="checkbox" checked={d.multi} onChange={e => set({ multi: e.target.checked })} />
                Multiple answers
              </label>
              <div>
                <label className="label" htmlFor="dg-closes">Closes</label>
                <input id="dg-closes" type="datetime-local" className="input" value={d.closes} onChange={e => set({ closes: e.target.value })} />
              </div>
            </div>
          </div>
        )}

        {d.kind === 'meeting' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="dg-at">Date and time</label>
              <input id="dg-at" type="datetime-local" className="input" value={d.date} onChange={e => set({ date: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="dg-min">Duration</label>
              <select id="dg-min" className="input" value={d.minutes} onChange={e => set({ minutes: Number(e.target.value) })}>
                {[15, 30, 45, 60, 90, 120, 180].map(m => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} hr`}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="dg-link">Meeting link</label>
              <input id="dg-link" className="input" value={d.link} onChange={e => set({ link: e.target.value })} placeholder="https://teams.microsoft.com/l/meetup-join/…" />
            </div>
            <div>
              <label className="label" htmlFor="dg-place">Where</label>
              <input id="dg-place" className="input" value={d.place} onChange={e => set({ place: e.target.value })} placeholder="Microsoft Teams" />
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className="label">Colour</span>
            <div className="flex flex-wrap gap-2">
              {[...HUES.map(([h]) => h), ...MORE].map(h => (
                <button key={h} type="button" onClick={() => set({ color: h })} aria-label={h}
                  className={clsx('h-8 w-8 rounded-full transition-transform hover:scale-110', d.color === h && 'ring-2 ring-violet-500 ring-offset-2 ring-offset-surface')}
                  style={{ background: grad(h) }} />
              ))}
              {/* Any colour at all. */}
              <label title="Custom colour"
                className={clsx('relative grid h-8 w-8 cursor-pointer place-items-center rounded-full border-2 border-dashed border-ink-400 transition-transform hover:scale-110',
                  d.color.startsWith('#') && !MORE.includes(d.color) && 'ring-2 ring-violet-500 ring-offset-2 ring-offset-surface')}
                style={d.color.startsWith('#') && !MORE.includes(d.color) ? { background: grad(d.color), borderStyle: 'solid' } : undefined}>
                <Plus className="h-4 w-4 text-ink-500" />
                <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={d.color.startsWith('#') ? d.color : '#7c3aed'}
                  onChange={e => set({ color: e.target.value })} />
              </label>
            </div>
          </div>
          <div>
            <span className="label">Photo</span>
            <div className="flex items-center gap-3">
              <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg" style={{ background: d.image_url ? `center/cover url(${d.image_url})` : grad(d.color) }} />
              <label className="btn-secondary cursor-pointer !px-3 !py-2 text-sm">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                {d.image_url ? 'Change' : 'Add photo'}
                <input type="file" accept="image/*" className="hidden" onChange={e => void pick(e.target.files?.[0])} />
              </label>
              {d.image_url && <button type="button" onClick={() => set({ image_url: null })} className="text-sm text-ink-500 hover:text-ink-800">Remove</button>}
            </div>
          </div>
        </div>

        <button className="btn-primary" disabled={!ready || save.isPending || uploading} onClick={() => { setDone(null); save.mutate() }}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {d.id ? 'Save changes' : 'Post to everyone'}
        </button>
      </div>

      {!!rows?.length && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[14rem] flex-1">
            <label className="label" htmlFor="dg-q">Search</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input id="dg-q" className="input !pl-9" value={q} onChange={e => setQ(e.target.value)} placeholder="Title or words in it" />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="dg-from">From</label>
            <input id="dg-from" type="date" className="input" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="dg-to">To</label>
            <input id="dg-to" type="date" className="input" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          {(q || from || to) && (
            <button type="button" className="btn-secondary" onClick={() => { setQ(''); setFrom(''); setTo('') }}>Clear</button>
          )}
        </div>
      )}

      {!!rows?.length && (
        <div className="card divide-y divide-ink-100 overflow-hidden">
          {rows.filter(r => {
            const day = r.created_at.slice(0, 10)
            const text = (r.title + ' ' + r.body).toLowerCase()
            return (!q.trim() || text.includes(q.trim().toLowerCase())) && (!from || day >= from) && (!to || day <= to)
          }).map(r => (
            <div key={r.id}>
              <div className="flex items-center gap-3 px-4 py-3">
                <button type="button" onClick={() => setOpen(o => (o === r.id ? null : r.id))} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  {open === r.id ? <ChevronDown className="h-4 w-4 shrink-0 text-ink-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" />}
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white"
                    style={{ background: r.image_url ? `center/cover url(${r.image_url})` : grad(r.color) }}>
                    {!r.image_url && (r.kind === 'meeting' ? <Video className="h-4 w-4" /> : r.kind === 'poll' ? <BarChart3 className="h-4 w-4" /> : <Newspaper className="h-4 w-4" />)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink-900">{r.title}</span>
                    <span className="block text-xs text-ink-500">
                      {r.kind === 'meeting' ? `Meeting · ${fmt(r.meet_at!)}` : r.kind === 'poll' ? 'Poll' : 'News'} · {r.posted_as === 'it' ? 'IT' : r.posted_as === 'mkt' ? 'Marketing' : 'HR'} · {fmt(r.created_at)}
                    </span>
                  </span>
                </button>
                <span className="hidden shrink-0 items-center gap-3 text-xs text-ink-600 sm:flex">
                  {r.kind === 'news' && <span className="inline-flex items-center gap-1"><Heart className="h-3.5 w-3.5" /> {r.likes}</span>}
                  <span className="inline-flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" /> {r.comments}</span>
                  {r.kind === 'meeting' && <span className="inline-flex items-center gap-1"><MousePointerClick className="h-3.5 w-3.5" /> {r.joined}</span>}
                </span>
                {r.mine && <button type="button" title="Edit" className="btn-icon" onClick={async () => {
                  const poll = r.kind === 'poll'
                    ? ((await supabase.rpc('digest_poll', { p_id: r.id })).data as Array<{ label: string; multi: boolean; closes_at: string | null }> | null) ?? []
                    : []
                  setD({ id: r.id, kind: r.kind, title: r.title, body: r.body, image_url: r.image_url, color: r.color,
                    date: r.meet_at ? local(r.meet_at) : '', minutes: r.meet_minutes ?? 60, link: r.meet_link ?? '', place: r.meet_place ?? '',
                    options: poll.length ? poll.map(o => o.label) : ['', ''], multi: !!poll[0]?.multi, closes: poll[0]?.closes_at ? local(poll[0].closes_at) : '' })
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}><Pencil className="h-4 w-4" /></button>}
                {r.mine && <button type="button" title="Delete" className="btn-icon text-cyrixRed-600"
                  onClick={() => { if (confirm(`Delete "${r.title}" from Cyrix Digest?`)) remove.mutate(r.id) }}><Trash2 className="h-4 w-4" /></button>}
              </div>
              {open === r.id && <Details row={r} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * One post's numbers (0166; the user, 10 Oct: "each post analytics ... who
 * all clicked, not liked etc, a summary"): everybody active and how far
 * each got — seen it on the home page, opened it, liked, commented,
 * clicked Join — with the lists either way, and the comments to moderate.
 */
type Person = {
  ecode: string; full_name: string; department: string | null; function_name: string | null
  seen_at: string | null; opened_at: string | null; opens: number
  liked_at: string | null; comments: number; joins: number; joined_at: string | null; voted: string | null
}
type Lens = 'seen' | 'not_seen' | 'opened' | 'liked' | 'not_liked' | 'commented' | 'joined' | 'not_joined' | 'voted' | 'not_voted'

function Details({ row }: { row: Row }) {
  const qc = useQueryClient()
  const [lens, setLens] = useState<Lens>('seen')
  const [find, setFind] = useState('')
  const { data: people } = useQuery({
    queryKey: ['digest_people', row.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('digest_post_people', { p_id: row.id })
      if (error) throw new Error(friendlyError(error))
      return data as Person[]
    },
  })
  const { data: comments } = useQuery({
    queryKey: ['digest_comments', row.id],
    queryFn: async () => (await supabase.rpc('digest_comments_for', { p_id: row.id })).data as Array<{ id: string; author: string; ecode: string; body: string; created_at: string }>,
  })
  const del = async (id: string) => {
    await supabase.rpc('digest_delete_comment', { p_id: id })
    qc.invalidateQueries({ queryKey: ['digest_comments', row.id] })
    qc.invalidateQueries({ queryKey: ['digest_admin'] })
    qc.invalidateQueries({ queryKey: ['digest_people', row.id] })
  }

  const all = people ?? []
  const n = all.length || 1
  const test: Record<Lens, (p: Person) => boolean> = {
    seen: p => !!p.seen_at, not_seen: p => !p.seen_at, opened: p => !!p.opened_at,
    liked: p => !!p.liked_at, not_liked: p => !p.liked_at, commented: p => p.comments > 0,
    joined: p => p.joins > 0, not_joined: p => p.joins === 0,
    voted: p => !!p.voted, not_voted: p => !p.voted,
  }
  const tiles: Array<[Lens, string, number]> = [
    ['seen', 'Seen', all.filter(test.seen).length],
    ['opened', 'Opened', all.filter(test.opened).length],
    ...(row.kind === 'news' ? [['liked', 'Liked', all.filter(test.liked).length] as [Lens, string, number]] : []),
    ['commented', 'Commented', all.filter(test.commented).length],
    ...(row.kind === 'meeting' ? [['joined', 'Clicked Join', all.filter(test.joined).length] as [Lens, string, number]] : []),
    ...(row.kind === 'poll' ? [['voted', 'Voted', all.filter(test.voted).length] as [Lens, string, number]] : []),
  ]
  const lenses: Array<[Lens, string]> = [
    ['seen', 'Seen'], ['not_seen', 'Not seen'], ['opened', 'Opened'],
    ...(row.kind === 'news' ? [['liked', 'Liked'], ['not_liked', 'Not liked']] as Array<[Lens, string]> : []),
    ['commented', 'Commented'],
    ...(row.kind === 'meeting' ? [['joined', 'Clicked Join'], ['not_joined', 'Did not join']] as Array<[Lens, string]> : []),
    ...(row.kind === 'poll' ? [['voted', 'Voted'], ['not_voted', 'Not voted']] as Array<[Lens, string]> : []),
  ]
  const f = find.trim().toLowerCase()
  const list = all.filter(test[lens]).filter(p => !f || `${p.full_name} ${p.ecode} ${p.department ?? ''} ${p.function_name ?? ''}`.toLowerCase().includes(f))
  const download = () => {
    const head = ['E-code', 'Name', 'Department', 'Function', 'Seen', 'Opened', 'Times opened', 'Liked', 'Comments', 'Join clicks', 'Answer']
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [head, ...list.map(p => [p.ecode, p.full_name, p.department, p.function_name,
      p.seen_at ? fmt(p.seen_at) : '', p.opened_at ? fmt(p.opened_at) : '', p.opens, p.liked_at ? fmt(p.liked_at) : '', p.comments, p.joins, p.voted ?? ''])]
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.map(l => l.map(cell).join(',')).join('\r\n')], { type: 'text/csv' }))
    a.download = `${row.title.replace(/[^\w ]+/g, '').slice(0, 40)} - ${lenses.find(([k]) => k === lens)?.[1]}.csv`
    a.click()
  }

  return (
    <div className="space-y-4 bg-ink-50/60 px-4 py-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {tiles.map(([k, label, v]) => (
          <button key={k} type="button" onClick={() => setLens(k)}
            className={clsx('rounded-xl border px-3 py-2 text-left transition-colors',
              lens === k ? 'border-violet-500 bg-violet-50' : 'border-ink-200 bg-surface hover:border-ink-400')}>
            <p className="text-xs text-ink-500">{label}</p>
            <p className="text-lg font-semibold tabular-nums text-ink-900">{v}<span className="ml-1 text-xs font-normal text-ink-500">{Math.round((v / n) * 100)}%</span></p>
          </button>
        ))}
      </div>
      <p className="text-xs text-ink-500">Out of {all.length} people.</p>

      <div className="flex flex-wrap items-center gap-2">
        {lenses.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setLens(k)}
            className={clsx('rounded-full border px-3 py-1 text-xs font-medium',
              lens === k ? 'border-violet-600 bg-violet-600 text-white' : 'border-ink-300 text-ink-700 hover:border-violet-400')}>
            {label} · {all.filter(test[k]).length}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input className="input !pl-9" value={find} onChange={e => setFind(e.target.value)} placeholder="Name, E-code or department" />
        </div>
        <button type="button" className="btn-secondary" onClick={download} disabled={!list.length}>Download</button>
      </div>
      <div className="max-h-80 overflow-auto rounded-lg border border-ink-200 bg-surface">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-ink-50">
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
              <th className="px-3 py-2">Name</th><th className="px-3 py-2">E-code</th><th className="px-3 py-2">Department</th>
              <th className="px-3 py-2">Seen</th><th className="px-3 py-2">Opened</th>
              {row.kind === 'news' ? <th className="px-3 py-2">Liked</th> : row.kind === 'poll' ? <th className="px-3 py-2">Answer</th> : <th className="px-3 py-2 text-right">Join clicks</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {list.slice(0, 300).map(p => (
              <tr key={p.ecode}>
                <td className="px-3 py-1.5 text-ink-900">{p.full_name}</td>
                <td className="px-3 py-1.5 text-ink-600">{p.ecode}</td>
                <td className="px-3 py-1.5 text-ink-600">{p.department ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-ink-600">{p.seen_at ? fmt(p.seen_at) : '—'}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-ink-600">{p.opened_at ? `${fmt(p.opened_at)}${p.opens > 1 ? ` · ×${p.opens}` : ''}` : '—'}</td>
                {row.kind === 'news'
                  ? <td className="whitespace-nowrap px-3 py-1.5 text-ink-600">{p.liked_at ? fmt(p.liked_at) : '—'}</td>
                  : row.kind === 'poll'
                  ? <td className="px-3 py-1.5 text-ink-700">{p.voted ?? '—'}</td>
                  : <td className="px-3 py-1.5 text-right tabular-nums">{p.joins || '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {list.length > 300 && <p className="px-3 py-2 text-xs text-ink-500">Showing 300 of {list.length}. Download for the full list.</p>}
        {!list.length && <p className="px-3 py-3 text-sm text-ink-500">Nobody.</p>}
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold text-ink-800">Comments · {comments?.length ?? 0}</p>
        <div className="space-y-2">
          {comments?.map(c => (
            <div key={c.id} className="flex items-start gap-2 rounded-lg border border-ink-200 bg-surface px-3 py-2">
              <div className="min-w-0 flex-1 text-sm">
                <p className="text-ink-900"><span className="font-medium">{c.author}</span> <span className="text-xs text-ink-500">{c.ecode} · {fmt(c.created_at)}</span></p>
                <p className="text-ink-700">{c.body}</p>
              </div>
              <button type="button" className="btn-icon text-ink-400 hover:text-cyrixRed-600" title="Delete comment" onClick={() => void del(c.id)}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
