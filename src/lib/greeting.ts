/**
 * Good morning, good afternoon, good evening.
 *
 * The panel used to open with "here is where you stand today", which is
 * a heading rather than a greeting: it tells the reader what the cards
 * below are and says nothing to them. A person opening an app at seven
 * in the morning and at nine at night is not in the same mood, and the
 * one word that acknowledges it costs nothing.
 *
 * Read off the reader's own device, which is the only clock that knows
 * where they are. Everybody here is in one timezone today, and this
 * still holds the day an engineer opens it from somewhere else.
 *
 * Four windows, not three. "Good night" is a farewell in English and in
 * every language this app speaks, so somebody signing in at two in the
 * morning gets a plain hello instead of being seen off.
 */
export function greetingKey(now: Date = new Date()): string {
  const hour = now.getHours()
  if (hour >= 5 && hour < 12) return 'hi.morning'
  if (hour >= 12 && hour < 17) return 'hi.afternoon'
  if (hour >= 17 && hour < 24) return 'hi.evening'
  return 'hi.late'
}
