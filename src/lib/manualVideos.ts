/**
 * The how-to videos, and which parts of the manual each one shows.
 *
 * Recorded by the scripts in demo-videos/ as the test logins E8888 (a team
 * member) and E9999 (their manager), so nobody's real record is in them,
 * and served from public/videos. When a screen changes, the script is run
 * again rather than the video being edited.
 *
 * The captions in the videos are English whatever language the manual is
 * read in; the manual says so beside the player.
 */
export interface ManualVideo {
  id: string
  /** The manual string the player's title comes from, so it is translated. */
  titleKey: string
  file: string
  poster: string
  /** As it reads on the button, m:ss. */
  duration: string
}

const served = (name: string) => `${import.meta.env.BASE_URL}videos/${name}`

export const MANUAL_VIDEOS: Record<string, ManualVideo> = {
  'your-kpi': {
    id: 'your-kpi', titleKey: 's1.title',
    file: served('kpi-1-your-kpi.mp4'), poster: served('kpi-1-your-kpi.jpg'), duration: '1:12',
  },
  approve: {
    id: 'approve', titleKey: 'team.p1.what',
    file: served('kpi-2-approve.mp4'), poster: served('kpi-2-approve.jpg'), duration: '1:09',
  },
  'every-month': {
    id: 'every-month', titleKey: 's2.title',
    file: served('kpi-3-every-month.mp4'), poster: served('kpi-3-every-month.jpg'), duration: '1:05',
  },
  score: {
    id: 'score', titleKey: 'team.p3.what',
    file: served('kpi-4-score.mp4'), poster: served('kpi-4-score.jpg'), duration: '1:33',
  },
}

/**
 * The manual entries each video walks through. A section's own key stands
 * for every entry in it: the first video is the whole of "Your KPI for the
 * year", while approving and scoring are two parts of the team section.
 */
const SHOWN_IN: Record<string, string> = {
  s1: 'your-kpi',
  s2: 'every-month',
  'team.p1': 'approve',
  'team.p2': 'approve',
  'team.p14': 'approve',
  'team.p18': 'approve',
  'team.p3': 'score',
  'team.p4': 'score',
  'team.p15': 'score',
  'team.p16': 'score',
}

/** The video for a manual entry ("team.p3") or section ("s1"), if there is one. */
export function videoFor(key: string): ManualVideo | null {
  const id = SHOWN_IN[key] ?? SHOWN_IN[key.split('.')[0]]
  return (id && MANUAL_VIDEOS[id]) || null
}

/** Every entry key a video is attached to — for the tests. */
export const VIDEO_KEYS = Object.keys(SHOWN_IN)
