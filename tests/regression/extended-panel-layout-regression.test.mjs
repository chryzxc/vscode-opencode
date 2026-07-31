import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  "webview/shared/src/chat/PanelComponents.tsx",
  "utf8",
);
const css = await readFile("webview/shared/src/chat/index.css", "utf8");
const extendedPanel = source.slice(
  source.indexOf("export const MobileRightSummary"),
  source.indexOf("export const ModelDropdown"),
);

test("extended details panel exposes every details surface through scrollable tabs", () => {
  assert.match(extendedPanel, /<TabsList className="oc-details-tabs/);
  assert.match(extendedPanel, /<TabsTrigger value="task"/);
  assert.match(extendedPanel, /<TabsTrigger value="quota"/);
  assert.match(extendedPanel, /<TabsTrigger value="integrations"/);
  assert.match(extendedPanel, /<TabsTrigger value="tools"/);
  assert.match(extendedPanel, /<ActiveTaskPanel \/>/);
  assert.match(extendedPanel, /<QuotaMonitor \/>/);
  assert.match(extendedPanel, /<McpPanel \/>[\s\S]*<LspPanel \/>/);
  assert.match(extendedPanel, /<SkillsPanel \/>[\s\S]*<AgentsPanel \/>/);
  assert.match(
    extendedPanel,
    /className="oc-details-tab-content[^\"]*overflow-y-auto"/,
    "each details tab should own its vertical scroll surface",
  );
});

test("extended details panel uses compact section heading density", () => {
  assert.match(css, /.oc-details-sheet \.oc-inspector-section-toggle\s*\{[\s\S]*min-height: 32px;/);
  assert.match(css, /.oc-details-sheet \.oc-inspector-section-toggle > span:first-child\s*\{[\s\S]*font-size: 9px;/);
  assert.match(css, /.oc-details-tab-content[^\{]*\{[\s\S]*overflow-y: auto;/);
});
