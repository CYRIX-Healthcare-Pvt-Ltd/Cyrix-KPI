// Video 2 — Approve their KPI (manual: Because you have a team), as E9999.
// Review Kevin's KPI, correct a target, keep it as a team template, approve.
import { session, click, type, pause, KPI } from './lib.mjs'

const { page, mark, finish } = await session('E9999', '2-approve')

/** Glide the cursor to something without clicking it, to point at it. */
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
  await point(page.locator('header').getByRole('link', { name: /Approvals/ }), 4500)

  mark('open')
  await click(page, page.locator('header').getByRole('link', { name: /Approvals/ }))
  await page.waitForLoadState('networkidle')
  await pause(2500)

  mark('review')
  await click(page, page.getByRole('button', { name: /Kevin - Test/ }))
  await page.getByRole('button', { name: 'Approve', exact: true }).waitFor()
  await pause(3500)

  mark('start')
  await point(page.getByText('This KPI starts from', { exact: false }).first(), 5000)

  mark('rules')
  await point(page.getByText('higher capped').first(), 2500)
  await point(page.getByText('lower penalty').first(), 3500)

  mark('edit')
  await click(page, page.getByRole('button', { name: 'Edit', exact: true }))
  await pause(1200)
  const response = page.locator('tbody tr').filter({ has: page.locator('input') }).nth(2)
  const target = response.locator('input').nth(3)
  if ((await target.inputValue()) !== '90' && (await target.inputValue()) !== '95') throw new Error('unexpected target field')
  await type(page, target, '95', { delay: 120 })
  await page.keyboard.press('Tab') // leaving the field saves it
  await pause(2500)
  await click(page, page.getByRole('button', { name: 'Done editing' }))
  await pause(2500)

  mark('template')
  await click(page, page.getByRole('button', { name: 'Save as team template' }))
  const name = page.getByPlaceholder('e.g. Service Engineer')
  await name.waitFor()
  await type(page, name, 'Service Engineer', { delay: 70 })
  await pause(800)
  await click(page, page.getByRole('button', { name: 'Save it' }))
  await page.getByText('Kept as').waitFor({ timeout: 20_000 })
  await pause(3500)

  mark('approve')
  await click(page, page.getByRole('button', { name: 'Approve', exact: true }))
  await page.getByText('Nothing waiting for approval').waitFor({ timeout: 20_000 })
  await pause(3500)

  mark('end')
  await pause(3000)
} finally {
  const take = await finish()
  console.log(`${take.frames.length} frames over ${take.end.toFixed(1)} s`)
  console.log(take.marks.map(m => `${m.key}@${m.at.toFixed(1)}`).join(' '))
}
