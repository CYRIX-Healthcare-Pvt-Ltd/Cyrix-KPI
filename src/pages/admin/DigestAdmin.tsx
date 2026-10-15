import { useState } from 'react'
import { htmlToMd } from '@/lib/htmlToMd'
import clsx from 'clsx'
import DurationPicker from '@/components/DurationPicker'
import DigestPreview, { type PreviewPost } from '@/components/DigestPreview'
import FormBuilder, { blankQuestion, type Question } from '@/components/FormBuilder'
import DigestAccess from '@/components/DigestAccess'
import MultiPick from '@/components/MultiPick'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Newspaper, Video, ImagePlus, Loader2, Send, Pencil, Trash2, ChevronDown, ChevronRight, Heart, MessageCircle, MousePointerClick, X, Search, BarChart3, Plus,
  Megaphone, TriangleAlert, Pin, Briefcase, Eye, ClipboardList, FileText, PlayCircle, FlaskConical,
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
type Kind = 'news' | 'announcement' | 'alert' | 'notice' | 'vacancy' | 'meeting' | 'poll' | 'form' | 'video'
/** Every kind, its word and its icon (0170; the user: "announcement, alerts, notice, vacancy"). */
const KINDS: Array<[Kind, string, typeof Newspaper]> = [
  ['news', 'News', Newspaper], ['announcement', 'Announcement', Megaphone], ['alert', 'Alert', TriangleAlert],
  ['notice', 'Notice', Pin], ['vacancy', 'Vacancy', Briefcase], ['meeting', 'Meeting', Video], ['poll', 'Poll', BarChart3],
  ['form', 'Form', ClipboardList], ['video', 'Video', PlayCircle],
]
const kindOf = (k: Kind) => KINDS.find(([x]) => x === k) ?? KINDS[0]
/** The kinds that are like news: words, a picture, likes. */
const LIKABLE = new Set<Kind>(['news', 'announcement', 'alert', 'notice', 'vacancy', 'video'])
/**
 * A YouTube video's id from any of its links — youtu.be/…, watch?v=…, shorts/…, embed/…, live/… —
 * or null (0185; the user, 13 Oct: "we are posting videos in YouTube, so I need to put the link in digest").
 */
