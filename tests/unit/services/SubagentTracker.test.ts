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

    it('should accept SubagentTimelineEvent with all fields', () => {
      const event: SubagentTimelineEvent = {
        key: 'test-key',
        type: 'test-type',
        label: 'Test Event',
        createdAt: Date.now(),
        messageID: 'msg1',
        partID: 'part1',
        callID: 'call1',
      };

      expect(event.key).toBe('test-key');
      expect(event.type).toBe('test-type');
      expect(event.label).toBe('Test Event');
      expect(event.messageID).toBe('msg1');
    });

    it('should accept SubagentThinkingEvent with all fields', () => {
      const event: SubagentThinkingEvent = {
        id: 'thought-1',
        text: 'Thinking about the problem',
        createdAt: Date.now(),
        messageID: 'msg1',
        partID: 'part1',
      };

      expect(event.id).toBe('thought-1');
      expect(event.text).toBe('Thinking about the problem');
    });

    it('should accept SubagentProgressEvent with all fields', () => {
      const event: SubagentProgressEvent = {
        id: 'progress-1',
        title: 'Processing file',
        status: 'pending',
        meta: 'Reading data',
        filePath: '/path/to/file.ts',
        diffStats: { added: 10, deleted: 5 },
        createdAt: Date.now(),
        messageID: 'msg1',
        partID: 'part1',
        callID: 'call1',
      };

      expect(event.id).toBe('progress-1');
      expect(event.title).toBe('Processing file');
      expect(event.status).toBe('pending');
      expect(event.diffStats?.added).toBe(10);
    });

    it('should accept SubagentSummary with all fields', () => {
      const summary: SubagentSummary = {
        id: 'subagent-1',
        parentSessionId: 'session-1',
        parentMessageId: 'msg1',
        childSessionId: 'child-session-1',
        agentId: 'agent-1',
        providerID: 'provider-1',
        modelID: 'model-1',
        startedAt: Date.now(),
        endedAt: Date.now() + 1000,
        durationMs: 1000,
        status: 'running',
        latestActivity: 'Processing',
        references: [{ messageID: 'msg1' }],
      };

      expect(summary.id).toBe('subagent-1');
      expect(summary.status).toBe('running');
      expect(summary.durationMs).toBe(1000);
    });

    it('should accept SubagentDetail with all fields', () => {
      const detail: SubagentDetail = {
        id: 'subagent-1',
        parentSessionId: 'session-1',
        parentMessageId: 'msg1',
        status: 'running',
        latestActivity: 'Processing',
        references: [],
        thinkingEvents: [
          {
            id: 'thought-1',
            text: 'Thinking',
            createdAt: Date.now(),
          },
        ],
        progressEvents: [
          {
            id: 'progress-1',
            title: 'Step 1',
            status: 'done',
            createdAt: Date.now(),
          },
        ],
        timelineEvents: [
          {
            key: 'event-1',
            type: 'test',
            label: 'Test event',
            createdAt: Date.now(),
          },
        ],
        tokenUsage: {
          input: 1000,
          output: 2000,
          reasoning: 500,
          cache: { read: 100, write: 50 },
        },
        errorText: undefined,
        hydrationUnavailable: false,
      };

      expect(detail.thinkingEvents).toHaveLength(1);
      expect(detail.progressEvents).toHaveLength(1);
      expect(detail.timelineEvents).toHaveLength(1);
      expect(detail.tokenUsage?.input).toBe(1000);
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

      expect(tracker['detailsById'].size).toBeGreaterThan(0);

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

    it('should return most recent message ID', () => {
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
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'subtask',
            id: 'part-2',
            sessionID: 'session-1',
            messageID: 'msg2',
            agent: 'test-agent',
          },
        },
      });

      const result = tracker.getLatestParentMessageId('session-1');
      expect(result).toBe('msg2');
    });
  });

  describe('seedFromMessages', () => {
    it('should load subagents from messages', () => {
      const messages = [
        {
          role: 'assistant',
          info: {
            id: 'msg1',
            sessionID: 'session-1',
          },
          subagents: [
            {
              id: 'subagent-1',
              status: 'done',
              latestActivity: 'Completed task',
              references: [{ messageID: 'msg1' }],
              thinkingEvents: [],
              progressEvents: [],
              timelineEvents: [],
            },
          ],
        },
      ];

      tracker.seedFromMessages(messages);

      expect(tracker['detailsById'].size).toBe(1);
      expect(tracker['detailsById'].has('subagent-1')).toBe(true);
    });

    it('should filter out non-assistant messages', () => {
      const messages = [
        {
          role: 'user',
          info: {
            id: 'msg1',
            sessionID: 'session-1',
          },
          subagents: [
            {
              id: 'subagent-1',
              status: 'done',
              latestActivity: 'Completed',
              references: [],
              thinkingEvents: [],
              progressEvents: [],
              timelineEvents: [],
            },
          ],
        },
      ];

      tracker.seedFromMessages(messages);

      expect(tracker['detailsById'].size).toBe(0);
    });

    it('should handle missing message ID gracefully', () => {
      const messages = [
        {
          role: 'assistant',
          info: {
            sessionID: 'session-1',
          },
          subagents: [],
        },
      ];

      expect(() => tracker.seedFromMessages(messages)).not.toThrow();
    });

    it('should reset existing state before seeding', () => {
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

      expect(tracker['detailsById'].size).toBeGreaterThan(0);

      tracker.seedFromMessages([]);

      expect(tracker['detailsById'].size).toBe(0);
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
      const subagentId = Object.keys(result?.detailsById || {})[0];
      expect(subagentId).toBeTruthy();
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

    it('should ignore events from inactive sessions', () => {
      tracker.setActiveSession('session-1');

      const result = tracker.consumeStreamEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'subtask',
            id: 'part-1',
            sessionID: 'different-session',
            messageID: 'msg1',
            agent: 'test-agent',
          },
        },
      });

      expect(result).toBeNull();
    });

    it('should add timeline events', () => {
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
            type: 'reasoning',
            id: 'part-2',
            sessionID: 'child-session-1',
            messageID: 'msg2',
            reasoning: 'Thinking',
          },
        },
      });

      expect(result).not.toBeNull();
      const detail = Object.values(result?.detailsById || {})[0] as SubagentDetail;
      expect(detail.timelineEvents.length).toBeGreaterThan(0);
    });

    it('should update subagent status to running', () => {
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
            type: 'reasoning',
            id: 'part-2',
            sessionID: 'child-session-1',
            messageID: 'msg2',
            reasoning: 'Thinking',
          },
        },
      });

      const detail = Object.values(result?.detailsById || {})[0] as SubagentDetail;
      expect(detail.status).toBe('running');
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

    it('should ignore child sessions from different parent', () => {
      tracker.setActiveSession('session-1');

      const result = tracker.consumeStreamEvent({
        type: 'session.created',
        properties: {
          info: {
            id: 'child-session-1',
            parentID: 'different-session',
            time: { created: Date.now() },
          },
        },
      });

      expect(result).toBeNull();
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

  describe('finalizeParentMessage', () => {
    it('should return empty array when no subagents', async () => {
      const client = {};
      const result = await tracker.finalizeParentMessage({
        client,
        parentSessionId: 'session-1',
        parentMessageId: 'msg1',
      });

      expect(result).toEqual([]);
    });

    it('should mark hydration unavailable when client missing children function', async () => {
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

      const client = {};
      const result = await tracker.finalizeParentMessage({
        client,
        parentSessionId: 'session-1',
        parentMessageId: 'msg1',
      });

      expect(result).toHaveLength(1);
      expect(result[0].hydrationUnavailable).toBe(true);
    });

    it('should hydrate from child session data', async () => {
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

      const client = {
        session: {
          children: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'child-session-1',
                parentID: 'session-1',
                time: {
                  created: Date.now(),
                  updated: Date.now() + 1000,
                },
              },
            ],
          }),
          messages: vi.fn().mockResolvedValue({
            data: [
              {
                info: {
                  role: 'assistant',
                  providerID: 'provider-1',
                  modelID: 'model-1',
                  tokens: {
                    input: 1000,
                    output: 2000,
                    reasoning: 500,
                  },
                  time: {
                    created: Date.now(),
                    completed: Date.now() + 1000,
                  },
                  finish: 'done',
                },
              },
            ],
          }),
        },
      };

      const result = await tracker.finalizeParentMessage({
        client,
        parentSessionId: 'session-1',
        parentMessageId: 'msg1',
      });

      expect(result).toHaveLength(1);
      expect(result[0].childSessionId).toBe('child-session-1');
      expect(result[0].providerID).toBe('provider-1');
      expect(result[0].modelID).toBe('model-1');
      expect(result[0].tokenUsage?.input).toBe(1000);
    });

    it('should handle API errors gracefully', async () => {
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

      const client = {
        session: {
          children: vi.fn().mockResolvedValue({
            error: 'API Error',
          }),
        },
      };

      const result = await tracker.finalizeParentMessage({
        client,
        parentSessionId: 'session-1',
        parentMessageId: 'msg1',
      });

      expect(result).toHaveLength(1);
      expect(result[0].hydrationUnavailable).toBe(true);
    });

    it('should handle network errors', async () => {
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

      const client = {
        session: {
          children: vi.fn().mockRejectedValue(new Error('Network error')),
        },
      };

      const result = await tracker.finalizeParentMessage({
        client,
        parentSessionId: 'session-1',
        parentMessageId: 'msg1',
      });

      expect(result).toHaveLength(1);
      expect(result[0].hydrationUnavailable).toBe(true);
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

    it('should handle missing startedAt', () => {
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
      const detail = Object.values(payload.detailsById)[0] as SubagentDetail;

      expect(detail.startedAt).toBeDefined();
    });

    it('should calculate ongoing duration for running subagents', () => {
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

      // Wait a bit
      const elapsed = 100;
      vi.advanceTimersByTimeAsync?.(elapsed) || new Promise(resolve => setTimeout(resolve, elapsed));

      const payload = tracker.getSnapshotPayload();
      const detail = Object.values(payload.detailsById)[0] as SubagentDetail;

      expect(detail.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Reference Management', () => {
    it('should add multiple references to subagent', () => {
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
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'tool',
            id: 'part-2',
            sessionID: 'child-session-1',
            messageID: 'msg2',
            callID: 'call-1',
            tool: 'test_tool',
            state: {
              status: 'done',
            },
          },
        },
      });

      const payload = tracker.getSnapshotPayload();
      const detail = Object.values(payload.detailsById)[0] as SubagentDetail;

      expect(detail.references.length).toBeGreaterThan(0);
      const hasMessageRef = detail.references.some((ref) => ref.messageID);
      const hasCallRef = detail.references.some((ref) => ref.callID);
      expect(hasMessageRef || hasCallRef).toBe(true);
    });

    it('should not duplicate references', () => {
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

      // Add same reference multiple times
      tracker.consumeStreamEvent({
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'reasoning',
            id: 'part-2',
            sessionID: 'session-1',
            messageID: 'msg1',
            reasoning: 'Thinking',
          },
        },
      });

      const payload = tracker.getSnapshotPayload();
      const detail = Object.values(payload.detailsById)[0] as SubagentDetail;

      // Count unique messageID references
      const msgRefCount = detail.references.filter((ref) => ref.messageID === 'msg1').length;
      expect(msgRefCount).toBe(1);
    });
  });

  describe('Event Clamping', () => {
    it('should limit timeline events to MAX_TIMELINE_EVENTS', () => {
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

      // Add many events
      for (let i = 0; i < 250; i++) {
        tracker.consumeStreamEvent({
          type: 'message.part.updated',
          properties: {
            part: {
              type: 'reasoning',
              id: `part-${i}`,
              sessionID: 'child-session-1',
              messageID: 'msg1',
              reasoning: `Thinking ${i}`,
            },
          },
        });
      }

      const payload = tracker.getSnapshotPayload();
      const detail = Object.values(payload.detailsById)[0] as SubagentDetail;

      expect(detail.timelineEvents.length).toBeLessThanOrEqual(200);
    });

    it('should limit thinking events to MAX_THINKING_EVENTS', () => {
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

      // Add many thinking events
      for (let i = 0; i < 250; i++) {
        tracker.consumeStreamEvent({
          type: 'message.part.updated',
          properties: {
            part: {
              type: 'reasoning',
              id: `part-${i}`,
              sessionID: 'child-session-1',
              messageID: 'msg1',
              reasoning: `Thinking ${i}`,
            },
          },
        });
      }

      const payload = tracker.getSnapshotPayload();
      const detail = Object.values(payload.detailsById)[0] as SubagentDetail;

      expect(detail.thinkingEvents.length).toBeLessThanOrEqual(200);
    });

    it('should limit progress events to MAX_PROGRESS_EVENTS', () => {
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

      // Add many progress events
      for (let i = 0; i < 250; i++) {
        tracker.consumeStreamEvent({
          type: 'message.part.updated',
          properties: {
            part: {
              type: 'tool',
              id: `part-${i}`,
              sessionID: 'child-session-1',
              messageID: 'msg1',
              tool: `tool-${i}`,
              state: {
                status: 'done',
              },
            },
          },
        });
      }

      const payload = tracker.getSnapshotPayload();
      const detail = Object.values(payload.detailsById)[0] as SubagentDetail;

      expect(detail.progressEvents.length).toBeLessThanOrEqual(200);
    });
  });

  describe('Token Usage Tracking', () => {
    it('should track input, output, and reasoning tokens', () => {
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
            tokens: {
              input: 1000,
              output: 2000,
              reasoning: 500,
            },
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

      expect(detail.tokenUsage?.input).toBe(1000);
      expect(detail.tokenUsage?.output).toBe(2000);
      expect(detail.tokenUsage?.reasoning).toBe(500);
    });

    it('should track cache read and write tokens', () => {
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
            tokens: {
              input: 1000,
              output: 2000,
              cache: {
                read: 100,
                write: 50,
              },
            },
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

      expect(detail.tokenUsage?.cache?.read).toBe(100);
      expect(detail.tokenUsage?.cache?.write).toBe(50);
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

    it('should handle subagent with minimal data', () => {
      const minimalDetail: SubagentDetail = {
        id: 'subagent-1',
        parentSessionId: 'session-1',
        parentMessageId: 'msg1',
        status: 'pending',
        latestActivity: 'Created',
        references: [],
        thinkingEvents: [],
        progressEvents: [],
        timelineEvents: [],
      };

      tracker['upsertDetail'](minimalDetail);

      const payload = tracker.getSnapshotPayload();
      expect(Object.keys(payload.detailsById).length).toBe(1);
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

  describe('Progress Event Status Normalization', () => {
    it('should normalize "completed" to "done"', () => {
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
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'tool',
            id: 'part-2',
            sessionID: 'child-session-1',
            messageID: 'msg2',
            tool: 'test_tool',
            state: {
              status: 'completed',
            },
          },
        },
      });

      const payload = tracker.getSnapshotPayload();
      const detail = Object.values(payload.detailsById)[0] as SubagentDetail;
      const progressEvent = detail.progressEvents[0];

      expect(progressEvent.status).toBe('done');
    });

    it('should normalize "success" to "done"', () => {
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
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'tool',
            id: 'part-2',
            sessionID: 'child-session-1',
            messageID: 'msg2',
            tool: 'test_tool',
            state: {
              status: 'success',
            },
          },
        },
      });

      const payload = tracker.getSnapshotPayload();
      const detail = Object.values(payload.detailsById)[0] as SubagentDetail;
      const progressEvent = detail.progressEvents[0];

      expect(progressEvent.status).toBe('done');
    });

    it('should normalize "failed" to "error"', () => {
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
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'tool',
            id: 'part-2',
            sessionID: 'child-session-1',
            messageID: 'msg2',
            tool: 'test_tool',
            state: {
              status: 'failed',
            },
          },
        },
      });

      const payload = tracker.getSnapshotPayload();
      const detail = Object.values(payload.detailsById)[0] as SubagentDetail;
      const progressEvent = detail.progressEvents[0];

      expect(progressEvent.status).toBe('error');
    });
  });

  describe('Reasoning Text Sanitization', () => {
    it('should filter out opaque IDs from reasoning', () => {
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
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'reasoning',
            id: 'part-2',
            sessionID: 'child-session-1',
            messageID: 'msg2',
            reasoning: 'abc123def456',
          },
        },
      });

      const payload = tracker.getSnapshotPayload();
      const detail = Object.values(payload.detailsById)[0] as SubagentDetail;

      // Should filter out opaque ID-like reasoning
      expect(detail.thinkingEvents.length).toBe(0);
    });

    it('should keep valid reasoning text', () => {
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
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'reasoning',
            id: 'part-2',
            sessionID: 'child-session-1',
            messageID: 'msg2',
            reasoning: 'Analyzing the problem and considering solutions',
          },
        },
      });

      const payload = tracker.getSnapshotPayload();
      const detail = Object.values(payload.detailsById)[0] as SubagentDetail;

      expect(detail.thinkingEvents.length).toBe(1);
      expect(detail.thinkingEvents[0].text).toBe('Analyzing the problem and considering solutions');
    });
  });

  describe('Summary vs Detail', () => {
    it('should return summary without event arrays in summaries', () => {
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
      const summary = payload.summariesByParentMessageId['msg1'][0];

      expect(summary.thinkingEvents).toBeUndefined();
      expect(summary.progressEvents).toBeUndefined();
      expect(summary.timelineEvents).toBeUndefined();
    });

    it('should return detail with event arrays in detailsById', () => {
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
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'reasoning',
            id: 'part-2',
            sessionID: 'child-session-1',
            messageID: 'msg2',
            reasoning: 'Thinking',
          },
        },
      });

      const payload = tracker.getSnapshotPayload();
      const detail = Object.values(payload.detailsById)[0] as SubagentDetail;

      expect(detail.thinkingEvents).toBeDefined();
      expect(Array.isArray(detail.thinkingEvents)).toBe(true);
      expect(detail.progressEvents).toBeDefined();
      expect(Array.isArray(detail.progressEvents)).toBe(true);
      expect(detail.timelineEvents).toBeDefined();
      expect(Array.isArray(detail.timelineEvents)).toBe(true);
    });
  });
});
