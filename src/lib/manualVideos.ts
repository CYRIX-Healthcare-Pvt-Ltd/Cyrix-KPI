/**
 * The how-to videos, and which parts of the manual each one shows.
 *
 * Recorded by the scripts in demo-videos/ as the test logins E8888 (a team
 * member) and E9999 (their manager), so nobody's real record is in them,
 * and served from public/videos. When a screen changes, the script is run
 * again rather than the video being edited.
 *
 * They are one series, and say so: each title card reads "Video 2 of 4"
 * and each ends on what comes next. The manual lists them in that order at
 * the top, as well as beside the entries they show — but only the ones for
 * steps the reader does. A team member gets their two, not the manager's.
 *
 * The captions in the videos are English whatever language the manual is
 * read in; the manual says so beside the player.
 */
export interface ManualVideo {
  id: string
  /** Its place in the series, as its title card numbers it. */
  part: number
  /** Whose part of the year it shows. */
  who: 'member' | 'manager'
  /** The manual string the title comes from, so it is translated. */
  titleKey: string
  file: string
  poster: string
  /** As it reads on the button, m:ss. */
  duration: string
}

const served = (name: string) => `${import.meta.env.BASE_URL}videos/${name}`

export const MANUAL_VIDEOS: Record<string, ManualVideo> = {
  'your-kpi': {
    id: 'your-kpi', part: 1, who: 'member', titleKey: 'video.your-kpi.title',
    file: served('kpi-1-your-kpi.mp4'), poster: served('kpi-1-your-kpi.jpg'), duration: '1:12',
  },
  approve: {
    id: 'approve', part: 2, who: 'manager', titleKey: 'video.approve.title',
    file: served('kpi-2-approve.mp4'), poster: served('kpi-2-approve.jpg'), duration: '1:09',
  },
  'every-month': {
    id: 'every-month', part: 3, who: 'member', titleKey: 'video.every-month.title',
    file: served('kpi-3-every-month.mp4'), poster: served('kpi-3-every-month.jpg'), duration: '1:05',
  },
  score: {
    id: 'score', part: 4, who: 'manager', titleKey: 'video.score.title',
    file: served('kpi-4-score.mp4'), poster: served('kpi-4-score.jpg'), duration: '1:33',
  },
}

/** All four, in the order they are numbered. */
export const VIDEO_SERIES: ManualVideo[] =
  Object.values(MANUAL_VIDEOS).sort((a, b) => a.part - b.part)

/**
 * The videos for somebody's own part of the year, by the same rule as the
 * manual's sections: the team member's two if they are appraised, the
 * manager's two if they have a team. HR and SW Admin do neither, so none.
 */
export const videosFor = ({ appraised, hasTeam }: { appraised: boolean; hasTeam: boolean }) =>
  VIDEO_SERIES.filter(v => (v.who === 'member' ? appraised : hasTeam))

/** The one after it among those somebody has, or null after the last. */
export const nextVideo = (video: ManualVideo, among: ManualVideo[] = VIDEO_SERIES): ManualVideo | null =>
  among.find(v => v.part > video.part) ?? null

/**
 * The manual entries each video walks through. A section's own key stands
 * for every entry in it: the first video is the whole of "Your KPI for the
 * year", while approving and scoring are two parts of the team section.
 * Asking for a demo starts at the beginning.
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
  'ask.p13': 'your-kpi',
}

/** The video for a manual entry ("team.p3") or section ("s1"), if there is one. */
export function videoFor(key: string): ManualVideo | null {
  const id = SHOWN_IN[key] ?? SHOWN_IN[key.split('.')[0]]
  return (id && MANUAL_VIDEOS[id]) || null
}

/** Every entry key a video is attached to — for the tests. */
export const VIDEO_KEYS = Object.keys(SHOWN_IN)