export const youTubeId = (url: string): string | null => {
  const u = url.trim()
  const m = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/|v\/))([A-Za-z0-9_-]{11})/)
  return m ? m[1] : /^[A-Za-z0-9_-]{11}$/.test(u) ? u : null
}
/** Minutes before a meeting that Join opens (0185; the user: "if I want to keep 30 mins before then I can customise it"). */
// 525600 (a year) is "Anytime": the link shows as soon as the meeting is posted (0194).
const JOIN_EARLY = [5, 10, 15, 30, 45, 60, 525600]
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
  /** This desk may edit it: it posted it, or the poster shared it (0183). */
  can_edit: boolean
  /** The other desks the poster let edit it. */
  editors: string[]
  /** How many people opened it (0184). */
  opened: number
  /** Minutes before the start that Join opens, and a Video post's YouTube id (0185). */
  join_early: number; video_id: string | null
  vac_location: string | null; apply_by: string | null; apply_link: string | null
  /** The last day it is on the portal home (0177); null stays. */
  show_until: string | null
  /** When it went out; null while it is a draft (0182). */
  published_at: string | null
}
interface Draft {
  id: string | null; kind: Kind; title: string; body: string; image_url: string | null; color: Hue
  date: string; minutes: number; link: string; place: string
  /** The link is often not known when the meeting is announced (the user, 12 Oct): ticked, it is asked for. */
  hasLink: boolean
  /** Whether the saved post already had one, so adding it later can tell everybody. */
  hadLink: boolean
  /** A form's questions (0181). Its closing time is `closes`, as a poll's is. */
  questions: Question[]
  /** Already out to people (0182): publishing it again is an edit, and a link added to it is news. */
  wasPublished: boolean
  /** Minutes before the start that Join opens (0185). */
  joinEarly: number
  /** A Video post's YouTube link, as pasted (0185). */
  video: string
  /** A poll (0167): its options, single or multiple choice, and when it closes. */
  options: string[]; multi: boolean; closes: string
  /** A vacancy (0170): where, apply by, and how to apply. */
  vloc: string; vby: string; vlink: string
  /** Show until (0177; the user, 12 Oct: "till which date this post should be there", optional). */
  until: string
}
const EMPTY: Draft = { id: null, kind: 'news', title: '', body: '', image_url: null, color: 'violet', date: '', minutes: 60, link: '', place: '', hasLink: false, hadLink: false, questions: [blankQuestion()], wasPublished: false, joinEarly: 15, video: '', options: ['', ''], multi: false, closes: '', vloc: '', vby: '', vlink: '', until: '' }
const local = (iso: string) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }
const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
// On screen with am/pm (the user, 15 Oct); the download keeps 24-hour fmt.
const fmtAmPm = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).replace(/(am|pm)/i, m => m.toUpperCase())

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
  const [previewing, setPreviewing] = useState(false)
  /*
    A draft sent as a test to a few people first (0187; the user, 13 Oct: "they want to test the
    link, whether it is opening or not … select the participants entering name or ecode").
  */
  const [testing, setTesting] = useState(false)
  const [testers, setTesters] = useState<string[]>([])
  const { data: people = [] } = useQuery({
    queryKey: ['digest_people'],
    enabled: testing,
    staleTime: 10 * 60_000,
    queryFn: async () => ((await supabase.rpc('digest_people_options')).data ?? []) as Array<{ ecode: string; name: string }>,
  })
  const sendTest = useMutation({
    mutationFn: async () => {
      // Saved as a draft first: a test is only ever of a draft.
      const r = await save.mutateAsync(false)
      const { data: n, error } = await supabase.rpc('digest_set_testers', { p_id: r.id, p_ecodes: testers })
      if (error) throw new Error(friendlyError(error))
      await supabase.functions.invoke('push', { body: { action: 'digest_test', post_id: r.id } })
      return n as number
    },
    onSuccess: n => {
      setDone(`Test sent to ${n} ${n === 1 ? 'person' : 'people'}. Only they can see it, marked Test, and Join works for them at once. Publish when it is right.`)
      setTesting(false)
    },
  })
  // Which desk this is, for "posted by" in the preview.
  const { data: desk } = useQuery({
    queryKey: ['digest', 'desk'],
    queryFn: async () => ((await supabase.rpc('digest_can_post')).data as 'hr' | 'it' | 'mkt' | null) ?? 'hr',
  })
  const [open, setOpen] = useState<string | null>(null)
  // Finding a post (the user, 10 Oct: "search and filter dates also").
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  /** Saved as a draft and not touched since: Save draft waits for the next change (the user, 12 Oct). */
  const [draftSaved, setDraftSaved] = useState(false)
  const set = (p: Partial<Draft>) => { setDraftSaved(false); setD(x => ({ ...x, ...p })) }

  const { data: rows } = useQuery({
    queryKey: ['digest_admin'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('digest_admin_list')
      if (error) throw new Error(friendlyError(error))
      return data as Row[]
    },
  })

  const save = useMutation({
    mutationFn: async (publish: boolean) => {
      const isNew = !d.id
      const { data: id, error } = await supabase.rpc('digest_save', {
        p_id: d.id, p_kind: d.kind, p_title: d.title, p_body: d.body, p_image_url: d.image_url ?? '', p_color: d.color,
        p_meet_at: d.kind === 'meeting' && d.date ? new Date(d.date).toISOString() : null,
        p_meet_minutes: d.kind === 'meeting' ? d.minutes : null,
        p_meet_link: d.kind === 'meeting' && d.hasLink ? d.link : null, p_meet_place: d.kind === 'meeting' ? d.place : null,
      })
      if (error) throw new Error(friendlyError(error))
      // A poll ends when it closes, a vacancy on its Apply by (0178), a meeting once it is over (0179):
      // no Show until for them.
      const ownEnd = d.kind === 'poll' || d.kind === 'vacancy' || d.kind === 'meeting' || d.kind === 'form'
      const { error: ue } = await supabase.rpc('digest_set_until', { p_id: id, p_until: ownEnd ? null : d.until || null })
      if (ue) throw new Error(friendlyError(ue))
      if (d.kind === 'vacancy') {
        const { error: ve } = await supabase.rpc('digest_set_vacancy', {
          p_id: id, p_location: d.vloc, p_apply_by: d.vby || null, p_apply_link: d.vlink,
        })
        if (ve) throw new Error(friendlyError(ve))
      }
      if (d.kind === 'meeting') {
        const { error: je } = await supabase.rpc('digest_set_join_early', { p_id: id, p_minutes: d.joinEarly })
        if (je) throw new Error(friendlyError(je))
      }
      if (d.kind === 'video') {
        const { error: ye } = await supabase.rpc('digest_set_video', { p_id: id, p_video_id: youTubeId(d.video) })
        if (ye) throw new Error(friendlyError(ye))
      }
      if (d.kind === 'form') {
        const { error: fe } = await supabase.rpc('digest_set_form', {
          p_id: id,
          p_questions: d.questions.map(q => ({ ...q, label: q.label.trim(), options: q.options.map(o => o.trim()).filter(Boolean) })),
          p_closes_at: d.closes ? new Date(d.closes).toISOString() : null,
        })
        if (fe) throw new Error(friendlyError(fe))
      }
      if (d.kind === 'poll') {
        const { error: pe } = await supabase.rpc('digest_set_poll', {
          p_id: id, p_options: d.options, p_closes_at: d.closes ? new Date(d.closes).toISOString() : null, p_multi: d.multi,
        })
        if (pe) throw new Error(friendlyError(pe))
      }
      // Draft or out (0182; the user, 12 Oct: "if clicked draft, it should be saved but not to be
      // sent to users", "save draft no notification should go").
      const { error: se } = await supabase.rpc('digest_set_published', { p_id: id, p_published: publish })
      if (se) throw new Error(friendlyError(se))
      if (!publish) return { publish, id: id as string, isNew, linkAdded: false, people: 0 }
      // The meeting link arriving after the meeting went out says so (0180).
      const linkAdded = d.wasPublished && d.kind === 'meeting' && d.hasLink && !d.hadLink
      // Publishing tells everybody, a new post or an edit alike, in the same words (the user,
      // 12 Oct: "for editing also notification should go", "updated title not needed").
      const { data: sent } = await supabase.functions.invoke('push', { body: { action: 'digest', post_id: id, link_added: linkAdded } })
      return { publish, id: id as string, isNew, linkAdded, people: (sent as { people?: number } | null)?.people ?? 0 }
    },
    onSuccess: r => {
      qc.invalidateQueries({ queryKey: ['digest_admin'] })
      if (!r.publish) {
        // Still open to carry on with; the next save is the same post, not a new one.
        setDone('Draft saved. Nobody has been told, and it is not on the home page.')
        setD(x => ({ ...x, id: r.id, wasPublished: false, hadLink: x.hasLink }))
        setDraftSaved(true)
        return
      }
      setDone(r.linkAdded ? `Published. ${r.people} people were told the meeting link is ready.` : `Published. ${r.people} people were notified.`)
      setD(EMPTY)
      setDraftSaved(false)
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
  /*
    What a post cannot go out without, by kind (the user, 12 Oct: "make necessary fields
    mandatory before posting, example duration, date, link"). Named as the labels are,
    so the button can say what is left.
  */
  const missing: string[] = []
  const has = (v: string) => v.trim() !== ''
  if (!has(d.title)) missing.push(d.kind === 'poll' ? 'Question' : d.kind === 'vacancy' ? 'Job post' : 'Title')
  if (LIKABLE.has(d.kind) && !has(d.body)) missing.push('Description')
  if (d.kind === 'vacancy') {
    if (!has(d.vloc)) missing.push('Location')
    if (!d.vby) missing.push('Apply by')
    if (!has(d.vlink)) missing.push('How to apply')
  }
  if (d.kind === 'poll') {
    if (d.options.filter(o => o.trim()).length < 2) missing.push('two options')
    if (!d.closes) missing.push('Closes')
  }
  if (d.kind === 'video' && !youTubeId(d.video)) missing.push('YouTube link')
  if (d.kind === 'form') {
    if (!d.questions.length || d.questions.some(q => !q.label.trim())) missing.push('every question')
    if (d.questions.some(q => (q.qtype === 'one' || q.qtype === 'many') && q.options.filter(o => o.trim()).length < 2)) missing.push('two choices for each choice question')
    if (!d.closes) missing.push('Closes')
  }
  if (d.kind === 'meeting') {
    if (!d.date) missing.push('Date and time')
    if (!(d.minutes >= 5 && d.minutes <= 600)) missing.push('Duration')
    if (d.hasLink && !/^https:\/\//.test(d.link.trim())) missing.push('Meeting link')
  }
  const ready = missing.length === 0

  const previewPost: PreviewPost = {
    kind: d.kind, title: d.title.trim() || (d.kind === 'poll' ? 'Your question' : 'Your title'), body: d.body,
    image_url: d.image_url, color: d.color,
    meet_at: d.kind === 'meeting' ? (d.date ? new Date(d.date).toISOString() : new Date(Date.now() + 864e5).toISOString()) : null,
    meet_minutes: d.kind === 'meeting' ? d.minutes : null,
    meet_link: d.kind === 'meeting' && d.hasLink && d.link.trim() ? d.link.trim() : null,
    meet_place: d.kind === 'meeting' ? d.place.trim() || null : null,
    posted_as: desk ?? 'hr', author: null, created_at: new Date().toISOString(),
    likes: 0, liked: false, comments: 0,
    vac_location: d.kind === 'vacancy' ? d.vloc.trim() || null : null,
    apply_by: d.kind === 'vacancy' ? d.vby || null : null,
    apply_link: d.kind === 'vacancy' ? d.vlink.trim() || null : null,
    join_early: d.joinEarly, video_id: d.kind === 'video' ? youTubeId(d.video) : null,
  }

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
          {KINDS.map(([k, word, Icon]) => (
            <button key={k} type="button" onClick={() => set({ kind: k })}
              className={clsx('inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-medium',
                d.kind === k ? 'border-violet-600 bg-violet-600 text-white shadow-sm' : 'border-ink-300 text-ink-700 hover:border-violet-400 hover:text-violet-700')}>
              <Icon className="h-4 w-4" />
              {word}
            </button>
          ))}
          {d.id && (
            <button type="button" onClick={() => { setD(EMPTY); setDraftSaved(false) }} className="ml-auto inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800">
              <X className="h-4 w-4" /> Stop editing
            </button>
          )}
        </div>

        <div>
          <label className="label" htmlFor="dg-title">{d.kind === 'poll' ? 'Question' : d.kind === 'vacancy' ? 'Job post' : 'Title'} <span className="text-cyrixRed-600" aria-hidden>*</span></label>
          <input id="dg-title" className="input" maxLength={120} value={d.title} onChange={e => set({ title: e.target.value })}
            placeholder={({ meeting: 'Quarterly town hall', poll: 'Which day suits the team lunch?', vacancy: 'Biomedical Engineer', alert: 'Office closed tomorrow', notice: 'Holiday list for 2027', announcement: 'New branch opens in Madurai', news: 'Diwali celebration at all offices' } as Record<Kind, string>)[d.kind]} />
        </div>
        <div>
          <label className="label" htmlFor="dg-body">Description{LIKABLE.has(d.kind) && <> <span className="text-cyrixRed-600" aria-hidden>*</span></>}</label>
          <textarea id="dg-body" className="input min-h-[110px]" maxLength={4000} value={d.body} onChange={e => set({ body: e.target.value })}
            onPaste={e => { const h = e.clipboardData.getData('text/html'); if (!h) return; e.preventDefault(); const t = e.currentTarget, md = htmlToMd(h), v = t.value.slice(0, t.selectionStart) + md + t.value.slice(t.selectionEnd); set({ body: v.slice(0, 4000) }) }}
            placeholder={d.kind === 'meeting' ? 'Q2 results, new modules and questions' : d.kind === 'vacancy' ? 'Two years in equipment repair; field travel' : 'Lunch, rangoli and prizes on 30 Oct'} />
        </div>

        {d.kind === 'vacancy' && (
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="dg-vloc">Location <span className="text-cyrixRed-600" aria-hidden>*</span></label>
              <input id="dg-vloc" className="input" value={d.vloc} onChange={e => set({ vloc: e.target.value })} placeholder="Kochi" />
            </div>
            <div>
              <label className="label" htmlFor="dg-vby">Apply by <span className="text-cyrixRed-600" aria-hidden>*</span></label>
              <input id="dg-vby" type="date" className="input" value={d.vby} onChange={e => set({ vby: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="dg-vlink">How to apply <span className="text-cyrixRed-600" aria-hidden>*</span></label>
              <input id="dg-vlink" className="input" value={d.vlink} onChange={e => set({ vlink: e.target.value })} placeholder="hr@cyrix.in" />
            </div>
          </div>
        )}

        {d.kind === 'video' && (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <div>
              <label className="label" htmlFor="dg-video">YouTube link <span className="text-cyrixRed-600" aria-hidden>*</span></label>
              <input id="dg-video" className="input" value={d.video} onChange={e => set({ video: e.target.value })} placeholder="https://youtu.be/…" />
            </div>
            {youTubeId(d.video) && (
              <img src={`https://i.ytimg.com/vi/${youTubeId(d.video)}/hqdefault.jpg`} alt="" className="aspect-video w-full rounded-lg object-cover" />
            )}
          </div>
        )}

        {d.kind === 'form' && (
          <div className="space-y-3">
            <FormBuilder questions={d.questions} onChange={questions => set({ questions })} />
            <div className="max-w-xs">
              <label className="label" htmlFor="dg-fcloses">Closes <span className="text-cyrixRed-600" aria-hidden>*</span></label>
              <input id="dg-fcloses" type="datetime-local" className="input" value={d.closes} onChange={e => set({ closes: e.target.value })} />
            </div>
          </div>
        )}

        {d.kind === 'poll' && (
          <div className="space-y-3">
            <span className="label">Options <span className="text-cyrixRed-600" aria-hidden>*</span></span>
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
                <label className="label" htmlFor="dg-closes">Closes <span className="text-cyrixRed-600" aria-hidden>*</span></label>
                <input id="dg-closes" type="datetime-local" className="input" value={d.closes} onChange={e => set({ closes: e.target.value })} />
              </div>
            </div>
          </div>
        )}

        {d.kind === 'meeting' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="dg-at">Date and time <span className="text-cyrixRed-600" aria-hidden>*</span></label>
              <input id="dg-at" type="datetime-local" className="input" value={d.date} onChange={e => set({ date: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="dg-min">Duration <span className="text-cyrixRed-600" aria-hidden>*</span></label>
              {/* Hours and minutes from two columns (the user, 12 Oct: "how can i select 1 hr 20 mins?"). */}
              <DurationPicker id="dg-min" value={d.minutes} onChange={minutes => set({ minutes })} />
            </div>
            <div>
              <label className="flex items-center gap-2 py-1 text-sm font-medium text-ink-800">
                <input type="checkbox" className="h-4 w-4 accent-violet-600" checked={d.hasLink}
                  onChange={e => set({ hasLink: e.target.checked })} />
                Add meeting link
              </label>
              {d.hasLink && (
                <>
                  <label className="label mt-2" htmlFor="dg-link">Meeting link <span className="text-cyrixRed-600" aria-hidden>*</span></label>
                  <input id="dg-link" className="input" value={d.link} onChange={e => set({ link: e.target.value })} placeholder="https://teams.microsoft.com/l/meetup-join/…" />
                  <span className="label mt-3">Join opens</span>
                  <div className="flex flex-wrap gap-1.5">
                    {JOIN_EARLY.map(m => (
                      <button key={m} type="button" onClick={() => set({ joinEarly: m })}
                        className={clsx('rounded-full border px-3 py-1.5 text-sm font-medium',
                          d.joinEarly === m ? 'border-violet-600 bg-violet-600 text-white' : 'border-ink-300 text-ink-700 hover:border-violet-400 hover:text-violet-700')}>
                        {m >= 525600 ? 'Anytime' : m < 60 ? `${m} min before` : '1 hr before'}
                      </button>
                    ))}
                  </div>
                </>
              )}
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

        {d.kind !== 'poll' && d.kind !== 'vacancy' && d.kind !== 'meeting' && d.kind !== 'form' && <div className="max-w-xs">
          <label className="label" htmlFor="dg-until">Show until · optional</label>
          <input id="dg-until" type="date" className="input" value={d.until}
            min={new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)}
            onChange={e => set({ until: e.target.value })} />
        </div>}

        <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary" disabled={!ready || draftSaved || save.isPending || uploading}
          onClick={() => { setDone(null); save.mutate(false) }}>
          {save.isPending && save.variables === false ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
          {draftSaved ? 'Draft saved' : 'Save draft'}
        </button>
        <button type="button" className="btn-primary" disabled={!ready || save.isPending || uploading} onClick={() => { setDone(null); save.mutate(true) }}>
          {save.isPending && save.variables === true ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {ready ? 'Publish' : `Fill in ${missing.join(', ')}`}
        </button>
        <button type="button" className="btn-secondary" onClick={() => setPreviewing(true)}>
          <Eye className="h-4 w-4" /> Preview
        </button>
        <button type="button" className="btn-secondary" disabled={!ready} onClick={() => setTesting(v => !v)}>
          <FlaskConical className="h-4 w-4" /> Send test
        </button>
        </div>
        {testing && (
          <div className="flex flex-wrap items-end gap-2 rounded-xl border border-ink-200 bg-ink-50/60 p-3">
            <div className="min-w-[16rem] flex-1">
              <label className="label" htmlFor="dg-testers">Send a test to</label>
              <MultiPick id="dg-testers" value={testers} onChange={setTesters} placeholder="Name or E-code"
                options={people.map(m => ({ value: m.ecode, label: m.name, hint: m.ecode }))} />
            </div>
            <button type="button" className="btn-primary" disabled={!testers.length || sendTest.isPending || save.isPending}
              onClick={() => { setDone(null); sendTest.mutate() }}>
              {sendTest.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send test{testers.length ? ` to ${testers.length}` : ''}
            </button>
            {sendTest.error && <p className="w-full text-sm text-cyrixRed-600">{(sendTest.error as Error).message}</p>}
          </div>
        )}
        {previewing && (
          <DigestPreview post={previewPost} options={d.options.filter(o => o.trim())} multi={d.multi}
            closes={(d.kind === 'poll' || d.kind === 'form') && d.closes ? new Date(d.closes).toISOString() : null}
            questions={d.kind === 'form' ? d.questions : []}
            onClose={() => setPreviewing(false)} />
        )}
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
                    {!r.image_url && (() => { const I = kindOf(r.kind)[2]; return <I className="h-4 w-4" /> })()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink-900">
                      {!r.published_at && <span className="badge mr-1.5 bg-amber-100 text-amber-800">Draft</span>}
                      {r.title}
                    </span>
                    <span className="block text-xs text-ink-500">
                      {r.kind === 'meeting' ? `Meeting · ${fmt(r.meet_at!)}` : kindOf(r.kind)[1]} · {r.posted_as === 'it' ? 'IT' : r.posted_as === 'mkt' ? 'Marketing' : 'HR'} · {fmt(r.created_at)}
                      {!r.mine && <span className="ml-1.5 font-medium text-violet-700">· Shared with you</span>}
                      {r.mine && r.editors.length > 0 && <span className="ml-1.5">· Shared with {r.editors.map(x => (x === 'it' ? 'IT' : x === 'mkt' ? 'Marketing' : 'HR')).join(', ')}</span>}
                      {r.show_until && (r.show_until < new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
                        ? <span className="ml-1.5 font-medium text-ink-500">· Ended {new Date(r.show_until).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                        // A meeting already says its date.
                        : r.kind !== 'meeting' && <span className="ml-1.5">· Until {new Date(r.show_until).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>)}
                    </span>
                  </span>
                </button>
                <span className="hidden shrink-0 items-center gap-3 text-xs text-ink-600 sm:flex">
                  {LIKABLE.has(r.kind) && <span className="inline-flex items-center gap-1"><Heart className="h-3.5 w-3.5" /> {r.likes}</span>}
                  <span className="inline-flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" /> {r.comments}</span>
                  {r.kind === 'meeting' && <span className="inline-flex items-center gap-1"><MousePointerClick className="h-3.5 w-3.5" /> {r.joined}</span>}
                  <span className="inline-flex items-center gap-1" title="Opened"><Eye className="h-3.5 w-3.5" /> {r.opened ?? 0}</span>
                </span>
                {r.can_edit && <button type="button" title="Edit" className="btn-icon" onClick={async () => {
                  const form = r.kind === 'form'
                    ? ((await supabase.rpc('digest_form', { p_id: r.id })).data as Array<Question & { id: string; closes_at: string | null }> | null) ?? []
                    : []
                  const poll = r.kind === 'poll'
                    ? ((await supabase.rpc('digest_poll', { p_id: r.id })).data as Array<{ label: string; multi: boolean; closes_at: string | null }> | null) ?? []
                    : []
                  const tested = r.published_at ? [] : ((await supabase.rpc('digest_testers', { p_id: r.id })).data as string[] | null) ?? []
                  setTesters(tested); setTesting(tested.length > 0)
                  setDraftSaved(false)
                  setD({ id: r.id, kind: r.kind, title: r.title, body: r.body, image_url: r.image_url, color: r.color,
                    date: r.meet_at ? local(r.meet_at) : '', minutes: r.meet_minutes ?? 60, link: r.meet_link ?? '', place: r.meet_place ?? '', hasLink: !!r.meet_link, hadLink: !!r.meet_link, wasPublished: !!r.published_at, joinEarly: r.join_early ?? 15, video: r.video_id ? `https://youtu.be/${r.video_id}` : '',
                    options: poll.length ? poll.map(o => o.label) : ['', ''], multi: !!poll[0]?.multi, closes: poll[0]?.closes_at ? local(poll[0].closes_at) : form[0]?.closes_at ? local(form[0].closes_at) : '',
                    questions: form.length ? form.map(q => ({ id: q.id, label: q.label, qtype: q.qtype, options: q.options ?? [], required: q.required })) : [blankQuestion()],
                    vloc: r.vac_location ?? '', vby: r.apply_by ? r.apply_by.slice(0, 10) : '', vlink: r.apply_link ?? '', until: r.kind === 'poll' || r.kind === 'vacancy' || r.kind === 'meeting' || r.kind === 'form' ? '' : r.show_until ?? '' })
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
  /** The latest time they opened it (0200); opened_at is the first. */
  last_opened: string | null
  /** The latest Join click (0209); joined_at is the first. */
  last_joined: string | null
  liked_at: string | null; comments: number; joins: number; joined_at: string | null; voted: string | null
  /** A form (0181): when they sent it, and their answers by question id. */
  answered_at: string | null; answers: Record<string, string | string[]> | null
  /** A video (0185): the most of it they watched, its length, and when they started. */
  watched_seconds: number | null; video_seconds: number | null; watched_at: string | null
  /** Their reporting manager (0211). */
  manager_name: string | null; manager_ecode: string | null
}
type Lens = 'opened' | 'not_opened' | 'liked' | 'not_liked' | 'commented' | 'joined' | 'not_joined' | 'voted' | 'not_voted' | 'answered' | 'not_answered' | 'watched' | 'not_watched'

function Details({ row, readOnly }: { row: Row; readOnly?: boolean }) {
  const qc = useQueryClient()
  const [lens, setLens] = useState<Lens>('opened')
  const [sort, setSort] = useState<{ key: string; asc: boolean } | null>(null)
  const [find, setFind] = useState('')
  const { data: people } = useQuery({
    queryKey: ['digest_people', row.id],
    // A thousand at a time: there are more than 1,000 people, and one request returns at most
    // that many (the user, 12 Oct: "Out of 1000 people", and Tincy, past the cut, was missing).
    queryFn: async () => {
      const out: Person[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.rpc('digest_post_people', { p_id: row.id }).order('full_name').order('ecode').range(from, from + 999)
        if (error) throw new Error(friendlyError(error))
        out.push(...((data ?? []) as Person[]))
        if (!data || data.length < 1000) return out
      }
    },
    // Fresh every time it is opened, and every minute while it stays open (the user, 12 Oct:
    // somebody who opened the post after the panel first loaded was missing from it).
    staleTime: 0,
    refetchOnMount: 'always',
    refetchInterval: 60_000,
  })
  // The names only when asked for (the user, 12 Oct: "need expand only, if 1000 persons
  // clicked the 1000 rows will be there"): the counts above say how many.
  const [showList, setShowList] = useState(false)
  // A form's questions, for its columns.
  const { data: questions = [] } = useQuery({
    queryKey: ['digest_form_q', row.id],
    enabled: row.kind === 'form',
    queryFn: async () => ((await supabase.rpc('digest_form', { p_id: row.id })).data ?? []) as Array<{ id: string; label: string }>,
  })
  const { data: comments } = useQuery({
    queryKey: ['digest_comments', row.id],
    queryFn: async () => (await supabase.rpc('digest_comments_for', { p_id: row.id })).data as Array<{ id: string; author: string; ecode: string; body: string; created_at: string; reply: string | null; reply_desk: string | null; reply_at: string | null; can_reply: boolean }>,
  })
  // The desk's reply to a comment (0202; the user, 15 Oct), sent to whoever wrote it.
  const [replying, setReplying] = useState<{ id: string; text: string } | null>(null)
  const [replyBusy, setReplyBusy] = useState(false)
  const saveReply = async () => {
    if (!replying) return
    setReplyBusy(true)
    try {
      const { error } = await supabase.rpc('digest_reply_comment', { p_comment: replying.id, p_body: replying.text })
      if (error) throw new Error(friendlyError(error))
      if (replying.text.trim()) await supabase.functions.invoke('push', { body: { action: 'digest_reply', comment_id: replying.id } })
      setReplying(null)
      qc.invalidateQueries({ queryKey: ['digest_comments', row.id] })
    } finally { setReplyBusy(false) }
  }
  const del = async (id: string) => {
    await supabase.rpc('digest_delete_comment', { p_id: id })
    qc.invalidateQueries({ queryKey: ['digest_comments', row.id] })
    qc.invalidateQueries({ queryKey: ['digest_admin'] })
    qc.invalidateQueries({ queryKey: ['digest_people', row.id] })
  }

  const all = people ?? []
  const n = all.length || 1
  const test: Record<Lens, (p: Person) => boolean> = {
    opened: p => !!p.opened_at, not_opened: p => !p.opened_at,
    liked: p => !!p.liked_at, not_liked: p => !p.liked_at, commented: p => p.comments > 0,
    joined: p => p.joins > 0, not_joined: p => p.joins === 0,
    voted: p => !!p.voted, not_voted: p => !p.voted,
    answered: p => !!p.answered_at, not_answered: p => !p.answered_at,
    watched: p => (p.watched_seconds ?? 0) > 0, not_watched: p => !p.watched_seconds,
  }
  const tiles: Array<[Lens, string, number]> = [
    ['opened', 'Opened', all.filter(test.opened).length],
    ...(LIKABLE.has(row.kind) ? [['liked', 'Liked', all.filter(test.liked).length] as [Lens, string, number]] : []),
    ['commented', 'Commented', all.filter(test.commented).length],
    ...(row.kind === 'meeting' ? [['joined', 'Clicked Join', all.filter(test.joined).length] as [Lens, string, number]] : []),
    ...(row.kind === 'poll' ? [['voted', 'Voted', all.filter(test.voted).length] as [Lens, string, number]] : []),
    ...(row.kind === 'form' ? [['answered', 'Answered', all.filter(test.answered).length] as [Lens, string, number]] : []),
    ...(row.kind === 'video' ? [['watched', 'Watched', all.filter(test.watched).length] as [Lens, string, number]] : []),
  ]
  const lenses: Array<[Lens, string]> = [
    ['opened', 'Opened'], ['not_opened', 'Not opened'],
    ...(LIKABLE.has(row.kind) ? [['liked', 'Liked'], ['not_liked', 'Not liked']] as Array<[Lens, string]> : []),
    ['commented', 'Commented'],
    ...(row.kind === 'meeting' ? [['joined', 'Clicked Join'], ['not_joined', 'Did not join']] as Array<[Lens, string]> : []),
    ...(row.kind === 'poll' ? [['voted', 'Voted'], ['not_voted', 'Not voted']] as Array<[Lens, string]> : []),
    ...(row.kind === 'form' ? [['answered', 'Answered'], ['not_answered', 'Not answered']] as Array<[Lens, string]> : []),
    ...(row.kind === 'video' ? [['watched', 'Watched'], ['not_watched', 'Not watched']] as Array<[Lens, string]> : []),
  ]
  const f = find.trim().toLowerCase()
  const list = all.filter(test[lens]).filter(p => !f || `${p.full_name} ${p.ecode} ${p.department ?? ''} ${p.function_name ?? ''}`.toLowerCase().includes(f))
  // One sheet with everybody, a Yes/No for each thing, to filter in Excel (the user, 10 Oct).
  /** How much of the video they watched, as a whole percent, or blank. */
  const pct = (p: Person) => (p.watched_seconds && p.video_seconds ? `${Math.min(100, Math.round((p.watched_seconds / p.video_seconds) * 100))}%` : '')
  const mins = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`
  // Watch time as h:mm:ss, and everyone's together in hours (the user, 15 Oct).
  const hms = (sec: number) => `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}:${String(Math.round(sec % 60)).padStart(2, '0')}`
  const totalWatch = all.reduce((t, p) => t + (p.watched_seconds ?? 0), 0)
  const download = () => {
    const yn = (b: boolean) => (b ? 'Yes' : 'No')
    const head = ['E-code', 'Name', 'Department', 'Function', 'Reporting manager', 'Manager E-code', 'Opened', 'First opened', 'Last opened', 'Times opened',
      ...(LIKABLE.has(row.kind) ? ['Liked', 'Liked at'] : []),
      'Commented', 'Comments',
      ...(row.kind === 'meeting' ? ['Clicked Join', 'Join clicks', 'First joined', 'Last joined'] : []),
      ...(row.kind === 'poll' ? ['Voted', 'Answer'] : []),
      ...(row.kind === 'form' ? ['Answered', 'Answered at', ...questions.map(q => q.label)] : []),
      ...(row.kind === 'video' ? ['Watched', 'Watch time (h:mm:ss)', 'Minutes watched', 'Video minutes', 'Percent watched', 'Started'] : [])]
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [head, ...all.map(p => [p.ecode, p.full_name, p.department, p.function_name, p.manager_name ?? '', p.manager_ecode ?? '',
      yn(!!p.opened_at), p.opened_at ? fmt(p.opened_at) : '', p.last_opened ? fmt(p.last_opened) : '', p.opens,
      ...(LIKABLE.has(row.kind) ? [yn(!!p.liked_at), p.liked_at ? fmt(p.liked_at) : ''] : []),
      yn(p.comments > 0), p.comments,
      ...(row.kind === 'meeting' ? [yn(p.joins > 0), p.joins, p.joined_at ? fmt(p.joined_at) : '', p.last_joined ? fmt(p.last_joined) : ''] : []),
      ...(row.kind === 'poll' ? [yn(!!p.voted), p.voted ?? ''] : []),
      ...(row.kind === 'form' ? [yn(!!p.answered_at), p.answered_at ? fmt(p.answered_at) : '',
        ...questions.map(q => { const v = p.answers?.[q.id]; return Array.isArray(v) ? v.join(', ') : v ?? '' })] : []),
      ...(row.kind === 'video' ? [yn(!!p.watched_seconds), p.watched_seconds ? hms(p.watched_seconds) : '', p.watched_seconds ? (p.watched_seconds / 60).toFixed(1) : '',
        p.video_seconds ? (p.video_seconds / 60).toFixed(1) : '', pct(p), p.watched_at ? fmt(p.watched_at) : ''] : [])])]
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.map(l => l.map(cell).join(',')).join('\r\n')], { type: 'text/csv' }))
    a.download = `${row.title.replace(/[^\w ]+/g, '').slice(0, 40)}.csv`
    a.click()
  }

  return (
    <div className="space-y-4 bg-ink-50/60 px-4 py-4">
      <DigestAccess postId={row.id} owner={row.posted_as as 'hr' | 'it' | 'mkt'} mine={row.mine} editors={row.editors ?? []} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {tiles.map(([k, label, v]) => (
          <button key={k} type="button" onClick={() => setLens(k)}
            className={clsx('rounded-xl border px-3 py-2 text-left transition-colors',
              lens === k ? 'border-violet-500 bg-violet-50' : 'border-ink-200 bg-surface hover:border-ink-400')}>
            <p className="text-xs text-ink-500">{label}</p>
            <p className="text-lg font-semibold tabular-nums text-ink-900">{v}<span className="ml-1 text-xs font-normal text-ink-500">{Math.round((v / n) * 100)}%</span></p>
          </button>
        ))}
      </div>
      <p className="text-xs text-ink-500">Out of {all.length} people.{row.kind === 'video' && totalWatch > 0 && <> Watched in all: <strong className="text-ink-800">{Math.floor(totalWatch / 3600)} h {Math.round((totalWatch % 3600) / 60)} min</strong>.</>}</p>

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
        <button type="button" className="btn-secondary" onClick={() => setShowList(v => !v)}>
          {showList ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          {showList ? 'Hide names' : `Show names · ${list.length}`}
        </button>
        <button type="button" className="btn-secondary" onClick={download} disabled={!all.length}>Download all</button>
      </div>
      {showList && (() => {
        // Every column sorts (the user, 15 Oct): click once for A–Z / earliest / fewest, again to reverse.
        const lastKey = row.kind === 'video' ? 'watched' : LIKABLE.has(row.kind) ? 'liked' : row.kind === 'poll' ? 'voted' : row.kind === 'form' ? 'answered' : 'joins'
        const val = (p: Person, k: string): string | number => {
          switch (k) {
            case 'name': return p.full_name.toLowerCase()
            case 'ecode': return p.ecode.toLowerCase()
            case 'dept': return (p.department ?? '').toLowerCase()
            case 'opened': return p.opened_at ?? ''
            case 'last': return p.last_opened ?? ''
            case 'watched': return p.watched_seconds ?? 0
            case 'liked': return p.liked_at ?? ''
            case 'voted': return (p.voted ?? '').toLowerCase()
            case 'answered': return p.answered_at ?? ''
            case 'firstjoin': return p.joined_at ?? ''
            case 'lastjoin': return p.last_joined ?? ''
            default: return p.joins ?? 0
          }
        }
        const rows = sort ? [...list].sort((a, b) => {
          const x = val(a, sort.key), y = val(b, sort.key)
          return (x < y ? -1 : x > y ? 1 : 0) * (sort.asc ? 1 : -1)
        }) : list
        const Th = ({ k, label, right }: { k: string; label: string; right?: boolean }) => (
          <th className={clsx('px-3 py-2', right && 'text-right')}>
            <button type="button" className="inline-flex items-center gap-1 uppercase hover:text-ink-900"
              onClick={() => setSort(s => s?.key === k ? { key: k, asc: !s.asc } : { key: k, asc: true })}>
              {label}<span className="text-[10px]">{sort?.key === k ? (sort.asc ? '▲' : '▼') : '↕'}</span>
            </button>
          </th>
        )
        return <div className="max-h-80 overflow-auto rounded-lg border border-ink-200 bg-surface">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-ink-50">
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
              <Th k="name" label="Name" /><Th k="ecode" label="E-code" /><Th k="dept" label="Department" />
              <Th k="opened" label="First opened" /><Th k="last" label="Last opened" />
              <Th k={lastKey} label={{ watched: 'Watched', liked: 'Liked', voted: 'Answer', answered: 'Answered', joins: 'Join clicks' }[lastKey]!} right={lastKey === 'joins'} />
              {lastKey === 'joins' && <><Th k="firstjoin" label="First joined" /><Th k="lastjoin" label="Last joined" /></>}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.slice(0, 300).map(p => (
              <tr key={p.ecode}>
                <td className="px-3 py-1.5 text-ink-900">{p.full_name}</td>
                <td className="px-3 py-1.5 text-ink-600">{p.ecode}</td>
                <td className="px-3 py-1.5 text-ink-600">{p.department ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-ink-600">{p.opened_at ? `${fmtAmPm(p.opened_at)}${p.opens > 1 ? ` · ×${p.opens}` : ''}` : '—'}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-ink-600">{p.last_opened && p.opens > 1 ? fmtAmPm(p.last_opened) : '—'}</td>
                {row.kind === 'video'
                  ? <td className="whitespace-nowrap px-3 py-1.5 text-ink-600">{p.watched_seconds ? `${mins(p.watched_seconds)}${p.video_seconds ? ` of ${mins(p.video_seconds)} · ${pct(p)}` : ''}` : '—'}</td>
                  : LIKABLE.has(row.kind)
                  ? <td className="whitespace-nowrap px-3 py-1.5 text-ink-600">{p.liked_at ? fmtAmPm(p.liked_at) : '—'}</td>
                  : row.kind === 'poll'
                  ? <td className="px-3 py-1.5 text-ink-700">{p.voted ?? '—'}</td>
                  : row.kind === 'form'
                  ? <td className="whitespace-nowrap px-3 py-1.5 text-ink-600">{p.answered_at ? fmtAmPm(p.answered_at) : '—'}</td>
                  : <td className="px-3 py-1.5 text-right tabular-nums">{p.joins || '—'}</td>}
                {lastKey === 'joins' && <>
                  <td className="whitespace-nowrap px-3 py-1.5 text-ink-600">{p.joined_at ? fmtAmPm(p.joined_at) : '—'}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-ink-600">{p.last_joined && p.joins > 1 ? fmtAmPm(p.last_joined) : '—'}</td>
                </>}
              </tr>
            ))}
          </tbody>
        </table>
        {list.length > 300 && <p className="px-3 py-2 text-xs text-ink-500">Showing 300 of {list.length}. Download all for everybody.</p>}
        {!list.length && <p className="px-3 py-3 text-sm text-ink-500">Nobody.</p>}
      </div>
      })()}

      <div>
        <p className="mb-2 text-sm font-semibold text-ink-800">Comments · {comments?.length ?? 0}</p>
        <div className="space-y-2">
          {comments?.map(c => (
            <div key={c.id} className="flex items-start gap-2 rounded-lg border border-ink-200 bg-surface px-3 py-2">
              <div className="min-w-0 flex-1 text-sm">
                <p className="text-ink-900"><span className="font-medium">{c.author}</span> <span className="text-xs text-ink-500">{c.ecode} · {fmt(c.created_at)}</span></p>
                <p className="text-ink-700">{c.body}</p>
                {c.reply && replying?.id !== c.id && (
                  <div className="mt-1.5 rounded-lg border-l-2 border-violet-500 bg-violet-50 px-2.5 py-1.5 dark:bg-violet-500/10">
                    <p className="text-xs font-semibold text-violet-700">{({ hr: 'HR', it: 'IT', mkt: 'Marketing' } as Record<string, string>)[c.reply_desk ?? ''] ?? 'Reply'}{c.reply_at ? <span className="font-normal text-ink-500"> · {fmtAmPm(c.reply_at)}</span> : null}</p>
                    <p className="text-ink-800">{c.reply}</p>
                  </div>
                )}
                {replying?.id === c.id ? (
                  <div className="mt-1.5 flex flex-col gap-1.5">
                    <textarea className="input min-h-[60px]" autoFocus maxLength={1000} value={replying.text}
                      onChange={e => setReplying({ id: c.id, text: e.target.value })} placeholder="Your reply" />
                    <div className="flex gap-1.5">
                      <button type="button" className="btn-primary" disabled={replyBusy} onClick={() => void saveReply()}>
                        {replyBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {replying.text.trim() ? 'Send reply' : 'Remove reply'}
                      </button>
                      <button type="button" className="btn-secondary" onClick={() => setReplying(null)}>Cancel</button>
                    </div>
                  </div>
                ) : !readOnly && c.can_reply && (
                  <button type="button" className="mt-1 text-xs font-medium text-violet-700 hover:underline" onClick={() => setReplying({ id: c.id, text: c.reply ?? '' })}>
                    {c.reply ? 'Edit reply' : 'Reply'}
                  </button>
                )}
              </div>
              {!readOnly && <button type="button" className="btn-icon text-ink-400 hover:text-cyrixRed-600" title="Delete comment" onClick={() => void del(c.id)}><Trash2 className="h-4 w-4" /></button>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/*
  SW Admin's Digest tab (0191; the user, 14 Oct): every post from IT, HR and Marketing, drafts and
  deleted ones too, so a post a desk deletes stays here as history. Read only; Details as the desks see it.
*/
interface SwRow {
  id: string; kind: Kind; title: string; body: string; posted_as: 'hr' | 'it' | 'mkt'; author: string | null
  created_at: string; published_at: string | null; deleted_at: string | null; deleted_by: string | null
  meet_at: string | null; likes: number; comments: number; opened: number; joined: number
  /** Over: a meeting that ended, a form or poll that closed, a post past its last day (0210). */
  ended?: boolean
}
const DESK_WORD = { hr: 'HR', it: 'IT', mkt: 'Marketing' } as const

export function DigestHistory() {
  const [find, setFind] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ['digest_sw_list'],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('digest_sw_list')
      if (error) throw new Error(friendlyError(error))
      return (data ?? []) as SwRow[]
    },
  })
  const q = find.trim().toLowerCase()
  const shown = q ? rows.filter(r => [r.title, r.body, r.author, DESK_WORD[r.posted_as], kindOf(r.kind)[1], r.deleted_by]
    .some(x => x?.toLowerCase().includes(q))) : rows
  const when = (t: string) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <input className="input pl-9" placeholder="Title, words, desk or person" value={find} onChange={e => setFind(e.target.value)} aria-label="Search posts" />
      </div>
      {isLoading && <Loader2 className="h-5 w-5 animate-spin text-ink-400" />}
      {error && <p className="text-sm text-cyrixRed-600">{(error as Error).message}</p>}
      <div className="space-y-2">
        {shown.map(r => {
          const [, word, Icon] = kindOf(r.kind)
          return (
            <div key={r.id} className={clsx('card p-3', r.deleted_at && 'opacity-80')}>
              <button type="button" className="flex w-full items-center gap-3 text-left" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                {open === r.id ? <ChevronDown className="h-4 w-4 shrink-0 text-ink-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" />}
                <Icon className="h-5 w-5 shrink-0 text-ink-500" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {r.deleted_at ? <span className="badge bg-cyrixRed-50 text-cyrixRed-700">Deleted</span>
                      : !r.published_at ? <span className="badge bg-amber-100 text-amber-800">Draft</span>
                      : r.ended ? <span className="badge bg-ink-100 text-ink-600">Ended</span>
                      : <span className="badge bg-emerald-50 text-emerald-700">Live</span>}
                    <span className="truncate font-medium text-ink-900">{r.title}</span>
                  </div>
                  <p className="text-xs text-ink-500">
                    {word} · {DESK_WORD[r.posted_as]}{r.author ? ` · ${r.author}` : ''} · {when(r.created_at)}
                    {r.deleted_at && ` · Deleted ${when(r.deleted_at)}${r.deleted_by ? ` by ${r.deleted_by}` : ''}`}
                  </p>
                </div>
                <span className="hidden shrink-0 gap-3 text-xs tabular-nums text-ink-500 sm:flex">
                  <span title="Opened"><Eye className="mr-1 inline h-3.5 w-3.5" />{r.opened}</span>
                  <span title="Likes"><Heart className="mr-1 inline h-3.5 w-3.5" />{r.likes}</span>
                  <span title="Comments"><MessageCircle className="mr-1 inline h-3.5 w-3.5" />{r.comments}</span>
                  {r.kind === 'meeting' && <span title="Joined"><Video className="mr-1 inline h-3.5 w-3.5" />{r.joined}</span>}
                </span>
              </button>
              {open === r.id && <div className="mt-3"><Details readOnly row={{ ...r, mine: false, editors: [] } as unknown as Row} /></div>}
            </div>
          )
        })}
        {!isLoading && !shown.length && <p className="text-sm text-ink-500">No posts</p>}
      </div>
    </div>
  )
}
