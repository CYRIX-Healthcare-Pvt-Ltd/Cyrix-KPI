#!/usr/bin/env node
/**
 * Generates public/icon-192.png and icon-512.png — the PWA home-screen
 * icons referenced by the manifest. A teal rounded square with a white C.
 *
 *   node scripts/make-icons.mjs
 *
 * Written by hand rather than pulled from an image library so the repo
 * stays dependency-light. Replace the output with real brand assets when
 * Cyrix marketing supplies them.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '..', 'public')
mkdirSync(outDir, { recursive: true })

const BRAND = [15, 118, 110]   // #0f766e
const WHITE = [255, 255, 255]

// ---- CRC32 -----------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([len, typeAndData, crc])
}

/** Encodes RGBA pixel data as a PNG. */
function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8      // bit depth
  ihdr[9] = 6      // colour type: RGBA
  ihdr[10] = 0     // deflate
  ihdr[11] = 0     // adaptive filtering
  ihdr[12] = 0     // no interlace

  // Each scanline is prefixed with its filter byte (0 = none).
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Coverage of a pixel, sampled 3x3 for cheap antialiasing. */
function coverage(x, y, test) {
  let hits = 0
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      if (test(x + (sx + 0.5) / 3, y + (sy + 0.5) / 3)) hits++
    }
  }
  return hits / 9
}

function makeIcon(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const r = size * 0.22                       // corner radius
  const cx = size / 2, cy = size / 2
  const outer = size * 0.30, inner = size * 0.185
  const strokeMid = (outer + inner) / 2

  const insideSquare = (x, y) => {
    // Rounded rectangle: clamp to the inner rect, then check distance.
    const qx = Math.max(r - x, 0, x - (size - r))
    const qy = Math.max(r - y, 0, y - (size - r))
    return Math.hypot(qx, qy) <= r
  }

  const insideC = (x, y) => {
    const dx = x - cx, dy = y - cy
    const d = Math.hypot(dx, dy)
    if (d < inner || d > outer) return false
    // Open the ring on the right — the gap that makes it a C, not an O.
    const angle = Math.atan2(dy, dx)          // -pi..pi, 0 = east
    return Math.abs(angle) > Math.PI * 0.28
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const bg = coverage(x, y, insideSquare)
      const fg = coverage(x, y, insideC)

      // Composite white C over the teal square, then the square over nothing.
      const [br, bgc, bb] = BRAND
      const [wr, wg, wb] = WHITE
      rgba[i]     = Math.round(br * (1 - fg) + wr * fg)
      rgba[i + 1] = Math.round(bgc * (1 - fg) + wg * fg)
      rgba[i + 2] = Math.round(bb * (1 - fg) + wb * fg)
      rgba[i + 3] = Math.round(255 * bg)
    }
  }

  void strokeMid
  return encodePng(size, size, rgba)
}

for (const size of [192, 512]) {
  const file = join(outDir, `icon-${size}.png`)
  writeFileSync(file, makeIcon(size))
  console.log(`  + public/icon-${size}.png`)
}
console.log('Done.')
