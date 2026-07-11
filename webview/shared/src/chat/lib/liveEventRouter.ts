/**
 * liveEventRouter — canonical routing table for stream events that are excluded
 * from centralized transcript data but still shown in the live UI.
 *
 * Architecture:
 *   centralizedDebugPayloadFilter decides what enters centralized tape:
 *     - "persist"       → stored in centralized history
 *     - "live-only"     → excluded from history, routed here for live UI
 *     - "excluded-noise"→ dropped entirely
 *
 *   This module is the single discoverable place that maps live-only event
 *   types to their UI destinations. To add a new live-only event type:
 *     1. Add its normalized event type to LIVE_EVENT_ROUTES
 *     2. Add a parser in toastEvents.ts (or a sibling module)
 *     3. Add a reducer + render path for the new destination
 *
 * Current destinations:
 *   - "toast"           → ToastOverlay (ephemeral top-right notifications inside chat)
 *   - "session-status"  → Bottom-of-chat banner with retry countdown (via StreamingState)
 *   - "reasoning-stream"→ Active reasoning step (handled inline by messageHandler, not here)
 */

import type { CentralizedToastNotification, LiveSessionStatus } from "./toastEvents";
import { toastNotificationFromPayload, liveSessionStatusFromPayload } from "./toastEvents";

export type LiveEventDestination = "toast" | "session-status";

export interface LiveEventRoute {
  readonly eventTypes: readonly string[];
  readonly destination: LiveEventDestination;
  readonly description: string;
}

export const LIVE_EVENT_ROUTES: readonly LiveEventRoute[] = [
  {
    eventTypes: ["tui.toast.show", "tui.show"],
    destination: "toast",
    description: "Toast notifications rendered as ephemeral overlays inside the chat",
  },
  {
    eventTypes: ["session.status"],
    destination: "session-status",
    description: "Session busy/retry banner at the bottom of the chat list with countdown",
  },
];

export const LIVE_ONLY_EVENT_TYPES: readonly string[] = LIVE_EVENT_ROUTES.flatMap(
  (route) => route.eventTypes,
);

export interface LiveEventRouteResult {
  toast?: CentralizedToastNotification;
  sessionStatus?: LiveSessionStatus;
}

export function routeLiveEvent(entry: unknown, index = 0): LiveEventRouteResult {
  const toast = toastNotificationFromPayload(entry, index);
  const sessionStatus = liveSessionStatusFromPayload(entry);
  const result: LiveEventRouteResult = {};
  if (toast) {
    result.toast = toast;
  }
  if (sessionStatus) {
    result.sessionStatus = sessionStatus;
  }
  return result;
}
