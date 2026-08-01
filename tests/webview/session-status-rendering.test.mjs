import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

const streamingComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'streamingCardVisibility.ts')],
  'streaming card visibility',
);

const toastEventsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'toastEvents.ts')],
  'toastEvents.ts',
);

const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);

const chatShellSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'ChatShell.tsx')],
  'ChatShell.tsx',
);

const toastOverlaySource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'ToastOverlay.tsx')],
  'ToastOverlay.tsx',
);

const liveEventRouterSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'liveEventRouter.ts')],
  'liveEventRouter.ts',
);

const chatViewProviderSource = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
  'ChatViewProvider.ts',
);

describe('Live-only session status rendering', () => {
  test('streaming card stays visible for status-only live updates', () => {
    assert.match(
      streamingComponentsSource,
      /if \(streaming\.liveSessionStatus\) return true;/,
      'StreamingCard visibility gate should keep the live assistant surface mounted for status-only updates',
    );
  });

  test('ResponseMessageInner renders a temporary structured status row with countdown support', () => {
    assert.match(
      messageComponentsSource,
      /const liveSessionStatus = streaming\?\.liveSessionStatus;/,
      'assistant live surface should read the temporary live session status from streaming state',
    );
    assert.match(
      messageComponentsSource,
      /const liveStatusCountdown = useMemo\([\s\S]*?liveSessionStatus\.next - liveStatusNow/s,
      'live status row should derive a countdown from the next retry timestamp',
    );
    assert.match(
      messageComponentsSource,
      /Retry scheduled · attempt \$\{liveSessionStatus\.attempt\}[\s\S]*?Session busy/s,
      'live status row should surface human-readable retry and busy titles',
    );
    assert.match(
      messageComponentsSource,
      /hasStickyTimelineActivity \|\|[\s\S]*?hasLiveSessionStatus[\s\S]*?showThinkingPlaceholder/s,
      'assistant activity section should stay mounted when live session status is the only signal',
    );
    assert.match(
      messageComponentsSource,
      /liveStatusCountdown\s*\?\s*\([\s\S]*?<span>\{liveStatusCountdown\}<\/span>/,
      'live retry row should show a countdown label instead of relying on centralized transcript timing',
    );
  });

  test('session-status toasts are pinned above the composer while tui notifications stay at the top', () => {
    assert.match(
      chatShellSource,
      /<LiveEventBanner[\s\S]*?placement="top"/,
      'general tui.show notifications should remain in the top notification slot',
    );
    assert.match(
      chatShellSource,
      /data-chat-composer-status-slot[\s\S]*?placement="composer"[\s\S]*?<InputWrapper \/>/,
      'session-status notifications should occupy a dedicated non-overlay slot immediately above the chat composer',
    );
    assert.doesNotMatch(
      chatShellSource,
      /SESSION_STATUS_TOAST_PREVIEW|previewNotification/,
      'the composer status slot must render only real session.status events after visual QA is complete',
    );
    assert.match(
      toastOverlaySource,
      /const isComposerPlacement = placement === "composer";[\s\S]*?isComposerPlacement \? "pl-0" : "pl-3"/s,
      'composer-bound status notifications should remove left padding while top notifications retain it',
    );
    assert.match(
      toastOverlaySource,
      /isComposerPlacement \? "mt-1 text-\[11px\] leading-\[1\.35\] opacity-75" : "mt-0\.5 text-\[12px\] leading-4 opacity-90"/s,
      'composer-bound status messages should render below the status row with wrapping enabled',
    );
  });
});

describe('Live-only event parsing and leak prevention', () => {
  test('toast parser accepts wrapped tui.show and session status parser exists', () => {
    assert.match(
      toastEventsSource,
      /eventType !== "tui\.toast\.show" && eventType !== "tui\.show"/,
      'toast parser should accept both tui.toast.show and tui.show normalized event types',
    );
    assert.match(
      toastEventsSource,
      /export function liveSessionStatusFromPayload\(/,
      'live-only parser module should expose a dedicated session.status parser',
    );
    assert.match(
      toastEventsSource,
      /eventSessionId\(payload\)/,
      'live-only parsers should derive session id through resilient wrapped-event helpers',
    );
    assert.match(
      toastEventsSource,
      /syncData\?\.type,[\s\S]*?payloadSyncData\?\.type/s,
      'toast parser should inspect syncEvent.data and payload.syncEvent.data event types for wrapped live events',
    );
    assert.match(
      toastEventsSource,
      /asString\(properties\?\.text\)\?\.trim\(\) \|\|[\s\S]*?asString\(properties\?\.body\)\?\.trim\(\) \|\|[\s\S]*?asString\(properties\?\.description\)\?\.trim\(\)/s,
      'toast parser should accept alternate live message fields like text, body, and description',
    );
    assert.match(
      toastEventsSource,
      /asString\(syncData\?\.message\)\?\.trim\(\) \|\|[\s\S]*?asString\(wrappedSyncData\?\.message\)\?\.trim\(\)/s,
      'toast parser should also read toast message text from sync-wrapped data objects',
    );
    assert.match(
      toastEventsSource,
      /properties\?\.variant \?\?[\s\S]*?properties\?\.severity \?\?[\s\S]*?properties\?\.level/s,
      'toast parser should accept severity aliases for variant selection',
    );
    assert.match(
      toastEventsSource,
      /asNumber\(properties\?\.duration\) \?\?[\s\S]*?asNumber\(properties\?\.durationMs\) \?\?[\s\S]*?asNumber\(properties\?\.timeout\)/s,
      'toast parser should accept alternate duration field names from live stream payloads',
    );
  });

  test('message handler keeps live-only events out of centralized raw tape', () => {
    assert.match(
      messageHandlerSource,
      /const liveRoute = routeLiveEventToUi\([\s\S]*?const liveSessionStatus = liveRoute\.sessionStatus/s,
      'stream events should route live-only events through the raw SDK live-event UI path',
    );
    assert.match(
      messageHandlerSource,
      /type: "UPDATE_LIVE_SESSION_STATUS"/,
      'stream events should dispatch a dedicated live session status action',
    );
    assert.doesNotMatch(
      messageHandlerSource,
      /centralizedDisposition !== "excluded-noise"[\s\S]*?APPEND_RAW_SDK_EVENT_PAYLOAD/s,
      'live-only events must no longer be appended to centralized raw tape by the old permissive gate',
    );
  });

  test('retry status events bypass the stopped-session content guard', () => {
    assert.match(
      messageHandlerSource,
      /isStoppedSession\(eventSessionId, activeSessionId\) &&\s*streamEventType !== "session\.status"/s,
      'a retry/usage-limit session.status event must still reach the live-status UI after a stop acknowledgement',
    );
    assert.match(
      messageHandlerSource,
      /isStoppedSession\(eventSessionId, activeSessionId\) &&\s*evtType !== "session\.status"/s,
      'batched retry/usage-limit session.status events must follow the same visibility rule',
    );
    assert.match(
      messageHandlerSource,
      /const isSessionStatusEvent = streamEventType === "session\.status";[\s\S]*?if \(isSessionStatusEvent\) \{[\s\S]*?appendLiveEventsToDebugPanel/s,
      'session.status must enter the temporary Live Events debug buffer before lifecycle gates can discard it',
    );
    assert.match(
      messageHandlerSource,
      /const isSessionStatusEvent = evtType === "session\.status";[\s\S]*?if \(isSessionStatusEvent\) \{[\s\S]*?appendLiveEventsToDebugPanel/s,
      'batched session.status frames must also be retained in the temporary Live Events debug buffer',
    );
  });

  test('terminal idle status releases the current session loading latch', () => {
    assert.match(
      messageHandlerSource,
      /const recordSessionIdleStatus = \(sessionId: string \| null\): void => \{[\s\S]*?stoppedSessionIds\.add\(resolvedSessionId\)[\s\S]*?SET_PROCESSING_SESSIONS[\s\S]*?SET_ASSISTANT_TURN_PENDING[\s\S]*?SET_PROCESSING[\s\S]*?FINISH_STREAMING/s,
      'the final SDK idle lifecycle event must latch the session closed, remove its processing hint, and finish the live stream without clearing its transcript',
    );
  });


  test('client-only live event batches route tui.show notifications into the toast overlay', () => {
    assert.match(
      messageHandlerSource,
      /case "liveEventStreamDebugBatch": \{[\s\S]*?routeLiveEventToUi\([\s\S]*?event,[\s\S]*?sessionId,[\s\S]*?"liveEventStreamDebugBatch",[\s\S]*?eventIndex,[\s\S]*?\)/s,
      'startup tui.show events that only reach the client-only live stream should still be rendered as toasts',
    );
  });

  test('chat shell subscribes to the per-session live toast state it passes to the overlay', () => {
    assert.match(
      chatShellSource,
      /liveToastNotificationsBySessionId: appState\.liveToastNotificationsBySessionId/,
      'the overlay must receive live toast changes through the ChatContent state selector',
    );
  });

  test('liveEventRouter is the canonical discoverable routing table for live-only events', () => {
    assert.match(
      liveEventRouterSource,
      /export const LIVE_EVENT_ROUTES/,
      'router module should export a canonical LIVE_EVENT_ROUTES table',
    );
    assert.match(
      liveEventRouterSource,
      /"tui\.toast\.show", "tui\.show"/,
      'router should map tui toast event types to the toast destination',
    );
    assert.match(
      liveEventRouterSource,
      /"session\.status"/,
      'router should map session.status to the session-status destination',
    );
    assert.match(
      liveEventRouterSource,
      /export function routeLiveEvent\(/,
      'router module should expose a single routeLiveEvent entry point',
    );
    assert.match(
      messageHandlerSource,
      /import \{ routeLiveEvent \} from "\.\/liveEventRouter"/,
      'messageHandler should import the router instead of scattered individual parsers',
    );
    assert.match(
      messageHandlerSource,
      /const routeLiveEventToUi = \([\s\S]*?routeLiveEvent\(payload, index\)/s,
      'stream events should use the centralized router for live-event dispatch',
    );
  });

  test('SDK idle status is terminal and clears host and webview loading state', () => {
    assert.match(
      chatViewProviderSource,
      /"session\.idle"[\s\S]*?if \(eventType === "session\.status"\) \{[\s\S]*?status\?\.type[\s\S]*?=== "idle"/s,
      'the host must treat session.idle and session.status: idle as terminal SDK lifecycle signals',
    );
    assert.match(
      messageHandlerSource,
      /const recordSessionIdleStatus = \(sessionId: string \| null\): void => \{[\s\S]*?idle-status-observed[\s\S]*?SET_PROCESSING_SESSIONS[\s\S]*?FINISH_STREAMING/s,
      'the webview must remove the idle session from the loading state while preserving rendered activity',
    );
    assert.doesNotMatch(
      messageHandlerSource,
      /terminalIdleSessionIds|rejected-terminal-idle|markSessionIdle/,
      'idle frames must not gate later assistant parts or reset the rendered timeline',
    );
  });

  test('live events use their SDK session identity before the host envelope', () => {
    assert.match(
      messageHandlerSource,
      /export function extractCentralizedEventSessionId\(payload: unknown\)/,
      'the webview needs one complete SDK session resolver for direct and sync event envelopes',
    );
    assert.match(
      messageHandlerSource,
      /asString\(info\?\.sessionID\)[\s\S]*?asString\(syncEvent\?\.aggregateID\)/,
      'session identity must include message info and sync aggregate fields used by OpenCode live events',
    );
    assert.match(
      messageHandlerSource,
      /extractCentralizedEventSessionId\(payload\) \|\| envelopeSessionId/,
      'a nested SDK session id must take precedence over a stale forwarded envelope session',
    );
  });
});
