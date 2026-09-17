// A soft, calm background track, made here rather than downloaded — so there
// is nothing to license. Warm pad chords, a quiet bell-like arpeggio and a
// low bass note, through a small reverb. Written as a 16-bit WAV.
//
//   node music.mjs [seconds] [out.wav]
import fs from 'node:fs'
import path from 'node:path'
import { WORK_DIR } from './lib.mjs'

const seconds = Number(process.argv[2] ?? 300)
const out = process.argv[3] ?? path.join(WORK_DIR, 'music.wav')
const RATE = 44100
const N = Math.floor(seconds * RATE)

const BPM = 70
const BEAT = 60 / BPM
const CHORD = BEAT * 8
const hz = midi => 440 * 2 ** ((midi - 69) / 12)

// Cmaj7 → Am7 → Fmaj7 → G6, one bar of eight beats each.
const CHORDS = [
  [48, 52, 55, 59],
  [45, 48, 52, 55],
  [41, 45, 48, 52],
  [43, 47, 50, 52],
]
const ARP = [0, 2, 1, 3, 2, 1, 3, 2]

const L = new Float32Array(N)
const R = new Float32Array(N)
const TAU = Math.PI * 2
const smooth = x => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(Math.max(x, 0), 1))

for (let i = 0; i < N; i++) {
  const t = i / RATE
  const bar = Math.floor(t / CHORD)
  const inBar = t - bar * CHORD
  const chord = CHORDS[bar % CHORDS.length]
  const prev = CHORDS[(bar + CHORDS.length - 1) % CHORDS.length]

  // Pad: the new chord swells in over two seconds as the old one lets go.
  let pad = 0
  const inEnv = bar === 0 ? smooth(inBar / 3) : smooth(inBar / 2)
  const outEnv = bar === 0 ? 0 : 1 - smooth(inBar / 2)
  for (const n of chord) {
    const f = hz(n)
    pad += inEnv * (Math.sin(TAU * f * t) + 0.18 * Math.sin(TAU * 2 * f * t) + 0.6 * Math.sin(TAU * f * 1.003 * t))
  }
  for (const n of prev) {
    const f = hz(n)
    pad += outEnv * (Math.sin(TAU * f * t) + 0.18 * Math.sin(TAU * 2 * f * t) + 0.6 * Math.sin(TAU * f * 1.003 * t))
  }
  pad *= 0.022

  // Bass: the root, once a bar and softly again halfway.
  const root = hz(chord[0] - 12)
  const hit = inBar < BEAT * 4 ? inBar : inBar - BEAT * 4
  const bassAmp = inBar < BEAT * 4 ? 0.07 : 0.045
  const bass = bassAmp * Math.exp(-hit * 0.7) * smooth(hit / 0.02) * Math.sin(TAU * root * t)

  // Arpeggio: eighth notes an octave and a half up, from the third bar on.
  let arpL = 0
  let arpR = 0
  if (bar >= 2) {
    const eighth = BEAT / 2
    const step = Math.floor(inBar / eighth)
    const tn = inBar - step * eighth
    const note = chord[ARP[step % ARP.length]] + 12
    const f = hz(note)
    const vel = step % 2 === 0 ? 1 : 0.6
    const env = smooth(tn / 0.004) * Math.exp(-tn * 3.2)
    const s = vel * env * (Math.sin(TAU * f * tn) + 0.25 * Math.exp(-tn * 4) * Math.sin(TAU * 2 * f * tn)
      + 0.08 * Math.exp(-tn * 6) * Math.sin(TAU * 3 * f * tn))
    const pan = step % 2 === 0 ? 0.35 : -0.35
    arpL = s * 0.05 * (1 - pan)
    arpR = s * 0.05 * (1 + pan)
  }

  L[i] = pad + bass + arpL
  R[i] = pad + bass + arpR
}

// A small reverb: four damped combs and two allpasses per side.
function reverb(input, offset) {
  const out = new Float32Array(input.length)
  const combs = [1116, 1188, 1277, 1356].map(d => ({ buf: new Float32Array(d + offset), i: 0, low: 0 }))
  const alls = [556, 441].map(d => ({ buf: new Float32Array(d + offset), i: 0 }))
  for (let n = 0; n < input.length; n++) {
    let acc = 0
    for (const c of combs) {
      const y = c.buf[c.i]
      c.low = y * 0.75 + c.low * 0.25
      c.buf[c.i] = input[n] + c.low * 0.8
      c.i = (c.i + 1) % c.buf.length
      acc += y
    }
    let y = acc * 0.25
    for (const a of alls) {
      const b = a.buf[a.i]
      a.buf[a.i] = y + b * 0.5
      a.i = (a.i + 1) % a.buf.length
      y = b - y * 0.5
    }
    out[n] = y
  }
  return out
}
const wetL = reverb(L, 0)
const wetR = reverb(R, 23)

let peak = 0
const mixL = new Float32Array(N)
const mixR = new Float32Array(N)
let lpL = 0
let lpR = 0
for (let i = 0; i < N; i++) {
  lpL += 0.45 * ((L[i] * 0.8 + wetL[i] * 0.35) - lpL)
  lpR += 0.45 * ((R[i] * 0.8 + wetR[i] * 0.35) - lpR)
  mixL[i] = lpL
  mixR[i] = lpR
  peak = Math.max(peak, Math.abs(lpL), Math.abs(lpR))
}
const gain = 0.7 / (peak || 1)

const data = Buffer.alloc(N * 4)
for (let i = 0; i < N; i++) {
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mixL[i] * gain)) * 32767), i * 4)
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mixR[i] * gain)) * 32767), i * 4 + 2)
}
const header = Buffer.alloc(44)
header.write('RIFF', 0)
header.writeUInt32LE(36 + data.length, 4)
header.write('WAVE', 8)
header.write('fmt ', 12)
header.writeUInt32LE(16, 16)
header.writeUInt16LE(1, 20)
header.writeUInt16LE(2, 22)
header.writeUInt32LE(RATE, 24)
header.writeUInt32LE(RATE * 4, 28)
header.writeUInt16LE(4, 32)
header.writeUInt16LE(16, 34)
header.write('data', 36)
header.writeUInt32LE(data.length, 40)
fs.writeFileSync(out, Buffer.concat([header, data]))
console.log(`${out} · ${seconds}s`)
