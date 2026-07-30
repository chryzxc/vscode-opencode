import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const panelSource = fs.readFileSync(
  path.join(process.cwd(), "webview/shared/src/chat/PanelComponents.tsx"),
  "utf8",
);

test("@ autocomplete renders file results with the shared file icon", () => {
  assert.match(
    panelSource,
    /item\.type === "file"[\s\S]*?<FileIcon filePath=\{item\.path\}/,
    "mention file rows should render the theme-aware FileIcon",
  );
  assert.doesNotMatch(
    panelSource,
    /item\.type === "file"[\s\S]*?📄/,
    "mention file rows should not use a hard-coded emoji icon",
  );
});

test("legacy @ file suggestions also render the shared file icon", () => {
  assert.match(
    panelSource,
    /fileSuggestions\.map\([\s\S]*?<FileIcon filePath=\{suggestion\.path\}/,
    "legacy file suggestion rows should use the same renderer",
  );
});
