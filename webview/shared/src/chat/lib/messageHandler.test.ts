import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Message } from './types';
import {
  normalizeMessage,
  dedupeSystemMessages,
  shouldPreferCachedSwitchMessages,
  resolveStreamingContentUpdate,
  coalesceAdjacentAssistantHistoryMessages,
} from './messageHandler';

describe('normalizeMessage - responseType handling', () => {
  it('should handle message with responseType field without throwing', () => {
    const inputMessage: Message = {
      role: 'assistant',
      content: 'Test message with responseType',
      responseType: 'question',
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should return a message without throwing');
    assert.strictEqual(result?.role, 'assistant');
    assert.strictEqual(result?.content, 'Test message with responseType');
  });

  it('should handle message with both responseType and structuredOutput.responseType', () => {
    const inputMessage: Message = {
      role: 'assistant',
      content: 'Test message',
      responseType: 'implementation_plan',
      structuredOutput: {
        responseType: 'question',
        message: 'Test question',
        interactiveEvents: [],
      }
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should return a message');
    const resultRecord = result as Record<string, unknown>;
    assert.ok(resultRecord.responseType || resultRecord.structuredOutput, 'Should handle responseType fields');
  });
});

describe('normalizeMessage - structuredOutput handling', () => {
  it('should preserve structuredOutput field when present', () => {
    const inputMessage: Message = {
      role: 'assistant',
      content: 'Test message',
      structuredOutput: {
        responseType: 'question',
        message: 'Test question',
        interactiveEvents: [{
          type: 'question',
          id: 'test-1',
          question: 'What is your favorite color?',
          options: [
            { id: 'red', label: 'Red', value: 'red' },
            { id: 'blue', label: 'Blue', value: 'blue' }
          ],
          multiSelect: false,
          allowCustomInput: true
        }]
      }
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should return a message');
    assert.strictEqual(result?.role, 'assistant');
    assert.strictEqual(result?.content, 'Test message');

    const normalizedRecord = result as Record<string, unknown>;
    assert.ok(normalizedRecord.structuredOutput, 'structuredOutput should be preserved');
    assert.strictEqual(
      (normalizedRecord.structuredOutput as Record<string, unknown>).responseType,
      'question',
      'structuredOutput.responseType should be preserved'
    );
  });

  it('should handle message without structuredOutput', () => {
    const inputMessage: Message = {
      role: 'assistant',
      content: 'Regular message without structured output',
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should return a message');
    assert.strictEqual(result?.role, 'assistant');
    assert.strictEqual(result?.content, 'Regular message without structured output');

    const normalizedRecord = result as Record<string, unknown>;
    assert.ok(
      !normalizedRecord.structuredOutput,
      'structuredOutput should not exist when not present in input'
    );
  });

  it('should preserve other message fields alongside structuredOutput', () => {
    const inputMessage: Message = {
      role: 'assistant',
      content: 'Test message',
      parts: [{ type: 'text', text: 'Test message' }],
      structuredOutput: {
        responseType: 'question',
        message: 'Test question',
        interactiveEvents: [{
          type: 'question',
          id: 'test-3',
          question: 'Choose option',
          options: [
            { id: 'a', label: 'Option A', value: 'a' },
            { id: 'b', label: 'Option B', value: 'b' }
          ],
          multiSelect: false,
          allowCustomInput: false
        }]
      },
      reasoningEvents: [
        { text: 'Thinking step 1', createdAt: 1000 },
        { text: 'Thinking step 2', createdAt: 2000 }
      ]
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should return a message');
    assert.ok(
      (result as Record<string, unknown>).structuredOutput,
      'structuredOutput should be preserved'
    );
    assert.ok(
      Array.isArray(result?.reasoningEvents) && result?.reasoningEvents.length === 2,
      'reasoningEvents should also be preserved'
    );
    assert.ok(
      Array.isArray(result?.parts) && result?.parts.length === 1,
      'parts should be preserved'
    );
  });

  it('should preserve canonical final content while backfilling structuredOutput from streaming state', () => {
    const inputMessage: Message = {
      role: 'assistant',
      content: 'Canonical final content',
    };

    const streaming = {
      messageId: 'test-msg-1',
      content: 'Streaming draft that should not replace the final assistant reply',
      reasoning: '',
      reasoningEvents: [],
      steps: [],
      progressEvents: [],
      edits: [],
      isActive: false,
      modelID: 'test-model',
      providerID: 'test-provider',
      structuredOutput: {
        responseType: 'question',
        message: 'Test question',
        interactiveEvents: [{
          type: 'question',
          id: 'test-4',
          question: 'Select one',
          options: [
            { id: 'x', label: 'X', value: 'x' },
            { id: 'y', label: 'Y', value: 'y' }
          ],
          multiSelect: false,
          allowCustomInput: false
        }]
      }
    };

    const result = normalizeMessage(inputMessage, streaming);

    assert.ok(result, 'normalizeMessage should return a message');
    assert.strictEqual(
      result?.content,
      'Canonical final content',
      'should keep the canonical finalized assistant content'
    );
    assert.ok(
      (result as Record<string, unknown>).structuredOutput,
      'structuredOutput should still be preserved when backfilled from streaming'
    );
  });

  it('should prefer the canonical structured payload over conflicting structuredOutput reasoning payload', () => {
    const inputMessage = {
      id: 'msg-canonical-structured',
      role: 'assistant',
      content: '**Preparing for MCQ response**\n\nI see see that I that I need need to respond...',
      structured: {
        responseType: 'question',
        question: {
          type: 'question',
          question: 'Which kind of questions would you like?',
          displayPrompt: 'Which kind of questions would you like?',
          options: [
            { id: 'fun', label: 'Fun', value: 'Fun' },
            { id: 'trivia', label: 'Trivia', value: 'Trivia' },
          ],
        },
      },
      structuredOutput: {
        responseType: 'message',
        message: '**Preparing for MCQ response**\n\nI see see that I that I need need to respond...',
      },
    } as Message & {
      structured?: {
        responseType?: string;
        question?: {
          type?: string;
          question?: string;
          displayPrompt?: string;
          options?: Array<{ id?: string; label: string; value?: string }>;
        };
      };
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should return a message');
    const normalizedRecord = result as Record<string, unknown>;
    const normalizedStructured = normalizedRecord.structuredOutput as Record<string, unknown> | undefined;
    assert.ok(normalizedStructured, 'normalized structuredOutput should exist');
    assert.strictEqual(
      normalizedStructured?.responseType,
      'question',
      'canonical structured payload should win over conflicting structuredOutput',
    );
    assert.ok(
      normalizedStructured?.question && typeof normalizedStructured.question === 'object',
      'canonical question payload should be preserved',
    );
    assert.strictEqual(
      (normalizedStructured?.question as Record<string, unknown>).question,
      'Which kind of questions would you like?',
      'canonical question text should be preserved',
    );
  });

  it('should keep the canonical question turn when coalescing an adjacent reasoning follow-up', () => {
    const questionTurn: Message = normalizeMessage(
      {
        id: 'msg-question-turn',
        role: 'assistant',
        structuredOutput: {
          responseType: 'question',
          question: {
            question: 'If you could instantly master one skill, which would you choose?',
            displayPrompt: 'If you could instantly master one skill, which would you choose?',
            options: [
              { id: 'instrument', label: 'Play Any Instrument', value: 'Play Any Instrument' },
              { id: 'language', label: 'Speak Every Language', value: 'Speak Every Language' },
            ],
          },
        },
        parts: [
          {
            type: 'text',
            text: 'If you could instantly master one skill, which would you choose?',
          },
        ],
      } as Message,
      null,
    ) as Message;

    const reasoningFollowUp: Message = normalizeMessage(
      {
        id: 'evt-reasoning-follow-up',
        role: 'assistant',
        content:
          '**Preparing for MCQ response**\n\nI see see that I that I need need to respond to respond quickly quickly with a tool call.',
        structuredOutput: {
          responseType: 'message',
          message:
            '**Preparing for MCQ response**\n\nI see see that I that I need need to respond to respond quickly quickly with a tool call.',
        },
        reasoningEvents: [
          {
            text:
              '**Preparing for MCQ response**\n\nI see that I need to respond quickly with a tool call.',
            createdAt: 1780640073646,
          },
        ],
      } as Message,
      null,
    ) as Message;

    const result = coalesceAdjacentAssistantHistoryMessages([
      questionTurn,
      reasoningFollowUp,
    ]);

    assert.strictEqual(result.length, 1, 'adjacent assistant burst should collapse into one message');
    assert.strictEqual(
      result[0]?.content,
      'If you could instantly master one skill, which would you choose?',
      'the canonical question turn should win over the reasoning follow-up',
    );
    assert.strictEqual(
      result[0]?.responseType,
      'question',
      'the coalesced message should remain a question turn',
    );
  });

  it('should keep the exact MCQ question turn instead of the following reasoning-only assistant burst', () => {
    const questionTurn: Message = normalizeMessage(
      {
        id: 'msg_e9669f5b6001F5iwvqqDX5Xm7x',
        role: 'assistant',
        agent: 'build',
        modelID: 'gpt-5.4',
        providerID: 'openai',
        time: {
          created: 1780639987126,
          completed: 1780640002793,
        },
        finish: 'tool-calls',
        structuredOutput: {
          responseType: 'question',
          question: {
            question: "Pick a question category, and I’ll ask you multiple-choice questions in that style.",
            displayPrompt: "Pick a question category, and I’ll ask you multiple-choice questions in that style.",
            type: 'question',
            options: [
              { label: 'Fun', value: 'Ask me fun multiple-choice questions.' },
              { label: 'Personality', value: 'Ask me personality multiple-choice questions.' },
              { label: 'Would You Rather', value: 'Ask me would-you-rather questions with choices.' },
              { label: 'Trivia', value: 'Ask me trivia questions with choices.' },
            ],
          },
        },
        parts: [
          {
            snapshot: '7ab719279a4d68707a87366c6806e0286950572c',
            type: 'text',
            id: 'prt_e966a02950012RY7xjRWYugNb5',
            sessionID: 'ses_16996583dffed6VXEMFd7eaZh9',
            messageID: 'msg_e9669f5b6001F5iwvqqDX5Xm7x',
            text: "Pick a question category, and I’ll ask you multiple-choice questions in that style.",
          },
        ],
      } as Message,
      null,
    ) as Message;

    const reasoningFollowUp: Message = normalizeMessage(
      {
        id: 'evt_e966b3956001Zh5RZ6n47GoiBd',
        role: 'assistant',
        content:
          '**Preparing for MCQ response**\n\nI see see that I that I need need to respond to respond quickly quickly with a tool call. Since with a tool call. Since the the user has user has responded to responded to my previous my previous question question,it, it seems likely seems likely they\'ll they\'ll continue continue with with fun fun multiple multiple-choice-choice questions questions..I I think think I I’ll’ll employ employ Structured Structured Output Output once once again again to to format format the question properly the question properly..This This way way,,I I can can make make sure my sure my answer answer is is clear clear and and engaging engaging for for the the user user!Let\'s! Let\'s get get going going with with that that!!',
        parts: [
          {
            type: 'text',
            text:
              '**Preparing for MCQ response**\n\nI see see that I that I need need to respond to respond quickly quickly with a tool call. Since with a tool call. Since the the user has user has responded to responded to my previous my previous question question,it, it seems likely seems likely they\'ll they\'ll continue continue with with fun fun multiple multiple-choice-choice questions questions..I I think think I I’ll’ll employ employ Structured Structured Output Output once once again again to to format format the question properly the question properly..This This way way,,I I can can make make sure my sure my answer answer is is clear clear and and engaging engaging for for the the user user!Let\'s! Let\'s get get going going with with that that!!',
          },
        ],
        reasoningEvents: [
          {
            text:
              '**Preparing for MCQ response**\n\nI see that I need to respond quickly with a tool call. Since the user has responded to my previous question, it seems likely they\'ll continue with fun multiple-choice questions. I think I’ll employ StructuredOutput once again to format the question properly. This way, I can make sure my answer is clear and engaging for the user! Let\'s get going with that!',
            createdAt: 1780640073646,
          },
        ],
        structuredOutput: {
          responseType: 'message',
          message:
            '**Preparing for MCQ response**\n\nI see see that I that I need need to respond to respond quickly quickly with a tool call. Since with a tool call. Since the the user has user has responded to responded to my previous my previous question question,it, it seems likely seems likely they\'ll they\'ll continue continue with with fun fun multiple multiple-choice-choice questions questions..I I think think I I’ll’ll employ employ Structured Structured Output Output once once again again to to format format the question properly the question properly..This This way way,,I I can can make make sure my sure my answer answer is is clear clear and and engaging engaging for for the the user user!Let\'s! Let\'s get get going going with with that that!!',
        },
      } as Message,
      null,
    ) as Message;

    const result = coalesceAdjacentAssistantHistoryMessages([
      questionTurn,
      reasoningFollowUp,
    ]);

    assert.strictEqual(result.length, 1, 'the assistant burst should collapse into one rendered turn');
    assert.strictEqual(
      result[0]?.content,
      "Pick a question category, and I’ll ask you multiple-choice questions in that style.",
      'the visible assistant body should stay on the question prompt',
    );
    assert.strictEqual(
      result[0]?.responseType,
      'question',
      'the collapsed turn should remain a question turn',
    );
    assert.ok(
      !String(result[0]?.content ?? '').includes('Preparing for MCQ response'),
      'reasoning text should not become the visible assistant response',
    );
  });

  it('should prefer structured question text over leaked reasoning text for question turns', () => {
    const inputMessage: Message = {
      id: 'msg-question-reasoning-leak',
      role: 'assistant',
      content: 'The user is repeating themselves. They seem to want me to ask another one.',
      structuredOutput: {
        responseType: 'question',
        question: {
          question: 'Which option should I ask the user to choose?',
          displayPrompt: 'Running question',
          options: [
            { id: 'opt-a', label: 'Option A', value: 'Option A' },
            { id: 'opt-b', label: 'Option B', value: 'Option B' },
          ],
        },
        interactiveEvents: [{
          type: 'question',
          id: 'q-leak',
          title: 'Question',
          question: 'Which option should I ask the user to choose?',
          options: [
            { id: 'opt-a', label: 'Option A', value: 'Option A' },
            { id: 'opt-b', label: 'Option B', value: 'Option B' },
          ],
          multiSelect: false,
          allowCustomInput: false,
        }],
      },
      parts: [
        {
          type: 'text',
          text: 'The user is repeating themselves. They seem to want me to ask another one.',
        },
      ],
    };

    const streaming = {
      messageId: 'msg-question-reasoning-leak',
      content: 'The user is repeating themselves. They seem to want me to ask another one.',
      reasoning: 'The user is repeating themselves. They seem to want me to ask another one.',
      reasoningEvents: [
        {
          text: 'The user is repeating themselves. They seem to want me to ask another one.',
          createdAt: Date.now(),
        },
      ],
      steps: [],
      progressEvents: [],
      edits: [],
      isActive: false,
      modelID: 'test-model',
      providerID: 'test-provider',
    };

    const result = normalizeMessage(inputMessage, streaming);

    assert.ok(result, 'normalizeMessage should return a message');
    assert.strictEqual(
      result?.content,
      'Which option should I ask the user to choose?',
      'question turns should render the structured question instead of leaked reasoning text',
    );
    assert.ok(
      (result as Record<string, unknown>).structuredOutput,
      'structuredOutput should still be preserved for question turns',
    );
  });

  it('should replace long leaked draft content with the canonical structured question prompt', () => {
    const inputMessage: Message = {
      id: 'msg-question-long-leak',
      role: 'assistant',
      content: 'The user wants me to ask them questions with choices using the question tool. Let me come up with some interesting and relevant questions to ask them about their project or about software engineering in general. Since they are in a project called climateRX-2, I could ask about that. But since they did not give me a specific topic, I will ask some general software engineering questions.',
      structuredOutput: {
        responseType: 'question',
        question: {
          question: 'What kind of project is climateRX-2?',
          displayPrompt: 'Running question',
          options: [
            { id: 'opt-a', label: 'Web app', value: 'Web app' },
            { id: 'opt-b', label: 'CLI tool', value: 'CLI tool' },
          ],
        },
        interactiveEvents: [{
          type: 'question',
          id: 'q-long-leak',
          title: 'Question',
          question: 'What kind of project is climateRX-2?',
          options: [
            { id: 'opt-a', label: 'Web app', value: 'Web app' },
            { id: 'opt-b', label: 'CLI tool', value: 'CLI tool' },
          ],
          multiSelect: false,
          allowCustomInput: false,
        }],
      },
      parts: [
        {
          type: 'text',
          text: 'The user wants me to ask them questions with choices using the question tool.',
        },
      ],
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should return a message');
    assert.strictEqual(
      result?.content,
      'What kind of project is climateRX-2?',
      'question turns should prefer the structured prompt even when the draft content is long',
    );
  });

  it('should replace progress reasoning with the interactive question prompt during live streaming', () => {
    const inputMessage: Message = {
      id: 'msg-progress-interactive-question',
      role: 'assistant',
      content:
        'The user answered Tony Stark, so I should continue with a fun multiple-choice question and explain my choice in the reasoning stream.',
      structuredOutput: {
        responseType: 'progress',
        message:
          'The user answered Tony Stark, so I should continue with a fun multiple-choice question and explain my choice in the reasoning stream.',
        interactiveEvents: [
          {
            type: 'question',
            id: 'q-progress',
            title: 'Running question',
            question: "What's the most fun way to spend a surprise free day?",
            options: [
              { id: 'theme-park', label: 'Theme Park', value: 'Theme Park' },
              { id: 'beach-day', label: 'Beach Day', value: 'Beach Day' },
              { id: 'road-trip', label: 'Road Trip', value: 'Road Trip' },
              { id: 'video-games', label: 'Video Games', value: 'Video Games' },
            ],
            multiSelect: false,
            allowCustomInput: false,
          },
        ],
      },
      parts: [
        {
          type: 'text',
          text:
            'The user answered Tony Stark, so I should continue with a fun multiple-choice question and explain my choice in the reasoning stream.',
        },
      ],
    };

    const streaming = {
      messageId: 'msg-progress-interactive-question',
      content:
        'The user answered Tony Stark, so I should continue with a fun multiple-choice question and explain my choice in the reasoning stream.',
      reasoning:
        'The user answered Tony Stark, so I should continue with a fun multiple-choice question and explain my choice in the reasoning stream.',
      reasoningEvents: [
        {
          text:
            'The user answered Tony Stark, so I should continue with a fun multiple-choice question and explain my choice in the reasoning stream.',
          createdAt: Date.now(),
        },
      ],
      steps: [],
      progressEvents: [],
      edits: [],
      isActive: true,
      hasRenderableContent: true,
      modelID: 'test-model',
      providerID: 'test-provider',
      structuredOutput: {
        responseType: 'progress',
        message:
          'The user answered Tony Stark, so I should continue with a fun multiple-choice question and explain my choice in the reasoning stream.',
        interactiveEvents: [
          {
            type: 'question',
            id: 'q-progress',
            title: 'Running question',
            question: "What's the most fun way to spend a surprise free day?",
            options: [
              { id: 'theme-park', label: 'Theme Park', value: 'Theme Park' },
              { id: 'beach-day', label: 'Beach Day', value: 'Beach Day' },
              { id: 'road-trip', label: 'Road Trip', value: 'Road Trip' },
              { id: 'video-games', label: 'Video Games', value: 'Video Games' },
            ],
            multiSelect: false,
            allowCustomInput: false,
          },
        ],
      },
    };

    const result = normalizeMessage(inputMessage, streaming);

    assert.ok(result, 'normalizeMessage should return a message');
    assert.strictEqual(
      result?.content,
      "What's the most fun way to spend a surprise free day?",
      'progress turns with blocking interactive questions should render the canonical question prompt',
    );
    assert.strictEqual(
      result?.responseType,
      'progress',
      'the underlying progress response type should be preserved',
    );
  });

  it('should collapse adjacent duplicate assistant text parts during normalization', () => {
    const inputMessage: Message = {
      role: 'assistant',
      parts: [
        { type: 'text', text: 'No stashes from our session.' },
        { type: 'text', text: 'No stashes from our session.' },
      ],
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should return a message');
    assert.strictEqual(
      result?.content,
      'No stashes from our session.',
      'duplicate adjacent text parts should not be repeated in content',
    );
    assert.ok(
      Array.isArray(result?.parts) && result?.parts.length === 1,
      'duplicate adjacent text parts should be collapsed in parts',
    );
  });

  it('should trim overlapping cumulative streaming snapshots before appending', () => {
    const result = resolveStreamingContentUpdate(
      'The user wants a',
      'wants a "New feature" code question with choices.',
      true,
    );

    assert.deepStrictEqual(
      result,
      {
        content: '"New feature" code question with choices.',
        append: true,
      },
      'overlapping cumulative snapshots should only append the new suffix',
    );
  });

  it('should prefer canonical structuredOutput over truncated rawResponse structured payload', () => {
    const fullPlanContent =
      '# Plan\n\n- Setup completion rate\n- Time to first route generated\n- Add-rate of missed gems';
    const truncatedPlanContent =
      '# Plan\n\n- Setup completion rate\n- Time to first route generated\n- Add-rate of ...<truncated 940 chars>';

    const inputMessage = {
      id: 'msg-plan-precedence',
      role: 'assistant',
      responseType: 'implementation_plan',
      structuredOutput: {
        responseType: 'implementation_plan',
        plan: {
          file: 'docs/plans/tuklasia-unique-itinerary-flow-plan.md',
          content: fullPlanContent,
        },
      },
      rawResponse: {
        info: {
          structured: {
            responseType: 'implementation_plan',
            plan: {
              file: 'docs/plans/tuklasia-unique-itinerary-flow-plan.md',
              content: truncatedPlanContent,
            },
          },
        },
        parts: [],
      },
    } as Message & { rawResponse: unknown };

    const result = normalizeMessage(inputMessage, null);
    const normalized = result as Message & {
      structuredOutput?: { plan?: { content?: string } };
    };

    assert.ok(normalized, 'normalizeMessage should return a message');
    assert.ok(normalized.structuredOutput?.plan?.content, 'plan.content should exist');
    assert.strictEqual(
      normalized.structuredOutput?.plan?.content,
      fullPlanContent,
      'local structuredOutput plan.content should win over rawResponse truncated content',
    );
    assert.ok(
      !(normalized.structuredOutput?.plan?.content || '').includes('<truncated'),
      'normalized plan.content should not contain truncation markers',
    );
  });
});

describe('normalizeMessage - chatHistory regression tests', () => {
  it('should handle chatHistory messages with responseType from server', () => {
    // This is the exact scenario that was failing when switching sessions
    const chatHistoryMessage: Message = {
      id: 'ses_123_msg_1',
      role: 'assistant',
      content: 'Here is my response',
      responseType: 'text',
      timestamp: Date.now(),
    };

    const result = normalizeMessage(chatHistoryMessage, null);

    assert.ok(result, 'Should successfully normalize chatHistory message');
    assert.strictEqual(result?.id, 'ses_123_msg_1');
    assert.strictEqual(result?.role, 'assistant');
    assert.strictEqual(result?.content, 'Here is my response');
  });

  it('should handle chatHistory messages with plan and responseType', () => {
    const chatHistoryMessage: Message = {
      id: 'ses_123_msg_2',
      role: 'assistant',
      content: 'Plan content',
      responseType: 'implementation_plan',
      plan: {
        id: 'plan-1',
        summary: 'Test plan summary',
        steps: [
          { id: 'step-1', instruction: 'Step 1', status: 'pending' },
          { id: 'step-2', instruction: 'Step 2', status: 'pending' },
        ],
      },
    };

    const result = normalizeMessage(chatHistoryMessage, null);

    assert.ok(result, 'Should successfully normalize message with plan and responseType');
    assert.strictEqual(result?.role, 'assistant');
    const resultRecord = result as Record<string, unknown>;
    assert.ok(resultRecord.plan, 'Plan should be preserved');
  });

  it('should handle multiple chatHistory messages in sequence', () => {
    const messages: Message[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Create a plan',
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'Plan content',
        responseType: 'implementation_plan',
        plan: {
          id: 'plan-1',
          summary: 'Test plan',
          steps: [],
        },
      },
      {
        id: 'msg-3',
        role: 'user',
        content: 'Proceed with this plan.',
      },
      {
        id: 'msg-4',
        role: 'assistant',
        content: 'Execution started',
        responseType: 'text',
      },
    ];

    // Process all messages without throwing
    const results = messages.map(msg => normalizeMessage(msg, null));

    assert.strictEqual(results.length, 4, 'All messages should be processed');
    results.forEach((result, index) => {
      assert.ok(result, `Message ${index + 1} should be normalized successfully`);
      assert.strictEqual(result?.id, messages[index].id);
      assert.strictEqual(result?.role, messages[index].role);
    });
  });

  it('should prefer cached switch history when it contains a newer user turn', () => {
    const cachedMessages: Message[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Draft the summary',
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'Working on it',
        progressEvents: [
          { type: 'step', title: 'build', status: 'pending' },
        ],
      },
      {
        id: 'msg-3',
        role: 'user',
        content: 'Actually, include the timeline too',
      },
    ];

    const incomingMessages: Message[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Draft the summary',
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'Working on it',
        progressEvents: [
          { type: 'step', title: 'build', status: 'pending' },
          { type: 'step', title: 'search', status: 'done' },
        ],
      },
    ];

    assert.strictEqual(
      shouldPreferCachedSwitchMessages(cachedMessages, incomingMessages),
      true,
      'cached history should win when it has the newer user turn that incoming history is missing',
    );
  });

  it('should handle chatHistory messages with missing optional fields', () => {
    const minimalMessage: Message = {
      role: 'assistant',
      content: 'Simple message',
    };

    const result = normalizeMessage(minimalMessage, null);

    assert.ok(result, 'Should handle minimal message structure');
    assert.strictEqual(result?.role, 'assistant');
    assert.strictEqual(result?.content, 'Simple message');
  });

  it('should handle chatHistory messages with nested structuredOutput', () => {
    const messageWithStructuredOutput: Message = {
      id: 'msg-structured',
      role: 'assistant',
      content: 'Question for user',
      responseType: 'question',
      structuredOutput: {
        responseType: 'question',
        message: 'Please choose:',
        interactiveEvents: [{
          type: 'question',
          id: 'q-1',
          question: 'Select an option',
          options: [
            { id: 'opt1', label: 'Option 1', value: 'opt1' },
            { id: 'opt2', label: 'Option 2', value: 'opt2' },
          ],
          multiSelect: false,
          allowCustomInput: false,
        }],
      },
    };

    const result = normalizeMessage(messageWithStructuredOutput, null);

    assert.ok(result, 'Should handle message with nested responseType fields');
    const resultRecord = result as Record<string, unknown>;
    assert.ok(resultRecord.structuredOutput, 'structuredOutput should be preserved');
  });
});

describe('structuredOutput preservation - Integration Tests', () => {
  it('should ensure structuredOutput survives through full normalization pipeline', () => {
    const inputMessage: Message = {
      id: 'msg-test-1',
      role: 'assistant',
      content: 'Question for user',
      structuredOutput: {
        responseType: 'question',
        message: 'Please choose an option:',
        interactiveEvents: [{
          type: 'question',
          id: 'q1',
          title: 'Choice Required',
          question: 'Which option do you prefer?',
          options: [
            { id: 'opt1', label: 'Option 1', value: 'option1' },
            { id: 'opt2', label: 'Option 2', value: 'option2' },
            { id: 'opt3', label: 'Option 3', value: 'option3' }
          ],
          multiSelect: false,
          allowCustomInput: true
        }]
      },
      parts: [{ type: 'text', text: 'Question for user' }],
      reasoningEvents: []
    };

    // Simulate the full normalization pipeline
    const result = normalizeMessage(inputMessage, null);

    // Verify the result
    assert.ok(result, 'Result should exist');
    assert.strictEqual(result?.id, 'msg-test-1', 'Message ID should be preserved');
    assert.strictEqual(result?.role, 'assistant', 'Role should be preserved');

    // Critical: Verify structuredOutput is preserved
    const resultRecord = result as Record<string, unknown>;
    assert.ok(resultRecord.structuredOutput, 'structuredOutput must be preserved');

    const structuredOutput = resultRecord.structuredOutput as Record<string, unknown>;
    assert.strictEqual(structuredOutput.responseType, 'question', 'responseType must be preserved');
    assert.ok(Array.isArray(structuredOutput.interactiveEvents), 'interactiveEvents must be an array');
    assert.strictEqual(structuredOutput.interactiveEvents.length, 1, 'Should have one interactive event');

    const interactiveEvent = structuredOutput.interactiveEvents[0] as Record<string, unknown>;
    assert.strictEqual(interactiveEvent.type, 'question', 'Event type must be preserved');
    assert.strictEqual(interactiveEvent.id, 'q1', 'Event ID must be preserved');
    assert.strictEqual(interactiveEvent.question, 'Which option do you prefer?', 'Question text must be preserved');
    assert.ok(Array.isArray(interactiveEvent.options), 'Options must be preserved');
    assert.strictEqual(interactiveEvent.options.length, 3, 'Should have 3 options');
  });

  it('should preserve structuredOutput and backfill streamed edits when coalescing with streaming state', () => {
    const baseMessage: Message = {
      id: 'msg-base',
      role: 'assistant',
      content: 'Base message',
      structuredOutput: {
        responseType: 'question',
        message: 'Base question',
        interactiveEvents: [{
          type: 'question',
          id: 'q-base',
          question: 'Base question?',
          options: [
            { id: 'a', label: 'A', value: 'a' },
            { id: 'b', label: 'B', value: 'b' }
          ],
          multiSelect: false,
          allowCustomInput: true
        }]
      }
    };

    const streaming = {
      messageId: 'msg-stream',
      content: 'Streaming content',
      reasoning: '',
      reasoningEvents: [],
      steps: [],
      progressEvents: [],
      edits: ['src/example.ts', 'src/example.ts', 'README.md'],
      isActive: false,
      modelID: 'test-model',
      providerID: 'test-provider'
    };

    const result = normalizeMessage(baseMessage, streaming);

    assert.ok(result, 'Result should exist');
    assert.strictEqual(result?.content, 'Base message', 'Should keep finalized assistant content');

    // Critical: structuredOutput must be preserved even when final content wins
    const resultRecord = result as Record<string, unknown>;
    assert.ok(resultRecord.structuredOutput, 'structuredOutput must be preserved with streaming');

    const structuredOutput = resultRecord.structuredOutput as Record<string, unknown>;
    assert.strictEqual(structuredOutput.responseType, 'question', 'responseType must be preserved');
    assert.strictEqual(
      (structuredOutput.interactiveEvents as Array<Record<string, unknown>>)[0].id,
      'q-base',
      'Original event ID must be preserved'
    );
    assert.deepStrictEqual(
      result?.edits,
      [{ file: 'src/example.ts' }, { file: 'README.md' }],
      'Should backfill deduplicated streamed edits when the final payload omitted them'
    );
  });
});

describe('normalizeMessage - slash commands and file attachments', () => {
  it('should handle messages with slash commands', () => {
    const inputMessage: Message = {
      role: 'user',
      content: '/plan Create a new feature',
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should handle slash commands');
    assert.strictEqual(result?.role, 'user');
    assert.strictEqual(result?.content, '/plan Create a new feature');
  });

  it('should handle messages with @ mentions', () => {
    const inputMessage: Message = {
      role: 'user',
      content: '@claude help me with this code',
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should handle @ mentions');
    assert.strictEqual(result?.role, 'user');
    assert.strictEqual(result?.content, '@claude help me with this code');
  });

  it('should handle messages with both slash commands and @ mentions', () => {
    const inputMessage: Message = {
      role: 'user',
      content: '/debug @claude fix this bug',
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should handle combined commands and mentions');
    assert.strictEqual(result?.role, 'user');
    assert.strictEqual(result?.content, '/debug @claude fix this bug');
  });

  it('should handle messages with file attachments', () => {
    const inputMessage: Message = {
      role: 'user',
      content: 'Please review this file',
      attachments: [{
        id: 'file-1',
        dataUrl: 'data:text/plain;base64,SGVsbG8gV29ybGQ=',
        filename: 'example.ts',
        mimeType: 'text/plain',
      }],
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should handle file attachments');
    assert.strictEqual(result?.role, 'user');
    assert.strictEqual(result?.content, 'Please review this file');

    const resultRecord = result as Record<string, unknown>;
    assert.ok(Array.isArray(resultRecord.attachments), 'attachments should be preserved');
    assert.strictEqual(resultRecord.attachments.length, 1, 'should have one attachment');

    const attachment = resultRecord.attachments as Array<Record<string, unknown>>;
    assert.strictEqual(attachment[0].id, 'file-1', 'attachment id should be preserved');
    assert.strictEqual(attachment[0].filename, 'example.ts', 'attachment filename should be preserved');
    assert.strictEqual(attachment[0].mimeType, 'text/plain', 'attachment mimeType should be preserved');
  });

  it('should handle messages with multiple file attachments', () => {
    const inputMessage: Message = {
      role: 'user',
      content: 'Review these files',
      attachments: [
        {
          id: 'file-1',
          dataUrl: 'data:text/plain;base64,SGVsbG8=',
          filename: 'file1.ts',
          mimeType: 'text/plain',
        },
        {
          id: 'file-2',
          dataUrl: 'data:text/plain;base64,V29ybGQ=',
          filename: 'file2.ts',
          mimeType: 'text/plain',
        },
      ],
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should handle multiple file attachments');
    assert.strictEqual(result?.content, 'Review these files');

    const resultRecord = result as Record<string, unknown>;
    assert.ok(Array.isArray(resultRecord.attachments), 'attachments should be preserved');
    assert.strictEqual(resultRecord.attachments.length, 2, 'should have two attachments');
  });

  it('should handle messages with images', () => {
    const inputMessage: Message = {
      role: 'user',
      content: 'What do you see in this image?',
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='],
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should handle images');
    assert.strictEqual(result?.role, 'user');
    assert.strictEqual(result?.content, 'What do you see in this image?');

    const resultRecord = result as Record<string, unknown>;
    assert.ok(Array.isArray(resultRecord.images), 'images should be preserved');
    assert.strictEqual(resultRecord.images.length, 1, 'should have one image');
  });

  it('should handle messages with slash commands and file attachments combined', () => {
    const inputMessage: Message = {
      role: 'user',
      content: '/review Please review this code',
      attachments: [{
        id: 'file-code',
        dataUrl: 'data:text/plain;base64,Y29uc3QgeCA9IDEwOw==',
        filename: 'code.ts',
        mimeType: 'text/plain',
      }],
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should handle slash commands with file attachments');
    assert.strictEqual(result?.content, '/review Please review this code');

    const resultRecord = result as Record<string, unknown>;
    assert.ok(Array.isArray(resultRecord.attachments), 'attachments should be preserved with commands');
    assert.strictEqual(resultRecord.attachments.length, 1, 'should have one attachment with command');
  });

  it('should handle messages with @ mentions and images combined', () => {
    const inputMessage: Message = {
      role: 'user',
      content: '@claude What do you see in this screenshot?',
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='],
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should handle @ mentions with images');
    assert.strictEqual(result?.content, '@claude What do you see in this screenshot?');

    const resultRecord = result as Record<string, unknown>;
    assert.ok(Array.isArray(resultRecord.images), 'images should be preserved with mentions');
    assert.strictEqual(resultRecord.images.length, 1, 'should have one image with mention');
  });
});

describe('normalizeMessage - comprehensive integration tests', () => {
  it('should handle complex message with command, mention, and attachments', () => {
    const inputMessage: Message = {
      role: 'user',
      content: '/analyze @claude Please analyze these files',
      attachments: [
        {
          id: 'file-1',
          dataUrl: 'data:text/plain;base64,ZmlsZSAxIGNvbnRlbnQ=',
          filename: 'data.json',
          mimeType: 'application/json',
        },
        {
          id: 'file-2',
          dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
          filename: 'screenshot.png',
          mimeType: 'image/png',
        },
      ],
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='],
    };

    const result = normalizeMessage(inputMessage, null);

    assert.ok(result, 'normalizeMessage should handle complex messages');
    assert.strictEqual(result?.role, 'user');
    assert.strictEqual(result?.content, '/analyze @claude Please analyze these files');

    const resultRecord = result as Record<string, unknown>;
    assert.ok(Array.isArray(resultRecord.attachments), 'attachments should be preserved');
    assert.strictEqual(resultRecord.attachments.length, 2, 'should have two attachments');
    assert.ok(Array.isArray(resultRecord.images), 'images should be preserved');
    assert.strictEqual(resultRecord.images.length, 1, 'should have one image');
  });
});

describe('dedupeSystemMessages', () => {
  it('should return empty array for empty input', () => {
    const result = dedupeSystemMessages([]);
    assert.deepStrictEqual(result, []);
  });

  it('should return single message for single message input', () => {
    const messages: Message[] = [{
      role: 'system',
      content: '<auto-slash-command>test</auto-slash-command>',
    }];
    const result = dedupeSystemMessages(messages);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].content, '<auto-slash-command>test</auto-slash-command>');
  });

  it('should remove duplicate system messages with identical content', () => {
    const messages: Message[] = [
      {
        role: 'system',
        content: '<auto-slash-command>test</auto-slash-command>',
      },
      {
        role: 'user',
        content: 'Hello',
      },
      {
        role: 'system',
        content: '<auto-slash-command>test</auto-slash-command>',
      },
    ];
    const result = dedupeSystemMessages(messages);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].content, '<auto-slash-command>test</auto-slash-command>');
    assert.strictEqual(result[1].content, 'Hello');
  });

  it('should preserve different system messages', () => {
    const messages: Message[] = [
      {
        role: 'system',
        content: '<auto-slash-command>command1</auto-slash-command>',
      },
      {
        role: 'system',
        content: '<auto-slash-command>command2</auto-slash-command>',
      },
      {
        role: 'system',
        content: '[info] Different format',
      },
    ];
    const result = dedupeSystemMessages(messages);
    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[0].content, '<auto-slash-command>command1</auto-slash-command>');
    assert.strictEqual(result[1].content, '<auto-slash-command>command2</auto-slash-command>');
    assert.strictEqual(result[2].content, '[info] Different format');
  });

  it('should keep only first occurrence of duplicate system messages', () => {
    const messages: Message[] = [
      {
        role: 'system',
        content: '<system-reminder>First occurrence</system-reminder>',
        time: { created: 1000 },
      },
      {
        role: 'system',
        content: '<system-reminder>First occurrence</system-reminder>',
        time: { created: 2000 },
      },
      {
        role: 'system',
        content: '<system-reminder>First occurrence</system-reminder>',
        time: { created: 3000 },
      },
    ];
    const result = dedupeSystemMessages(messages);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].time?.created, 1000, 'Should keep first occurrence');
  });

  it('should not deduplicate non-system messages', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: 'Hello',
      },
      {
        role: 'assistant',
        content: 'Hi there',
      },
      {
        role: 'user',
        content: 'Hello',
      },
      {
        role: 'assistant',
        content: 'Hi there',
      },
    ];
    const result = dedupeSystemMessages(messages);
    assert.strictEqual(result.length, 4, 'Should not deduplicate non-system messages');
  });

  it('should preserve message order when deduplicating', () => {
    const messages: Message[] = [
      {
        role: 'system',
        content: '[info] Message 1',
      },
      {
        role: 'system',
        content: '[info] Message 2',
      },
      {
        role: 'system',
        content: '[info] Message 1',
      },
      {
        role: 'system',
        content: '[info] Message 3',
      },
      {
        role: 'system',
        content: '[info] Message 2',
      },
    ];
    const result = dedupeSystemMessages(messages);
    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[0].content, '[info] Message 1');
    assert.strictEqual(result[1].content, '[info] Message 2');
    assert.strictEqual(result[2].content, '[info] Message 3');
  });

  it('should deduplicate system messages with different whitespace', () => {
    const messages: Message[] = [
      {
        role: 'system',
        content: '<auto-slash-command>test</auto-slash-command>',
      },
      {
        role: 'system',
        content: '  <auto-slash-command>test</auto-slash-command>  ',
      },
      {
        role: 'system',
        content: '<auto-slash-command>test</auto-slash-command> ',
      },
    ];
    const result = dedupeSystemMessages(messages);
    assert.strictEqual(result.length, 1, 'Should deduplicate messages with different whitespace');
    assert.strictEqual(result[0].content, '<auto-slash-command>test</auto-slash-command>');
  });

  it('should deduplicate system messages with leading/trailing newlines', () => {
    const messages: Message[] = [
      {
        role: 'system',
        content: '\n[info] Test message\n',
      },
      {
        role: 'system',
        content: '[info] Test message',
      },
      {
        role: 'system',
        content: '[info] Test message\n\n',
      },
    ];
    const result = dedupeSystemMessages(messages);
    assert.strictEqual(result.length, 1, 'Should deduplicate messages with different newlines');
  });
});
