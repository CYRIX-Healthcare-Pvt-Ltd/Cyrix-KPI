import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { MANUAL_VIDEOS, VIDEO_KEYS, VIDEO_SERIES, nextVideo, videoFor, videosFor } from './manualVideos'
import { HELP } from './help-strings'

describe('the how-to videos', () => {
  it('is only ever attached to something the manual actually says', () => {
    for (const key of VIDEO_KEYS) {
      const exists = HELP[`${key}.what`] || HELP[`${key}.title`]
      expect(exists, `${key} is not in the manual`).toBeTruthy()
    }
  })

  it('has a translated title for every video', () => {
    for (const v of Object.values(MANUAL_VIDEOS)) {
      expect(HELP[v.titleKey], `${v.id}: ${v.titleKey}`).toBeTruthy()
    }
  })

  it('ships the file and the poster for every video', () => {
    for (const v of Object.values(MANUAL_VIDEOS)) {
      for (const served of [v.file, v.poster]) {
        const name = served.split('/videos/')[1]
        expect(fs.existsSync(path.join(__dirname, '../../public/videos', name)), `${name} is missing`).toBe(true)
      }
    }
  })

  it('finds the video for a point from its section, and nothing where there is none', () => {
    expect(videoFor('s1.p3')?.id).toBe('your-kpi')
    expect(videoFor('s2.p1')?.id).toBe('every-month')
    expect(videoFor('team.p1')?.id).toBe('approve')
    expect(videoFor('team.p16')?.id).toBe('score')
    expect(videoFor('team.p5')).toBeNull()
    expect(videoFor('hr.p1')).toBeNull()
    // Asking for a demo starts the series from the beginning.
    expect(videoFor('ask.p13')?.id).toBe('your-kpi')
  })

  it('numbers the series 1 to 4 the way the title cards do, each leading to the next', () => {
    expect(VIDEO_SERIES.map(v => [v.part, v.id, v.who])).toEqual([
      [1, 'your-kpi', 'member'],
      [2, 'approve', 'manager'],
      [3, 'every-month', 'member'],
      [4, 'score', 'manager'],
    ])
    // The file names carry the same number, so a re-render cannot swap two.
    for (const v of VIDEO_SERIES) expect(v.file).toContain(`/videos/kpi-${v.part}-`)
    expect(VIDEO_SERIES.map(v => nextVideo(v)?.part ?? null)).toEqual([2, 3, 4, null])
  })

  it('gives each reader only the videos for the steps they do', () => {
    const ids = (appraised: boolean, hasTeam: boolean) =>
      videosFor({ appraised, hasTeam }).map(v => v.id)
    expect(ids(true, false)).toEqual(['your-kpi', 'every-month'])                    // a team member
    expect(ids(true, true)).toEqual(['your-kpi', 'approve', 'every-month', 'score']) // a manager with a KPI
    expect(ids(false, true)).toEqual(['approve', 'score'])                           // a team, no KPI
    expect(ids(false, false)).toEqual([])                                            // HR, SW Admin

    // Next stays inside what they have: a team member goes from setting up
    // their KPI straight to the month, and nothing follows that.
    const mine = videosFor({ appraised: true, hasTeam: false })
    expect(nextVideo(MANUAL_VIDEOS['your-kpi'], mine)?.id).toBe('every-month')
    expect(nextVideo(MANUAL_VIDEOS['every-month'], mine)).toBeNull()
  })

  it('titles a video by its own name, not by the numbered manual heading above it', () => {
    for (const v of VIDEO_SERIES) {
      expect(HELP[v.titleKey].en, v.id).not.toMatch(/^\d+\./)
    }
  })
})
