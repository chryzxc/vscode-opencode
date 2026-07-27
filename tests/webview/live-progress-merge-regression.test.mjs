import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const messageComponentsSource = readFileSync(
  new URL("../../webview/shared/src/chat/MessageComponents.tsx", import.meta.url),
  "utf8",
);
const activityIdentitySource = readFileSync(
  new URL("../../webview/shared/src/chat/lib/activityIdentity.ts", import.meta.url),
  "utf8",
);
const storeSource = readFileSync(
  new URL("../../webview/shared/src/chat/lib/store.ts", import.meta.url),
  "utf8",
);

test("AssistantResponseCardInner merges live streaming progress rows into the activity timeline", () => {
  assert.match(
    messageComponentsSource,
    /const mergeReasoningPartText = \(current: string, incoming: string\): string => \{[\s\S]*?current\.includes\(incoming\)[\s\S]*?incoming\.includes\(current\)/s,
    "Repeated or cumulative snapshots for one reasoning part must be coalesced instead of concatenated",
  );

  assert.match(
    messageComponentsSource,
    /const nextText = existing\s*\? mergeReasoningPartText\(existing\.text, resolvedText\)\s*: resolvedText;/s,
    "The streaming reasoning projection must use the cumulative-snapshot merge before rendering a thought",
  );

  assert.match(
    messageComponentsSource,
    /function todoWriteChecklistIdentity\([\s\S]*?tool !== "todowrite"[\s\S]*?content[\s\S]*?priority[\s\S]*?return `todowrite:\$\{JSON\.stringify\(normalizedTodos\)\}`;/s,
    "TodoWrite snapshots should coalesce by checklist identity while allowing their mutable item statuses to advance",
  );

  assert.match(
    messageComponentsSource,
    /const existingTodoChecklistIndex[\s\S]*?deduped\[existingTodoChecklistIndex\] = mergeStickyDisplayEvent\(existing, event\);/s,
    "A later hydrated TodoWrite state must replace the earlier checklist snapshot instead of leaving a stale 0/N card",
  );

  assert.match(
    messageComponentsSource,
    /const dedupedIndexByTodoChecklist = new Map<string, number>\(\);[\s\S]*?dedupedIndexByTodoChecklist\.get\(todoChecklistIdentity\)/s,
    "Distinct SDK calls with an identical TodoWrite snapshot should render as one activity row",
  );

  assert.match(
    activityIdentitySource,
    /export function canonicalActivityActionIdentity\([\s\S]*?!tool \|\| input == null[\s\S]*?activityValueFingerprint\(actionInput\)/s,
    "Every tool activity needs one input-based canonical identity",
  );
  assert.match(
    activityIdentitySource,
    /export function stableActivityIdentity\([\s\S]*?const callID = normalized\(input\.callID\);[\s\S]*?return `call:\$\{callID\}`;[\s\S]*?const partID = normalized\(input\.partID \|\| input\.id\);/s,
    "Cross-envelope tool snapshots must prefer callID over changing part or event IDs",
  );
  assert.match(
    activityIdentitySource,
    /tool === "bash"[\s\S]*?\{ command \}[\s\S]*?tool === "read"[\s\S]*?\{ file, offset, limit \}[\s\S]*?tool === "grep"/s,
    "The shared action identity must ignore transport-only fields while preserving Bash commands, exact Read ranges, and Grep inputs",
  );
  assert.match(
    messageComponentsSource,
    /canonicalActivityActionIdentity\([\s\S]*?item\.activityDetail\?\.tool[\s\S]*?item\.activityDetail\?\.input/s,
    "The renderer must use the shared canonical activity identity",
  );
  assert.match(
    messageComponentsSource,
    /function activitySnapshotIdentity\([\s\S]*?const fallbackAction = firstNonEmptyString\([\s\S]*?visible-action:/s,
    "Input-less mirrored lifecycle snapshots must still coalesce by their exact visible action",
  );
  assert.match(
    storeSource,
    /import \{ canonicalActivityActionIdentity \} from "\.\/activityIdentity";[\s\S]*?const snapshotKey = canonicalActivityActionIdentity\(tool, input\);/s,
    "The streaming reducer must use the same canonical activity identity as the renderer",
  );
  assert.match(
    storeSource,
    /function mergeLiveActivityDetailLocal\([\s\S]*?input: mergePartialActivityRecordLocal\([\s\S]*?metadata: mergePartialActivityRecordLocal\(/s,
    "Sparse live activity updates must retain prior Read input such as offset and limit",
  );
  assert.match(
    messageComponentsSource,
    /function normalizeReadRangeInput\([\s\S]*?metadata\?\.display[\s\S]*?display\?\.lineStart[\s\S]*?display\?\.lineEnd[\s\S]*?normalized\.offset = offset[\s\S]*?normalized\.limit = limit[\s\S]*?function formatReadLineRange\([\s\S]*?metadata\?\.lineStart[\s\S]*?metadata\?\.lineEnd/s,
    "Read line ranges must normalize both live input offset/limit and hydrated metadata.display lineStart/lineEnd, with a metadata fallback at render time",
  );

  assert.match(
    messageComponentsSource,
    /function mergeProgressItemsForTimeline\([\s\S]*?item\.mergeKey[\s\S]*?indexByKey\.set\(item\.mergeKey, index\)[\s\S]*?actionKey[\s\S]*?const keys = \[[\s\S]*?item\.mergeKey/s,
    "The live/final timeline merge must use the same canonical activity key as the row projection",
  );
  assert.match(
    messageComponentsSource,
    /function mergeProgressItemRecord\([\s\S]*?activityDetail: mergeActivityDetail\(existing\.activityDetail, incoming\.activityDetail\)/s,
    "Progress snapshots must preserve an earlier tool payload when a later mirror is sparse",
  );
  assert.match(
    messageComponentsSource,
    /function mergePartialSdkRecord\([\s\S]*?for \(const \[key, value\] of Object\.entries\(source\)\)[\s\S]*?if \(value !== undefined\)[\s\S]*?function mergeActivityDetail\([\s\S]*?input: mergePartialSdkRecord\(existingInput, incomingInput\)/s,
    "Activity-detail merges must retain Read offset and limit across partial live event mirrors without broad object spreads",
  );
  assert.match(
    messageComponentsSource,
    /function mergeProgressItemRecord\([\s\S]*?key: existing\.key \|\| incoming\.key[\s\S]*?activityDetail: mergeActivityDetail\(existing\.activityDetail, incoming\.activityDetail\)[\s\S]*?function mergeStickyDisplayEvent\([\s\S]*?status: mergeDisplayEventStatus\(existing\.status, incoming\.status\)/s,
    "Live progress and sticky display rows must use explicit patch ownership instead of whole-record replacement",
  );

  assert.match(
    messageComponentsSource,
    /const dedupedIndexByActivitySnapshot = new Map<string, number>\(\);[\s\S]*?dedupedIndexByActivitySnapshot\.get\(snapshotIdentity\)/s,
    "Identical Read, Grep, Bash, and other tool snapshots with different SDK call IDs must collapse to one row",
  );

  assert.match(
    messageComponentsSource,
    /key: "live-reasoning-placeholder"[\s\S]*?streamSeq: Number\.MAX_SAFE_INTEGER/s,
    "A pending live reasoning placeholder must sort after the activity that preceded its latest delta",
  );

  assert.match(
    messageComponentsSource,
    /function activityPatchContentFingerprint\([\s\S]*?changedLines/s,
    "patch dedupe should compare changed lines rather than unstable diff headers",
  );
  assert.match(
    messageComponentsSource,
    /function activityPatchIdentity\([\s\S]*?diffExcerpt[\s\S]*?fileDiff\?\.patch[\s\S]*?oldString[\s\S]*?newString/s,
    "the same edit represented as tool metadata, patch part, or diff excerpt must share one patch identity",
  );
  assert.match(
    messageComponentsSource,
    /const dedupedIndexByPatch = new Map<string, number>\(\);[\s\S]*?dedupedIndexByPatch\.get\(patchIdentity\)/s,
    "mirrored edit representations must collapse into one rendered activity row",
  );
  assert.match(
    messageComponentsSource,
    /const activityPatchIdentityCache = new WeakMap<object, string>\(\);[\s\S]*?if \(!isEditLikeActivity\(event\)\)/s,
    "patch dedupe must be cached and limited to edit-like rows so normal stream events stay cheap",
  );

  assert.match(
    messageComponentsSource,
    /if \(!message \|\| isCurrentCardLiveAssistantTurn\) \{[\s\S]*?return activityTimelineStreaming;/,
    "The live overlay must use the card's full assistant-turn identity candidates, not only one preferred SDK ID",
  );

  assert.match(
    messageComponentsSource,
    /function buildAssistantScopeMessageIds\([\s\S]*?includeLiveTurnIds\?: boolean[\s\S]*?messageCandidates\.size > 0[\s\S]*?!options\.includeLiveTurnIds[\s\S]*?options\.streamingMessageId/s,
    "An active card must keep both its original assistant ID and the current SDK phase ID in timeline scope",
  );
  assert.match(
    messageComponentsSource,
    /includeLiveTurnIds: isCurrentCardLiveAssistantTurn/,
    "Only the active card may expand scope to the current streaming phase",
  );

  assert.match(
    messageComponentsSource,
    /progressItemsFromSteps\(\s*\[\s*\.\.\.\(Array\.isArray\(scopedActivityTimelineStreaming\?\.progressEvents\)/s,
    "Live streaming progressEvents should be projected into progress items",
  );

  assert.match(
    messageComponentsSource,
    /const mergedProgressItems = useMemo\([\s\S]*?mergeProgressItemsForTimeline\(\s*progressItems,\s*liveProgressItems,\s*isStreamingActive,/s,
    "Streaming must use the same merge path as hydrated progress so repeated tool snapshots update one row",
  );
  assert.match(
    messageComponentsSource,
    /function mergeProgressItemsForTimeline\([\s\S]*?item\.callID \? `call:\$\{item\.callID\}` : ""[\s\S]*?semantic:\$\{semanticKey\}[\s\S]*?action:\$\{actionKey\}/s,
    "SDK lifecycle IDs must win while semantic action fallback merges mirrored snapshots with different IDs",
  );
  assert.match(
    messageComponentsSource,
    /Generic titles such as "Running read\.\.\."[\s\S]*?if \(!semanticKey && !item\.callID && !item\.id && !item\.messageID\)/s,
    "A generic progress title must never replace a rendered activity that has a real identity",
  );
  assert.doesNotMatch(
    messageComponentsSource,
    /event\.viewDiffFile && \(\s*<button[\s\S]*?>\s*View diff\s*<\/button>/s,
    "File_edit timeline rows must not render a View diff button",
  );
  assert.match(
    messageComponentsSource,
    /event\.activityDetail\?\.kind === "file_edit"\) \{\s*continue;/s,
    "patch-derived File_edit rows must be excluded from the shared live and hydrated timeline projection",
  );
  assert.match(
    messageComponentsSource,
    /const shouldAggregateCollapsedBlockActivity = Boolean\([\s\S]*?isLastInBlock[\s\S]*?isBlockExpanded !== true[\s\S]*?const collapsedBlockAssistantMessages = useMemo\([\s\S]*?candidate\.info\?\.parentID[\s\S]*?additionalMessageIds: collapsedBlockAssistantMessageIds[\s\S]*?const hydratedActivityParts = useMemo\([\s\S]*?collapsedBlockAssistantMessages\.flatMap/s,
    "The one visible collapsed assistant card must render real Edit tool parts from every sibling SDK message in its user turn",
  );
  assert.match(
    messageComponentsSource,
    /activityDetail\?\.kind === "file_edit"[\s\S]*?continue;[\s\S]*?parts: hydratedActivityParts/s,
    "Only patch-derived file_edit rows are excluded; authoritative tool: edit parts remain eligible for hydrated rendering",
  );

  assert.match(
    messageComponentsSource,
    /mergeThoughtItemsForTimeline\([\s\S]*?liveThoughtItems,[\s\S]*?isStreamingActive,[\s\S]*?\)/,
    "Thought items should also prefer live streaming text while the turn is active",
  );

  assert.match(
    messageComponentsSource,
    /function progressItemIdentityKey\(/,
    "Progress rows should use a centralized identity key before rendering",
  );

  assert.match(
    messageComponentsSource,
    /function progressItemIdentityKey\([\s\S]*?stableActivityIdentity\(\{[\s\S]*?callID: item\.callID,[\s\S]*?if \(stableIdentity\) \{\s*return stableIdentity;/,
    "SDK lifecycle snapshots must collapse by callID/part ID before mutable titles, paths, and output are considered",
  );

  const activityDisplayIdentityStart = messageComponentsSource.indexOf(
    "function activityDisplayEventIdentity",
  );
  const activityDisplayIdentityEnd = messageComponentsSource.indexOf(
    "function todoWriteChecklistIdentity",
    activityDisplayIdentityStart,
  );
  const activityDisplayIdentitySource = messageComponentsSource.slice(
    activityDisplayIdentityStart,
    activityDisplayIdentityEnd,
  );
  assert.doesNotMatch(
    activityDisplayIdentitySource,
    /key:\s*event\.key/,
    "a transient stream array key must not become a duplicate-activity identity",
  );

  assert.match(
    messageComponentsSource,
    /function mergeProgressItemRecord\(/,
    "Progress rows should merge repeated status updates into one canonical row",
  );

  assert.match(
    messageComponentsSource,
    /function mergeStickyDisplayEventsForTurn\(/,
    "Activity timeline rows should be merged through a sticky turn-scoped helper",
  );
  assert.match(
    messageComponentsSource,
    /function orderDisplayEventsChronologically\(events: DisplayEvent\[\]\): DisplayEvent\[\] \{[\s\S]*?SDK stream is already ordered[\s\S]*?return events;/s,
    "The live activity timeline must preserve SDK arrival order instead of re-sorting local snapshot indexes",
  );
  assert.doesNotMatch(
    messageComponentsSource,
    /normalizedEntries\.sort\(/,
    "The display-event projection must not re-sort live SDK entries",
  );
  assert.doesNotMatch(
    messageComponentsSource,
    /orderedEntries\.sort\(/,
    "The activity timeline grouping step must preserve the SDK event order",
  );
  assert.match(
    messageComponentsSource,
    /const entriesBySdkSequence = new Map<number, RawRenderEntry\[\]>\(\);[\s\S]*?for \(let streamSeq = 0; streamSeq < rawEventCount; streamSeq \+= 1\)[\s\S]*?for \(const entry of sdkOrderedEntries\)/s,
    "Activity and assistant text lanes must be rendered by their original SDK tape position without a UI-level sort",
  );
  assert.match(
    messageComponentsSource,
    /function mergeProgressItemRecord\([\s\S]*?streamSeq:\s*existing\.streamSeq \?\? incoming\.streamSeq/s,
    "An activity lifecycle update must retain its first SDK position instead of moving ahead of intervening assistant text",
  );
  assert.match(
    messageComponentsSource,
    /function mergeStickyDisplayEvent\([\s\S]*?streamSeq:\s*existing\.streamSeq \?\? incoming\.streamSeq/s,
    "The sticky activity timeline must retain the original activity position across streaming rerenders",
  );
  assert.match(
    messageComponentsSource,
    /event\.label === "Assistant Response"[\s\S]*?!shouldInterleaveStreamingAssistantCommentary/s,
    "Interleaved live assistant text must not be skipped from the activity timeline",
  );
  assert.match(
    messageComponentsSource,
    /showResponseBody && !shouldInterleaveStreamingAssistantCommentary/s,
    "The response footer must not duplicate assistant text already interleaved in the live timeline",
  );
  assert.match(
    messageComponentsSource,
    /function isLikelyUserPromptEcho\([\s\S]*?response === prompt[\s\S]*?shorterLength \/ longerLength >= 0\.9[\s\S]*?response\.includes\(prompt\)/s,
    "Text-only SDK events that echo the visible user prompt must not render as Assistant Response cards",
  );
  assert.match(
    messageComponentsSource,
    /commentaryItemsFromRawEventPayloads\(normalizedCentralizedRawSdkEventPayloads\)\.filter\([\s\S]*?!isLikelyUserPromptEcho\(item\.text, visibleTurnUserPromptText\)/s,
    "Prompt-echo suppression must be applied before commentary reaches the activity timeline",
  );
  assert.match(
    messageComponentsSource,
    /const mergeKey = partID[\s\S]*?: id[\s\S]*?`id:\$\{id\}`[\s\S]*?`text:\$\{messageID \|\| "unknown"\}:\$\{normalizeComparableText\(text\)\}`/s,
    "Separate text parts must not be collapsed solely because they share an assistant message ID",
  );
  assert.match(
    messageComponentsSource,
    /function timelineDisplayEventReactKey\([\s\S]*?event\.kind === "commentary"[\s\S]*?`commentary:\$\{event\.partID \|\| event\.key\}`/s,
    "Assistant Response cards without part IDs need unique React keys",
  );
  assert.match(
    messageComponentsSource,
    /function mergeStickyDisplayEventsForTurn\([\s\S]*?activitySnapshotIdentity\(event\)[\s\S]*?activityPatchIdentity\(event\)/s,
    "Mirrored SDK activity must be coalesced in the sticky merge, before the timeline renderer",
  );
  assert.doesNotMatch(
    messageComponentsSource,
    /function dedupeDisplayEventsForRender\(/,
    "A second render-time dedupe must not suppress legitimate sibling activity",
  );
  assert.doesNotMatch(
    messageComponentsSource,
    /function mergeStickyDisplayEventsForTurn\([\s\S]*?if \(previousEvents\.length === 0\)\s*\{\s*return nextEvents;/s,
    "The initial live frame must pass through semantic dedupe instead of returning mirrored rows unchanged",
  );
  assert.match(
    messageComponentsSource,
    /function mergeStickyDisplayEventsForTurn\([\s\S]*?const merged: DisplayEvent\[\] = \[\];[\s\S]*?for \(const event of previousEvents\) \{\s*ingest\(event\);\s*\}[\s\S]*?for \(const event of nextEvents\) \{\s*ingest\(event\);\s*\}/s,
    "Previously sticky rows must be re-ingested through the same identity merge, otherwise duplicate File_edit rows survive forever",
  );

  assert.match(
    messageComponentsSource,
    /function mergeStickyDisplayEvent\([\s\S]*?LOCKED UI INVARIANT:[\s\S]*?diffStats: incoming\.diffStats \?\? existing\.diffStats,[\s\S]*?activityDetail: mergeActivityDetail\(existing\.activityDetail, incoming\.activityDetail\),/,
    "A sparse live update must preserve the edit/diff fields of an already-rendered activity component",
  );

  assert.match(
    messageComponentsSource,
    /const stickyTimelineDisplayEventsRef = useRef<\{\s*messageId: string \| null;\s*sessionId: string \| null;\s*events: DisplayEvent\[\];\s*isLive: boolean;\s*\}>/s,
    "The timeline should keep a session-scoped sticky snapshot so partial live groups cannot clear already rendered rows",
  );

  assert.match(
    messageComponentsSource,
    /const hasStickyTimelineActivity = timelineDisplayEvents\.length > 0;/,
    "The assistant card should keep showing the timeline once sticky rows exist",
  );

  assert.match(
    messageComponentsSource,
    /\[ACTIVITY-TIMELINE-TRACE\] rendered-step-removed[\s\S]*?rawProgress:[\s\S]*?liveProgress:[\s\S]*?mergedProgress:[\s\S]*?displayActivity:[\s\S]*?stickyActivity:/s,
    "SDK debug mode must identify the precise projection layer when a rendered activity row disappears",
  );

  assert.match(
    messageComponentsSource,
    /\[ACTIVITY-TIMELINE-TRACE\][\s\S]*?sticky-session-reset[\s\S]*?sticky-turn-phase-carried[\s\S]*?previousTurnId:[\s\S]*?nextTurnId:[\s\S]*?retainedRows:/s,
    "a phase transition must report that rows were retained; only a session transition may report a reset",
  );
  assert.match(
    messageComponentsSource,
    /isCurrentCardLiveAssistantTurn,[\s\S]*?blockGroupKey: blockGroupKey \?\? null,[\s\S]*?assistantTurnAnchorMessageId,/s,
    "the reset trace must include the live-card and assistant-block identity inputs used to make its decision",
  );

  assert.match(
    messageComponentsSource,
    /const showResponseSection =[\s\S]*hasStickyTimelineActivity/s,
    "The response section should stay mounted when the sticky timeline has activity",
  );

  assert.match(
    messageComponentsSource,
    /mergeStickyDisplayEventsForTurn\(\s*stickyTimelineDisplayEventsRef\.current\.events,\s*visibleDisplayEvents,\s*\)/s,
    "Incoming timeline rows should be merged into the sticky snapshot instead of replacing it",
  );
  assert.match(
    messageComponentsSource,
    /const timelineDisplayEvents =\s*stickyTimelineDisplayEventsRef\.current\.messageId === activityTimelineTurnMessageId\s*\? stickyTimelineDisplayEventsRef\.current\.events\s*:\s*visibleDisplayEvents/s,
    "Live rendering must use the sticky turn snapshot too, so a partial next activity group cannot clear already-rendered rows",
  );
  assert.match(
    messageComponentsSource,
    /const fromRaw = progressItemsFromCentralizedData[\s\S]*?const fromSnapshotParts = progressItemsFromRawResponseParts[\s\S]*?const fromSnapshotSteps = progressItemsFromSteps[\s\S]*?return mergeProgressItemsForTimeline\(\s*fromRaw,\s*\[\.\.\.fromSnapshotParts, \.\.\.fromSnapshotSteps\],/s,
    "A partial live/raw tape must merge with the SDK snapshot so it cannot hide activity kinds that the tape omitted",
  );
  assert.doesNotMatch(
    messageComponentsSource,
    /if \(isLiveAssistantTurn\) \{\s*return \[\.\.\.fromRaw, \.\.\.fromSnapshotParts, \.\.\.fromSnapshotSteps\];\s*\}/s,
    "Live activity must not bypass the canonical merge by concatenating raw and hydrated rows",
  );
  assert.match(
    messageComponentsSource,
    /const sessionChanged = Boolean\(\s*stickyTimelineDisplayEventsRef\.current\.sessionId[\s\S]*?stickyTimelineDisplayEventsRef\.current\.sessionId !== centralizedSessionId,/s,
    "Only a session change may reset sticky activity; assistant envelope and activity-group changes must retain it",
  );
  assert.match(
    messageComponentsSource,
    /merged\[matchingIndex\] = mergeStickyDisplayEvent\(existing, event\);[\s\S]*?remember\(merged\[matchingIndex\], matchingIndex\);/s,
    "A row enriched by a later event must be re-indexed so the next mirror also collapses into it",
  );
  assert.match(
    messageComponentsSource,
    /function activityPatchFileIdentity\([\s\S]*?return file \? `patch-file:\$\{activityPatchFileKey\(file\)\}` : "";[\s\S]*?const sparseActivityPatchFileIndex = new Map<string, number>\(\);[\s\S]*?isSparsePatchSnapshot[\s\S]*?activityPatchFileIndex\.get\(patchFileIdentity\)[\s\S]*?sparseActivityPatchFileIndex\.get\(patchFileIdentity\)/s,
    "A sparse file-only File_edit mirror must collapse into its detailed patch snapshot, while two content-bearing patches retain their own identity",
  );
  assert.match(
    messageComponentsSource,
    /function collapseConsecutiveReasoningDisplayEvents\([\s\S]*?event\.kind !== "reasoning" \|\| previous\?\.kind !== "reasoning"[\s\S]*?const consecutiveReasoningCollapsed = collapseConsecutiveReasoningDisplayEvents\(rawEvents\);/s,
    "Adjacent live reasoning parts should render as one Thinking step while keeping reasoning separated by activity rows",
  );
  assert.match(
    messageComponentsSource,
    /function isHiddenLifecycleReasoningSeparator\([\s\S]*?partType === "step-start"[\s\S]*?while \([\s\S]*?isHiddenLifecycleReasoningSeparator\(collapsed\[previousIndex\]\)/s,
    "Hidden step lifecycle transport markers must not split one continuous visible Thinking phase",
  );
  assert.match(
    messageComponentsSource,
    /const isPendingPlaceholder =[\s\S]*?event\.summary\.trim\(\) === "Thinking\.\.\."[\s\S]*?const existingPlaceholderIndex = collapsed\.findIndex\([\s\S]*?candidate\.summary\.trim\(\) === "Thinking\.\.\."[\s\S]*?existingPlaceholderIndex >= 0/s,
    "Reasoning deltas must update exactly one pending Thinking placeholder even when the SDK changes transient assistant message IDs or interleaves transport events",
  );
  assert.match(
    messageComponentsSource,
    /function mergeStickyDisplayEventsForTurn\([\s\S]*?return collapseConsecutiveReasoningDisplayEvents\(merged\);/s,
    "Sticky live-frame retention must also collapse a continuous reasoning phase so transient reasoning identities cannot accumulate Thinking rows",
  );
  assert.match(
    messageComponentsSource,
    /const collapsed: DisplayEvent\[\] = deduped;[\s\S]*?return mergeStickyDisplayEventsForTurn\(\[\], collapsed\);/s,
    "The initial hydrated projection must apply the same semantic snapshot merge as live frames before rendering",
  );
  assert.match(
    messageComponentsSource,
    /function coalesceTimelineEventsForRender\([\s\S]*?activityDisplayEventIdentity\(event\)[\s\S]*?mergeStickyDisplayEvent\(existing, event\)[\s\S]*?coalesceTimelineEventsForRender\(\s*timelineDisplayEvents/s,
    "The final timeline boundary must collapse repeated SDK call snapshots before creating visible rows",
  );
  assert.match(
    messageComponentsSource,
    /function timelineDisplayEventReactKey\([\s\S]*?activityPatchIdentity\(event\)[\s\S]*?key=\{timelineDisplayGroupReactKey\(group\.events, groupIdx\)\}[\s\S]*?<ActivityTimelineItem\s+key=\{timelineDisplayEventReactKey\(event\)\}/s,
    "Live activity rows and their Stepper groups need semantic React keys so subsequent stream events update instead of remounting and blinking",
  );

  assert.match(
    messageComponentsSource,
    /const liveAssistantTurnParentMessageId = useMemo\([\s\S]*?info\?\.parentID[\s\S]*?const activityTimelineTurnMessageId = firstNonEmptyString\(\s*blockGroupKey,[\s\S]*?liveAssistantTurnParentMessageId,[\s\S]*?assistantTurnAnchorMessageId/s,
    "The message-less live card must key tool-driven assistant phases to their shared user parent, not a transient SDK envelope id",
  );

  assert.match(
    messageComponentsSource,
    /const events = buildDisplayEvents\([\s\S]*?thoughtItems,[\s\S]*?mergedProgressItems,[\s\S]*?commentaryItems,[\s\S]*?fileChanges,[\s\S]*?assistantScopeMessageIds,[\s\S]*?normalizedCentralizedRawSdkEventPayloads\.length,[\s\S]*?\)/,
    "Merged progress rows should be projected with the centralized SDK tape length",
  );
});

test("pending reasoning with live delta text remains expandable", () => {
  assert.match(
    messageComponentsSource,
    /const hasReasoningContent =[\s\S]*?event\.summary\.trim\(\) !== "Thinking\.\.\.";/s,
    "only the empty live placeholder should be non-expandable",
  );
  assert.match(
    messageComponentsSource,
    /\{hasReasoningContent && \([\s\S]*?oc-reasoning-chevron/s,
    "a pending live reasoning row with captured text must show its expand affordance",
  );
  assert.match(
    messageComponentsSource,
    /\{isExpanded && hasReasoningContent && \(/,
    "expanded pending reasoning must render its current accumulated delta text",
  );
});
