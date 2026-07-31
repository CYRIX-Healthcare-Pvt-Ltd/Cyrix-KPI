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
        ink: {
          50:  '#f7f7f8', 100: '#eeeef0', 200: '#d8d9dd', 300: '#b4b6bd',
          400: '#8a8d97', 500: '#6b6e79', 600: '#565962', 700: '#464851',
          800: '#2b2d34', 900: '#141519', 950: '#000000',
        },
        cyrixRed: {
          50:  '#fef2f3', 100: '#fde3e5', 200: '#fbccd0', 300: '#f7a8af',
          400: '#f17886', 500: '#e64a5f', 600: '#e30613', 700: '#c00512',
          800: '#9e0812', 900: '#7e1426', 950: '#460610',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      letterSpacing: {
        label: '0.16em',
      },
    },
  },
  plugins: [],
}
