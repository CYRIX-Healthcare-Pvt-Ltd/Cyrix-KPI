// Turns a recorded take into the finished video: a title card, the screen
// with a caption strip under it, the music, and an end card.
//
//   node render.mjs <take> [video-id] [lang]
//   node render.mjs 1-your-kpi-dry 1-your-kpi en
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import ffmpegPath from 'ffmpeg-static'
import { RAW_DIR, OUT_DIR, WORK_DIR } from './lib.mjs'
import { VIDEOS } from './videos.mjs'

const [takeName, videoId = takeName.replace(/-dry$/, ''), lang = 'en'] = process.argv.slice(2)
const video = VIDEOS[videoId]
if (!video) throw new Error(`no video called ${videoId}`)
const take = JSON.parse(fs.readFileSync(path.join(RAW_DIR, `${takeName}.json`), 'utf8'))
const steps = video.steps[lang]
if (!steps) throw new Error(`${videoId} has no ${lang} captions`)

const W = 1920, H = 1080, APP_W = 1600, APP_H = 900, STRIP = H - APP_H, SIDE = (W - APP_W) / 2
const FPS = 30, CARD = 3.2, FADE = 0.6
const BG = '#0f1115'
const work = path.join(WORK_DIR, `${takeName}-${lang}`)
fs.mkdirSync(work, { recursive: true })
const ff = args => execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })

/* ---- 1. the screen, at a steady 30 frames a second ------------------ */
const frames = take.frames
const list = ['ffconcat version 1.0']
for (let i = 0; i < frames.length; i++) {
  const from = i === 0 ? 0 : frames[i].at
  const to = i + 1 < frames.length ? frames[i + 1].at : take.end
  list.push(`file '${path.join(take.dir, frames[i].file).replace(/\\/g, '/')}'`, `duration ${Math.max(0.001, to - from).toFixed(4)}`)
}
list.push(`file '${path.join(take.dir, frames.at(-1).file).replace(/\\/g, '/')}'`)
fs.writeFileSync(path.join(work, 'frames.txt'), list.join('\n'))
const screen = path.join(work, 'screen.mp4')
ff(['-f', 'concat', '-safe', '0', '-i', path.join(work, 'frames.txt'),
  '-vf', `fps=${FPS},scale=${APP_W}:${APP_H}:flags=lanczos,format=yuv420p`,
  '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', screen])
const screenLength = take.end

