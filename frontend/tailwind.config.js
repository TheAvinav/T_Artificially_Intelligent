/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Outfit"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
        display: ['"Outfit"', 'system-ui', 'sans-serif'],
      },
      colors: {
        base: '#0c0c0e',
        raised: '#131316',
        surface: '#1a1a1f',
        overlay: '#222228',
        dim: '#2a2a31',
        mid: '#35353d',
        accent: {
          DEFAULT: '#e2a04f',
          dim: '#b8833f',
          glow: 'rgba(226, 160, 79, 0.12)',
        },
        muted: '#5c5955',
        secondary: '#9a9690',
      },
      animation: {
        'fade-up': 'fadeUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'fade-in': 'fadeIn 0.3s ease-out forwards',
        'slide-down': 'slideDown 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'blink': 'blink 1s step-end infinite',
      },
    },
  },
  plugins: [],
}