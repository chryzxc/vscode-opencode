import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);
const chatCssSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "index.css")],
  "index.css",
);
const messageHandlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);
const typesSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "types.ts")],
  "types.ts",
);

test("activity timeline defines a normalized redundant-content helper", () => {
  assert.match(
    messageComponentsSource,
    /function isActivityTextRedundantWithTitle\(/,
    "activity timeline should define a helper for hiding title-like body text",
  );
  assert.match(
    messageComponentsSource,
    /function normalizeComparableActivityText\(/,
    "redundant-content helper should normalize punctuation and casing before comparison",
  );
  assert.match(
    messageComponentsSource,
    /function getVisibleDefaultActivitySummary\(/,
    "default activity-step UI should centralize redundant-summary filtering in a shared helper",
  );
});

test("activity timeline suppresses summary blocks when summary matches the title", () => {
  assert.match(
    messageComponentsSource,
    /const visibleSummary =[\s\S]*getVisibleDefaultActivitySummary\(\s*event\.label,\s*event\.summary,\s*event\.filePath,/s,
    "default activity-step summary visibility should be computed through the shared helper",
  );
  assert.match(
    messageComponentsSource,
    /\{labelLower !== "read" && labelLower !== "todowrite" && !isEditLike && visibleSummary && \(/,
    "generic activity summary rendering should skip rows whose visible summary was suppressed",
  );
});

test("compress activity rows show topic inline and hide the lower summary block", () => {
  assert.match(
    messageComponentsSource,
    /const compressTopic = labelLower === "compress"\s*\?[\s\S]*?\.topic/s,
    "compress rows should pull topic text from the activity payload",
  );
  assert.match(
    messageComponentsSource,
    /labelLower === "compress"\s*\|\|[\s\S]*isActivityTextRedundantWithTitle\(event\.label,\s*event\.summary\)/,
    "compress rows should explicitly suppress the generic summary block",
  );
  assert.match(
    messageComponentsSource,
    /\{compressTopic \?\s*\(\s*<span className="oc-activity-step-meta truncate max-w-\[min\(42ch,60vw\)\] text-oc-text-soft">/s,
    "compress topic should render inline beside the title instead of at the far edge",
  );
});

test("activity timeline also suppresses redundant descriptions and details", () => {
  assert.match(
    messageComponentsSource,
    /const shouldHideDescription =\s*[\s\S]*isActivityTextRedundantWithTitle\(event\.label,\s*event\.description\)/,
    "description visibility should also respect title/content similarity",
  );
  assert.match(
    messageComponentsSource,
    /const shouldHideDetail =\s*[\s\S]*isActivityTextRedundantWithTitle\(event\.label,\s*event\.detail\)/,
    "detail visibility should also respect title/content similarity",
  );
});

test("read activities are header-only and do not reserve an empty payload row", () => {
  assert.match(
    messageComponentsSource,
    /const isReadActivity = labelLower === "read";/,
    "read events should be identified before the activity body is rendered",
  );
  assert.match(
    messageComponentsSource,
    /const shouldRenderActivityBody = !isReadActivity;/,
    "read events should not mount an otherwise-empty body container",
  );
  assert.match(
    messageComponentsSource,
    /shouldRenderActivityBody \? \(\s*<div className="flex flex-col gap-1 w-full">/s,
    "the activity body should render only when it has a visible purpose",
  );
});

test("question prelude activity rows also suppress redundant summary text", () => {
  assert.match(
    messageComponentsSource,
    /const visibleQuestionPreludeSummary = getVisibleDefaultActivitySummary\(\s*event\.label,\s*event\.summary,\s*\);/s,
    "question prelude rows should reuse the shared default-summary helper",
  );
  assert.match(
    messageComponentsSource,
    /\{visibleQuestionPreludeSummary && \(/,
    "question prelude rows should skip rendering the summary block when it duplicates the title",
  );
});

test("patch activity rows preserve and render file paths from patch parts", () => {
  assert.match(
    typesSource,
    /export interface ActivityDetail \{[\s\S]*files\?: string\[\];/s,
    "activity detail should carry patch file lists",
  );
  assert.match(
    messageHandlerSource,
    /if \(partType === 'patch'\) \{[\s\S]*const normalizedFiles = files[\s\S]*const primaryPatchFile = normalizedFiles\[0\];[\s\S]*filePath: primaryPatchFile,[\s\S]*files: normalizedFiles,/s,
    "streaming patch parts should promote their files into the visible activity step payload",
  );
  assert.match(
    messageComponentsSource,
    /const activityFiles = Array\.isArray\(activityDetail\?\.files\)[\s\S]*if \(!filePath && activityFiles\.length > 0\) \{\s*filePath = activityFiles\[0\];\s*\}/s,
    "timeline renderer should fall back to the first patch file when no direct filePath exists",
  );
});

test("file-backed activity summary rows stretch across the available left column", () => {
  assert.match(
    messageComponentsSource,
    /className="oc-refined-file-link oc-refined-file-link-with-tooltip w-full min-w-0"/,
    "summary-row file links should claim the available width so they do not stop short before the View diff action",
  );
});

test("implementation plan card renders through the dedicated plan card component", () => {
  assert.match(
    messageComponentsSource,
    /function ImplementationPlanCard\(/,
    "implementation plan should render through a dedicated card component",
  );
  assert.match(
    messageComponentsSource,
    /<ImplementationPlanCard\s+plan=\{plan\}\s+isRevisedPlan=\{isRevisedPlan\}\s+planStatus=\{planStatus\}\s*\/>/s,
    "assistant response renderer should delegate plan UI to the dedicated plan card component",
  );
  assert.match(
    messageComponentsSource,
    /function getImplementationPlanPrelude\(/,
    "implementation plan prelude selection should be extracted into a dedicated helper",
  );
  assert.match(
    messageComponentsSource,
    /const planPrelude = useMemo\(\s*\(\) => \(shouldShowPlanCard \? getImplementationPlanPrelude\(plan\) : ""\),/s,
    "implementation plan response area should prefer plan.summary and fall back to plan.intro",
  );
  assert.match(
    messageComponentsSource,
    /const \{[\s\S]*responseChunksToRender,[\s\S]*\} = useMemo\(\(\) =>[\s\S]*getRenderablePlanResponseChunks\(/s,
    "implementation plan response presentation should be derived through the dedicated helper",
  );
});
