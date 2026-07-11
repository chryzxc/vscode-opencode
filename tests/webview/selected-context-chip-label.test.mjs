import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const panelComponentsPath = path.join(
  repoRoot,
  "webview/shared/src/chat/PanelComponents.tsx",
);
const panelComponentsSource = await readFile(panelComponentsPath, "utf8");

test("selected context chip derives filename-only label and preserves line suffix separately", () => {
  assert.match(
    panelComponentsSource,
    /function\s+contextChipDisplayParts\(context:\s*ContextItem\)/,
    "PanelComponents must define a helper for selected-context chip label parts",
  );
  assert.match(
    panelComponentsSource,
    /const\s+segments\s*=\s*rawLabel\.split\(\/\[\\\\\/\]\/\)/,
    "helper must split path segments so the chip shows filename only",
  );
  assert.match(
    panelComponentsSource,
    /const\s+displayName\s*=\s*segments\[segments\.length\s*-\s*1\]\s*\|\|\s*rawLabel/,
    "helper must use the final filename segment as the visible label",
  );
  assert.match(
    panelComponentsSource,
    /lineSuffix:\s*normalizedLineInfo[\s\S]*?normalizedLineInfo\.replace\(\/\^:\+\/,[\s\S]*?\)[\s\S]*?:\s*""/,
    "helper must normalize line info into a separate non-empty :line suffix",
  );
});

test("selected context chip truncates filename but keeps line suffix visible", () => {
  assert.match(
    panelComponentsSource,
    /const\s*\{\s*displayName,\s*lineSuffix\s*\}\s*=\s*contextChipDisplayParts\(context\)/,
    "selected-context renderer must use the helper output",
  );
  assert.match(
    panelComponentsSource,
    /<span\s+className="flex min-w-0 items-center gap-1">[\s\S]*?<span\s+className="truncate max-w-\[160px\]">\{displayName\}<\/span>[\s\S]*?<span\s+className="shrink-0">\{lineSuffix\}<\/span>/,
    "chip must truncate filename separately while keeping line suffix non-shrinking",
  );
});
