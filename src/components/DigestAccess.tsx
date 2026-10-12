import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { History, Loader2, Users } from 'lucide-react'
import { supabase, friendlyError } from '@/lib/supabase'

/**
 * Who else may edit a Cyrix Digest post, and everything done to it (0183; the user, 12 Oct:
 * "IT admin should have an option to grant edit access, he has option HR admin and MRK admin,
 * he can tick any and save, so need edit logs also, and delete option only for the owner").
 * The desk that posted it ticks the others; they see it in their own Digest tab and can edit
 * and publish it. Deleting stays the owner's.
 */
type Desk = 'hr' | 'it' | 'mkt'
const DESK: Record<Desk, string> = { hr: 'HR', it: 'IT', mkt: 'Marketing' }
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

export default function DigestAccess({ postId, owner, mine, editors }: {
  postId: string
  /** The desk that posted it. */
  owner: Desk
  /** This desk posted it: only then can it share it. */
  mine: boolean
  editors: string[]
}) {
  const qc = useQueryClient()
  const others = (['hr', 'it', 'mkt'] as Desk[]).filter(x => x !== owner)
  const [ticked, setTicked] = useState<string[]>(editors)
  useEffect(() => setTicked(editors), [editors])
  const changed = [...ticked].sort().join() !== [...editors].sort().join()

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('digest_set_editors', { p_id: postId, p_desks: ticked })
      if (error) throw new Error(friendlyError(error))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['digest_admin'] })
      qc.invalidateQueries({ queryKey: ['digest_log', postId] })
    },
  })
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
        <p className="text-sm text-ink-700">{DESK[owner]} <span className="text-ink-400">· posted it, the only one who can delete it</span></p>
        {mine ? (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {others.map(x => (
              <label key={x} className="inline-flex items-center gap-1.5 text-sm text-ink-800">
                <input type="checkbox" className="h-4 w-4 accent-violet-600" checked={ticked.includes(x)}
                  onChange={e => setTicked(t => (e.target.checked ? [...t, x] : t.filter(y => y !== x)))} />
                {DESK[x]}
              </label>
            ))}
            <button type="button" className="btn-secondary !px-3 !py-1.5 text-sm" disabled={!changed || save.isPending} onClick={() => save.mutate()}>
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </button>
            {save.error && <span className="text-sm text-cyrixRed-600">{(save.error as Error).message}</span>}
          </div>
        ) : (
          <p className="mt-1 text-sm text-ink-700">{editors.map(x => DESK[x as Desk] ?? x).join(', ')} <span className="text-ink-400">· can edit and publish</span></p>
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
