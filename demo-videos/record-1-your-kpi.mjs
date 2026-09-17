// Video 1 — Your KPI for the year (manual section 1), as E8888.
// Upload the KPI from the Excel template, choose the start month, send it
// to the manager. `--dry` stops before anything is saved.
import path from 'node:path'
import { session, click, pause, KPI, WORK_DIR } from './lib.mjs'

const DRY = process.argv.includes('--dry')
const START_MONTH = 'Aug-26'
const SHEET = path.join(WORK_DIR, 'My KPI - Kevin Test.xlsx')

const { page, mark, finish } = await session('E8888', DRY ? '1-your-kpi-dry' : '1-your-kpi')
try {
  await page.goto(KPI + '/', { waitUntil: 'networkidle' })
  await pause(1200)
  mark('intro')
  await pause(4500)

  mark('open')
  await click(page, page.locator('header').getByRole('link', { name: 'My KPI' }))
  await page.waitForLoadState('networkidle')
  await pause(1800)
  await click(page, page.getByText('Set up my KPI', { exact: true }).first())
  await page.waitForLoadState('networkidle')
  await pause(2500)

  mark('choices')
  await pause(3500)

  mark('template')
  await click(page, page.getByRole('button', { name: /Upload my Excel/ }))
  await pause(1500)
  await click(page, page.getByRole('button', { name: 'Download template' }))
  // The file itself is not needed: the sheet uploaded next is this template, filled in.
  await page.waitForFunction(() => (window.__demoDownloads ?? 0) > 0, null, { timeout: 15_000 })
  await pause(2500)

  mark('fill')
  await pause(5000)

  mark('upload')
  const chooser = page.waitForEvent('filechooser')
  await click(page, page.getByRole('button', { name: 'Upload from device' }))
  await (await chooser).setFiles(SHEET)
  await page.getByText('Job Role row(s) from sheet').waitFor()
  await pause(3000)

  mark('rows')
  // Down through the rows at reading pace.
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 220); await pause(1300) }
  await pause(1500)

  mark('rules')
  await pause(4000)

  // Where the start month is chosen: the select whose options are the months of the year.
  const selects = page.locator('select')
  const count = await selects.count()
  let startSelect = null
  for (let i = 0; i < count; i++) {
    const options = await selects.nth(i).locator('option').allInnerTexts()
    if (options.includes(START_MONTH) && options.includes('Apr-26')) { startSelect = selects.nth(i); break }
  }
  if (!startSelect) throw new Error('start month select not found')
  mark('start')
  await click(page, startSelect)
  await startSelect.selectOption({ label: START_MONTH })
  await pause(3500)

  mark('send')
  const send = page.getByRole('button', { name: 'Submit to my manager' })
  await send.scrollIntoViewIfNeeded()
  await pause(1500)
  if (DRY) {
    const box = await send.boundingBox()
    await page.evaluate(({ x, y }) => window.__demoCursor?.moveTo(x, y), { x: box.x + box.width / 2, y: box.y + box.height / 2 })
    await pause(3000)
  } else {
    await click(page, send)
    await page.waitForURL('**/kpi/my-kpi', { timeout: 20_000 })
    await page.waitForLoadState('networkidle')
    await pause(4000)
  }

  mark('end')
  await pause(3000)
} finally {
  const take = await finish()
  console.log(`${take.frames.length} frames over ${take.end.toFixed(1)} s`)
  console.log(take.marks.map(m => `${m.key}@${m.at.toFixed(1)}`).join(' '))
}
