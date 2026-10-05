import { useQuery } from '@tanstack/react-query'
import { supabase, friendlyError } from '@/lib/supabase'

/** Somebody active with no login, and whether their address is already taken by an account not linked to them. */
export interface MissingLogin {
  ecode: string
  full_name: string
  created_at: string
  unlinked: boolean
}

/** Who has no login yet — HR's and the software administrator's screens offer to make them. */
export function useMissingLogins() {
  return useQuery({
    queryKey: ['missing_logins'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('hr_missing_logins')
      if (error) throw new Error(friendlyError(error))
      return (data ?? []) as MissingLogin[]
    },
  })
}

export interface LoginRun {
  created: string[]
  /** "E1234: why", for any the database could not make. */
  failed: string[]
  /** Codes whose address belongs to an account not linked to them: not made here. */
  unlinked: string[]
}

/**
 * A login for everybody active who has none (0143).
 *
 * Each one is made as "Create their login" makes it — the employee code as
 * the user and the first password — in batches of twenty, because every
 * login is a password hash and a whole company in one call would run past
 * the database's time limit. Asks again while the batches make progress.
 *
 * This replaced the create-logins edge function at the end of a bulk
 * import, which on 3 Oct made none of the eight people imported.
 */
export async function createMissingLogins(onProgress?: (made: number) => void): Promise<LoginRun> {
  const created: string[] = []
  const failed = new Map<string, string>()
  let unlinked: string[] = []
  for (let round = 0; round < 100; round++) {
    const { data, error } = await supabase.rpc('hr_create_missing_logins', { p_limit: 20 })
    if (error) throw new Error(friendlyError(error))
    const said = data as { created: string[]; failed: string[]; unlinked: string[]; remaining: number }
    created.push(...said.created)
    said.failed.forEach(f => failed.set(f.split(':')[0], f))
    unlinked = said.unlinked
    onProgress?.(created.length)
    // Nothing left, or nothing moving: either way, stop asking.
    if (!said.remaining || said.created.length === 0) break
  }
  return { created, failed: [...failed.values()], unlinked }
}
