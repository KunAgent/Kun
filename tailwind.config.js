/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{ts,tsx}',
    './node_modules/streamdown/dist/**/*.js'
  ],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: 'var(--ds-accent)',
          foreground: 'var(--ds-control-foreground)',
          soft: 'var(--ds-accent-soft)',
          // Alpha-capable accent: `bg-accent-tint/10` works, while
          // `bg-accent/10` is silently dropped (full var() colors cannot take
          // an opacity modifier in Tailwind 3.4).
          tint: 'color-mix(in srgb, var(--ds-accent) calc(<alpha-value> * 100%), transparent)'
        },
        control: {
          DEFAULT: 'var(--ds-control)',
          foreground: 'var(--ds-control-foreground)'
        },
        background: 'var(--ds-bg-canvas)',
        foreground: 'var(--ds-text)',
        border: 'var(--ds-border)',
        muted: {
          DEFAULT: 'var(--ds-surface-subtle)',
          foreground: 'var(--ds-text-muted)'
        },
        sidebar: 'var(--ds-surface-subtle)',
        primary: {
          DEFAULT: 'var(--ds-control)',
          foreground: 'var(--ds-control-foreground)'
        },
        ds: {
          main: 'var(--ds-bg-main)',
          sidebar: 'var(--ds-bg-sidebar)',
          canvas: 'var(--ds-bg-canvas)',
          card: 'var(--ds-surface-card)',
          elevated: 'var(--ds-surface-elevated)',
          subtle: 'var(--ds-surface-subtle)',
          hover: 'var(--ds-surface-hover)',
          border: 'var(--ds-border)',
          'border-muted': 'var(--ds-border-muted)',
          ink: 'var(--ds-text)',
          muted: 'var(--ds-text-muted)',
          faint: 'var(--ds-text-faint)',
          success: 'var(--ds-success)',
          'success-soft': 'var(--ds-success-soft)',
          danger: 'var(--ds-danger)',
          'danger-soft': 'var(--ds-danger-soft)',
          'diff-added': 'var(--ds-diff-added)',
          'diff-added-soft': 'var(--ds-diff-added-soft)',
          'diff-removed': 'var(--ds-diff-removed)',
          'diff-removed-soft': 'var(--ds-diff-removed-soft)',
          skill: 'var(--ds-skill)',
          'skill-soft': 'var(--ds-skill-soft)',
          userbubble: 'var(--ds-bubble-user)',
          userbubbleFg: 'var(--ds-bubble-user-fg)'
        }
      },
      boxShadow: {
        composer: 'var(--ds-shadow-composer)',
        shell: 'var(--ds-shadow-shell)',
        panel: 'var(--ds-shadow-panel)'
      },
      borderRadius: {
        control: 'var(--ds-radius-control)',
        card: 'var(--ds-radius-card)',
        pill: 'var(--ds-radius-pill)',
        xl: '14px',
        '2xl': '18px',
        '3xl': '22px'
      }
    }
  },
  plugins: []
}
