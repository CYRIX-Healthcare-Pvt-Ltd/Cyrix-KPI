import { useEffect, useState } from 'react'

/** A phone-width screen (under Tailwind's sm), kept up to date as it turns or resizes. */
export function useNarrow() {
  const query = '(max-width: 639px)'
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches)
  useEffect(() => {
    const q = window.matchMedia?.(query)
    if (!q) return
    const on = () => setNarrow(q.matches)
    on()
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [])
  return narrow
}
