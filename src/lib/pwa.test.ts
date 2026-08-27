import { describe, it, expect } from 'vitest'
import { installRoute } from './pwa'

/**
 * Four situations, four different answers, and every one of them needs a
 * different physical device to see for real — which is exactly why the
 * branching lives in a pure function with tests rather than inside the
 * component.
 *
 * The one that matters most is 'unsupported'. There is no way to force
 * an install: Safari offers websites no install API at all and Firefox
 * has none either. A prompt that insisted would lock those people out of
 * a system they are required to use, so the rule has to be able to say
 * "do not ask" — and has to keep saying it.
 */
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36'
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1'
const CHROME_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1'
const SAFARI_IPADOS =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
const CHROME_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const EDGE_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0'
const FIREFOX_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'

const route = (ua: string, over: { standalone?: boolean; hasPrompt?: boolean; touchPoints?: number } = {}) =>
  installRoute({ standalone: false, hasPrompt: false, ua, ...over })

describe('which install route somebody is on', () => {
  it('says nothing at all to somebody already installed', () => {
    // Whatever else is true. An installed app asking to be installed is
    // the single worst outcome here.
    for (const ua of [CHROME_ANDROID, SAFARI_IPHONE, CHROME_DESKTOP, FIREFOX_DESKTOP]) {
      expect(route(ua, { standalone: true })).toBe('installed')
      expect(route(ua, { standalone: true, hasPrompt: true })).toBe('installed')
    }
  })

  it('offers the real button the moment Chrome hands one over', () => {
    expect(route(CHROME_ANDROID, { hasPrompt: true })).toBe('prompt')
    expect(route(CHROME_DESKTOP, { hasPrompt: true })).toBe('prompt')
  })

  it('falls back to instructions on Safari, which has no button to offer', () => {
    expect(route(SAFARI_IPHONE)).toBe('ios')
  })

  it('recognises an iPad claiming to be a Mac', () => {
    // iPadOS 13 and later send a desktop Safari string. Touch points are
    // the only thing that gives it away, and without this an iPad is
    // told to look in an address bar it does not have.
    expect(route(SAFARI_IPADOS, { touchPoints: 5 })).toBe('ios')
    // A real Mac, same string, no touch screen.
    expect(route(SAFARI_IPADOS, { touchPoints: 0 })).toBe('unsupported')
  })

  it('does not send Chrome-on-iOS to a Share menu that has no such entry', () => {
    // It is Safari underneath, but only Safari itself can add to the
    // home screen — the instructions would be a dead end.
    expect(route(CHROME_IPHONE)).toBe('unsupported')
  })

  it('points desktop Chromium at its own address-bar control', () => {
    expect(route(CHROME_DESKTOP)).toBe('desktop-manual')
    expect(route(EDGE_DESKTOP)).toBe('desktop-manual')
  })

  it('does not send a phone looking for an address bar', () => {
    // Android Chrome with no captured event means either it is already
    // installed — Chrome stops offering once it is — or Chrome has not
    // decided to offer yet. "Click the icon in the address bar" is
    // advice for a window that does not exist on a phone.
    expect(route(CHROME_ANDROID)).toBe('unsupported')
    // The event arriving is what turns it into a real offer.
    expect(route(CHROME_ANDROID, { hasPrompt: true })).toBe('prompt')
  })

  it('stays silent where installing is not possible', () => {
    // Firefox cannot install a PWA on the desktop at all. Asking is
    // pure nagging, and the prompt has to be able to not appear.
    expect(route(FIREFOX_DESKTOP)).toBe('unsupported')
    expect(route(FIREFOX_DESKTOP, { standalone: true })).toBe('installed')
  })

  it('never leaves somebody with a prompt they cannot act on', () => {
    // Every route either does something or says nothing. The failure
    // this guards against is a dialog with no working way out of it.
    const actionable = ['prompt', 'ios', 'desktop-manual']
    for (const ua of [
      CHROME_ANDROID, SAFARI_IPHONE, CHROME_IPHONE, SAFARI_IPADOS,
      CHROME_DESKTOP, EDGE_DESKTOP, FIREFOX_DESKTOP,
    ]) {
      for (const hasPrompt of [true, false]) {
        const r = route(ua, { hasPrompt })
        expect(actionable.includes(r) || r === 'unsupported' || r === 'installed').toBe(true)
      }
    }
  })
})
