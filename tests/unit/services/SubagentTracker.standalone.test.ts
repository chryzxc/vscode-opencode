/**
 * Comprehensive unit tests for SubagentTracker service
 * Tests subagent lifecycle, event tracking, and state management
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SubagentTracker,
  type SubagentStatus,
  type SubagentReference,
  type SubagentTimelineEvent,
  type SubagentThinkingEvent,
  type SubagentProgressEvent,
  type SubagentSummary,
  type SubagentDetail,
  type SubagentUpdatePayload,
} from '../../../src/services/SubagentTracker';

describe('SubagentTracker', () => {
  let tracker: SubagentTracker;

  beforeEach(() => {
    tracker = new SubagentTracker();
    vi.clearAllMocks();
  });

  describe('Type Definitions', () => {
    it('should accept valid SubagentStatus values', () => {
      const validStatuses: SubagentStatus[] = [
        'pending',
        'running',
        'done',
        'error',
        'orphaned',
      ];
      validStatuses.forEach((status) => {
        expect(status).toBeTruthy();
      });
    });

    it('should accept SubagentReference with optional fields', () => {
      const ref1: SubagentReference = { messageID: 'msg1' };
      const ref2: SubagentReference = { partID: 'part1' };
      const ref3: SubagentReference = { callID: 'call1' };
      const ref4: SubagentReference = {
        messageID: 'msg1',
        partID: 'part1',
        callID: 'call1',
      };

      expect(ref1.messageID).toBe('msg1');
      expect(ref2.partID).toBe('part1');
      expect(ref3.callID).toBe('call1');
      expect(ref4.messageID).toBe('msg1');
    });
  });

  describe('resetForSession', () => {
    it('should reset all state for new session', () => {
      const sessionId = 'session-1';
      tracker.setActiveSession(sessionId);

      // Create some subagents
      tracker.consumeStreamEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'subtask',
            id: 'part-1',
            sessionID: sessionId,
            messageID: 'msg1',
            agent: 'test-agent',
          },
        },
      });

      const hasSubagents = tracker['detailsById'].size > 0;
      expect(hasSubagents).toBe(true);

      // Reset
      tracker.resetForSession('session-2');

      expect(tracker['activeSessionId']).toBe('session-2');
      expect(tracker['detailsById'].size).toBe(0);
      expect(tracker['idsByParentMessageId'].size).toBe(0);
      expect(tracker['pendingSubtasksByParentSessionId'].size).toBe(0);
    });

    it('should accept null session ID', () => {
      tracker.resetForSession(null);
      expect(tracker['activeSessionId']).toBeNull();
    });
  });

  describe('setActiveSession', () => {
    it('should set active session ID', () => {
      tracker.setActiveSession('session-1');
      expect(tracker['activeSessionId']).toBe('session-1');
    });

    it('should allow changing active session', () => {
      tracker.setActiveSession('session-1');
      tracker.setActiveSession('session-2');
      expect(tracker['activeSessionId']).toBe('session-2');
    });

    it('should accept null session ID', () => {
      tracker.setActiveSession('session-1');
      tracker.setActiveSession(null);
      expect(tracker['activeSessionId']).toBeNull();
    });
  });

  describe('getLatestParentMessageId', () => {
    it('should return undefined when no messages tracked', () => {
      const result = tracker.getLatestParentMessageId('session-1');
      expect(result).toBeUndefined();
    });

    it('should return latest parent message ID for session', () => {
      tracker.setActiveSession('session-1');

      tracker.consumeStreamEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'subtask',
            id: 'part-1',
            sessionID: 'session-1',
            messageID: 'msg1',
            agent: 'test-agent',
          },
        },
      });

      const result = tracker.getLatestParentMessageId('session-1');
      expect(result).toBe('msg1');
    });
  });

  describe('consumeStreamEvent - message.part.updated', () => {
    beforeEach(() => {
      tracker.setActiveSession('session-1');
    });

    it('should create subagent from subtask part', () => {
      const result = tracker.consumeStreamEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'subtask',
            id: 'part-1',
            sessionID: 'session-1',
            messageID: 'msg1',
            agent: 'test-agent',
            description: 'Test subtask',
          },
        },
      });

      expect(result).not.toBeNull();
      expect(result?.detailsById).toBeDefined();
      const subagentIds = Object.keys(result?.detailsById || {});
      expect(subagentIds.length).toBeGreaterThan(0);
    });

    it('should track thinking events from reasoning parts', () => {
      tracker.consumeStreamEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'subtask',
            id: 'part-1',
            sessionID: 'session-1',
            messageID: 'msg1',
            agent: 'test-agent',
          },
        },
      });

      // Create child session
      tracker.consumeStreamEvent({
        type: 'session.created',
        properties: {
          info: {
            id: 'child-session-1',
            parentID: 'session-1',
            time: { created: Date.now() },
          },
        },
      });

      // Add reasoning
      const result = tracker.consumeStreamEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'reasoning',
            id: 'part-2',
            sessionID: 'child-session-1',
            messageID: 'msg2',
            reasoning: 'Analyzing the problem',
          },
        },
      });

      expect(result).not.toBeNull();
      const detail = Object.values(result?.detailsById || {})[0] as SubagentDetail;
      expect(detail.thinkingEvents.length).toBeGreaterThan(0);
      expect(detail.thinkingEvents[0].text).toBe('Analyzing the problem');
    });

    it('should track progress events from tool parts', () => {
      tracker.consumeStreamEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'subtask',
            id: 'part-1',
            sessionID: 'session-1',
            messageID: 'msg1',
            agent: 'test-agent',
          },
        },
      });

      tracker.consumeStreamEvent({
        type: 'session.created',
        properties: {
          info: {
            id: 'child-session-1',
            parentID: 'session-1',
            time: { created: Date.now() },
          },
        },
      });

      const result = tracker.consumeStreamEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'tool',
            id: 'part-2',
            sessionID: 'child-session-1',
            messageID: 'msg2',
            tool: 'read_file',
            callID: 'call-1',
            state: {
              input: { file: '/path/to/file.ts' },
              result: { diffStats: { added: 10, deleted: 5 } },
              status: 'done',
            },
          },
        },
      });

      expect(result).not.toBeNull();
      const detail = Object.values(result?.detailsById || {})[0] as SubagentDetail;
      expect(detail.progressEvents.length).toBeGreaterThan(0);
      expect(detail.progressEvents[0].title).toContain('read_file');
    });
  });

  describe('consumeStreamEvent - session.created', () => {
    beforeEach(() => {
      tracker.setActiveSession('session-1');
    });

    it('should bind child session to pending subtask', () => {
      tracker.consumeStreamEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'subtask',
            id: 'part-1',
            sessionID: 'session-1',
            messageID: 'msg1',
            agent: 'test-agent',
          },
        },
      });

      const result = tracker.consumeStreamEvent({
        type: 'session.created',
        properties: {
          info: {
            id: 'child-session-1',
            parentID: 'session-1',
            time: { created: Date.now() },
          },
        },
      });

      expect(result).not.toBeNull();
      const detail = Object.values(result?.detailsById || {})[0] as SubagentDetail;
      expect(detail.childSessionId).toBe('child-session-1');
      expect(detail.status).toBe('running');
    });

    it('should create orphan subagent if no pending subtask', () => {
      const result = tracker.consumeStreamEvent({
        type: 'session.created',
        properties: {
          info: {
            id: 'child-session-1',
            parentID: 'session-1',
            time: { created: Date.now() },
          },
        },
      });

      expect(result).not.toBeNull();
      const detail = Object.values(result?.detailsById || {})[0] as SubagentDetail;
      expect(detail.status).toBe('orphaned');
      expect(detail.childSessionId).toBe('child-session-1');
    });
  });

  describe('consumeStreamEvent - message.updated', () => {
    beforeEach(() => {
      tracker.setActiveSession('session-1');
    });

    it('should update subagent on child message completion', () => {
      tracker.consumeStreamEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'subtask',
            id: 'part-1',
            sessionID: 'session-1',
            messageID: 'msg1',
            agent: 'test-agent',
          },
        },
      });

      tracker.consumeStreamEvent({
        type: 'session.created',
        properties: {
          info: {
            id: 'child-session-1',
            parentID: 'session-1',
            time: { created: Date.now() },
          },
        },
      });

      const result = tracker.consumeStreamEvent({
        type: 'message.updated',
        properties: {
          info: {
            id: 'child-msg-1',
            sessionID: 'child-session-1',
            providerID: 'provider-1',
            modelID: 'model-1',
            tokens: {
              input: 1000,
              output: 2000,
              reasoning: 500,
              cache: { read: 100, write: 50 },
            },
            time: {
              created: Date.now(),
              completed: Date.now() + 1000,
            },
            finish: 'done',
          },
        },
      });

      expect(result).not.toBeNull();
      const detail = Object.values(result?.detailsById || {})[0] as SubagentDetail;
      expect(detail.status).toBe('done');
      expect(detail.providerID).toBe('provider-1');
      expect(detail.modelID).toBe('model-1');
      expect(detail.tokenUsage?.input).toBe(1000);
      expect(detail.tokenUsage?.output).toBe(2000);
    });

    it('should handle error state', () => {
      tracker.consumeStreamEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'subtask',
            id: 'part-1',
            sessionID: 'session-1',
            messageID: 'msg1',
            agent: 'test-agent',
          },
        },
      });

      tracker.consumeStreamEvent({
        type: 'session.created',
        properties: {
          info: {
            id: 'child-session-1',
            parentID: 'session-1',
            time: { created: Date.now() },
          },
        },
      });

      const result = tracker.consumeStreamEvent({
        type: 'message.updated',
        properties: {
          info: {
            id: 'child-msg-1',
            sessionID: 'child-session-1',
            error: {
              message: 'Test error',
            },
          },
        },
      });

      const detail = Object.values(result?.detailsById || {})[0] as SubagentDetail;
      expect(detail.status).toBe('error');
      expect(detail.errorText).toBe('Test error');
    });
  });

  describe('consumeStreamEvent - session.error', () => {
    beforeEach(() => {
      tracker.setActiveSession('session-1');
    });

    it('should update subagent to error state', () => {
      tracker.consumeStreamEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'subtask',
            id: 'part-1',
            sessionID: 'session-1',
            messageID: 'msg1',
            agent: 'test-agent',
          },
        },
      });

      tracker.consumeStreamEvent({
        type: 'session.created',
        properties: {
          info: {
            id: 'child-session-1',
            parentID: 'session-1',
            time: { created: Date.now() },
          },
        },
      });

      const result = tracker.consumeStreamEvent({
        type: 'session.error',
        properties: {
          sessionID: 'child-session-1',
          error: {
            message: 'Session failed',
          },
        },
      });

      const detail = Object.values(result?.detailsById || {})[0] as SubagentDetail;
      expect(detail.status).toBe('error');
      expect(detail.errorText).toBe('Session failed');
    });
  });

  describe('getSnapshotPayload', () => {
    it('should return payload with all tracked subagents', () => {
      tracker.setActiveSession('session-1');

      tracker.consumeStreamEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'subtask',
            id: 'part-1',
            sessionID: 'session-1',
            messageID: 'msg1',
            agent: 'test-agent',
          },
        },
      });

      const payload = tracker.getSnapshotPayload();

      expect(payload.summariesByParentMessageId).toBeDefined();
      expect(payload.detailsById).toBeDefined();
      expect(Object.keys(payload.detailsById).length).toBeGreaterThan(0);
    });

    it('should return empty payload when no subagents', () => {
      const payload = tracker.getSnapshotPayload();

      expect(Object.keys(payload.summariesByParentMessageId).length).toBe(0);
      expect(Object.keys(payload.detailsById).length).toBe(0);
    });
  });

  describe('getPayloadForParentMessage', () => {
    it('should return payload for specific parent message', () => {
      tracker.setActiveSession('session-1');

      tracker.consumeStreamEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'subtask',
            id: 'part-1',
            sessionID: 'session-1',
            messageID: 'msg1',
            agent: 'test-agent',
          },
        },
      });

      const payload = tracker.getPayloadForParentMessage('msg1');

      expect(payload.summariesByParentMessageId['msg1']).toBeDefined();
      expect(Object.keys(payload.detailsById).length).toBeGreaterThan(0);
    });

    it('should return empty payload for unknown message', () => {
      const payload = tracker.getPayloadForParentMessage('unknown-msg');

      expect(Object.keys(payload.summariesByParentMessageId).length).toBe(0);
      expect(Object.keys(payload.detailsById).length).toBe(0);
    });
  });

  describe('Time Calculations', () => {
    it('should calculate duration from startedAt and endedAt', () => {
      tracker.setActiveSession('session-1');

      const startedAt = Date.now();
      tracker.consumeStreamEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'subtask',
            id: 'part-1',
            sessionID: 'session-1',
            messageID: 'msg1',
            agent: 'test-agent',
          },
        },
      });

      tracker.consumeStreamEvent({
        type: 'session.created',
        properties: {
          info: {
            id: 'child-session-1',
            parentID: 'session-1',
            time: { created: startedAt },
          },
        },
      });

      const endedAt = startedAt + 5000;
      tracker.consumeStreamEvent({
        type: 'message.updated',
        properties: {
          info: {
            id: 'child-msg-1',
            sessionID: 'child-session-1',
            time: {
              created: startedAt,
              completed: endedAt,
            },
            finish: 'done',
          },
        },
      });

      const payload = tracker.getSnapshotPayload();
      const detail = Object.values(payload.detailsById)[0] as SubagentDetail;

      expect(detail.durationMs).toBe(5000);
    });
  });

  describe('Status Transitions', () => {
    it('should transition from pending to running', () => {
      tracker.setActiveSession('session-1');

      tracker.consumeStreamEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'subtask',
            id: 'part-1',
            sessionID: 'session-1',
            messageID: 'msg1',
            agent: 'test-agent',
          },
        },
      });

      let payload = tracker.getSnapshotPayload();
      let detail = Object.values(payload.detailsById)[0] as SubagentDetail;
      expect(detail.status).toBe('pending');

      tracker.consumeStreamEvent({
        type: 'session.created',
        properties: {
          info: {
            id: 'child-session-1',
            parentID: 'session-1',
            time: { created: Date.now() },
          },
        },
      });

      payload = tracker.getSnapshotPayload();
      detail = Object.values(payload.detailsById)[0] as SubagentDetail;
      expect(detail.status).toBe('running');
    });

    it('should transition to done on completion', () => {
      tracker.setActiveSession('session-1');

      tracker.consumeStreamEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'subtask',
            id: 'part-1',
            sessionID: 'session-1',
            messageID: 'msg1',
            agent: 'test-agent',
          },
        },
      });

      tracker.consumeStreamEvent({
        type: 'session.created',
        properties: {
          info: {
            id: 'child-session-1',
            parentID: 'session-1',
            time: { created: Date.now() },
          },
        },
      });

      tracker.consumeStreamEvent({
        type: 'message.updated',
        properties: {
          info: {
            id: 'child-msg-1',
            sessionID: 'child-session-1',
            time: {
              created: Date.now(),
              completed: Date.now() + 1000,
            },
            finish: 'done',
          },
        },
      });

      const payload = tracker.getSnapshotPayload();
      const detail = Object.values(payload.detailsById)[0] as SubagentDetail;
      expect(detail.status).toBe('done');
    });

    it('should transition to error on error', () => {
      tracker.setActiveSession('session-1');

      tracker.consumeStreamEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'subtask',
            id: 'part-1',
            sessionID: 'session-1',
            messageID: 'msg1',
            agent: 'test-agent',
          },
        },
      });

      tracker.consumeStreamEvent({
        type: 'session.created',
        properties: {
          info: {
            id: 'child-session-1',
            parentID: 'session-1',
            time: { created: Date.now() },
          },
        },
      });

      tracker.consumeStreamEvent({
        type: 'message.updated',
        properties: {
          info: {
            id: 'child-msg-1',
            sessionID: 'child-session-1',
            error: {
              message: 'Test error',
            },
          },
        },
      });

      const payload = tracker.getSnapshotPayload();
      const detail = Object.values(payload.detailsById)[0] as SubagentDetail;
      expect(detail.status).toBe('error');
    });
  });

  describe('Edge Cases', () => {
    it('should handle null events gracefully', () => {
      const result = tracker.consumeStreamEvent(null);
      expect(result).toBeNull();
    });

    it('should handle events without type', () => {
      const result = tracker.consumeStreamEvent({
        properties: {},
      });
      expect(result).toBeNull();
    });

    it('should handle unknown event types', () => {
      const result = tracker.consumeStreamEvent({
        type: 'unknown.event',
        properties: {},
      });
      expect(result).toBeNull();
    });

    it('should handle malformed part data', () => {
      tracker.setActiveSession('session-1');

      const result = tracker.consumeStreamEvent({
        type: 'message.part.updated',
        properties: {
          part: null,
        },
      });

      expect(result).toBeNull();
    });
  });

  describe('Multiple Subagents', () => {
    it('should track multiple subagents for same parent', () => {
      tracker.setActiveSession('session-1');

      tracker.consumeStreamEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'subtask',
            id: 'part-1',
            sessionID: 'session-1',
            messageID: 'msg1',
            agent: 'agent-1',
          },
        },
      });

      tracker.consumeStreamEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'subtask',
            id: 'part-2',
            sessionID: 'session-1',
            messageID: 'msg1',
            agent: 'agent-2',
          },
        },
      });

      const payload = tracker.getSnapshotPayload();
      const summaries = payload.summariesByParentMessageId['msg1'];

      expect(summaries).toBeDefined();
      expect(summaries.length).toBe(2);
    });

    it('should track subagents from different parent messages', () => {
      tracker.setActiveSession('session-1');

      tracker.consumeStreamEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'subtask',
            id: 'part-1',
            sessionID: 'session-1',
            messageID: 'msg1',
            agent: 'agent-1',
          },
        },
      });

      tracker.consumeStreamEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'subtask',
            id: 'part-2',
            sessionID: 'session-1',
            messageID: 'msg2',
            agent: 'agent-2',
          },
        },
      });

      const payload = tracker.getSnapshotPayload();

      expect(Object.keys(payload.summariesByParentMessageId).length).toBe(2);
      expect(payload.summariesByParentMessageId['msg1']).toBeDefined();
      expect(payload.summariesByParentMessageId['msg2']).toBeDefined();
    });
  });
});
