// Video 3 — Every month (manual section 2), as E8888.
// Start August, enter what was achieved, see the score, send it to the manager.
import { session, click, type, pause, KPI } from './lib.mjs'

const MONTH = 'Aug-26'
// Achieved, row by row: uptime %, PMs on time %, calls within 4 hours %, repeat breakdowns.
const ACHIEVED = ['96', '100', '88', '1']

const { page, mark, finish } = await session('E8888', '3-month')

async function point(locator, hold = 0) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  if (box) await page.evaluate(({ x, y }) => window.__demoCursor?.moveTo(x, y), { x: box.x + box.width / 2, y: box.y + box.height / 2 })
  await pause(hold)
}

try {
  await page.goto(KPI + '/', { waitUntil: 'networkidle' })
  await pause(1200)
  mark('intro')
  await point(page.getByText(`${MONTH} has not been submitted`), 4500)

  mark('open')
  await click(page, page.getByRole('link', { name: /start now/i }).or(page.getByRole('button', { name: /start now/i })).first())
  await page.waitForLoadState('networkidle')
  await pause(2000)
  const start = page.getByRole('button', { name: `Start ${MONTH}` })
  if (await start.isVisible().catch(() => false)) {
    await click(page, start)
  }
  const achieved = page.locator('input[id^="ach-"]:not([disabled])')
  await achieved.first().waitFor({ timeout: 20_000 })
  await pause(2500)

  mark('enter')
  const count = await achieved.count()
  if (count < ACHIEVED.length) throw new Error(`expected ${ACHIEVED.length} rows, found ${count}`)
  for (let i = 0; i < ACHIEVED.length; i++) {
    await type(page, achieved.nth(i), ACHIEVED[i], { delay: 140 })
    await pause(1300)
  }
  await pause(1500)

  mark('core')
  await point(page.getByText(/core values/i).last(), 5500)

  mark('remarks')
  const remarks = page.locator('#remarks')
  await type(page, remarks, 'Two breakdowns waited on spares from the Revive Lab.', { delay: 35 })
  await pause(2000)

  mark('send')
  await click(page, page.getByRole('button', { name: 'Submit to manager' }))
  await page.waitForURL('**/kpi/history', { timeout: 20_000 })
  await page.waitForLoadState('networkidle')
  await pause(3500)

  mark('end')
  await pause(3500)
} finally {
  const take = await finish()
  console.log(`${take.frames.length} frames over ${take.end.toFixed(1)} s`)
  console.log(take.marks.map(m => `${m.key}@${m.at.toFixed(1)}`).join(' '))
}
