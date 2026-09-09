#!/usr/bin/env node
/**
 * Generates every raster icon the four apps declare, from the same
 * geometry as public/favicon.svg — the PWA home-screen icons, BEMMP's
 * apple-touch-icon, and its favicon.ico.
 *
 * The .ico is the reason this exists again. BEMMP declares it before its
 * SVG, so the browser took the stale one and that tab kept the old mark
 * while the other two changed.
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
// Straight off public/favicon.svg, so the raster and the vector cannot
// drift apart.
const INK = [0x14, 0x14, 0x14]     // #141414
const WHITE = [255, 255, 255]
const RED = [0xe5, 0x23, 0x1d]     // #e5231d

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

/**
 * The Cyrix mark: two chevrons facing each other across a gap, black on
 * the left and red on the right, on a white rounded tile.
 *
 * The same geometry as public/favicon.svg, at 32 units, scaled to
 * whatever size is asked for — so the PNG a phone puts on a home screen
 * and the SVG a browser puts in a tab are the same drawing rather than
 * two drawings that resemble each other.
 *
 * White tile rather than black: the mark is red *and* black, and black
 * needs a light ground.
 */
function makeIcon(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const u = size / 32                         // the SVG's units, scaled
  const r = 7 * u                             // corner radius
  const half = 2.5 * u                        // half the 5-unit stroke

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

  // M6 6 L16 16 L6 26 and M26 6 L16 16 L26 26, straight off the SVG.
  const onInk = (x, y) =>
    nearSegment(x, y, 6 * u, 6 * u, 16 * u, 16 * u)
    || nearSegment(x, y, 16 * u, 16 * u, 6 * u, 26 * u)
  const onRed = (x, y) =>
    nearSegment(x, y, 26 * u, 6 * u, 16 * u, 16 * u)
    || nearSegment(x, y, 16 * u, 16 * u, 26 * u, 26 * u)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const bg = coverage(x, y, insideSquare)
      const k = coverage(x, y, onInk)
      const rd = coverage(x, y, onRed)

      let [cr, cg, cb] = WHITE
      cr = cr * (1 - k) + INK[0] * k
      cg = cg * (1 - k) + INK[1] * k
      cb = cb * (1 - k) + INK[2] * k
      cr = cr * (1 - rd) + RED[0] * rd
      cg = cg * (1 - rd) + RED[1] * rd
      cb = cb * (1 - rd) + RED[2] * rd

      rgba[i] = Math.round(cr)
      rgba[i + 1] = Math.round(cg)
      rgba[i + 2] = Math.round(cb)
      rgba[i + 3] = Math.round(255 * bg)
    }
  }

  return encodePng(size, size, rgba)
}

/**
 * A .ico wrapping a single PNG.
 *
 * Every browser that still asks for /favicon.ico accepts PNG-in-ICO, and
 * it is a header, one directory entry and the PNG bytes. BEMMP declares
 * the .ico before its SVG, so a stale one wins outright — which is how
 * that tab kept the old mark while the other two changed.
 */
function makeIco(png, size) {
  const dir = Buffer.alloc(22)
  dir.writeUInt16LE(0, 0)            // reserved
  dir.writeUInt16LE(1, 2)            // type: icon
  dir.writeUInt16LE(1, 4)            // one image
  dir.writeUInt8(size >= 256 ? 0 : size, 6)   // 0 means 256
  dir.writeUInt8(size >= 256 ? 0 : size, 7)
  dir.writeUInt8(0, 8)               // palette size
  dir.writeUInt8(0, 9)               // reserved
  dir.writeUInt16LE(1, 10)           // colour planes
  dir.writeUInt16LE(32, 12)          // bits per pixel
  dir.writeUInt32LE(png.length, 14)
  dir.writeUInt32LE(22, 18)          // the PNG starts right after this
  return Buffer.concat([dir, png])
}

/*
 * Every place a raster icon is declared, across the three repos.
 *
 * Written from here rather than copied by hand: three apps sharing one
 * tab strip is the whole point, and an icon set kept in step by somebody
 * remembering is one that goes out of step.
 */
const TARGETS = [
  ['D:/Cyrix KPI/public/icon-192.png', 192, 'png'],
  ['D:/Cyrix KPI/public/icon-512.png', 512, 'png'],
  ['D:/Cyrix Coding/public/apple-touch-icon.png', 180, 'png'],
  ['D:/Cyrix Coding/public/favicon.ico', 32, 'ico'],
]

for (const [file, size, kind] of TARGETS) {
  const png = makeIcon(size)
  writeFileSync(file, kind === 'ico' ? makeIco(png, size) : png)
  console.log(`  ${file}  ${size}px`)
}
console.log('icons written')

console.log('Done.')
