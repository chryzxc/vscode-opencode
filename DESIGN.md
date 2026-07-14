# OpenCode Design System

This is the UI source of truth for the OpenCode VS Code extension. It defines the visual language shared by the chat, plan, diff review, skills, and configuration webviews.

OpenCode should feel like a precise, native extension of the editor: dark and calm by default, compact without becoming cramped, and rich in operational information without looking like a dashboard.

## 1. Design principles

1. **Editor-native** — inherit VS Code colors, fonts, contrast settings, and focus behavior. The UI must remain coherent in dark, light, and high-contrast themes.
2. **Quiet hierarchy** — use surface tone, spacing, and thin borders before using color, weight, or decoration.
3. **Dense, not busy** — show useful model, session, token, activity, and diff information in compact rows with clear grouping.
4. **One clear action** — each local context has one primary action at most. Everything else is a quiet secondary or icon action.
5. **State is factual** — green, yellow, and red communicate state; they are never decorative palette choices.
6. **Details on demand** — raw output, reasoning, error stacks, and secondary metrics collapse into the same item that introduced them.

## 2. Visual character

| Attribute | Direction |
| --- | --- |
| Mood | Technical, understated, dependable |
| Contrast | High enough to scan for hours; avoid harsh pure white on large text areas |
| Depth | Flat surfaces differentiated by 1px outlines and subtle tone shifts |
| Shape | Softly rounded containers, compact controls, no excessive pills |
| Color | One theme-derived accent plus semantic success, warning, and error colors |
| Motion | Fast and functional; communicates progress, expansion, or focus only |

## 3. Foundations

### 3.1 Color

Colors must be semantic. Components use OpenCode tokens, which resolve from VS Code variables; they must not introduce fixed dark-theme hex values for routine UI.

| Token | Role | VS Code source |
| --- | --- | --- |
| `--oc-bg` | Main canvas and fixed shell background | `--vscode-editor-background` |
| `--oc-chat-bg` | Transcript background | Active tab/editor-group background |
| `--oc-bg-soft` | Secondary surface, side panel, input shell | Editor widget or sidebar background |
| `--oc-panel` | Contained panel and popover surface | Editor widget background |
| `--oc-panel-soft` | Nested/hover surface | Input or editor-widget background |
| `--oc-text` | Primary content and labels | `--vscode-editor-foreground` |
| `--oc-text-secondary` | Metadata, descriptions, quiet actions | Mix of editor and description foreground |
| `--oc-border` | Default outline and structural divider | Widget/panel border |
| `--oc-border-soft` | Low-emphasis internal divider only | Transparent border mix |
| `--oc-accent` | Selected, focused, running, primary action | Scrollbar slider or button background |
| `--oc-green` | Success, additions, completion | Terminal ANSI green |
| `--oc-yellow` | Warning, pending, attention | Terminal ANSI yellow |
| `--oc-red` | Failure, deletion, destructive action | Terminal ANSI red / error foreground |

Use the shared activity-surface tokens for repeated operational surfaces:

```css
--oc-surface-border
--oc-surface-border-soft
--oc-surface-fill
--oc-surface-fill-soft
--oc-surface-panel
--oc-surface-divider
```

#### Color rules

- Use `--oc-text` for primary reading content, never status colors.
- Use `--oc-text-secondary` for timestamps, model IDs, token counts, descriptions, and inactive controls.
- Keep panels neutral. Apply semantic color to a count, icon, left rule, or small status chip—not to an entire routine panel.
- Use `color-mix()` with an existing token when a hover or tinted state is needed.
- Use VS Code link colors for inline links; do not repurpose the accent token as body-link text.

### 3.2 Typography

Use the platform system sans stack for product UI and the VS Code editor monospace stack only for code-like values.

```css
/* Product UI */
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;

/* Code, commands, paths, model IDs, token values */
font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
```

| Role | Size / line height | Weight | Usage |
| --- | --- | --- | --- |
| Page title | 16px / 1.35 | 600 | Persistent view title only |
| Section title | 13–14px / 1.4 | 600 | Panel and modal headings |
| Body | 13–14px / 1.55 | 400 | Assistant prose, settings, readable content |
| Row label | 12–13px / 1.45 | 400–500 | Files, agents, selectors, actions |
| Metadata | 11–12px / 1.4 | 400 | Time, tokens, provider, secondary facts |
| Micro label | 10–11px / 1.3 | 600 | Stable group label or compact status only |
| Code / inline token | 12–13px / 1.5 | 400–500 | Commands, model names, paths, code |

- Default body weight is `400`; reserve `600` for headings, selected labels, and primary actions.
- Use uppercase only for stable, compact group labels such as `SUBAGENTS`; track it lightly (`0.06–0.1em`).
- Never use bold, red text, or all-caps as a substitute for hierarchy.
- Long primary content wraps. One-line metadata truncates with an accessible full-value label.

