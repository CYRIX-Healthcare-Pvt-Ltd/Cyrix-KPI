import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { MANUAL_VIDEOS, VIDEO_KEYS, videoFor } from './manualVideos'
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
  })
})
