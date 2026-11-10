import { useState } from 'react'
import clsx from 'clsx'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Crown } from 'lucide-react'
import { supabase, friendlyError } from '@/lib/supabase'
import { Alert, Spinner } from '@/components/ui'

/*
  SW Admin → Platform: settings for the portal home (app.cyrix.in). The gold "Oct-26 Rank 1s" bar can be turned off and
  on (the user, 10 Nov: "if it becomes contreversial, i need to disbale it"); off, Cyrix Digest fills the row (0277).
  Asks before changing, the answer beside the button.
*/
export default function PlatformAdmin() {
  const qc = useQueryClient()
  const { data: on, isLoading } = useQuery({
    queryKey: ['platform', 'rank-ones-on'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('portal_rank_ones_on')
      if (error) throw new Error(friendlyError(error))
      return data !== false
    },
  })
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: async (next: boolean) => {
      const { error } = await supabase.rpc('portal_set_rank_ones', { p_on: next })
      if (error) throw new Error(friendlyError(error))
      return next
    },
    onSuccess: next => {
      setAsking(false); setError(null)
      setDone(next ? 'Turned on. The Rank 1s bar shows on the portal home.' : 'Turned off. Cyrix Digest fills the row.')
      void qc.invalidateQueries({ queryKey: ['platform', 'rank-ones-on'] })
    },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="card max-w-2xl overflow-hidden">
      <div className="flex items-center gap-2 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
        <Crown className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-semibold text-ink-800">Rank 1s bar on the portal home</h3>
      </div>
      <div className="space-y-3 p-4">
        {isLoading ? <Spinner className="h-4 w-4 text-ink-400" /> : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className={clsx('rounded-full px-3 py-1 text-sm font-semibold',
                on ? 'bg-emerald-50 text-emerald-700' : 'bg-ink-100 text-ink-600')}>
                {on ? 'On' : 'Off'}
              </span>
              {!asking && (
                <button type="button" className={on ? 'btn-secondary' : 'btn-primary'} onClick={() => { setAsking(true); setDone(null); setError(null) }}>
                  {on ? 'Turn off' : 'Turn on'}
                </button>
              )}
            </div>
            {asking && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm font-medium text-ink-900">
                  {on ? 'Turn off the Rank 1s bar for everybody?' : 'Turn on the Rank 1s bar for everybody?'}
                </p>
                <div className="mt-2 flex gap-2">
                  <button type="button" className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(!on)}>
                    {save.isPending ? <Spinner className="h-4 w-4" /> : on ? 'Yes, turn off' : 'Yes, turn on'}
                  </button>
                  <button type="button" className="btn-secondary" disabled={save.isPending} onClick={() => { setAsking(false); setError(null) }}>Cancel</button>
                </div>
              </div>
            )}
            {error && <Alert kind="error">{error}</Alert>}
            {done && <Alert kind="success">{done}</Alert>}
          </>
        )}
      </div>
    </div>
  )
}
