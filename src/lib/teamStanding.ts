import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/*
  The team card's data (kpi_team_standing), shared by the card and the Dashboard, which hides its own month-by-month
  chart while the card shows. The Dashboard waits for the same answer, so the old chart no longer flashes up for a
  moment on a reload (the user, 9 Nov: "why on reloading it is showing?").
*/
export type TeamRow = { employee_id: string; ecode: string; full_name: string; designation: string | null; is_me: boolean
  manager_name: string; period_month: string | null; score: number | null; team_rank: number | null; team_of: number | null
  months: number | null; team_avg: number | null; band_from: number | null; prev_rank: number | null
  ytd_rank: number | null; ytd_of: number | null; shape: number | null
  /** The team's average job role, ESMS and core values points (0274). */
  team_avg_job?: number | null; team_avg_esms?: number | null; team_avg_core?: number | null }

export function useTeamStanding(fy: string) {
  return useQuery({
    queryKey: ['kpi_team_standing', fy],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('kpi_team_standing', { p_fy: fy })
      if (error) throw error
      return (data ?? []) as TeamRow[]
    },
  })
}

/** The card shows when I am in a team of two or more with at least one ranked month. */
export const teamCardShows = (rows: TeamRow[]) =>
  rows.some(r => r.is_me) && new Set(rows.map(r => r.employee_id)).size >= 2 && rows.some(r => r.period_month && r.team_rank != null)
