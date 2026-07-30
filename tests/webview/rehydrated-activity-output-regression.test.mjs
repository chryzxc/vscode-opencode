import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const modalSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "SubagentDetailModal.tsx")],
  "SubagentDetailModal.tsx",
);
const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);
const subagentActivityStepSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "components", "activity-steps", "SubagentActivityStep.tsx")],
  "SubagentActivityStep.tsx",
);

	test("rehydrated raw tool output remains visible in the activity timeline", () => {
	assert.match(modalSource, /const output = toolDataText\(state\?\.output\);/);
	assert.match(modalSource, /summary: output \|\| inputSummary/);
  assert.match(modalSource, /activityDetail: \{ tool, input: input \?\? \{\}, output \}/);
  assert.match(
    messageComponentsSource,
    /event\.filePath \|\| event\.activityDetail\?\.output/,
    "the shared activity surface should use persisted tool output when no summary is available",
  );
  assert.match(
    messageComponentsSource,
    /<CollapsedMarkdownPreview title=\{event\.label\} content=\{visibleSummary\} \/>/,
    "rehydrated output should use the same expandable preview as other activity content",
  );
});

test("live Bash activity renders its terminal payload without requiring a summary", () => {
  assert.match(
    messageComponentsSource,
    /\{labelLower === "bash" \|\| isGlobSearch \? \(\s*<div className="oc-refined-event-summary">\s*<TerminalBlockWithOutput/s,
    "Bash/Glob terminal previews must be selected before the generic visibleSummary gate",
  );
  assert.match(
    messageComponentsSource,
    /labelLower !== "read" && labelLower !== "todowrite" && labelLower !== "skill_mcp" && !isEditLike && visibleSummary && \(/,
    "other generic activity rows should retain the existing summary visibility guard",
  );
});

test("all generic activity summaries use bounded content previews", () => {
  assert.match(
    messageComponentsSource,
    /labelLower !== "read" && labelLower !== "todowrite" && labelLower !== "skill_mcp" && !isEditLike && visibleSummary && \([\s\S]*?<CollapsedMarkdownPreview[\s\S]*?content=\{[\s\S]*?visibleSummary/s,
    "file-backed activity summaries must not bypass the bounded preview",
  );
  assert.match(
    messageComponentsSource,
    /SEARCH_LABELS\.has\(event\.label\)[\s\S]*?<CollapsedMarkdownPreview[\s\S]*?content=\{visibleSummary\}/s,
    "URL summaries must use the same bounded markdown preview",
  );
  assert.match(
    messageComponentsSource,
    /event\.activityDetail\.command && \([\s\S]*?<CollapsedTerminalBlockPreview[\s\S]*?command=\{event\.activityDetail\.command\}/s,
    "activity detail commands must use the bounded terminal preview",
  );
});

test("task activity rows show the requested subagent type", () => {
  assert.match(
    messageComponentsSource,
    /const taskSubagentType = labelLower === "task"[\s\S]*?subagent_type[\s\S]*?<span[\s\S]*?\{taskSubagentType\}/s,
    "task activity rows must expose input.subagent_type such as feature-dev:code-explorer",
  );
});

test("subagent activity bodies use the bounded preview contract", () => {
  assert.match(
    subagentActivityStepSource,
    /useFadedContentOverflow[\s\S]*?max-h-\[140px\][\s\S]*?FadedCollapseOverlay[\s\S]*?Show full/s,
    "secondary subagent activity bodies must limit long command/query/Markdown content",
  );
});

test("skill_mcp activity rows show MCP/tool input and bounded output", () => {
  assert.match(
    messageComponentsSource,
    /function SkillMcpActivityStep[\s\S]*?mcp_name[\s\S]*?tool_name[\s\S]*?CollapsedMarkdownPreview[\s\S]*?output/s,
    "skill_mcp rows must expose MCP and tool names and collapse their output",
  );
  assert.match(
    messageComponentsSource,
    /labelLower === "skill_mcp"[\s\S]*?<SkillMcpActivityStep event=\{event\} \/>/s,
    "skill_mcp events must use the dedicated activity renderer",
  );
});

test("task activity rows show the selected subagent type", () => {
  assert.match(
    messageComponentsSource,
    /labelLower === "task"[\s\S]*?input\?\.subagent_type[\s\S]*?oc-activity-step-meta[\s\S]*?taskSubagentType/s,
    "task timeline steps must expose input.subagent_type instead of hiding the selected agent",
  );
});

test("skill_mcp activity rows show the MCP and tool names", () => {
  assert.match(
    messageComponentsSource,
    /labelLower === "skill_mcp"[\s\S]*?input\?\.mcp_name[\s\S]*?input\?\.tool_name[\s\S]*?skillMcpTarget[\s\S]*?oc-activity-step-meta/s,
    "skill_mcp timeline steps must expose both mcp_name and tool_name",
  );
});

test("unknown tools retain arbitrary input and output through the generic fallback", () => {
  assert.match(
    messageComponentsSource,
    /function GenericToolPayloadStep[\s\S]*?Object\.keys\(input\)[\s\S]*?Input[\s\S]*?Output[\s\S]*?CollapsedMarkdownPreview/s,
    "unknown tool rows must expose arbitrary input and output without field-specific mappings",
  );
  assert.match(
    messageComponentsSource,
    /!visibleSummary && \([\s\S]*?Object\.keys\(event\.activityDetail\.input\)[\s\S]*?<GenericToolPayloadStep event=\{event\} \/>/s,
    "the generic payload renderer must be used when an unknown tool has no summary",
  );
});

test("empty system transport envelopes do not render an empty expandable card", () => {
  assert.match(
    messageComponentsSource,
    /if \(!displayContent\) \{\s*return null;\s*\}\s*\n\s*return \(\s*<div className="oc-message-enter mb-4"/s,
    "SystemMessage must return no UI when its transport envelope has no displayable text",
  );
});
