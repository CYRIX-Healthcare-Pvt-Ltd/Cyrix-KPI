---
name: layout-check
description: Check rendered UI for content escaping its container — clipped chart labels, text overflowing a card, a flex row that drops one item to its own line, a table forcing the page to scroll sideways. Use after building or changing any layout, chart, dialog or grid, or when the user says something "is outside the container", "not visible", "cut off", "going down", or "alignment is off".
---

# Layout check

Things escape their container in a small number of ways, and each one has
a specific cause. This is the list to walk, and how to prove it rather
than eyeball it.

## Walk this in order

### 1. Charts — the label is outside the plot

The single most common one, and it is never the chart's fault. A value
label sits above its point; the plot's top margin has no room for it; it
is drawn outside the SVG viewport and clipped.

- **Top margin must exceed the label offset plus the text height.** A
  label at `dy={-12}` in an 11px font needs roughly `top: 26`. `top: 5`
  clips it every time.
- **The first and last labels are centred on points sitting on the plot's
  own edges**, so half the text lands on the axis or past the right
  border. Anchor the ends inwards: `textAnchor="start"` on the first,
  `"end"` on the last.
- **A negative left margin** (`left: -20`, a common trick to reclaim axis
  space) pulls the plot under its own y-axis labels. The first data label
  then overlaps the topmost axis tick.
- Share one margin constant across every chart in the codebase. Picking a
  top margin by eye is how this bug comes back with the next chart.

### 2. Flex — one item drops to its own line

`flex-wrap` does not do what it looks like it does when the items have no
width to insist on.

- An item that is `shrink-0` beside one that is `flex-1` gives the second
  a flex-basis of 0. It never wraps; it just gives up its width until the
  text breaks one word per line.
- **Three buttons in a narrow container** wrap two-then-one, and the
  stranded one keeps its natural width, which reads as a mistake. Use a
  grid, and give an odd last child the full width:
  `.grid-fill > :last-child:nth-child(odd) { grid-column: 1 / -1 }`.
- Wrapping needs a stated width to fail against. State it at a
  breakpoint (`flex-col sm:flex-row`) rather than hoping.

### 3. Overflow — the page scrolls sideways

- A wide table or a long unbroken string must scroll **inside its own**
  `overflow-x-auto` container. The page body must never scroll
  horizontally.
- `min-w-0` on a flex child is what allows `truncate` to work. Without
  it, a flex item refuses to shrink below its content and pushes the row
  wider than its parent.
- `overflow-hidden` on an ancestor silently kills `position: sticky` on
  anything inside it. If a sticky element is not sticking, look up the
  tree.

### 4. Absolute and fixed

- An absolutely positioned child needs a `relative` ancestor, or it
  anchors to the viewport and lands somewhere unrelated.
- A dropdown or tooltip inside `overflow-hidden` is clipped by it. Either
  portal it out or remove the clip.
- `z-index` only competes within a stacking context. A `z-50` element
  inside a `transform`ed parent still loses to a `z-10` sibling of that
  parent.

## Proving it, not guessing

Do not judge this from the code. Render it and measure.

```js
// Anything sticking out of its parent, and anything overflowing the page.
const bad = []
for (const el of document.querySelectorAll('*')) {
  const p = el.parentElement
  if (!p) continue
  const a = el.getBoundingClientRect(), b = p.getBoundingClientRect()
  const cs = getComputedStyle(p)
  if (cs.overflow !== 'visible') continue          // clipping is deliberate
  if (a.width === 0 || a.height === 0) continue
  if (a.right > b.right + 1 || a.left < b.left - 1 ||
      a.bottom > b.bottom + 1 || a.top < b.top - 1) {
    bad.push({ el: el.tagName + '.' + el.className, by: Math.round(a.right - b.right) })
  }
}
JSON.stringify({
  pageScrollsSideways: document.documentElement.scrollWidth >
                       document.documentElement.clientWidth,
  overflowing: bad.slice(0, 20),
})
```

For SVG charts specifically, a clipped label has a `<text>` whose box
falls outside the `<svg>`:

```js
[...document.querySelectorAll('svg text')].filter(t => {
  const a = t.getBoundingClientRect()
  const b = t.closest('svg').getBoundingClientRect()
  return a.top < b.top || a.left < b.left || a.right > b.right || a.bottom > b.bottom
}).map(t => t.textContent)
```

Run both at **375px** and at desktop width. Most of these only appear at
one of the two, and the phone is the one nobody checks.

## Reporting

Say which of the four causes it was, not just that it overflowed —
"the top margin is 5 and the label sits 12 above the point" is
actionable; "the label is cut off" is the thing the user already told
you.
