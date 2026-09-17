// Video 4 — Score their months (manual: Because you have a team), as E9999.
// Enter the manager's figures, give a reason for a much lower score, rate the
// five core values with a reason for a low one, and submit.
import { session, click, type, pause, KPI } from './lib.mjs'

// Uptime is marked down from Kevin's 96, which is what brings up the reason.
const FIGURES = ['80', '100', '85', '1']
const RATINGS = ['Very Good', 'Good', 'Excellent', 'Satisfactory', 'Good']

const { page, mark, finish } = await session('E9999', '4-score')

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
  await point(page.locator('header').getByRole('link', { name: /My Team/ }), 4500)

  mark('open')
  await click(page, page.locator('header').getByRole('link', { name: /My Team/ }))
  await page.waitForLoadState('networkidle')
  await pause(2500)
  await click(page, page.getByRole('link', { name: 'Score', exact: true }).first())
  const figures = page.locator('input[id^="mgr-"]:not([disabled])')
  await figures.first().waitFor({ timeout: 20_000 })
  await page.waitForLoadState('networkidle')
  await pause(3000)

  mark('figures')
  if ((await figures.count()) < FIGURES.length) throw new Error('fewer figure fields than expected')
  for (let i = 0; i < FIGURES.length; i++) {
    await type(page, figures.nth(i), FIGURES[i], { delay: 140 })
    await pause(1200)
  }
  await pause(1000)

  mark('reason')
  const cut = page.locator('#cut-reason')
  await cut.waitFor({ timeout: 10_000 })
  await type(page, cut, 'Two ventilators at GH Ernakulam were down for a week waiting on spares, so uptime was 80, not 96.', { delay: 28 })
  await pause(2500)

  mark('core')
  const ratings = page.locator('select[id^="core-"]:not([disabled])')
  if ((await ratings.count()) < RATINGS.length) throw new Error('fewer core value ratings than expected')
  for (let i = 0; i < RATINGS.length; i++) {
    await click(page, ratings.nth(i), { settle: 250 })
    await ratings.nth(i).selectOption(RATINGS[i])
    await pause(900)
  }

  mark('low')
  const why = page.locator('textarea[id^="why-"]').first()
  await why.waitFor({ timeout: 10_000 })
  await type(page, why, 'Two service reports this month needed corrections before they went to the hospital.', { delay: 28 })
  await pause(2500)

  mark('remarks')
  await type(page, page.locator('#mremarks'), 'Good month overall. Uptime will recover once the spares are back from the Revive Lab.', { delay: 28 })
  await pause(2000)

  mark('submit')
  await click(page, page.getByRole('button', { name: 'Submit my scores' }))
  await pause(2500)
  await click(page, page.getByRole('button', { name: 'Yes, submit my scores' }))
  await page.getByText(/Manager reviewed|scores have been submitted|submitted/i).first().waitFor({ timeout: 20_000 })
  await page.waitForLoadState('networkidle')
  await pause(4000)

  mark('end')
  await pause(3000)
} finally {
  const take = await finish()
  console.log(`${take.frames.length} frames over ${take.end.toFixed(1)} s`)
  console.log(take.marks.map(m => `${m.key}@${m.at.toFixed(1)}`).join(' '))
}
