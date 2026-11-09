import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { History, Loader2, Search, Users } from 'lucide-react'
import { supabase, friendlyError } from '@/lib/supabase'

/**
 * Who else may edit a Cyrix Digest post, and everything done to it (0183; the user, 12 Oct:
 * "IT admin should have an option to grant edit access, he has option HR admin and MRK admin,
 * he can tick any and save, so need edit logs also, and delete option only for the owner").
 * The desk that posted it ticks the others; they see it in their own Digest tab and can edit
 * and publish it. Deleting stays the owner's.
 *
 * Since 0270 (the user, 9 Nov: "ya change desk to person"): a post is the person's who posted it, and they share it
 * with people — everyone who can post on the Digest, listed under their desk ("first dept and then person").
 */
type Desk = 'hr' | 'it' | 'mkt' | 'mgmt'
const DESK: Record<Desk, string> = { hr: 'HR', it: 'IT', mkt: 'Marketing', mgmt: 'Management' }
/** The post's fields as the form names them. */
const FIELD: Record<string, string> = {
  title: 'Title', body: 'Description', image_url: 'Photo', color: 'Colour', kind: 'Kind',
  meet_at: 'Date and time', meet_minutes: 'Duration', meet_link: 'Meeting link', meet_place: 'Where',
  show_until: 'Show until', vac_location: 'Location', apply_by: 'Apply by', apply_link: 'How to apply',
  closes_at: 'Closes', multi: 'Multiple answers', questions: 'Questions', options: 'Options',
}
const ACTION: Record<string, string> = {
  created: 'Created', edited: 'Edited', published: 'Published', drafted: 'Saved as a draft',
  access: 'Edit access', deleted: 'Deleted',
}
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })

type Person = { employee_id: string; ecode: string; full_name: string; desk: Desk; ticked: boolean }
const ORDER: Desk[] = ['mgmt', 'hr', 'it', 'mkt']

export default function DigestAccess({ postId, owner, author, mine }: {
  postId: string
  /** The desk it was posted from. */
  owner: Desk
  /** Who posted it. */
  author: string | null
  /** This person posted it: only then can they share it. */
  mine: boolean
}) {
  const qc = useQueryClient()
  const { data: people } = useQuery({
    queryKey: ['digest_editor_people', postId],
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('digest_editor_people', { p_id: postId })
      if (error) throw new Error(friendlyError(error))
      return data as Person[]
    },
  })
  const saved = (people ?? []).filter(p => p.ticked).map(p => p.employee_id)
  const [ticked, setTicked] = useState<string[]>([])
  useEffect(() => setTicked(saved), [people]) // eslint-disable-line react-hooks/exhaustive-deps
  const changed = [...ticked].sort().join() !== [...saved].sort().join()

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('digest_set_editor_people', { p_id: postId, p_people: ticked })
      if (error) throw new Error(friendlyError(error))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['digest_admin'] })
      qc.invalidateQueries({ queryKey: ['digest_editor_people', postId] })
      qc.invalidateQueries({ queryKey: ['digest_log', postId] })
    },
  })
  const shared = (people ?? []).filter(p => p.ticked)
  // Folded to one line until Change is pressed (the user, 9 Nov: "why that who can edit container is always open? what
  // if list is big?"); a search once the list is long.
  const [open, setOpen] = useState(false)
  const [find, setFind] = useState('')
  const f = find.trim().toLowerCase()
  const listed = (people ?? []).filter(p => !f || `${p.full_name} ${p.ecode} ${DESK[p.desk]}`.toLowerCase().includes(f))
  const { data: log } = useQuery({
    queryKey: ['digest_log', postId],
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async () => {
      const { data, error } = await supabase.rpc('digest_edit_log', { p_id: postId })
      if (error) throw new Error(friendlyError(error))
      return data as Array<{ at: string; ecode: string | null; full_name: string | null; desk: string | null; action: string; fields: string[] }>
    },
  })

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="rounded-lg border border-ink-200 bg-surface p-3">
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink-800"><Users className="h-4 w-4 text-ink-400" /> Who can edit</p>
        <p className="text-sm text-ink-700">{author ?? DESK[owner]} <span className="text-ink-400">· {DESK[owner]} · posted it, the only one who can delete it</span></p>
        {mine && !open ? (
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink-700">{shared.length ? <>{shared.map(p => p.full_name).join(', ')} <span className="text-ink-400">· can edit and publish</span></> : <span className="text-ink-400">Not shared</span>}</p>
            <button type="button" className="btn-secondary !px-3 !py-1.5 text-sm" onClick={() => setOpen(true)}>Change</button>
          </div>
        ) : mine ? (
          <div className="mt-2 space-y-2.5">
            {(people ?? []).length > 8 && (
              <label className="relative block">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <input className="input h-9 !pl-8 text-sm" value={find} placeholder="Name or E-code" onChange={e => setFind(e.target.value)} />
              </label>
            )}
            <div className="max-h-64 space-y-2.5 overflow-auto">
            {ORDER.filter(d => listed.some(p => p.desk === d)).map(d => (
              <div key={d}>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">{DESK[d]}</p>
                <div className="space-y-1">
                  {listed.filter(p => p.desk === d).map(p => (
                    <label key={p.employee_id} className="flex items-center gap-2 text-sm text-ink-800">
                      <input type="checkbox" className="h-4 w-4 accent-violet-600" checked={ticked.includes(p.employee_id)}
                        onChange={e => setTicked(t => (e.target.checked ? [...t, p.employee_id] : t.filter(y => y !== p.employee_id)))} />
                      {p.full_name} <span className="text-xs text-ink-400">{p.ecode}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn-secondary !px-3 !py-1.5 text-sm" disabled={!changed || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => { setOpen(false); setFind('') } })}>
                {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
              </button>
              <button type="button" className="text-sm text-ink-500 hover:text-ink-800" onClick={() => { setOpen(false); setFind(''); setTicked(saved) }}>Cancel</button>
              {save.error && <span className="text-sm text-cyrixRed-600">{(save.error as Error).message}</span>}
            </div>
          </div>
        ) : shared.length > 0 && (
          <p className="mt-1 text-sm text-ink-700">{shared.map(p => p.full_name).join(', ')} <span className="text-ink-400">· can edit and publish</span></p>
        )}
      </div>
      <div className="rounded-lg border border-ink-200 bg-surface p-3">
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink-800"><History className="h-4 w-4 text-ink-400" /> Edit history</p>
        <div className="max-h-48 space-y-1.5 overflow-auto text-sm">
          {(log ?? []).map((l, i) => (
            <div key={i} className="flex items-start justify-between gap-3">
              <span className="min-w-0 text-ink-800">
                {ACTION[l.action] ?? l.action}
                {l.action === 'edited' && l.fields.length > 0 && <span className="text-ink-500"> · {l.fields.map(f => FIELD[f] ?? f).join(', ')}</span>}
                {l.action === 'access' && <span className="text-ink-500"> · {l.fields.length ? l.fields.map(f => DESK[f as Desk] ?? f).join(', ') : 'nobody else'}</span>}
                <span className="block text-xs text-ink-500">{l.full_name ?? 'Someone'}{l.ecode ? ` · ${l.ecode}` : ''}{l.desk ? ` · ${DESK[l.desk as Desk] ?? l.desk}` : ''}</span>
              </span>
              <span className="shrink-0 text-xs text-ink-500">{when(l.at)}</span>
            </div>
          ))}
          {log && !log.length && <p className="text-ink-500">Nothing yet.</p>}
        </div>
      </div>
    </div>
  )
}
