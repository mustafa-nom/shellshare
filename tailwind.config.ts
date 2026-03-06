import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ['Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', 'monospace'],
      },
      colors: {
        shell: {
          bg: '#1e1e1e',
          terminal: '#1a1a1a',
          input: '#252526',
          text: '#d4d4d4',
          muted: '#6a737d',
          border: '#333333',
          selection: '#264f78',
          'tab-active': '#37373d',
          'tab-border': '#58a6ff',
          hover: '#2a2d2e',
          error: '#f85149',
        },
      },
    },
  },
  plugins: [],
};

export default config;
