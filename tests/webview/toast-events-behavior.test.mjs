// Runtime regression tests for webview/shared/src/chat/lib/toastEvents.ts
//
// Why this file exists:
// - `toastEvents.ts` had ZERO runtime behavior coverage for user-visible toast parsing.
// - The module is 318 lines of fallback-heavy normalization for live OpenCode events.
// - A silent behavior change would break centralized notifications and live session status UI.
//
// These tests execute the actual TypeScript implementation via `tsx` so they
// catch real behavior regressions, not just source-text drift.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { importWebviewModule } from "../helpers/webview-module.mjs";

const MODULE_PATH = "webview/shared/src/chat/lib/toastEvents.ts";
const {
  toastNotificationFromPayload,
  liveSessionStatusFromPayload,
  extractCentralizedToastNotifications,
} = await importWebviewModule(MODULE_PATH);

describe("toastEvents", () => {
  describe("toastNotificationFromPayload", () => {
    it("returns null for non-record payloads", () => {
      assert.strictEqual(toastNotificationFromPayload(null), null);
      assert.strictEqual(toastNotificationFromPayload(undefined), null);
      assert.strictEqual(toastNotificationFromPayload("tui.toast.show"), null);
      assert.strictEqual(toastNotificationFromPayload(42), null);
      assert.strictEqual(toastNotificationFromPayload(true), null);
      assert.strictEqual(toastNotificationFromPayload([]), null);
    });

    it("returns null when the normalized event type is not a toast event", () => {
      assert.strictEqual(toastNotificationFromPayload({ type: "session.status" }), null);
      assert.strictEqual(toastNotificationFromPayload({ type: "tui.toast.hide" }), null);
      assert.strictEqual(toastNotificationFromPayload({ event: "other.event", message: "ignored" }), null);
    });

    it("accepts a bare tui.toast.show payload and extracts core fields", () => {
      const notification = toastNotificationFromPayload({
        type: "tui.toast.show",
        id: "toast-1",
        title: "Saved",
        message: "Settings persisted",
        variant: "SUCCESS",
        durationMs: 2500,
        sessionId: "session-a",
      });

      assert.equal(notification.key, "toast-1");
      assert.equal(notification.id, "toast-1");
      assert.equal(notification.type, "tui.toast.show");
      assert.equal(notification.title, "Saved");
      assert.equal(notification.message, "Settings persisted");
      assert.equal(notification.variant, "success");
      assert.equal(notification.durationMs, 2500);
      assert.equal(notification.sessionId, "session-a");
    });

    it("uses the variant fallback chain from properties.variant to severity to level", () => {
      assert.equal(
        toastNotificationFromPayload({
          type: "tui.show",
          properties: { title: "A", message: "B", variant: "WARNING", severity: "error", level: "success" },
        }).variant,
        "warning",
      );
      assert.equal(
        toastNotificationFromPayload({
          type: "tui.show",
          properties: { title: "A", message: "B", severity: "ERROR", level: "success" },
        }).variant,
        "error",
      );
      assert.equal(
        toastNotificationFromPayload({
          type: "tui.show",
          properties: { title: "A", message: "B", level: "SUCCESS" },
        }).variant,
        "success",
      );
    });

    it("unwraps payload envelopes, sync-event data, and combined wrapped sync-event data", () => {
      const wrapped = toastNotificationFromPayload({
        payload: {
          type: "tui.toast.show",
          title: "Wrapped title",
          message: "Wrapped message",
          sessionID: "wrapped-session",
        },
      });
      const sync = toastNotificationFromPayload({
        syncEvent: {
          data: {
            type: "tui.toast.show",
            title: "Sync title",
            text: "Sync text",
            sessionId: "sync-session",
          },
        },
      });
      const combined = toastNotificationFromPayload({
        payload: {
          syncEvent: {
            data: {
              type: "tui.show",
              title: "Combined title",
              body: "Combined body",
              sessionId: "combined-session",
            },
          },
        },
      });

      assert.equal(wrapped.title, "Wrapped title");
      assert.equal(wrapped.message, "Wrapped message");
      assert.equal(wrapped.sessionId, "wrapped-session");
      assert.equal(sync.title, "Sync title");
      assert.equal(sync.message, "Sync text");
      assert.equal(sync.sessionId, "sync-session");
      assert.equal(combined.type, "tui.show");
      assert.equal(combined.title, "Combined title");
      assert.equal(combined.message, "Combined body");
      assert.equal(combined.sessionId, "combined-session");
    });

    it("falls back to OpenCode title and empty message when no text fields resolve", () => {
      const notification = toastNotificationFromPayload({ type: "tui.toast.show" });

      assert.equal(notification.title, "OpenCode");
      assert.equal(notification.message, "");
      assert.equal(notification.variant, "info");
      assert.equal(notification.durationMs, 4000);
    });

    it("honors duration priority before falling back to defaults", () => {
      assert.equal(
        toastNotificationFromPayload({
          type: "tui.toast.show",
          properties: { title: "A", message: "B", duration: 100, durationMs: 200, timeout: 300 },
          syncEvent: { data: { duration: 400 } },
          duration: 500,
        }).durationMs,
        100,
      );
      assert.equal(
        toastNotificationFromPayload({
          type: "tui.toast.show",
          properties: { title: "A", message: "B", durationMs: 200, timeout: 300 },
          syncEvent: { data: { duration: 400 } },
          duration: 500,
        }).durationMs,
        200,
      );
      assert.equal(
        toastNotificationFromPayload({
          type: "tui.toast.show",
          properties: { title: "A", message: "B", timeout: 300 },
          syncEvent: { data: { duration: 400 } },
          duration: 500,
        }).durationMs,
        300,
      );
      assert.equal(
        toastNotificationFromPayload({
          type: "tui.toast.show",
          syncEvent: { data: { title: "A", message: "B", duration: 400, durationMs: 450 } },
          duration: 500,
        }).durationMs,
        400,
      );
      assert.equal(
        toastNotificationFromPayload({ type: "tui.toast.show", title: "A", message: "B", duration: 0 }).durationMs,
        4000,
      );
      assert.equal(
        toastNotificationFromPayload({ type: "tui.toast.show", title: "A", message: "B", duration: -1 }).durationMs,
        4000,
      );
    });

    it("normalizes variants case-insensitively and falls back to info for unknown values", () => {
      assert.equal(toastNotificationFromPayload({ type: "tui.show", variant: "eRrOr" }).variant, "error");
      assert.equal(toastNotificationFromPayload({ type: "tui.show", variant: "mystery" }).variant, "info");
      assert.equal(toastNotificationFromPayload({ type: "tui.show", severity: "warning" }).variant, "warning");
    });

    it("strips numeric event-type suffixes before accepting toast events", () => {
      const notification = toastNotificationFromPayload({
        type: "tui.toast.show.123",
        title: "Numbered",
        message: "Suffix",
      });

      assert.equal(notification.type, "tui.toast.show");
      assert.equal(notification.title, "Numbered");
      assert.equal(notification.message, "Suffix");
    });

    it("uses supported id-like fields for keys before building composite fallback keys", () => {
      assert.equal(toastNotificationFromPayload({ type: "tui.show", eventID: "event-upper" }).key, "event-upper");
      assert.equal(toastNotificationFromPayload({ type: "tui.show", eventId: "event-camel" }).key, "event-camel");
      assert.equal(toastNotificationFromPayload({ type: "tui.show", messageID: "message-upper" }).key, "message-upper");
      assert.equal(toastNotificationFromPayload({ type: "tui.show", messageId: "message-camel" }).key, "message-camel");

      const composite = toastNotificationFromPayload(
        { type: "tui.show", properties: { title: "Composite", message: "Fallback", sessionId: "session-z" } },
        7,
      );
      assert.equal(composite.key, "toast:tui.show:Composite:Fallback:session-z:7");
      assert.equal(composite.id, undefined);
    });
  });

  describe("liveSessionStatusFromPayload", () => {
    it("returns null for non-session.status events and status blocks without a resolvable type", () => {
      assert.strictEqual(liveSessionStatusFromPayload(null), null);
      assert.strictEqual(liveSessionStatusFromPayload({ type: "tui.toast.show" }), null);
      assert.strictEqual(liveSessionStatusFromPayload({ type: "session.status", status: { message: "missing type" } }), null);
      assert.strictEqual(liveSessionStatusFromPayload({ type: "session.status", properties: { message: "missing status" } }), null);
    });

    it("extracts status fields, lowercases statusType, parses timestamps, and falls back source to event type", () => {
      const timestamp = "2026-07-19T12:34:56.000Z";
      const status = liveSessionStatusFromPayload({
        type: "session.status",
        timestamp,
        sessionID: "session-1",
        properties: {
          message: "Attempting reconnect",
          status: { type: "RECONNECTING", attempt: 2, next: 5000 },
        },
      });

      assert.equal(status.statusType, "reconnecting");
      assert.equal(status.message, "Attempting reconnect");
      assert.equal(status.attempt, 2);
      assert.equal(status.next, 5000);
      assert.equal(status.sessionId, "session-1");
      assert.equal(status.source, "session.status");
      assert.equal(status.updatedAt, Date.parse(timestamp));
    });

    it("prefers status.message, accepts status.status, preserves source, and omits invalid updatedAt", () => {
      const status = liveSessionStatusFromPayload({
        event: "session.status",
        source: "sdk-stream",
        timestamp: "not a date",
        status: { status: "IDLE", message: "Idle now", attempt: 1, next: 10 },
        sessionId: "session-2",
        properties: { message: "Fallback message" },
      });

      assert.equal(status.statusType, "idle");
      assert.equal(status.message, "Idle now");
      assert.equal(status.attempt, 1);
      assert.equal(status.next, 10);
      assert.equal(status.sessionId, "session-2");
      assert.equal(status.source, "sdk-stream");
      assert.equal(status.updatedAt, undefined);
    });

    it("reads wrapped sync-event status data and leaves updatedAt undefined when timestamp is missing", () => {
      const status = liveSessionStatusFromPayload({
        payload: {
          syncEvent: {
            data: {
              type: "session.status",
              sessionId: "session-3",
              status: { type: "RUNNING" },
            },
          },
        },
      });

      assert.equal(status.statusType, "running");
      assert.equal(status.sessionId, "session-3");
      assert.equal(status.source, "session.status");
      assert.equal(status.updatedAt, undefined);
    });
  });

  describe("extractCentralizedToastNotifications", () => {
    it("returns an empty array for non-array and empty-array input", () => {
      assert.deepEqual(extractCentralizedToastNotifications(undefined), []);
      assert.deepEqual(extractCentralizedToastNotifications(null), []);
      assert.deepEqual(extractCentralizedToastNotifications({ type: "tui.show" }), []);
      assert.deepEqual(extractCentralizedToastNotifications([]), []);
    });

    it("skips entries that do not parse and preserves parsed notification order", () => {
      const notifications = extractCentralizedToastNotifications([
        { type: "session.status" },
        { type: "tui.show", properties: { title: "First", message: "One" } },
        null,
        { type: "tui.toast.show", properties: { title: "Second", message: "Two" } },
      ]);

      assert.equal(notifications.length, 2);
      assert.equal(notifications[0].title, "First");
      assert.equal(notifications[0].message, "One");
      assert.equal(notifications[1].title, "Second");
      assert.equal(notifications[1].message, "Two");
    });

    it("passes the original input index into composite-key generation", () => {
      const notifications = extractCentralizedToastNotifications([
        { type: "not.toast" },
        { type: "tui.show", properties: { title: "Indexed", message: "Original", sessionId: "session-index" } },
      ]);

      assert.equal(notifications.length, 1);
      assert.equal(notifications[0].key, "toast:tui.show:Indexed:Original:session-index:1");
    });
  });
});
