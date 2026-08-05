import { describe, it, expect } from 'vitest'
import {
  statsFromPixels, checkImageStats, humanBytes, dataUrlBytes,
  AVATAR_MAX_CHARS,
} from './avatar'

/**
 * Building fake images pixel by pixel, because the interesting cases —
 * a company logo, a blank frame, a photograph — are exactly the ones a
 * fixture file would make hard to vary.
 */
function pixels(
  w: number, h: number,
  at: (x: number, y: number) => [number, number, number],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = at(x, y)
      const i = (y * w + x) * 4
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255
    }
  }
  return data
}

/** Deterministic noise — a stand-in for the texture any photograph has. */
function noisy(seed = 1) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

describe('telling a photograph from a graphic', () => {
  it('rejects a solid colour', () => {
    const s = statsFromPixels(pixels(64, 64, () => [40, 90, 200]), 64, 64)
    expect(s.colours).toBe(1)
    expect(checkImageStats(s).ok).toBe(false)
  })

  it('rejects a flat two-tone logo', () => {
    const s = statsFromPixels(
      pixels(64, 64, (x, y) => (x > 20 && y > 20 ? [227, 6, 19] : [255, 255, 255])),
      64, 64,
    )
    expect(s.colours).toBeLessThan(8)
    expect(checkImageStats(s).ok).toBe(false)
  })

  it('rejects a near-blank frame', () => {
    // A wall: many almost-identical colours, but nothing happening.
    const rnd = noisy(7)
    const s = statsFromPixels(
      pixels(64, 64, () => {
        const v = 200 + Math.floor(rnd() * 2)
        return [v, v, v]
      }),
      64, 64,
    )
    expect(s.detail).toBeLessThan(4)
    expect(checkImageStats(s).ok).toBe(false)
  })

  it('accepts something with photographic texture', () => {
    const rnd = noisy(42)
    const s = statsFromPixels(
      pixels(128, 128, () => [
        Math.floor(rnd() * 256), Math.floor(rnd() * 256), Math.floor(rnd() * 256),
      ]),
      128, 128,
    )
    expect(s.colours).toBeGreaterThan(24)
    expect(s.detail).toBeGreaterThan(4)
    expect(checkImageStats(s).ok).toBe(true)
  })

  /**
   * The first version of this rejected greyscale outright, and it took
   * a test to notice: five bits a channel leaves a black-and-white
   * photograph at most 32 distinct values, and the threshold was 24.
   * Somebody uploading a monochrome portrait would have been told it
   * was "a graphic", which reads as a rule rather than a bug.
   */
  it('accepts a black-and-white photograph', () => {
    const rnd = noisy(19)
    const s = statsFromPixels(
      pixels(128, 128, () => {
        const v = Math.floor(rnd() * 200) + 20
        return [v, v, v]
      }),
      128, 128,
    )
    expect(s.colours).toBeLessThan(33)     // the ceiling greyscale can reach
    expect(checkImageStats(s).ok).toBe(true)
  })

  it('rejects anything too small to be a face', () => {
    const rnd = noisy(3)
    const s = statsFromPixels(
      pixels(32, 32, () => [
        Math.floor(rnd() * 256), Math.floor(rnd() * 256), Math.floor(rnd() * 256),
      ]),
      32, 32,
    )
    expect(checkImageStats({ ...s, width: 32, height: 32 }).ok).toBe(false)
  })

  it('explains every refusal in words somebody can act on', () => {
    const bad = checkImageStats({ width: 20, height: 20, colours: 1, detail: 0 })
    expect(bad.ok).toBe(false)
    expect(bad.problem).toMatch(/too small/i)
  })
})

/**
 * The checks are about texture, never about how light or dark the
 * picture is. A threshold on brightness would pass and fail people by
 * skin tone, so this pins that it does not exist: the same photograph at
 * two very different exposures has to get the same verdict.
 */
describe('brightness is not part of the judgement', () => {
  const shot = (lift: number) => {
    const rnd = noisy(11)
    return statsFromPixels(
      pixels(128, 128, () => {
        const v = Math.floor(rnd() * 120)
        return [
          Math.min(255, v + lift),
          Math.min(255, v + lift),
          Math.min(255, v + lift),
        ]
      }),
      128, 128,
    )
  }

  it('accepts the same texture dark and light alike', () => {
    expect(checkImageStats(shot(0)).ok).toBe(true)
    expect(checkImageStats(shot(120)).ok).toBe(true)
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
  })
})
