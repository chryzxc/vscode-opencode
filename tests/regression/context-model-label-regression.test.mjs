import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  "webview/shared/src/chat/PanelComponents.tsx",
  "utf8",
);
const css = await readFile("webview/shared/src/chat/index.css", "utf8");

test("context panel labels the provider and model used for its context limit", () => {
  assert.match(
    source,
    /const contextModelLabel = useMemo\(\(\) => \{[\s\S]*const provider = matched\?\.providerName \|\| selectedModel\.providerID[\s\S]*const model = matched\?\.name \|\| selectedModel\.modelID/s,
  );
  assert.match(
    source,
    /<MiniSection title="Context" titleAside=\{contextModelLabel\} className="order-1">/,
  );
});

test("session compaction timestamp is explicitly labeled", () => {
  assert.match(
    source,
    /<span className="uppercase opacity-70">Last compact<\/span>/,
  );
});

test("session compaction uses a stable responsive status layout", () => {
  assert.match(source, /className="oc-compaction-header"/);
  assert.match(source, /className="oc-compaction-meta[\s\S]*dateTime=/);
  assert.match(source, /className="oc-compaction-button h-6/);
  assert.match(css, /\.oc-compaction-header \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto auto/);
  assert.match(css, /\.oc-compaction-button:hover,[\s\S]*background: var\(--oc-inspector-hover\)/);
  assert.match(css, /@media \(max-width: 520px\) \{[\s\S]*\.oc-compaction-meta \{[\s\S]*flex-basis: 100%/);
});

test("details panel places context before task and runtime diagnostics", () => {
  assert.match(
    source,
    /<MiniSection title="Context" titleAside=\{contextModelLabel\} className="order-1">/,
  );
  assert.match(source, /<MiniSection title="Active Task" className="order-2">/);
  assert.match(source, /<MiniSection title="Runtime" className="order-4">/);
});

test("desktop extended panel stacks every details component in one vertical scroll", () => {
  assert.match(css, /\.oc-desktop-right-panel \{[\s\S]*flex-direction: column[\s\S]*overflow-y: auto/);
  assert.match(source, /oc-desktop-right-panel min-h-0 w-\[380px\]/);
  assert.match(css, /--oc-desktop-inspector-gutter: 4px/);
  assert.match(css, /--oc-desktop-secondary-inspector-gutter: 16px/);
  assert.match(css, /\.oc-right-panel \.oc-active-task-content \{\s*padding: 0 var\(--oc-desktop-inspector-gutter\)/);
  assert.match(css, /\.oc-right-panel \.oc-quota-monitor,[\s\S]*padding: 0 var\(--oc-desktop-secondary-inspector-gutter\)/);
  assert.match(css, /\.oc-desktop-right-panel > \.oc-quota-monitor,[\s\S]*\.oc-desktop-right-panel > \.oc-agents-panel \{\s*margin-top: 12px/);
  assert.doesNotMatch(css, /\.oc-desktop-right-panel > \.oc-quota-monitor,[\s\S]*padding-right: 28px/);
  assert.match(source, /<ActiveTaskPanel \/>[\s\S]*<QuotaMonitor \/>[\s\S]*<McpPanel \/>[\s\S]*<LspPanel \/>[\s\S]*<SkillsPanel \/>[\s\S]*<AgentsPanel \/>/);
  assert.match(css, /\.oc-right-panel \.oc-inspector-section-toggle > span:first-child,[\s\S]*font-size: 10px/);
  assert.match(css, /\.oc-right-panel \.oc-skills-panel > div:last-child,[\s\S]*max-height: 320px[\s\S]*overflow-y: auto/);
  assert.match(css, /\.oc-right-panel \.oc-mcp-panel > div:last-child,[\s\S]*\.oc-right-panel \.oc-agents-panel > div:last-child[\s\S]*overflow-y: auto/);
});

test("small-screen details modal keeps the four navigation tabs", () => {
  assert.match(source, /oc-mobile-details-overlay fixed inset-0/);
  assert.match(source, /<Tabs[\s\S]*<TabsTrigger value="task"[\s\S]*Overview[\s\S]*<TabsTrigger value="quota"[\s\S]*Quota[\s\S]*<TabsTrigger value="integrations"[\s\S]*Integrations[\s\S]*<TabsTrigger value="tools"[\s\S]*Tools/);
  assert.match(css, /\.oc-mobile-details-overlay \{\s*display: none;/);
});

test("details tab content uses a compact shared horizontal gutter", () => {
  assert.match(css, /\.oc-details-sheet \.oc-details-tab-content\s*\{[\s\S]*padding: 8px 8px 10px/);
  assert.doesNotMatch(css, /\.oc-details-sheet \.oc-details-tab-content\s*\{[\s\S]*padding: 8px 16px 10px/);
});

test("overview tab uses the compact horizontal inset shared by the other tabs", () => {
  assert.match(css, /\.oc-details-sheet \.oc-details-tab-content--overview \{[\s\S]*padding-top: 0[\s\S]*padding-right: 0[\s\S]*padding-left: 0[\s\S]*overflow-x: hidden/);
  assert.match(css, /\.oc-details-sheet \.oc-details-tab-content--overview \.oc-active-task-content \{[\s\S]*padding-right: 0;[\s\S]*padding-left: 0/);
  assert.match(css, /\.oc-details-sheet \.oc-details-tab-content--overview > \.oc-active-task-panel \{[\s\S]*width: calc\(100% \+ 8px\)[\s\S]*margin-right: -4px[\s\S]*margin-left: -4px[\s\S]*overflow-x: hidden/);
  assert.match(css, /\.oc-details-sheet \.oc-details-tab-content--overview > \.oc-active-task-panel \{\s*margin-top: -4px/);
  assert.match(css, /\.oc-details-sheet \.oc-details-tab-content--overview \.oc-inspector-section-toggle,[\s\S]*padding-right: 0;[\s\S]*padding-left: 0/);
});

test("session header exposes SDK context usage through the circular progress tooltip", () => {
  assert.match(source, /contextInputTokens: state\.contextInputTokens/);
  assert.match(source, /const headerContextPct = resolveContextUsagePct\(/);
  assert.match(source, /title=\{headerContextTooltip\}/);
  assert.match(css, /\.oc-context-progress-tooltip::after[\s\S]*content: attr\(data-tooltip\)/);
  assert.match(css, /\.oc-context-progress-tooltip:hover::after/);
});

test("context tooltip stays inside the header viewport when anchored at the left edge", () => {
  assert.match(
    css,
    /\.oc-context-progress-tooltip::after[\s\S]*left: 0;[\s\S]*white-space: normal;[\s\S]*transform: none;/,
    "the context tooltip should not center off the clipped left edge of the chat column",
  );
});

test("circular context usage uses healthy, warning, and critical colors", () => {
  assert.match(
    source,
    /normalizedPct > 90[\s\S]*var\(--oc-red\)[\s\S]*normalizedPct > 75[\s\S]*var\(--oc-orange\)[\s\S]*var\(--oc-green\)/,
  );
});

test("context usage bar uses the same healthy, warning, and critical thresholds", () => {
  assert.match(
    source,
    /pct > 90[\s\S]*var\(--oc-orange\), var\(--oc-red\)[\s\S]*pct > 75[\s\S]*var\(--oc-yellow\), var\(--oc-orange\)[\s\S]*var\(--oc-green\)/,
  );
});

test("MCP and LSP disclosure carets stay visible on hover", () => {
  const integrationActionButtons = source.match(/oc-accent-soft-action/g) ?? [];
  assert.ok(
    integrationActionButtons.length >= 12,
    "integration action buttons must reuse the existing accent-soft action styling",
  );
  assert.match(css, /--oc-inspector-hover: color-mix\(in srgb, var\(--oc-text\) 10%, var\(--oc-panel\)\)/);
  assert.match(css, /\.oc-accent-soft-action:hover[\s\S]*background: var\(--oc-inspector-hover\)/);
  assert.match(css, /\.oc-inspector-action \{[\s\S]*color: var\(--oc-text\) !important/);
  assert.match(css, /\.oc-inspector-action:hover,[\s\S]*background: var\(--oc-inspector-hover\)/);
  assert.match(css, /\.oc-inspector-action:hover,[\s\S]*color: var\(--oc-text\) !important/);
  assert.match(css, /\.oc-details-sheet \.oc-inspector-section-toggle:hover,[\s\S]*background: transparent !important/);
  assert.match(css, /\.oc-right-panel \.oc-inspector-section-toggle:hover,[\s\S]*background: transparent !important/);
  assert.match(css, /\.oc-details-sheet \.oc-inspector-data-row:hover,[\s\S]*\.oc-right-panel \.oc-details-list-row:hover[\s\S]*background: var\(--oc-inspector-hover\) !important/);
  assert.match(source, /aria-label="Refresh quota"[\s\S]*oc-inspector-action/);
  assert.match(source, /aria-label=\{[\s\S]*Collapse Quota Monitor[\s\S]*oc-inspector-action/);
  assert.doesNotMatch(css, /\.oc-details-sheet \.oc-mcp-panel button:hover/);
  assert.match(css, /\.oc-details-sheet \.oc-skills-panel > div:last-child,[\s\S]*\.oc-right-panel \.oc-agents-panel > div:last-child[\s\S]*border: 0[\s\S]*background: transparent/);
  assert.match(css, /\.oc-right-panel \.oc-agents-panel \.oc-agent-list \{[\s\S]*border: 1px solid var\(--oc-surface-border-soft\)[\s\S]*border-radius: 8px/);
});

test("details modal header actions match the compact extended-panel controls", () => {
  assert.match(source, /className="oc-collapse-btn oc-inspector-action flex items-center/);
  assert.match(
    css,
    /\.oc-details-sheet \.oc-mcp-panel > div:first-child \.oc-inspector-action,[\s\S]*width: 20px[\s\S]*min-width: 20px[\s\S]*height: 20px[\s\S]*min-height: 20px/,
  );
  assert.match(css, /\.oc-details-sheet \.oc-agents-panel > div:first-child \.oc-inspector-action svg[\s\S]*width: 12px[\s\S]*height: 12px/);
});

test("modal Skills uses a grouped card wrapper without changing the extended panel", () => {
  assert.match(
    css,
    /\.oc-details-sheet \.oc-skills-panel > div:last-child \{[\s\S]*border: 1px solid var\(--oc-surface-border-soft\)[\s\S]*border-radius: 8px[\s\S]*background: color-mix/,
  );
  assert.match(css, /\.oc-details-sheet \.oc-skills-panel \.oc-panel-section \{[\s\S]*border-bottom: 1px solid var\(--oc-surface-divider\)/);
  assert.match(css, /\.oc-details-sheet \.oc-skills-panel \.oc-panel-section:last-of-type \{[\s\S]*border-bottom: 0/);
  assert.match(
    css,
    /\.oc-right-panel \.oc-skills-panel > div:last-child \{[\s\S]*max-height: 320px[\s\S]*overflow-y: auto/,
  );
});

test("session header keeps its existing action hover styling", () => {
  assert.match(css, /\.oc-history-btn:hover[\s\S]*background: var\(--oc-accent-soft\)/);
  assert.doesNotMatch(css, /\.oc-header-right \.oc-history-btn:hover/);
});
