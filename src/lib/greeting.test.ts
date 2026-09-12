import { describe, it, expect } from 'vitest'
import { greetingKey } from './greeting'
import { CHAT } from './chat-strings'
import { READY_LANGS } from './i18n'

const at = (hour: number) => greetingKey(new Date(2026, 8, 12, hour, 30))

describe('the hello', () => {
  it('greets by the clock', () => {
    expect(at(7)).toBe('hi.morning')
    expect(at(11)).toBe('hi.morning')
    expect(at(12)).toBe('hi.afternoon')
    expect(at(16)).toBe('hi.afternoon')
    expect(at(17)).toBe('hi.evening')
    expect(at(23)).toBe('hi.evening')
  })

  it('does not send anybody to bed', () => {
    // "Good night" is a farewell. At 2am a plain hello is the greeting.
    expect(at(0)).toBe('hi.late')
    expect(at(4)).toBe('hi.late')
    expect(at(5)).toBe('hi.morning')
  })

  it('has every hour of the day covered, in every language', () => {
    for (let hour = 0; hour < 24; hour++) {
      const phrase = CHAT[at(hour)]
      expect(phrase, `${hour}:30 has no greeting`).toBeDefined()
      for (const { code } of READY_LANGS) {
        expect(phrase[code], `${at(hour)} is missing ${code}`).toBeTruthy()
        expect(phrase[code]).toContain('{name}')
      }
    }
  })
})
