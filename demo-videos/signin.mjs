// Opens one Edge window per demo account and waits for a person to sign in.
//
// The recordings run as E8888 (team member) and E9999 (their manager). Claude
// does not type passwords, these accounts included, so a person signs in once
// here; each window keeps its own profile under profiles/, and every
// recording afterwards reuses that session.
import { chromium } from 'playwright'
import { PROFILE_DIR, ACCOUNTS, APP } from './lib.mjs'

const who = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(ACCOUNTS)

async function signedInAs(page) {
  return page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (!k.includes('auth-token')) continue
      try {
        const email = JSON.parse(localStorage.getItem(k))?.user?.email ?? ''
        return email.split('@')[0].toUpperCase()
      } catch { /* not a session */ }
    }
    return null
  }).catch(() => null)
}

const windows = await Promise.all(who.map(async (ecode, i) => {
  const context = await chromium.launchPersistentContext(`${PROFILE_DIR}/${ecode}`, {
    channel: 'msedge',
    headless: false,
    viewport: { width: 1100, height: 760 },
    args: [`--window-position=${40 + i * 620},40`],
  })
  // A banner on every page of this window only, so nobody signs the wrong one in.
  await context.addInitScript(({ ecode, name }) => {
    const show = () => {
      if (document.getElementById('demo-signin-banner')) return
      const b = document.createElement('div')
      b.id = 'demo-signin-banner'
      b.textContent = `Sign in here as ${ecode} (${name}) — this window records as ${ecode}`
      Object.assign(b.style, {
        position: 'fixed', left: '0', right: '0', bottom: '0', zIndex: '2147483647',
        background: '#e30613', color: '#fff', font: '600 15px system-ui', padding: '10px 16px', textAlign: 'center',
      })
      document.body.appendChild(b)
    }
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show)
  }, { ecode, name: ACCOUNTS[ecode] })
  const page = context.pages()[0] ?? await context.newPage()
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  return { ecode, context, page }
}))

console.log(`Waiting for sign-in: ${who.join(', ')}`)
const deadline = Date.now() + 20 * 60_000
const done = new Set()
while (done.size < windows.length && Date.now() < deadline) {
  for (const w of windows) {
    if (done.has(w.ecode)) continue
    const as = await signedInAs(w.page)
    if (as === w.ecode) {
      done.add(w.ecode)
      console.log(`${w.ecode} signed in`)
    } else if (as) {
      console.log(`The ${w.ecode} window is signed in as ${as} — sign out there and sign in as ${w.ecode}`)
    }
  }
  await new Promise(r => setTimeout(r, 3000))
}
for (const w of windows) await w.context.close()
if (done.size < windows.length) {
  console.log(`Not signed in: ${windows.filter(w => !done.has(w.ecode)).map(w => w.ecode).join(', ')}`)
  process.exit(1)
}
console.log('SIGNED IN: ' + [...done].join(', '))
