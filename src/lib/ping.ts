/**
 * The notification sound, and nothing else.
 *
 * Synthesised rather than shipped as a file. This is an installable PWA
 * that service engineers open on patchy connections — the same reason
 * the font is self-hosted — and a two-note ping is about forty lines of
 * maths against forty kilobytes of audio that has to arrive before it
 * can be heard. It also cannot half-load and click.
 *
 * When to make a sound is decided in alerts.ts. This file only knows how.
 */

let ctx: AudioContext | null = null
let unlocked = false

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!ctx) ctx = new Ctor()
  return ctx
}

/**
 * Autoplay policy: a context created outside a gesture starts suspended
 * and every note played into it is silent. Resuming it once, inside any
 * real interaction, is what makes every later ping audible.
 *
 * Browsers refuse to play audio until the user has interacted with the
 * page, which is not a problem worth engineering around: signing in is a
 * click. The context is unlocked on the first gesture of the session and
 * stays unlocked.
 */
function unlock() {
  if (unlocked) return
  const c = context()
  if (!c) return
  unlocked = true
  if (c.state === 'suspended') void c.resume()
}

if (typeof window !== 'undefined') {
  const once = { once: true, passive: true } as const
  window.addEventListener('pointerdown', unlock, once)
  window.addEventListener('keydown', unlock, once)
}

/**
 * Two soft sine tones a fourth apart, the second landing while the first
 * is still fading.
 *
 * Every envelope starts and ends at a value rather than at zero, because
 * an oscillator that begins at full gain produces a click — the speaker
 * cone is being asked to jump rather than move. 12ms in and a long tail
 * out is the difference between a ping and a tick.
 */
export async function playPing(): Promise<void> {
  const c = context()
  if (!c) return

  // The listener above resumes on the first gesture, but resume() is a
  // promise: the very first ping is often the confirmation played from
  // inside that same click, and it would land while the context is still
  // suspended. Awaiting here is what makes that one audible too.
  if (c.state === 'suspended') {
    try {
      await c.resume()
    } catch {
      return
    }
  }
  if (c.state !== 'running') return

  const now = c.currentTime
  const master = c.createGain()
  // Quiet on purpose. This has to be able to go off in an open office
  // without turning heads that are not being notified.
  master.gain.value = 0.09
  master.connect(c.destination)

  const note = (freq: number, at: number, hold: number) => {
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq

    gain.gain.setValueAtTime(0.0001, now + at)
    gain.gain.exponentialRampToValueAtTime(1, now + at + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + at + hold)

    osc.connect(gain)
    gain.connect(master)
    osc.start(now + at)
    osc.stop(now + at + hold + 0.02)
  }

  note(987.77, 0, 0.20)      // B5
  note(1318.51, 0.085, 0.30) // E6
}
