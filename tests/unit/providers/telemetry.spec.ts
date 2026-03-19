import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { ChatViewProvider } from '../../../src/providers/ChatViewProvider';
import { OpencodeServerManager } from '../../../src/services/OpencodeServerManager';
import { SessionService } from '../../../src/services/SessionService';
import * as LoggerModule from '../../../src/utils/Logger';

const mockContext = {
  globalState: { get: vi.fn(), update: vi.fn(), keys: [] },
  workspaceState: { get: vi.fn(), update: vi.fn(), keys: [] },
  extensionUri: { fsPath: '/mock' } as any,
  subscriptions: [],
} as any as vscode.ExtensionContext;

const mockServerManager = { getClient: vi.fn(), getStatus: vi.fn(() => 'running'), onStatusChange: vi.fn(() => ({ dispose: vi.fn() })) } as any as OpencodeServerManager;
const mockSessionService = { getCurrentSession: vi.fn(), getMessages: vi.fn(() => []), listSessions: vi.fn(() => []) } as any as SessionService;

describe('Plan suppression telemetry', () => {
  let chat: ChatViewProvider;
  let debugSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    const stubLogger = { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() };
    vi.spyOn(LoggerModule, 'createLogger').mockReturnValue(stubLogger as any);

    chat = new ChatViewProvider(mockContext, mockServerManager, mockSessionService);
    // @ts-ignore access private
    debugSpy = (chat as any).logger.debug;
  });

  it('logs interactive-wins when structured output is interactive and plan present', () => {
    const structured = {
      responseType: 'question',
      assistantMessage: 'Question',
      interactiveEvents: [{ type: 'question', id: 'i1', question: 'Q?', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }],
      plan: { content: 'irrelevant plan content that would be suppressed' },
    } as any;

    (chat as any).normalizeStructuredOutput(structured, { source: 'test' });
    expect(debugSpy).toHaveBeenCalled();
    const call = debugSpy.mock.calls.find((c: any) => c[0] === 'Plan suppressed' && c[1]?.source === 'normalizeStructuredOutput');
    expect(call).toBeTruthy();
    const payload = call[1];
    expect(payload.reason).toBe('interactive-wins');
    expect(payload.hasInteractiveEvents).toBe(true);
  });

  it('logs clarification-detected when plan-looking content is clarification', () => {
    const body = {
      responseType: 'implementation_plan',
      assistantMessage: 'I need clarifications',
      message: 'What is the target platform?\nWhat files should be changed?\nWould you like tests?\n',
    } as any;

    (chat as any).normalizeStructuredOutput(body, { source: 'test' });
    expect(debugSpy).toHaveBeenCalled();
    const call = debugSpy.mock.calls.find((c: any) => c[0] === 'Plan suppressed' && c[1]?.source === 'normalizeStructuredOutput');
    expect(call).toBeTruthy();
    const payload = call[1];
    expect(payload.reason).toBe('clarification-detected');
    expect(payload.isClarification).toBe(true);
  });

  it('enrichMessageWithPlan strips attached plan and logs clarification-detected', () => {
    const message = {
      role: 'assistant',
      content: 'Some content',
      plan: { content: 'old plan' },
      parts: [{ type: 'text', text: 'What is the target platform?\nWhich db?\nHow many endpoints?' }],
    } as any;

    const next = (chat as any).enrichMessageWithPlan(message);
    expect(next.plan).toBeUndefined();
    const call = debugSpy.mock.calls.find((c: any) => c[0] === 'Plan suppressed' && c[1]?.source === 'enrichMessageWithPlan');
    expect(call).toBeTruthy();
    const payload = call[1];
    expect(payload.reason).toBe('clarification-detected');
    expect(payload.isClarification).toBe(true);
  });
});
