import type { Dispatch } from 'react';

import type { AppAction } from './store';
import type { AppState, ContextItem, FileResult, Message, QueueItem, QuotaData, Session, StreamingState, StreamingStep } from './types';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asArray<T>(value: unknown, guard: (item: unknown) => item is T): T[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(guard);
}

function isFileResult(value: unknown): value is FileResult {
  const rec = asRecord(value);
  return !!rec && typeof rec.path === 'string' && typeof rec.name === 'string';
}

function isQueueItem(value: unknown): value is QueueItem {
  const rec = asRecord(value);
  return !!rec && typeof rec.text === 'string';
}

function isSession(value: unknown): value is Session {
  const rec = asRecord(value);
  return !!rec && typeof rec.id === 'string';
}

function isMessage(value: unknown): value is Message {
  const rec = asRecord(value);
  return !!rec && (typeof rec.role === 'string' || typeof rec.content === 'string' || typeof rec.text === 'string');
}

function extractMessageText(message: Message): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  if (typeof message.text === 'string') {
    return message.text;
  }
  if (Array.isArray(message.parts)) {
    return message.parts
      .map((part) => part.text ?? part.content ?? part.reasoning ?? part.thought ?? part.thinking ?? '')
      .join('')
      .trim();
  }
  return '';
}

function buildStreamingMessage(streaming: StreamingState): Message {
  return {
    role: 'assistant',
    content: streaming.content,
    parts: [
      {
        type: 'text',
        text: streaming.content
      }
    ],
    steps: streaming.steps.map((step) => ({
      type: step.type,
      title: step.title,
      content: step.filePath,
      status: step.status,
      meta: step.meta
    })),
    edits: streaming.edits.map((file) => ({ file })),
    info: {
      id: streaming.messageId ?? undefined,
      duration: streaming.usage?.duration
    }
  };
}

function handleStreamEvent(
  dispatch: Dispatch<AppAction>,
  getState: () => AppState,
  payload: UnknownRecord
): void {
  const eventType = asString(payload.type) || asString(payload.event) || asString(payload.kind);
  const state = getState();
  const current = state.streaming;
  const messageId = asString(payload.messageId) || asString(payload.id) || current?.messageId || null;

  if (!current && eventType !== 'start' && eventType !== 'streamStart') {
    dispatch({
      type: 'SET_STREAMING',
      payload: {
        messageId,
        content: '',
        reasoning: '',
        steps: [],
        edits: [],
        isActive: true
      }
    });
  }

  switch (eventType) {
    case 'message.part.updated': {
      const part = asRecord(payload.part) ?? asRecord(payload.properties);
      if (!part) {
        dispatch({ type: 'SET_PROCESSING', payload: true });
        break;
      }

      const textChunk =
        asString(part.text) ||
        asString(part.content) ||
        asString(part.delta) ||
        asString(part.thought) ||
        asString(part.reasoning);
      if (textChunk) {
        dispatch({ type: 'UPDATE_STREAMING_CONTENT', payload: { content: textChunk, append: true } });
      }

      const reasoningChunk = asString(part.reasoning) || asString(part.thought) || asString(part.thinking);
      if (reasoningChunk) {
        dispatch({ type: 'UPDATE_STREAMING_REASONING', payload: { reasoning: reasoningChunk, append: true } });
      }

      dispatch({ type: 'SET_PROCESSING', payload: true });
      break;
    }
    case 'message.updated': {
      const info = asRecord(payload.info) ?? asRecord(payload.properties)?.info;
      const finish = info ? asBoolean((info as UnknownRecord).finish, false) : false;
      if (finish) {
        dispatch({ type: 'FINISH_STREAMING' });
        dispatch({ type: 'SET_PROCESSING', payload: false });
      } else {
        dispatch({ type: 'SET_PROCESSING', payload: true });
      }
      break;
    }
    case 'session.error':
    case 'error': {
      dispatch({ type: 'SET_PROCESSING', payload: false });
      dispatch({ type: 'FINISH_STREAMING' });
      break;
    }
    case 'start':
    case 'streamStart': {
      dispatch({
        type: 'SET_STREAMING',
        payload: {
          messageId,
          content: '',
          reasoning: '',
          steps: [],
          edits: [],
          isActive: true
        }
      });
      dispatch({ type: 'SET_PROCESSING', payload: true });
      break;
    }
    case 'contentDelta':
    case 'content':
    case 'text':
    case 'text-delta': {
      const chunk =
        asString(payload.delta) || asString(payload.text) || asString(payload.content) || asString(payload.chunk);
      if (chunk) {
        dispatch({ type: 'UPDATE_STREAMING_CONTENT', payload: { content: chunk, append: true } });
      }
      break;
    }
    case 'reasoningDelta':
    case 'reasoning':
    case 'thinking': {
      const chunk =
        asString(payload.delta) || asString(payload.reasoning) || asString(payload.thinking) || asString(payload.text);
      if (chunk) {
        dispatch({ type: 'UPDATE_STREAMING_REASONING', payload: { reasoning: chunk, append: true } });
      }
      break;
    }
    case 'stepStart': {
      const step: StreamingStep = {
        id: asString(payload.id) || undefined,
        callID: asString(payload.callID) || undefined,
        title: asString(payload.title, 'Working'),
        type:
          asString(payload.stepType) === 'tool' || asString(payload.stepType) === 'reasoning'
            ? (asString(payload.stepType) as 'tool' | 'reasoning')
            : 'step',
        status: 'pending',
        meta: asString(payload.meta) || undefined,
        filePath: asString(payload.filePath) || undefined,
        startTime: Date.now()
      };
      dispatch({ type: 'ADD_STREAMING_STEP', payload: step });
      break;
    }
    case 'stepUpdate': {
      dispatch({
        type: 'UPDATE_STREAMING_STEP',
        payload: {
          id: asString(payload.id) || undefined,
          callID: asString(payload.callID) || undefined,
          patch: {
            title: asString(payload.title) || undefined,
            meta: asString(payload.meta) || undefined,
            filePath: asString(payload.filePath) || undefined
          }
        }
      });
      break;
    }
    case 'stepDone': {
      dispatch({
        type: 'UPDATE_STREAMING_STEP',
        payload: {
          id: asString(payload.id) || undefined,
          callID: asString(payload.callID) || undefined,
          patch: {
            status: 'done',
            duration: asOptionalNumber(payload.duration)
          }
        }
      });
      break;
    }
    case 'stepError': {
      dispatch({
        type: 'UPDATE_STREAMING_STEP',
        payload: {
          id: asString(payload.id) || undefined,
          callID: asString(payload.callID) || undefined,
          patch: {
            status: 'error',
            meta: asString(payload.error) || asString(payload.meta) || 'Failed'
          }
        }
      });
      break;
    }
    case 'edit':
    case 'fileEdit': {
      const file = asString(payload.file) || asString(payload.path);
      if (file) {
        dispatch({ type: 'ADD_STREAMING_EDIT', payload: file });
      }
      break;
    }
    case 'finish':
    case 'done': {
      dispatch({
        type: 'FINISH_STREAMING',
        payload: {
          usage: {
            total: asNumber(payload.total, 0),
            duration: asOptionalNumber(payload.duration)
          }
        }
      });
      dispatch({ type: 'SET_PROCESSING', payload: false });
      break;
    }
    default:
      break;
  }
}

