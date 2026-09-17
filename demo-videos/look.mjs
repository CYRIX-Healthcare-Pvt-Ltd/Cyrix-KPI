// Looks at a page as a demo account, without doing anything on it: a
// screenshot and the visible buttons, to plan a recording's steps.
import { chromium } from 'playwright'
import path from 'node:path'
import { PROFILE_DIR, WORK_DIR, KPI, SIZE } from './lib.mjs'

const [ecode, route = '/'] = process.argv.slice(2)
const context = await chromium.launchPersistentContext(path.join(PROFILE_DIR, ecode), {
  channel: 'msedge', headless: true, viewport: SIZE,
})
const page = context.pages()[0] ?? await context.newPage()
await page.goto(KPI + route, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
const shot = path.join(WORK_DIR, `look-${ecode}-${route.replace(/\W+/g, '_') || 'home'}.png`)
await page.screenshot({ path: shot, fullPage: true })
const info = await page.evaluate(() => ({
  url: location.pathname,
  h1: [...document.querySelectorAll('h1,h2,h3')].map(h => h.innerText.trim()).filter(Boolean).slice(0, 12),
  buttons: [...document.querySelectorAll('button, a.btn-primary, a.btn-secondary')].map(b => b.innerText.trim()).filter(Boolean).slice(0, 30),
  who: document.querySelector('header')?.innerText.replace(/\s+/g, ' ').slice(0, 120),
}))
console.log(JSON.stringify(info, null, 2))
console.log(shot)
await context.close()
