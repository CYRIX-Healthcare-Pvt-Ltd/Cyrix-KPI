import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import 'leaflet/dist/leaflet.css'

/*
  A person's day on the map for SW Admin's Km vs map (the user, 5 Nov: "can we get full ride map? like we check in claim
  form with stops"): the same look as Travel's "See on map" — the rides along the real roads, numbered stops, each ride
  with its km — from the rides the report already has. Hovering a ride or its row lifts it and dims the rest.
*/
export interface MapRide {
  way: string; mode: string; map_km: number | null; claimed_km: number | null; amount?: number | null
  from_lat?: number | null; from_lng?: number | null; to_lat?: number | null; to_lng?: number | null
}

/* Each mode in the colours of Travel's claim form (src/lib/claims.ts MODES): bike orange, car blue. */
const MODE_LOOK: Record<string, { label: string; color: string; bg: string; fg: string }> = {
  bike: { label: 'Bike', color: '#EF9F27', bg: '#FEF3C7', fg: '#78350F' },
  car: { label: 'Car', color: '#2563EB', bg: '#DBEAFE', fg: '#1E3A8A' },
  bus: { label: 'Bus', color: '#16A34A', bg: '#DCFCE7', fg: '#14532D' },
  train: { label: 'Train', color: '#7C3AED', bg: '#EDE9FE', fg: '#4C1D95' },
  metro: { label: 'Metro', color: '#06B6D4', bg: '#CFFAFE', fg: '#164E63' },
  auto: { label: 'Auto', color: '#DB2777', bg: '#FCE7F3', fg: '#831843' },
  taxi: { label: 'Taxi · Car', color: '#374151', bg: '#E5E7EB', fg: '#111827' },
  taxi_bike: { label: 'Taxi · Bike', color: '#0D9488', bg: '#CCFBF1', fg: '#134E4A' },
  flight: { label: 'Flight', color: '#92400E', bg: '#FDE7D3', fg: '#7C2D12' },
}
const PER_KM = new Set(['bike', 'car'])
const rupee = (v: number | null | undefined) => (v == null ? '—' : `₹${Math.round(v).toLocaleString('en-IN')}`)
const look = (m: string) => MODE_LOOK[m] ?? { label: m, color: '#7F77DD', bg: '#EEEDFE', fg: '#3C3489' }
const PIN = { home: '#1D9E75', change: '#888780', hospital: '#E24B4A', hotel: '#7F77DD' }
const km = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 10) / 10} km`)

/* The road between two points, from the same two public routers Travel uses; the straight line when neither answers. */
type Road = { km: number; line: [number, number][] } | null
const ROUTERS = [
  (ll: string) => `https://routing.openstreetmap.de/routed-car/route/v1/driving/${ll}?overview=full&geometries=geojson`,
  (ll: string) => `https://router.project-osrm.org/route/v1/driving/${ll}?overview=full&geometries=geojson`,
]
async function road(a: [number, number], b: [number, number]): Promise<Road> {
  const ll = `${a[1]},${a[0]};${b[1]},${b[0]}`
  for (const url of ROUTERS) {
    try {
      const ctl = new AbortController(); const t = window.setTimeout(() => ctl.abort(), 12000)
      const res = await fetch(url(ll), { signal: ctl.signal }); window.clearTimeout(t)
      if (!res.ok) continue
      const j = await res.json() as { routes?: Array<{ distance: number; geometry: { coordinates: [number, number][] } }> }
      const r = j.routes?.[0]
      if (r) return { km: Math.round(r.distance / 100) / 10, line: r.geometry.coordinates.map(([x, y]) => [y, x]) }
    } catch { /* the next router */ }
  }
  return null
}

