import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#f0fdf9', 100: '#ccfbef', 500: '#14b8a6', 600: '#0d9488', 700: '#0f766e' },
      },
    },
  },
} satisfies Config;
