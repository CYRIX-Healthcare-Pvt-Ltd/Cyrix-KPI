import { useEffect, useState } from 'react'
import type { TatPolicy } from '@/lib/queries'
import { lastDayEnds, timeLeftText, type Side } from '@/lib/lastDay'

/**
 * A running clock to a last day (0153): "1 day 12 hr 32 min left to
 * submit", and inside the last 24 hours with seconds, "5 hr 12 min 33 sec
 * left to submit" (the user, 10 Oct).
 */
export function TimeLeft({ period, side, policy }: { period: string; side: Side; policy: TatPolicy | undefined }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const end = lastDayEnds(period, side, policy)
  if (!end || end.getTime() <= now) return null
  return <span className="tabular-nums">{timeLeftText(end.getTime() - now, side)}</span>
}
