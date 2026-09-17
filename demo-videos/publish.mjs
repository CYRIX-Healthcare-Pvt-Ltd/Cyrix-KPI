// Copies the finished videos into the KPI app's public/videos, with a poster
// frame for each (its title card), under the names the manual links to.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'
import { OUT_DIR, WORK_DIR } from './lib.mjs'

const TARGET = 'D:/Cyrix KPI/public/videos'
const NAMES = {
  '1-your-kpi': 'kpi-1-your-kpi',
  '2-approve': 'kpi-2-approve',
  '3-month': 'kpi-3-every-month',
  '4-score': 'kpi-4-score',
}
fs.mkdirSync(TARGET, { recursive: true })
for (const [take, name] of Object.entries(NAMES)) {
  const video = path.join(OUT_DIR, `${take}-en.mp4`)
  const title = path.join(WORK_DIR, `${take}-en`, 'title.png')
  if (!fs.existsSync(video) || !fs.existsSync(title)) throw new Error(`${take} is not rendered yet`)
  fs.copyFileSync(video, path.join(TARGET, `${name}.mp4`))
  execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', title,
    '-vf', 'scale=1280:-1', '-q:v', '4', path.join(TARGET, `${name}.jpg`)])
  const mb = (fs.statSync(path.join(TARGET, `${name}.mp4`)).size / 1024 / 1024).toFixed(1)
  console.log(`${name}.mp4 · ${mb} MB`)
}
