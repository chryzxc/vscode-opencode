import test from "node:test";
import assert from "node:assert/strict";

import {
  extractFunctionBody,
  joinFromRoot,
  readSource,
} from "./helpers/source-utils.mjs";

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

test("SystemMessage component has max-height constraint for long content", () => {
  // Search for the SystemMessage component in the source
  assert.match(
    messageComponentsSource,
    /export const SystemMessage/,
    "SystemMessage component should be exported",
  );

  // Check for max-height class in the source (component uses 220px)
  assert.match(
    messageComponentsSource,
    /max-h-\[220px\]/,
    "SystemMessage content div should have max-height of 220px",
  );

  // Check for overflow-y-auto class in the source
  assert.match(
    messageComponentsSource,
    /overflow-y-auto/,
    "SystemMessage content div should have overflow-y-auto for scrolling",
  );

  // Verify both classes appear in the SystemMessage component section
  assert.match(
    messageComponentsSource,
    /SystemMessage[\s\S]*?max-h-\[220px\][\s\S]*?overflow-y-auto/,
    "SystemMessage component should have both max-height and overflow-y-auto classes",
  );
});

test("SystemMessage component maintains proper styling structure", () => {
  // Search for key styling elements in the SystemMessage component
  assert.match(
    messageComponentsSource,
    /SystemMessage[\s\S]*?oc-message-enter/,
    "SystemMessage should have oc-message-enter class",
  );
  assert.match(
    messageComponentsSource,
    /SystemMessage[\s\S]*?opacity-90/,
    "SystemMessage should have opacity-90 class",
  );
  assert.match(
    messageComponentsSource,
    /SystemMessage[\s\S]*?hover:opacity-100/,
    "SystemMessage should have hover:opacity-100 class",
  );
  assert.match(
    messageComponentsSource,
    /SystemMessage[\s\S]*?border-l/,
    "SystemMessage content should have left border",
  );
  assert.match(
    messageComponentsSource,
    /SystemMessage[\s\S]*?font-mono/,
    "SystemMessage content should use monospace font",
  );
  assert.match(
    messageComponentsSource,
    /SystemMessage[\s\S]*?\{content\}/,
    "SystemMessage should render the content prop",
  );
  assert.match(
    messageComponentsSource,
    /SystemMessage[\s\S]*?whitespace-pre-wrap/,
    "SystemMessage content should preserve whitespace",
  );
});
