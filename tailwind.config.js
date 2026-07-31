/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /**
         * Cyrix Healthcare palette, taken from the logo.
         *
         *   ink   the black of CYRIX / HEALTH CARE PVT LTD
         *   red   the X, and the "X-Factor" in the tagline
         *   blue  the tagline text
         *
         * Blue carries interactive elements. Red is kept meaningful —
         * poor scores, destructive actions, the logo — rather than used
         * as general decoration, so a red badge always means something.
         */
        ink: {
          50:  '#f6f7f9', 100: '#eceef2', 200: '#d4d8e0', 300: '#adb4c2',
          400: '#808a9f', 500: '#606b82', 600: '#4c5568', 700: '#3e4555',
          800: '#353a48', 900: '#11141c', 950: '#080a0f',
        },
        cyrixRed: {
          50:  '#fef2f3', 100: '#fde3e5', 200: '#fbccd0', 300: '#f7a8af',
          400: '#f17886', 500: '#e64a5f', 600: '#d21f38', 700: '#b01329',
          800: '#941327', 900: '#7e1426', 950: '#460610',
        },
        cyrixBlue: {
          50:  '#f0f5fc', 100: '#dee9f8', 200: '#c4d9f4', 300: '#9bc0ec',
          400: '#6b9fe1', 500: '#4a7fd6', 600: '#3663c9', 700: '#2e50b8',
          800: '#1e4b9b', 900: '#1b3f7c', 950: '#12284c',
        },
        /** Alias so existing `brand-*` classes pick up the new palette. */
        brand: {
          50:  '#f0f5fc', 100: '#dee9f8', 200: '#c4d9f4', 300: '#9bc0ec',
          400: '#6b9fe1', 500: '#4a7fd6', 600: '#3663c9', 700: '#2e50b8',
          800: '#1e4b9b', 900: '#1b3f7c',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