### 3.3 Spacing

The system uses a 4px base unit.

| Token | Value | Typical use |
| --- | --- | --- |
| `space-1` | 4px | Icon/label gap, tight metadata separation |
| `space-2` | 8px | Compact row padding, control gap |
| `space-3` | 12px | Panel padding, standard transcript gap |
| `space-4` | 16px | Separate independent transcript items |
| `space-5` | 20px | Major section separation |
| `space-6` | 24px | Modal/page padding on spacious layouts |

Rules:

- One-line controls and rows are `28–36px` high.
- Default component padding is `8–12px`; readable content cards may use `12–16px`.
- Keep `8px` between related controls and `12–16px` between independent transcript blocks.
- Use whitespace and dividers before adding another card.

### 3.4 Shape, borders, and depth

| Element | Radius | Border | Shadow |
| --- | --- | --- | --- |
| Inline code / compact chip | 4px | Optional soft border | None |
| Button / field / row | 6–8px | 1px standard border | None |
| Panel / message / grouped activity | 10–12px | 1px standard border | None |
| Modal / popover | 10–12px | 1px standard border | Subtle elevation only |
| User message | 16px with one compact reply corner | Accent-derived border | Very subtle only |

- A border communicates containment; a divider communicates a relationship inside a container.
- Avoid double borders. A nested row gets a strong outline only when it has its own interaction or is a meaningful child record.
- Routine panels do not use gradients, glass effects, ambient glow, or inset rings.
- Modals and popovers may use one restrained shadow to separate from the transcript.

### 3.5 Icons

- Use Lucide-style, 1.5–2px stroke icons consistently.
- Default size: `14px`; compact metadata: `12px`; standalone action: `16px`.
- Pair an icon with a visible label unless the action is universally recognisable and has an `aria-label` and tooltip.
- Icons inherit the text color of their role. Do not add decorative icons that repeat the label.

## 4. Layout system

```text
Application shell
├── Header: session identity, model/agent context, global session metrics
├── Optional history rail
├── Transcript: the primary reading and work surface
├── Optional details rail: secondary session context
└── Composer: persistent prompt and send/stop controls
```

### Shell rules

- The transcript is the primary surface and owns vertical scrolling.
- Header and composer are persistent. Separate each from the transcript with one `--oc-border` divider.
- Side rails are optional context. At narrow widths they become explicit toggles, sheets, or modals rather than squeezing the transcript.
- Avoid a nested scroll region except for long code, raw output, diff content, or a deliberate list with a maximum height.

### Breakpoints

| Width | Behavior |
| --- | --- |
| `< 560px` | Single-column transcript; wrap metadata; hide persistent side rails. |
| `560–899px` | Full transcript and composer; side context is toggleable. |
| `≥ 900px` | Optional persistent details rail and expanded header context. |

## 5. Component system

### 5.1 Buttons

| Variant | Use | Treatment |
| --- | --- | --- |
| Primary | The single most important local action | Accent fill, readable foreground, 28–34px height |
| Secondary | Review, Undo, Retry, configuration action | Neutral border, panel/transparent fill |
| Ghost | Toolbar or inline action | No resting border; quiet hover fill |
| Destructive | Explicit irreversible action | Red text/border; use only after clear context |
| Icon | Compact universal action | 28px minimum target, tooltip, visible focus |

All buttons have `default`, `hover`, `focus-visible`, `disabled`, and `loading` states. Hover changes background/border subtly; it does not scale or glow.

### 5.2 Inputs and selects

- Use one 1px border and `--oc-bg-soft`/`--oc-panel-soft` background.
- `:focus-within` moves the border toward `--oc-accent`; retain a visible focus indicator for keyboard users.
- Place labels above fields in forms. Use placeholder text only as an example, not as the sole label.
- Selectors follow the secondary-button pattern; show the current selection and a chevron.

### 5.3 Composer

The composer is a persistent Level 1 action surface.

- Prompt area: `13–14px`, transparent interior, `1.5` line height, vertical growth before internal scroll.
- Footer: agent and model selectors on the left; context/settings and send/stop controls on the right.
- Send remains in a stable trailing position. When a request is active, replace send with a clearly labelled Stop action.
- Attachments, images, and queued state appear as compact local rows; they do not displace the core send affordance.

### 5.4 Messages

| Message type | Structure | Visual treatment |
| --- | --- | --- |
| User | Right-aligned bubble → quiet time/copy metadata | Soft accent tint; asymmetric reply corner; content first |
| Assistant | Model/session metadata → activity → prose → quiet time/copy metadata | Prose usually sits directly on the transcript; no generic bubble |
| Reasoning | Compact disclosure inside assistant turn | Secondary text; clearly separate from answer content |
| System | Collapsed header → expanded raw content | Neutral outlined disclosure with right chevron |
| Error | Message → optional Details disclosure | Neutral outlined notice; semantic color is local |