export default function DayRouteMap({ rides, title, onClose }: { rides: MapRide[]; title: string; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const lift = useRef<(k: number | null) => void>(() => {})
  const all = rides.filter(r => r.from_lat != null && r.to_lat != null)
  const names = all.map(r => { const [f, ...t] = r.way.split(' → '); return [f ?? '', t.join(' → ')] as const })

  // Stops numbered through the day; a ride that starts where the last one ended shares its number.
  const stops: Array<{ name: string; at: [number, number] }> = []
  const ends: Array<[number, number]> = []
  all.forEach((r, i) => {
    if (i === 0 || names[i - 1][1] !== names[i][0]) stops.push({ name: names[i][0], at: [r.from_lat!, r.from_lng!] })
    const a = stops.length - 1
    stops.push({ name: names[i][1], at: [r.to_lat!, r.to_lng!] })
    ends.push([a, stops.length - 1])
  })

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose() } }
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [onClose])

  useEffect(() => {
    let map: import('leaflet').Map | null = null
    let alive = true
    void (async () => {
      const L = (await import('leaflet')).default
      if (!box.current || !alive) return
      map = L.map(box.current)
      window.setTimeout(() => map?.invalidateSize(), 250)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map)
      const pts: [number, number][] = stops.map(s => s.at)
      if (pts.length) map.fitBounds(pts, { padding: [40, 40] })
      const kind = (n: string, i: number): keyof typeof PIN => /home/i.test(n) ? 'home' : /hotel|lodge/i.test(n) ? 'hotel' : /hospital|clinic|medical|lab/i.test(n) || i === stops.length - 1 ? 'hospital' : 'change'
      stops.forEach((s, i) => L.marker(s.at, {
        icon: L.divIcon({ className: '', html: `<div class="rm-pin" style="background:${PIN[kind(s.name, i)]}">${i + 1}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
      }).addTo(map!).bindTooltip(s.name, { direction: 'right', offset: [14, 0], className: 'rm-tip' }))
      const parts: Array<{ line: import('leaflet').Polyline; label: import('leaflet').Marker }> = []
      lift.current = k => parts.forEach((p, i) => {
        const on = i === k
        p.line.setStyle({ weight: on ? 10 : 6, opacity: k !== null && !on ? 0.3 : 0.95 })
        p.label.getElement()?.classList.toggle('dim', k !== null && !on)
        p.label.getElement()?.querySelector('.rm-km')?.classList.toggle('up', on)
        if (on) p.line.bringToFront()
      })
      for (let k = 0; k < all.length; k++) {
        const r = all[k], m = look(r.mode)
        const rd = await road([r.from_lat!, r.from_lng!], [r.to_lat!, r.to_lng!])
        if (!alive || !map) return
        const line = rd?.line ?? [[r.from_lat!, r.from_lng!], [r.to_lat!, r.to_lng!]]
        pts.push(...line)
        const pl = L.polyline(line, { color: m.color, weight: 6, opacity: 0.95, className: 'rm-line' }).addTo(map)
        const label = L.marker(line[Math.floor(line.length / 2)], {
          icon: L.divIcon({ className: '', html: `<div class="rm-km" style="background:${m.bg};color:${m.fg}">${m.label} · ${PER_KM.has(r.mode) ? km(r.claimed_km) : rupee(r.amount)}</div>`, iconSize: undefined }),
        }).addTo(map)
        parts.push({ line: pl, label })
        for (const t of [pl, label]) { t.on('mouseover', () => lift.current(k)); t.on('mouseout', () => lift.current(null)) }
      }
      if (pts.length) map.fitBounds(pts, { padding: [30, 30] })
    })()
    return () => { alive = false; map?.remove() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const claimed = all.filter(r => PER_KM.has(r.mode)).reduce((t, r) => t + (r.claimed_km ?? 0), 0)
  const mapped = all.filter(r => PER_KM.has(r.mode)).reduce((t, r) => t + (r.map_km ?? 0), 0)
  const fares = all.filter(r => !PER_KM.has(r.mode)).reduce((t, r) => t + (r.amount ?? 0), 0)
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/60 sm:items-center sm:p-4 lg:p-6" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex max-h-full w-full flex-col overflow-hidden bg-surface sm:h-[90vh] sm:max-w-3xl sm:rounded-2xl lg:h-full lg:max-w-none" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 p-4">
          <div>
            <h2 className="text-base font-semibold text-ink-900">{title}</h2>
            <p className="text-sm text-ink-500">Bike and car: map {km(mapped)} · claimed {km(claimed)}{fares ? ` · Other rides ${rupee(fares)}` : ''}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg text-ink-500 hover:bg-ink-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div ref={box} className="min-h-[240px] w-full flex-1 lg:min-h-0" />
          <div className="max-h-[45%] shrink-0 overflow-y-auto px-4 pb-4 pt-2 lg:max-h-none lg:w-[420px] lg:border-l lg:border-ink-100">
            {all.map((r, i) => {
              const m = look(r.mode)
              return (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border-t border-ink-100 px-1.5 py-2 text-sm hover:bg-ink-100/60"
                  onMouseEnter={() => lift.current(i)} onMouseLeave={() => lift.current(null)}>
                  <span className="tabular-nums text-ink-500">{ends[i][0] + 1} → {ends[i][1] + 1}</span>
                  <span className="text-ink-900">{r.way}</span>
                  <span className="rounded-md px-2 py-0.5 text-xs font-semibold" style={{ background: m.bg, color: m.fg }}>{m.label}</span>
                  <span className="rounded-md bg-ink-100 px-2 py-0.5 text-xs tabular-nums text-ink-700">
                    {PER_KM.has(r.mode) ? `Claimed ${km(r.claimed_km)} · Map ${km(r.map_km)}` : `${rupee(r.amount)} · Map ${km(r.map_km)}`}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
