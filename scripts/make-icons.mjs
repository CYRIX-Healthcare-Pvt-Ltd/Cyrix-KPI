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

// The logo mark: black tile, one white stroke and one red, forming the X.
const INK = [0, 0, 0]
const WHITE = [255, 255, 255]
const RED = [227, 6, 19]       // #e30613

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
  const r = size * 0.19                       // corner radius
  const pad = size * 0.24                     // inset of the X arms
  const half = size * 0.072                   // half stroke width

  const insideSquare = (x, y) => {
    // Rounded rectangle: clamp to the inner rect, then check distance.
    const qx = Math.max(r - x, 0, x - (size - r))
    const qy = Math.max(r - y, 0, y - (size - r))
    return Math.hypot(qx, qy) <= r
  }

  /** Distance from a point to a line segment, for stroke thickness. */
  const nearSegment = (x, y, x1, y1, x2, y2) => {
    const dx = x2 - x1, dy = y2 - y1
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) <= half
  }

  const lo = pad, hi = size - pad
  const onWhite = (x, y) => nearSegment(x, y, lo, lo, hi, hi)   // ↘ stroke
  const onRed   = (x, y) => nearSegment(x, y, hi, lo, lo, hi)   // ↙ stroke

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const bg = coverage(x, y, insideSquare)
      const w = coverage(x, y, onWhite)
      // Red drawn last so the crossing point reads red, as in the logo.
      const rd = coverage(x, y, onRed)

      let [cr, cg, cb] = INK
      cr = cr * (1 - w) + WHITE[0] * w
      cg = cg * (1 - w) + WHITE[1] * w
      cb = cb * (1 - w) + WHITE[2] * w
      cr = cr * (1 - rd) + RED[0] * rd
      cg = cg * (1 - rd) + RED[1] * rd
      cb = cb * (1 - rd) + RED[2] * rd

      rgba[i]     = Math.round(cr)
      rgba[i + 1] = Math.round(cg)
      rgba[i + 2] = Math.round(cb)
      rgba[i + 3] = Math.round(255 * bg)
    }
  }

  return encodePng(size, size, rgba)
}

for (const size of [192, 512]) {
  const file = join(outDir, `icon-${size}.png`)
  writeFileSync(file, makeIcon(size))
  console.log(`  + public/icon-${size}.png`)
}
console.log('Done.')
