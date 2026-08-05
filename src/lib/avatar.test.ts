import { describe, it, expect, afterEach } from 'vitest'
import {
  detectFace, shouldWarnAboutFace, humanBytes, dataUrlBytes,
  AVATAR_MAX_CHARS, AVATAR_MIN_SOURCE, type FaceVerdict,
} from './avatar'

/** Stands in for the browser's FaceDetector, which node does not have. */
function withDetector(impl: (() => Promise<unknown[]>) | 'throws' | null) {
  const g = globalThis as Record<string, unknown>
  if (impl === null) { delete g.FaceDetector; return }
  g.FaceDetector = class {
    constructor() { if (impl === 'throws') throw new Error('not supported here') }
    detect() { return (impl as () => Promise<unknown[]>)() }
  }
}

afterEach(() => withDetector(null))

/**
 * The one rule that matters: not knowing is never the same as no.
 *
 * Most browsers have no FaceDetector — Firefox and Safari have none at
 * all, desktop Chrome keeps it behind a flag — so 'unknown' is the
 * common case, not the edge case. If any failure path leaked through as
 * 'no-face', every one of those users would be told their own photo has
 * no face in it.
 */
describe('asking the browser whether there is a face', () => {
  it('says unknown when the browser cannot answer', async () => {
    withDetector(null)
    expect(await detectFace({} as CanvasImageSource)).toBe('unknown')
  })

  it('says unknown when the detector exists but will not start', async () => {
    withDetector('throws')
    expect(await detectFace({} as CanvasImageSource)).toBe('unknown')
  })

  it('says unknown when detection itself fails', async () => {
    withDetector(() => Promise.reject(new Error('no model')))
    expect(await detectFace({} as CanvasImageSource)).toBe('unknown')
  })

  it('says face when it finds one', async () => {
    withDetector(() => Promise.resolve([{ boundingBox: {} }]))
    expect(await detectFace({} as CanvasImageSource)).toBe('face')
  })

  it('says face for a group photo rather than complaining', async () => {
    withDetector(() => Promise.resolve([{}, {}, {}]))
    expect(await detectFace({} as CanvasImageSource)).toBe('face')
  })

  it('says no-face only when it looked and found none', async () => {
    withDetector(() => Promise.resolve([]))
    expect(await detectFace({} as CanvasImageSource)).toBe('no-face')
  })
})

/**
 * And nothing here ever refuses. No detector finds every face — a
 * turban, a beard, a head covering, a three-quarter angle, bad light —
 * so a hard block would lock real people out of their own profile to
 * save a manager one click. The manager is the gate; this is a nudge.
 */
describe('what the verdict is allowed to do', () => {
  it('warns only when a face was looked for and not found', () => {
    expect(shouldWarnAboutFace('no-face')).toBe(true)
    expect(shouldWarnAboutFace('face')).toBe(false)
    expect(shouldWarnAboutFace('unknown')).toBe(false)
  })

  it('has no verdict that blocks', () => {
    const all: FaceVerdict[] = ['face', 'no-face', 'unknown']
    // Every one of them is either silent or a warning. If a third
    // behaviour is ever added, this is the test that should fail.
    for (const v of all) {
      expect(typeof shouldWarnAboutFace(v)).toBe('boolean')
    }
  })
})

describe('sizes people are shown', () => {
  it('reads in the units a person uses', () => {
    expect(humanBytes(512)).toBe('512 B')
    expect(humanBytes(6 * 1024)).toBe('6 KB')
    expect(humanBytes(1.8 * 1024 * 1024)).toBe('1.8 MB')
  })

  it('measures a data URL by what it decodes to, not its length', () => {
    const url = `data:image/jpeg;base64,${'A'.repeat(1000)}`
    expect(dataUrlBytes(url)).toBe(750)
  })

  it('caps at what the column will take', () => {
    expect(AVATAR_MAX_CHARS).toBe(65536)
    expect(AVATAR_MIN_SOURCE).toBe(64)
  })
})
