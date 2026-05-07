# OpenCode Color Theme System

## Overview

The OpenCode extension now uses a centralized, neutral grey color theme that is easy to customize. All color definitions are consolidated in a single file for easy maintenance.

## Color Configuration File

**Location:** `/webview/shared/src/chat/colors.css`

This file contains all color variables used throughout the UI. To change the color theme, you only need to modify this one file.

## Color Categories

### Primary Accent Colors
- `--oc-neutral-accent`: Main accent color (#a1a1aa - neutral grey)
- `--oc-neutral-accent-soft`: Transparent version for backgrounds
- `--oc-neutral-accent-glow`: Shadow/glow effect color
- `--oc-neutral-accent-hover`: Hover state color

### Border Colors
- `--oc-neutral-border-light`: Light border opacity
- `--oc-neutral-border-medium`: Medium border opacity
- `--oc-neutral-border-thin`: Thin border opacity
- `--oc-neutral-border-faint`: Faint border opacity

### Background Colors
- `--oc-neutral-bg-subtle`: Subtle background accent
- `--oc-neutral-bg-faint`: Very faint background
- `--oc-neutral-bg-light`: Light background
- `--oc-neutral-bg-hover`: Hover background state

### Operation Colors
All operation types use the same neutral theme:
- `--oc-op-blue`: For edit operations
- `--oc-op-purple`: For modify operations
- `--oc-op-teal`: For patch operations
- `--oc-op-green`: For write operations
- `--oc-op-orange`: For update operations

### Terminal Colors
- `--oc-term-accent`: Terminal accent color
- `--oc-term-accent-light`: Light terminal accent
- `--oc-term-bg`: Terminal background highlight
- `--oc-term-border`: Terminal border color

## How to Customize Colors

### Example: Change to Blue Theme

Edit `/webview/shared/src/chat/colors.css`:

```css
:root {
  /* Primary Accent - Blue Theme */
  --oc-neutral-accent: #3b82f6;
  --oc-neutral-accent-soft: rgba(59, 130, 246, 0.1);
  --oc-neutral-accent-glow: rgba(59, 130, 246, 0.2);
  --oc-neutral-accent-hover: rgba(59, 130, 246, 0.15);

  /* Update all other color variables similarly */
}
```

### Example: Change to Green Theme

```css
:root {
  /* Primary Accent - Green Theme */
  --oc-neutral-accent: #10b981;
  --oc-neutral-accent-soft: rgba(16, 185, 129, 0.1);
  --oc-neutral-accent-glow: rgba(16, 185, 129, 0.2);
  --oc-neutral-accent-hover: rgba(16, 185, 129, 0.15);
}
```

## Using Colors in Components

All components reference these CSS variables. For example:

```css
.my-component {
  color: var(--oc-neutral-accent);
  background: var(--oc-neutral-bg-subtle);
  border-color: var(--oc-neutral-border-medium);
}
```

## Files Using the Color System

- `/webview/shared/src/chat/index.css` - Main styles (imports colors.css)
- `/webview/shared/src/chat/PanelComponents.tsx` - React components
- All other component files automatically inherit the color theme

## Benefits

1. **Single Source of Truth**: All colors defined in one place
2. **Easy Theme Changes**: Modify one file to change the entire UI
3. **Consistency**: All components use the same color variables
4. **Maintainability**: No need to hunt through multiple files
5. **Neutral Default**: Professional grey theme that works in any context

## Migration Notes

All blue colors (#89b4fa, #58a6ff, #3b82f6, etc.) have been replaced with the neutral grey theme. The old blue colors are no longer used anywhere in the codebase.
