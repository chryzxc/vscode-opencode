import type { Config } from 'tailwindcss'

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ── shadcn semantic tokens (maps to --vscode-* via index.css) ──────────
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        background: "var(--background)",
        foreground: "var(--foreground)",
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },

        // ── OpenCode design tokens (--oc-* vars) ─────────────────────────────
        // Surfaces
        "oc-bg": "var(--oc-bg)",
        "oc-bg-soft": "var(--oc-bg-soft)",
        "oc-bg-overlay": "var(--oc-bg-overlay)",
        "oc-panel": "var(--oc-panel)",
        "oc-panel-soft": "var(--oc-panel-soft)",

        // Borders
        "oc-border": "var(--oc-border)",
        "oc-border-soft": "var(--oc-border-soft)",

        // Text
        "oc-text": "var(--oc-text)",
        "oc-text-soft": "var(--oc-text-soft)",
        "oc-text-muted": "var(--oc-text-muted)",

        // Accent
        "oc-accent": "var(--oc-accent)",
        "oc-accent-soft": "var(--oc-accent-soft)",
        "oc-accent-glow": "var(--oc-accent-glow)",

        // Status
        "oc-green": "var(--oc-green)",
        "oc-yellow": "var(--oc-yellow)",
        "oc-red": "var(--oc-red)",
        "oc-orange": "var(--oc-orange)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontSize: {
        // Named aliases for frequently used arbitrary sizes
        "oc-2xs": ["11px", { lineHeight: "1.4" }],
        "oc-xs": ["12px", { lineHeight: "1.4" }],
        "oc-sm": ["13px", { lineHeight: "1.5" }],
        "oc-base": ["14px", { lineHeight: "1.5" }],
      },
    },
  },
  plugins: [],
} satisfies Config;