/* ---- 2. the cards, captions and sheet, drawn by the browser --------- */
const require = createRequire('D:/Cyrix KPI/package.json')
const XLSX = require('xlsx')
const logo = fs.readFileSync('D:/Cyrix KPI/src/assets/cyrix-logo-white.png').toString('base64')
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const FONT = `'Segoe UI', 'Nirmala UI', system-ui, sans-serif`

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ deviceScaleFactor: 1 })
async function draw(html, file, width, height, transparent = false) {
  await page.setViewportSize({ width, height })
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:${transparent ? 'transparent' : BG};font-family:${FONT};-webkit-font-smoothing:antialiased}
  </style></head><body>${html}</body></html>`, { waitUntil: 'load' })
  await page.screenshot({ path: file, omitBackground: transparent })
  return file
}

const card = (kicker, big, small) => `
  <div style="position:absolute;inset:0;background:radial-gradient(1200px 700px at 30% 20%, #1c2230 0%, ${BG} 60%)"></div>
  <img src="data:image/png;base64,${logo}" style="position:absolute;left:140px;top:120px;height:84px">
  <div style="position:absolute;left:140px;right:140px;top:430px">
    <div style="color:#ff3b46;font-size:30px;font-weight:600;letter-spacing:.14em;text-transform:uppercase">${esc(kicker)}</div>
    <div style="color:#fff;font-size:92px;font-weight:700;line-height:1.08;margin-top:22px">${esc(big)}</div>
    <div style="color:#b8bfca;font-size:38px;margin-top:26px;line-height:1.35">${esc(small)}</div>
  </div>
  <div style="position:absolute;left:140px;bottom:90px;color:#6f7785;font-size:26px">Cyrix KPI · How-to videos</div>`

const title = await draw(card(`Video ${video.number} of ${video.of}`, video.section, video.subtitle),
  path.join(work, 'title.png'), W, H)
const endCard = await draw(card('Done', 'That is the whole step.', video.next), path.join(work, 'end.png'), W, H)

const order = take.marks.map(m => m.key).filter(k => steps[k])
const captions = []
for (let i = 0; i < order.length; i++) {
  const key = order[i]
  const mark = take.marks.find(m => m.key === key)
  const next = take.marks.find(m => m.key === order[i + 1])
  const [head, body] = steps[key]
  const file = await draw(`
    <div style="position:absolute;inset:0;background:${BG}"></div>
    <div style="position:absolute;left:${SIDE}px;top:34px;width:8px;height:112px;border-radius:4px;background:#e30613"></div>
    <div style="position:absolute;left:${SIDE + 34}px;right:${SIDE}px;top:28px">
      <div style="color:#fff;font-size:40px;font-weight:650;line-height:1.15">${esc(head)}</div>
      <div style="color:#c3c9d3;font-size:30px;line-height:1.35;margin-top:10px">${esc(body)}</div>
    </div>
    <div style="position:absolute;right:${SIDE}px;top:30px;color:#6f7785;font-size:24px">${i + 1} / ${order.length}</div>`,
  path.join(work, `cap-${String(i).padStart(2, '0')}-${key}.png`), W, STRIP)
  captions.push({ file, from: i === 0 ? 0.2 : mark.at, to: next ? next.at : screenLength })
}

const overlays = []
for (const o of video.overlays ?? []) {
  if (o.image !== 'sheet') continue
  const wb = XLSX.readFile(path.join(WORK_DIR, 'My KPI - Kevin Test.xlsx'))
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 })
  const cell = (v, i) => `<td style="border:1px solid #d6dbe1;padding:8px 11px;font-size:17px;white-space:nowrap;${i === 3 || i === 4 ? 'text-align:right' : ''}">${esc(i === 3 && typeof v === 'number' ? v : v ?? '')}</td>`
  const table = rows.slice(0, 5).map((r, n) => `<tr style="${n === 0 ? 'background:#e8f1ea;font-weight:600' : 'background:#fff'}">${[0, 1, 2, 3, 4, 5].map(i => cell(r[i], i)).join('')}</tr>`).join('')
  const file = await draw(`
    <div style="position:absolute;left:30px;top:30px;right:30px;bottom:30px;background:#fff;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.35);overflow:hidden">
      <div style="background:#1e7145;color:#fff;font-size:22px;padding:14px 20px;font-weight:600">My KPI - Kevin Test.xlsx</div>
      <table style="border-collapse:collapse;margin:18px;color:#1d2330">${table}</table>
    </div>`, path.join(work, 'sheet.png'), 1540, 460, true)
  const from = take.marks.find(m => m.key === o.from)?.at ?? 0
  const to = take.marks.find(m => m.key === o.to)?.at ?? screenLength
  overlays.push({ file, from: from + 0.4, to: to - 0.2, x: SIDE + (APP_W - 1540) / 2, y: (APP_H - 460) / 2 })
}
await browser.close()

/* ---- 3. music ------------------------------------------------------ */
const music = path.join(WORK_DIR, 'music.wav')
if (!fs.existsSync(music)) throw new Error('run: node music.mjs 300')

/* ---- 4. put it together -------------------------------------------- */
const total = CARD + screenLength + CARD - 2 * FADE
const inputs = ['-loop', '1', '-t', String(CARD), '-i', title, '-i', screen, '-loop', '1', '-t', String(CARD), '-i', endCard]
const stills = [...captions, ...overlays]
for (const s of stills) inputs.push('-loop', '1', '-t', screenLength.toFixed(3), '-i', s.file)
inputs.push('-i', music)
const musicIndex = 3 + stills.length

const norm = `fps=${FPS},format=yuv420p,settb=AVTB,setsar=1`
const graph = [
  `[0:v]scale=${W}:${H},${norm}[title]`,
  `[2:v]scale=${W}:${H},${norm}[end]`,
  `[1:v]pad=${W}:${H}:${SIDE}:0:color=${BG.replace('#', '0x')},${norm}[s0]`,
]
let last = 's0'
stills.forEach((s, i) => {
  const x = s.x ?? 0, y = s.y ?? APP_H
  const next = `s${i + 1}`
  const fade = s.x !== undefined ? `,format=rgba,fade=t=in:st=${s.from.toFixed(2)}:d=0.35:alpha=1` : ''
  graph.push(`[${3 + i}:v]setsar=1${fade}[o${i}]`)
  graph.push(`[${last}][o${i}]overlay=${x}:${y}:enable='between(t,${s.from.toFixed(3)},${s.to.toFixed(3)})',${norm}[${next}]`)
  last = next
})
graph.push(`[title][${last}]xfade=transition=fade:duration=${FADE}:offset=${(CARD - FADE).toFixed(3)}[ts]`)
graph.push(`[ts][end]xfade=transition=fade:duration=${FADE}:offset=${(CARD + screenLength - 2 * FADE).toFixed(3)}[v]`)
graph.push(`[${musicIndex}:a]atrim=0:${total.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=2.5,afade=t=out:st=${(total - 3.5).toFixed(3)}:d=3.5,volume=0.55[a]`)

const out = path.join(OUT_DIR, `${takeName}-${lang}.mp4`)
fs.writeFileSync(path.join(work, 'graph.txt'), graph.join(';\n'))
ff([...inputs, '-filter_complex_script', path.join(work, 'graph.txt'), '-map', '[v]', '-map', '[a]',
  '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-t', total.toFixed(3), out])
console.log(`${out} · ${total.toFixed(1)}s`)
