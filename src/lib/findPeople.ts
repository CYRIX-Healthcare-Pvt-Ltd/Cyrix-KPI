import { supabase } from '@/lib/supabase'

export type PersonMatch = { ecode: string; full_name: string; designation: string | null; is_active: boolean }

/**
 * People by name or ecode, best match first (the user, 13 Nov: "where is ajith, e1? first suggestion should be my
 * searched thing" — A–Z with a limit of 8 hid E1 behind E1092, E1715…). The exact ecode, then ecodes starting with
 * it (shortest first), then names starting with it, then names containing it; people who have left go last.
 */
export async function findPeople(typed: string, limit = 10): Promise<PersonMatch[]> {
  const q = typed.trim().replace(/[%,()*\\]/g, ' ').trim()
  if (q.length < 2) return []
  // Two lists, so neither crowds the other out: "e1" matches 512 people, and E1 must still come first.
  const cols = 'ecode, full_name, designation, is_active'
  const [byCode, byName] = await Promise.all([
    supabase.from('employees').select(cols).eq('account_type', 'employee').ilike('ecode', `${q}%`).order('ecode').limit(40),
    supabase.from('employees').select(cols).eq('account_type', 'employee').ilike('full_name', `%${q}%`).order('full_name').limit(40),
  ])
  const seen = new Set<string>()
  const data = [...(byCode.data ?? []), ...(byName.data ?? [])].filter(m => !seen.has(m.ecode) && !!seen.add(m.ecode))
  const t = q.toLowerCase()
  const rank = (m: PersonMatch) => {
    const e = m.ecode.toLowerCase(), n = m.full_name.toLowerCase()
    return e === t ? 0 : e.startsWith(t) ? 1 : n.startsWith(t) ? 2 : n.split(/\s+/).some(w => w.startsWith(t)) ? 3 : 4
  }
  return ((data ?? []) as PersonMatch[]).sort((a, b) =>
    Number(b.is_active) - Number(a.is_active) || rank(a) - rank(b)
    || (rank(a) === 1 ? a.ecode.length - b.ecode.length || a.ecode.localeCompare(b.ecode, undefined, { numeric: true }) : 0)
    || a.full_name.localeCompare(b.full_name)).slice(0, limit)
}
