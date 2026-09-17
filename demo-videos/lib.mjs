// Shared pieces for recording KPI walkthroughs.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.dirname(fileURLToPath(import.meta.url))
export const PROFILE_DIR = path.join(ROOT, 'profiles')
export const RAW_DIR = path.join(ROOT, 'raw')
export const OUT_DIR = path.join(ROOT, 'out')
export const WORK_DIR = path.join(ROOT, 'work')
export const APP = 'https://app.cyrix.in/'
export const KPI = 'https://app.cyrix.in/kpi'

/** The demo accounts. Test logins made for this; no real person's record appears. */
export const ACCOUNTS = {
  E8888: 'Kevin - Test',
  E9999: 'Henry - Test',
}

// Recorded at the size it is shown, so no text is scaled up.
export const SIZE = { width: 1600, height: 900 }

for (const d of [RAW_DIR, OUT_DIR, WORK_DIR]) fs.mkdirSync(d, { recursive: true })

/**
 * A recording session as one account.
 *
 * Returns the page plus `mark(key)`, which notes the time a step begins —
 * the captions are laid over the video at those times afterwards, in
 * whichever language is wanted, without recording again.
 */
export async function session(ecode, name, { headless = true } = {}) {
  const context = await chromium.launchPersistentContext(path.join(PROFILE_DIR, ecode), {
    channel: 'msedge',
    headless,
    viewport: SIZE,
    deviceScaleFactor: 1,
    args: ['--hide-scrollbars'],
  })
  await context.addInitScript(cursorScript)
  // A file download closes headless Edge part-way through a take. The app
  // saves a file by clicking a hidden link; that click is counted and not
  // followed, so the button still shows being pressed and nothing is saved.
  await context.addInitScript(() => {
    const follow = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function () {
      if (this.hasAttribute('download')) { window.__demoDownloads = (window.__demoDownloads ?? 0) + 1; return }
      return follow.call(this)
    }
  })
  // Cyra's "I have 2 things for you" bubble belongs to a real sitting, not a
  // walkthrough of something else. Hidden, not dismissed: dismissing writes
  // to the account's storage for the day.
  await context.addInitScript(() => {
    const css = 'div:has(> button[aria-label="Not now"]) { display: none !important; }'
    const add = () => { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st) }
    if (document.head) add(); else document.addEventListener('DOMContentLoaded', add)
  })
  const page = context.pages()[0] ?? await context.newPage()

  /*
    Frames straight from the browser's compositor, as sharp JPEGs with the
    moment each was drawn. Nothing is sent while the screen is still, so a
    frame lasts until the next one — render.mjs turns that into a steady
    30 frames a second.
  */
  const dir = path.join(RAW_DIR, name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const frames = []
  const cdp = await context.newCDPSession(page)
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = path.join(dir, `f${String(frames.length).padStart(6, '0')}.jpg`)
    fs.writeFileSync(file, Buffer.from(data, 'base64'))
    frames.push({ file, t: metadata.timestamp ?? Date.now() / 1000 })
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', {
    format: 'jpeg', quality: 92, maxWidth: SIZE.width, maxHeight: SIZE.height, everyNthFrame: 2,
  })

  const t0 = Date.now() / 1000
  const marks = []
  const mark = key => marks.push({ key, at: Date.now() / 1000 - t0 })

  async function finish() {
    const end = Date.now() / 1000 - t0
    await cdp.send('Page.stopScreencast').catch(() => {})
    await context.close()
    const take = {
      dir,
      end,
      marks,
      frames: frames.map(f => ({ file: path.basename(f.file), at: Math.max(0, f.t - t0) })),
    }
    fs.writeFileSync(path.join(RAW_DIR, `${name}.json`), JSON.stringify(take, null, 2))
    return take
  }
  return { context, page, mark, finish }
}

export const pause = ms => new Promise(r => setTimeout(r, ms))

/** Glide the visible cursor to an element, then click it — the way a person would. */
export async function click(page, locator, { settle = 500 } = {}) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  if (box) {
    await page.evaluate(({ x, y }) => window.__demoCursor?.moveTo(x, y), { x: box.x + box.width / 2, y: box.y + box.height / 2 })
    await pause(700)
    await page.evaluate(() => window.__demoCursor?.press())
  }
  await locator.click()
  await pause(settle)
}

/** Type like a person, a little slower than a machine. */
export async function type(page, locator, text, { delay = 55 } = {}) {
  await click(page, locator, { settle: 150 })
  await locator.fill('')
  await locator.pressSequentially(String(text), { delay })
  await pause(300)
}

/**
 * A soft cursor and a ripple where it clicks. Playwright's recording has
 * no pointer in it, and a walkthrough where things happen with nothing
 * moving towards them is hard to follow.
 */
function cursorScript() {
  const install = () => {
    if (window.__demoCursor) return
    const dot = document.createElement('div')
    Object.assign(dot.style, {
      position: 'fixed', left: '0', top: '0', width: '22px', height: '22px', marginLeft: '-11px', marginTop: '-11px',
      borderRadius: '50%', background: 'rgba(227,6,19,0.28)', border: '2px solid rgba(227,6,19,0.85)',
      boxShadow: '0 2px 8px rgba(0,0,0,0.25)', zIndex: '2147483647', pointerEvents: 'none',
      transform: 'translate(640px, 360px)', transition: 'transform 650ms cubic-bezier(0.23,1,0.32,1)',
    })
    document.body.appendChild(dot)
    let x = 640, y = 360
    window.__demoCursor = {
      moveTo(nx, ny) { x = nx; y = ny; dot.style.transform = `translate(${nx}px, ${ny}px)` },
      press() {
        const ring = document.createElement('div')
        Object.assign(ring.style, {
          position: 'fixed', left: `${x - 20}px`, top: `${y - 20}px`, width: '40px', height: '40px', borderRadius: '50%',
          border: '3px solid rgba(227,6,19,0.7)', zIndex: '2147483646', pointerEvents: 'none',
          transform: 'scale(0.4)', opacity: '1', transition: 'transform 450ms ease-out, opacity 450ms ease-out',
        })
        document.body.appendChild(ring)
        requestAnimationFrame(() => { ring.style.transform = 'scale(1.3)'; ring.style.opacity = '0' })
        setTimeout(() => ring.remove(), 500)
      },
    }
  }
  if (document.body) install(); else document.addEventListener('DOMContentLoaded', install)
}