Assistant markdown uses comfortable reading width and `13–14px` body text. Code blocks are visually distinct, selectable, and horizontally scroll only inside the block.

### 5.5 Panels and rows

| Pattern | Use | Anatomy |
| --- | --- | --- |
| Grouped panel | Subagents, file changes, plans, provider detail | Header, optional status/count, divider, content rows |
| Interactive row | Agent, file, setting, result | Leading semantic icon only when useful, primary label, optional secondary line, trailing metadata/action |
| Disclosure row | Reasoning, raw output, system payload | Full-width header button, summary, chevron, in-place expanded content |
| Key/value grid | Session and quota facts | Quiet label/value pairs; no individual cards per metric |

Use a Level 1 panel for an independently scannable group. Use a Level 2 row only for an actual child record. Expanded technical content is Level 3 and should normally use a divider rather than another card.

### 5.6 Status and feedback

| State | Required signal | Color use |
| --- | --- | --- |
| Running | Text label, spinner, or progress state | Accent on the indicator only |
| Complete | Check, completion label, or resolved state | Green indicator/count |
| Warning | Clear warning label or pending state | Yellow indicator/count |
| Error | Plain-language error message and optional detail | Red indicator/count or left rule; neutral container |
| Added / removed | `+` / `−` count | Green / red number only |

Color never carries the meaning alone. Errors must remain readable and expandable; do not make provider/model errors into full red banners by default.

### 5.7 Modals, menus, and popovers

- Modal: focused task, scrim, title/action header, scrollable body, optional footer. Keep one primary action.
- Menu: compact list, 28–32px items, clear selected state, keyboard navigation.
- Popover: anchored to its trigger, does not obscure the selection unnecessarily, closes on Escape and outside click when appropriate.
- Do not open a modal from inside another modal when an inline disclosure or tab can solve the task.

## 6. Interaction and motion

| Interaction | Duration | Behavior |
| --- | --- | --- |
| Hover/focus color transition | 120–180ms | Ease-out, no layout shift |
| Disclosure expand/collapse | 180–220ms | Ease-out; chevron rotates with content |
| New message | 180–260ms | Small upward fade only |
| Local running indicator | Continuous | Spinner or subtle opacity pulse on the indicator only |

Respect reduced motion:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Never use motion as the sole status cue.

## 7. Accessibility

- Every action is keyboard reachable and has a visible `:focus-visible` state using a theme-aware focus color.
- Icon-only actions require `aria-label` and a tooltip.
- Disclosures use a button plus `aria-expanded` and a programmatic relationship to their content.
- Minimum compact target is `28px × 28px`; increase targets for touch-constrained layouts.
- Preserve contrast in VS Code dark, light, and high-contrast themes.
- Do not hide important error details permanently; collapse them by default and expose a clear Details control.
- Avoid hover-only functionality and color-only state communication.

## 8. Implementation rules

### Token ownership

- Define shared `--oc-*` tokens in `webview/shared/src/chat/index.css`.
- Add a Tailwind alias in `webview/shared/tailwind.config.ts` only for a stable semantic token.
- Use `color-mix()` from an existing token for component tints; do not add a hardcoded palette for one component.
- Reuse `webview/shared/src/components/ui/` primitives when a pattern is shared by multiple webviews.

### CSS and React conventions

- Use semantic component classes for a repeated visual pattern; use Tailwind for local layout and composition.
- Keep variants explicit (`variant="secondary"`, `state="error"`) rather than duplicating components.
- Keep chat-specific visual patterns in `webview/shared/src/chat/`; promote them only after a second webview needs them.
- Preserve the chat message order and structured-output contracts when changing UI implementation.

### Component delivery checklist

- Uses semantic tokens and the spacing/type scale in this document.
- Includes relevant default, hover, focus-visible, disabled, loading, and error states.
- Handles long labels, model IDs, paths, and large text without clipping primary content.
- Works in narrow webviews, light themes, dark themes, and high-contrast themes.
- Has accessible labels and keyboard behavior.
- Reuses an existing primitive or creates a deliberate new primitive with a defined role.

## 9. Do not do this

- Do not hardcode normal UI colors that bypass VS Code themes.
- Do not wrap every message, metric, or row in a card.
- Do not add gradients, glass blur, large shadows, or glowing borders to routine operational surfaces.
- Do not use red panel backgrounds for ordinary request or provider errors.
- Do not use pills for ordinary labels or disclosures.
- Do not introduce a second component for a pattern that is already covered by a variant.
- Do not remove session metrics, plan affordances, stop controls, or information-rich details while simplifying layout.
