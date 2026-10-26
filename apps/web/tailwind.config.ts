import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display)', 'ui-monospace', 'monospace'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      colors: {
        console: '#06080b',
        panel: {
          DEFAULT: '#0b0f14',
          raised: '#0f141b',
          inset: '#070a0e',
        },
        line: {
          DEFAULT: '#1a2430',
          bright: '#2b3a4a',
        },
        grid: {
          100: '#cdd8e4',
          300: '#8a9aac',
          500: '#5a6b7d',
        },
        amber: {
          DEFAULT: '#ffb000',
          soft: '#f0a202',
        },
        phosphor: '#44d492',
        alert: '#ff5a52',
        info: '#3cc4e6',
      },
      boxShadow: {
        bezel:
          'inset 0 1px 0 0 rgba(255,255,255,0.04), inset 0 0 0 1px rgba(0,0,0,0.6), 0 8px 24px -12px rgba(0,0,0,0.9)',
        'glow-amber': '0 0 0 1px rgba(255,176,0,0.4), 0 0 24px -4px rgba(255,176,0,0.45)',
      },
    },
  },
  plugins: [],
};

export default config;
