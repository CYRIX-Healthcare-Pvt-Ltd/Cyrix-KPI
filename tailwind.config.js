/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /**
         * Cyrix Healthcare palette — black, red, white, exactly as the
         * logo. No blue anywhere in the chrome.
         *
         *   ink       the black of CYRIX / HEALTH CARE PVT LTD
         *   cyrixRed  the X
         *
         * Black carries structure and primary actions. Red is the single
         * accent, kept meaningful — the X in the wordmark, destructive
         * actions, pending badges, poor scores — so it always signals.
         *
         * Score bands use their own semantic greens and ambers: those
         * communicate performance, not brand, and a red-on-red scale
         * would be unreadable.
         */
        /*
         * Read from CSS variables so one stylesheet can restate the whole
         * ramp for dark mode and every existing bg-ink-50 / text-ink-900 /
         * border-ink-200 follows without being touched. There are around
         * 350 of them across 35 components; adding a dark: variant to each
         * would be 350 chances to miss one, and every future component
         * would have to remember.
         *
         * Channels rather than whole colours, and rgb(... / <alpha-value>)
         * rather than var(--x): the app leans on alpha modifiers in 22
         * places — border-ink-200/70, bg-ink-950/60 — and a variable
         * holding "#d8d9dd" cannot take one.
         */
        ink: {
          50:  'rgb(var(--ink-50) / <alpha-value>)',
          100: 'rgb(var(--ink-100) / <alpha-value>)',
          200: 'rgb(var(--ink-200) / <alpha-value>)',
          300: 'rgb(var(--ink-300) / <alpha-value>)',
          400: 'rgb(var(--ink-400) / <alpha-value>)',
          500: 'rgb(var(--ink-500) / <alpha-value>)',
          600: 'rgb(var(--ink-600) / <alpha-value>)',
          700: 'rgb(var(--ink-700) / <alpha-value>)',
          800: 'rgb(var(--ink-800) / <alpha-value>)',
          900: 'rgb(var(--ink-900) / <alpha-value>)',
          950: 'rgb(var(--ink-950) / <alpha-value>)',
        },
        /** The page behind everything. White in light, near-black in dark. */
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        /** Cards and bars, a step lighter than the canvas in dark so they
         *  still read as raised without needing a shadow. */
        surface: 'rgb(var(--surface) / <alpha-value>)',
        /** Text and icons sitting on an ink-900/950 fill. It cannot be
         *  plain white: ink-900 becomes near-white in dark, and white on
         *  white is the one thing a palette swap must not produce. */
        onInk: 'rgb(var(--on-ink) / <alpha-value>)',
        /**
         * Near-black in both themes, for the surfaces that are meant to be
         * dark rather than merely darker than the page: the sign-in hero,
         * the chatbot's chrome, the analysis cards, and every modal scrim.
         *
         * These were bg-ink-950 and inverting them turned the sign-in hero
         * white while the wordmark on it stayed white — an invisible logo
         * on a blank panel. A scrim is worse: ink-950/60 in dark is a white
         * veil over a dark page, which reads as the screen washing out.
         *
         * Not a token that flips, because these are not "the darkest step
         * of the palette". They are dark on purpose.
         *
         * Exactly #000000, which is what ink-950 rendered before any of
         * this existed. These surfaces must look in light precisely as
         * they always have — near-black would have been a quiet redesign
         * of the sign-in screen smuggled in behind a dark mode.
         */
        shade: 'rgb(0 0 0 / <alpha-value>)',
        cyrixRed: {
          50:  '#fef2f3', 100: '#fde3e5', 200: '#fbccd0', 300: '#f7a8af',
          400: '#f17886', 500: '#e64a5f', 600: '#e30613', 700: '#c00512',
          800: '#9e0812', 900: '#7e1426', 950: '#460610',
        },
      },
      fontFamily: {
        /*
         * SF Pro, the same stack every Cyrix module uses.
         *
         * It is Apple's font and licensed only for Apple platforms, so it
         * cannot be shipped. -apple-system picks it up where it already
         * exists; Inter is bundled as the stand-in everywhere else, close
         * enough in metrics that the layout does not shift between a
         * phone and a desk.
         */
        sans: [
          'SF Pro Text',
          '-apple-system',
          'BlinkMacSystemFont',
          'Inter Variable',
          'Inter',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
      letterSpacing: {
        label: '0.16em',
      },
    },
  },
  plugins: [],
}