export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState) {
  return (event: MessageEvent) => {
    const data = asRecord(event.data);
    if (!data) {
      return;
    }

    const type = asString(data.type);

    switch (type) {
      case 'initState':
      case 'init': {
        const state = asRecord(data.state) ?? data;
        const sessionId = asString(state.sessionId) || asString(state.currentSessionId) || null;

        const selectedModelRecord = asRecord(state.selectedModel);
        const selectedModel = selectedModelRecord
          ? {
              providerID: asString(selectedModelRecord.providerID),
              modelID: asString(selectedModelRecord.modelID)
            }
          : null;

        dispatch({ type: 'SET_SESSION_ID', payload: sessionId });
        dispatch({ type: 'SET_SERVER_STATUS', payload: asString(state.serverStatus, 'connected') });
        dispatch({ type: 'SET_SELECTED_MODEL', payload: selectedModel?.modelID ? selectedModel : null });
        dispatch({ type: 'SET_SELECTED_AGENT', payload: asString(state.selectedAgent) });
        dispatch({ type: 'SET_RECEIVED_INIT_STATE', payload: true });
        break;
      }
      case 'modelsList': {
        const models = asArray(data.models, (item): item is AppState['availableModels'][number] => {
          const rec = asRecord(item);
          return !!rec && typeof rec.modelID === 'string' && typeof rec.providerID === 'string' && typeof rec.name === 'string';
        });
        dispatch({ type: 'SET_MODELS_LIST', payload: models });
        break;
      }
      case 'agentsList': {
        const agents = asArray(data.agents, (item): item is AppState['availableAgents'][number] => {
          const rec = asRecord(item);
          return !!rec && typeof rec.id === 'string' && typeof rec.name === 'string' && typeof rec.description === 'string';
        });
        dispatch({ type: 'SET_AGENTS_LIST', payload: agents });
        break;
      }
      case 'statusUpdate': {
        dispatch({ type: 'SET_SERVER_STATUS', payload: asString(data.status, 'unknown') });
        break;
      }
      case 'messageResponse': {
        const msg = (asRecord(data.message) as Message | null) ?? (data as unknown as Message);
        const currentMessages = getState().messages;

        // FORBIDDEN TO REMOVE - token accumulation for sticky header
        dispatch({
          type: 'ACCUMULATE_SESSION_STATS',
          payload: {
            input: msg.info?.tokens?.input || 0,
            output: msg.info?.tokens?.output || 0,
            read: msg.info?.tokens?.cache?.read || 0,
            write: msg.info?.tokens?.cache?.write || 0,
            duration: msg.info?.duration || 0
          }
        });

        const streaming = getState().streaming;
        const normalizedMessage = isMessage(msg) ? msg : streaming ? buildStreamingMessage(streaming) : undefined;
        if (normalizedMessage) {
          dispatch({ type: 'SET_MESSAGES', payload: [...currentMessages, normalizedMessage] });
        }
        dispatch({ type: 'SET_PROCESSING', payload: false });
        dispatch({ type: 'SET_STREAMING', payload: null });
        break;
      }
      case 'chatHistory': {
        const messages = asArray(data.messages, isMessage);
        dispatch({ type: 'CLEAR_MESSAGES' });
        dispatch({ type: 'SET_MESSAGES', payload: messages });

        // FORBIDDEN TO REMOVE - recalculate session stats from full history
        const stats = { input: 0, output: 0, read: 0, write: 0, duration: 0 };
        messages.forEach((msg) => {
          stats.input += msg.info?.tokens?.input || 0;
          stats.output += msg.info?.tokens?.output || 0;
          stats.read += msg.info?.tokens?.cache?.read || 0;
          stats.write += msg.info?.tokens?.cache?.write || 0;
          stats.duration += msg.info?.duration || 0;
        });
        dispatch({ type: 'RESET_SESSION_STATS', payload: stats });
        break;
      }
      case 'streamEvent': {
        const payload = asRecord(data.event) ?? data;
        handleStreamEvent(dispatch, getState, payload);
        break;
      }
      case 'error': {
        dispatch({ type: 'ADD_ERROR_MESSAGE', payload: asString(data.message, 'Unknown error') });
        dispatch({ type: 'SET_PROCESSING', payload: false });
        break;
      }
      case 'appendPrompt': {
        const current = getState().inputValue;
        const extra = asString(data.text);
        const next = current ? `${current}\n${extra}` : extra;
        dispatch({ type: 'SET_INPUT_VALUE', payload: next });
        break;
      }
      case 'addContext': {
        const item = asRecord(data.context);
        if (!item) {
          break;
        }
        const context: ContextItem = {
          file: asString(item.file),
          lineInfo: asString(item.lineInfo)
        };
        if (!context.file) {
          break;
        }
        const selected = getState().selectedContexts;
        dispatch({ type: 'SET_SELECTED_CONTEXTS', payload: [...selected, context] });
        break;
      }
      case 'fileSearchResults': {
        const results = asArray(data.results, isFileResult);
        dispatch({ type: 'SET_FILE_SUGGESTIONS', payload: results });
        dispatch({ type: 'SET_SHOW_FILE_SUGGESTIONS', payload: results.length > 0 });
        dispatch({ type: 'SET_SUGGESTION_INDEX', payload: 0 });
        break;
      }
      case 'sessionsList': {
        dispatch({ type: 'SET_SESSIONS_LIST', payload: asArray(data.sessions, isSession) });
        dispatch({ type: 'SET_SESSION_ID', payload: asString(data.currentSessionId) || null });
        break;
      }
      case 'queueUpdate': {
        dispatch({ type: 'SET_QUEUE', payload: asArray(data.queue, isQueueItem) });
        break;
      }
      case 'queueExecutionStarted': {
        dispatch({ type: 'SET_EXECUTING_QUEUE', payload: true });
        break;
      }
      case 'queueExecutionFinished': {
        dispatch({ type: 'SET_EXECUTING_QUEUE', payload: false });
        break;
      }
      case 'quotaUpdate': {
        dispatch({ type: 'SET_QUOTA_DATA', payload: data.data as QuotaData });
        break;
      }
      default:
        break;
    }

    if (asBoolean(data.processing, false)) {
      dispatch({ type: 'SET_PROCESSING', payload: true });
    }

    const candidate = asRecord(data.message);
    if (candidate) {
      const text = extractMessageText(candidate as Message);
      if (text && asString(data.type) === 'appendPrompt') {
        const current = getState().inputValue;
        dispatch({ type: 'SET_INPUT_VALUE', payload: current ? `${current}\n${text}` : text });
      }
    }
  };
}
