/**
 * A number field must not change because somebody scrolled past it.
 *
 * A focused input[type=number] treats the wheel as up/down. That is a
 * browser default nobody asked for and it is quietly destructive here:
 * this form is a column of narrow number fields taller than the screen,
 * so reaching the next row means scrolling, and the pointer is still
 * sitting on the field you just filled in. A weightage of 5 becomes 8 on
 * the way down, and nothing on screen says it happened.
 *
 * One listener for the whole app rather than a prop on every field —
 * there are number inputs on six screens and the next one added would
 * have shipped without the guard.
 *
 * Blur rather than preventDefault, deliberately. Cancelling the event
 * stops the value AND the page, so the page would freeze whenever the
 * pointer happened to rest on a focused field — trading a rare wrong
 * number for a scroll that constantly sticks. Dropping focus takes the
 * field out of the wheel's reach and lets the page move as it should.
 * Nothing is lost: these fields commit on every keystroke.
 */

/** Only what the check needs, so it can be tested without a DOM. */
export interface FocusedField {
  tagName?: string
  type?: string
}

/**
 * Would this wheel event land on the field the browser would edit?
 *
 * Both conditions matter. Focused but not under the pointer scrolls the
 * page and leaves the value alone; under the pointer but not focused
 * does nothing either. Only the overlap is destructive, and only the
 * overlap should cost the field its focus.
 */
export const wheelWouldEdit = (active: unknown, target: unknown): boolean => {
  if (!active || active !== target) return false
  const el = active as FocusedField
  return el.tagName === 'INPUT' && el.type === 'number'
}

/** Installs the guard. Returns the undo, which only tests use. */
export function guardNumberFields(doc: Document = document): () => void {
  const onWheel = (e: WheelEvent) => {
    const active = doc.activeElement
    if (wheelWouldEdit(active, e.target)) (active as HTMLElement).blur()
  }
  // Passive: the point is to let the scroll through untouched.
  doc.addEventListener('wheel', onWheel, { passive: true })
  return () => doc.removeEventListener('wheel', onWheel)
}
