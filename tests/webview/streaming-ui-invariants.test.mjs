import assert from "node:assert/strict";
import test from "node:test";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const messageSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);
const shellSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx")],
  "ChatShell.tsx",
);
const timelineItemSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "components", "activity-steps", "ActivityTimelineItem.tsx")],
  "ActivityTimelineItem.tsx",
);

test("activity rows use one shared timeline shell", () => {
  assert.match(
    timelineItemSource,
    /StepperItem[\s\S]*StepIndicator[\s\S]*children/s,
    "every activity row must retain the shared status/connector shell",
  );
  assert.match(
    messageSource,
    /<ActivityTimelineItem\s+key=\{timelineDisplayEventReactKey\(event\)\}/,
    "the main timeline must render rows through ActivityTimelineItem rather than a second ad hoc shell",
  );
});

test("live activity projection is append-preserving within one assistant turn", () => {
  assert.match(
    messageSource,
    /function mergeStickyDisplayEventsForTurn\([\s\S]*?for \(const event of previousEvents\) \{\s*ingest\(event\);\s*\}[\s\S]*?for \(const event of nextEvents\) \{\s*ingest\(event\);\s*\}/s,
    "later stream frames must merge into the retained activity tape instead of replacing it",
  );
  assert.match(
    messageSource,
    /const timelineDisplayEvents =\s*stickyTimelineDisplayEventsRef\.current\.messageId === activityTimelineTurnMessageId\s*\?\s*stickyTimelineDisplayEventsRef\.current\.events/s,
    "the visible timeline must use the retained turn-scoped tape",
  );
});

test("task and skill_mcp metadata stay visible in activity headers", () => {
  assert.match(
    messageSource,
    /labelLower === "task"[\s\S]*?subagent_type[\s\S]*?taskSubagentType/s,
    "task rows must expose the selected subagent type",
  );
  assert.match(
    messageSource,
    /function SkillMcpActivityStep[\s\S]*?mcp_name[\s\S]*?tool_name[\s\S]*?CollapsedMarkdownPreview[\s\S]*?output/s,
    "skill_mcp rows must expose MCP/tool input and use a bounded output preview",
  );
  const skillMcpSource = messageSource.slice(
    messageSource.indexOf("function SkillMcpActivityStep"),
    messageSource.indexOf("function genericToolPayloadText"),
  );
  assert.match(
    skillMcpSource,
    /shared activity row already renders the skill_mcp title[\s\S]*?variant="bare"/s,
    "skill_mcp output must reuse the shared header and avoid a nested payload card",
  );
  assert.doesNotMatch(
    skillMcpSource,
    /<span className="oc-activity-step-title[\s\S]*?skill_mcp/s,
    "skill_mcp must not render a second inner title",
  );
  assert.match(
    messageSource,
    /labelLower === "skill_mcp"[\s\S]*?<SkillMcpActivityStep event=\{event\} \/>/s,
    "skill_mcp rows must have one dedicated renderer",
  );
});

test("generic activity content cannot bypass bounded previews", () => {
  const genericToolSource = messageSource.slice(
    messageSource.indexOf("function GenericToolPayloadStep"),
    messageSource.indexOf("function sanitizeUserContent"),
  );
  assert.match(
    messageSource,
    /function CollapsedMarkdownPreview[\s\S]*?max-h-\[140px\][\s\S]*?FadedCollapseOverlay/s,
    "Markdown activity content must have a bounded collapsed state and full-content affordance",
  );
  assert.match(
    messageSource,
    /labelLower !== "read" && labelLower !== "todowrite" && labelLower !== "skill_mcp" && !isEditLike && visibleSummary[\s\S]*?CollapsedMarkdownPreview/s,
    "generic activity summaries must route through the bounded preview",
  );
  assert.doesNotMatch(
    messageSource,
    /labelLower === "skill_mcp"[\s\S]*?labelLower !== "skill_mcp"[\s\S]*?SkillMcpActivityStep[\s\S]*?CollapsedMarkdownPreview/s,
    "skill_mcp output must not be rendered once by a dedicated card and again by the generic fallback",
  );
  assert.match(
    genericToolSource,
    /parent activity row already owns the surface[\s\S]*?variant="bare"/s,
    "generic tool payloads must not create a nested card inside the activity row surface",
  );
  assert.doesNotMatch(
    genericToolSource,
    /<div className="oc-activity-step-surface/s,
    "generic tool payloads must not add a second activity surface wrapper",
  );
});

test("live and transcript response ownership cannot render two cards", () => {
  assert.match(
    shellSource,
    /const shouldKeepSeparateStreamingCard =\s*[\s\S]*?!hasTranscriptAssistantForCurrentTurn/s,
    "the separate live card must be gated by transcript content ownership",
  );
  assert.match(
    shellSource,
    /liveStreaming=\{renderedLiveStreaming\}[\s\S]*?streaming=\{shouldKeepSeparateStreamingCardForContentOwnership \? renderedLiveStreaming : null\}/s,
    "the transcript and standalone live card must receive mutually exclusive ownership",
  );
  assert.match(
    shellSource,
    /transcriptOwnsLiveStreaming \|\|[\s\S]*?liveResponseContentAlreadyRendered \|\|[\s\S]*?hasTranscriptAssistantForCurrentTurn/s,
    "a new assistant phase ID must still feed the live snapshot into the existing current-turn transcript block",
  );
});

test("collapsed response selection keeps structured final output authoritative", () => {
  assert.match(
    shellSource,
    /structuredOutputFromRawSdkEventPayloads\([\s\S]*?const structuredResponse =\s*[\s\S]*?hasResponseText:[\s\S]*?structuredResponse\?\.message[\s\S]*?structuredResponse\?\.text/s,
    "collapsed response selection must inspect structured output before choosing the visible final card",
  );
  assert.match(
    messageSource,
    /responseSourceMessage[\s\S]*?structuredOutputFromRawSdkEventPayloads[\s\S]*?snapshotContent/s,
    "the response card must retain structured content when the selected envelope has no direct text",
  );
});
