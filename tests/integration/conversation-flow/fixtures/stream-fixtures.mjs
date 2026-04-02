/**
 * Stream Fixtures - Pre-built stream event sequences for testing
 *
 * Provides realistic stream event sequences that simulate
 * OpenCode server responses.
 */

/**
 * Creates a simple text streaming response
 * @param {string} text - Complete text to stream
 * @param {Object} options - Options
 */
export function createSimpleTextStream(text, options = {}) {
  const { sessionId = 'test-session-123', responseId = 'test-response-123' } = options;

  return [
    {
      type: 'message.part.updated',
      properties: {
        sessionId,
        responseId,
        part: {
          type: 'text',
          text: text,
        },
      },
    },
    {
      type: 'message.updated',
      properties: {
        sessionId,
        responseId,
        message: {
          role: 'assistant',
          content: text,
          text: text,
          parts: [
            {
              type: 'text',
              text: text,
            },
          ],
          time: { created: Date.now() },
        },
        tokens: { input: 10, output: text.length },
      },
    },
  ];
}

/**
 * Creates a chunked text streaming response
 * @param {Array<string>} chunks - Text chunks to stream in order
 * @param {Object} options - Options
 */
export function createChunkedStream(chunks, options = {}) {
  const { sessionId = 'test-session-123', responseId = 'test-response-123' } = options;
  const events = [];
  let fullText = '';

  // Stream each chunk
  chunks.forEach(chunk => {
    fullText += chunk;
    events.push({
      type: 'message.part.updated',
      properties: {
        sessionId,
        responseId,
        part: {
          type: 'text',
          text: fullText,
        },
      },
    });
  });

  // Final completion event
  events.push({
    type: 'message.updated',
    properties: {
      sessionId,
      responseId,
      message: {
        role: 'assistant',
        content: fullText,
        text: fullText,
        parts: [
          {
            type: 'text',
            text: fullText,
          },
        ],
        time: { created: Date.now() },
      },
      tokens: { input: 10, output: fullText.length },
    },
  });

  return events;
}

/**
 * Creates a streaming response with tool use
 * @param {string} text - Text response
 * @param {Object} tool - Tool use details
 * @param {Object} options - Options
 */
export function createToolUseStream(text, tool, options = {}) {
  const { sessionId = 'test-session-123', responseId = 'test-response-123' } = options;
  const events = [];

  // Text part
  if (text) {
    events.push({
      type: 'message.part.updated',
      properties: {
        sessionId,
        responseId,
        part: {
          type: 'text',
          text: text,
        },
      },
    });
  }

  // Tool use part
  events.push({
    type: 'message.part.updated',
    properties: {
      sessionId,
      responseId,
      part: {
        type: 'tool',
        name: tool.name,
        input: tool.input,
        state: tool.state ? { status: tool.state } : undefined,
      },
    },
  });

  // Completion
  events.push({
    type: 'message.updated',
    properties: {
      sessionId,
      responseId,
      message: {
        role: 'assistant',
        content: text,
        text: text,
        parts: [
          { type: 'text', text: text },
          { type: 'tool', name: tool.name },
        ],
        time: { created: Date.now() },
      },
      tokens: { input: 15, output: text.length + 50 },
    },
  });

  return events;
}

/**
 * Creates a streaming response with structured output
 * @param {string} text - Text response
 * @param {Object} structuredOutput - Structured output data
 * @param {Object} options - Options
 */
export function createStructuredOutputStream(text, structuredOutput, options = {}) {
  const { sessionId = 'test-session-123', responseId = 'test-response-123' } = options;

  return [
    {
      type: 'message.part.updated',
      properties: {
        sessionId,
        responseId,
        part: {
          type: 'text',
          text: text,
        },
      },
    },
    {
      type: 'structured.output',
      properties: {
        sessionId,
        responseId,
        structured: structuredOutput,
      },
    },
    {
      type: 'message.updated',
      properties: {
        sessionId,
        responseId,
        message: {
          role: 'assistant',
          content: text,
          text: text,
          parts: [{ type: 'text', text: text }],
          time: { created: Date.now() },
          structured: structuredOutput,
        },
        tokens: { input: 12, output: text.length + JSON.stringify(structuredOutput).length },
      },
    },
  ];
}

// Pre-built fixtures for common scenarios
export const StreamFixtures = {
  // Simple greeting response
  simpleGreeting: createSimpleTextStream('Hello! How can I help you today?'),

  // Chunked "thinking" response
  chunkedThinking: createChunkedStream(['Let me ', 'think about ', 'this... ', 'Got it!']),

  // Explaining React hooks (chunked)
  reactExplanation: createChunkedStream([
    'React hooks ',
    'are functions ',
    'that let you ',
    'use state ',
    'and other ',
    'React features ',
    'in functional components.',
  ]),

  // File write tool use
  writeFile: createToolUseStream(
    'I will create a new component for you',
    {
      name: 'write',
      input: {
        filepath: 'src/components/NewComponent.tsx',
        content: 'export default function NewComponent() {\n  return <div>New Component</div>;\n}',
      },
      state: 'done',
    }
  ),

  // File edit tool use
  editFile: createToolUseStream(
    'I have updated the component',
    {
      name: 'edit',
      input: {
        filepath: 'src/components/Button.tsx',
        edits: [
          {
            range: { start: 0, end: 10 },
            newText: 'export default function Button({ children, onClick }) {',
          },
        ],
      },
      state: 'done',
    }
  ),

  // Multiple tool uses
  multiTool: (() => {
    const events = [];
    const sessionId = 'test-session-123';
    const responseId = 'test-response-123';

    // Text
    events.push({
      type: 'message.part.updated',
      properties: {
        sessionId,
        responseId,
        part: { type: 'text', text: 'I will create multiple files for you' },
      },
    });

    // First tool
    events.push({
      type: 'message.part.updated',
      properties: {
        sessionId,
        responseId,
        part: {
          type: 'tool',
          name: 'write',
          input: { filepath: 'src/components/Component1.tsx', content: 'export default function Component1() {}' },
          state: { status: 'done' },
        },
      },
    });

    // Second tool
    events.push({
      type: 'message.part.updated',
      properties: {
        sessionId,
        responseId,
        part: {
          type: 'tool',
          name: 'write',
          input: { filepath: 'src/components/Component2.tsx', content: 'export default function Component2() {}' },
          state: { status: 'done' },
        },
      },
    });

    // Completion
    events.push({
      type: 'message.updated',
      properties: {
        sessionId,
        responseId,
        message: {
          role: 'assistant',
          content: 'I will create multiple files for you',
          text: 'I will create multiple files for you',
          parts: [
            { type: 'text', text: 'I will create multiple files for you' },
            { type: 'tool', name: 'write' },
            { type: 'tool', name: 'write' },
          ],
          time: { created: Date.now() },
        },
        tokens: { input: 20, output: 150 },
      },
    });

    return events;
  })(),

  // Structured output (plan)
  planStructuredOutput: createStructuredOutputStream(
    'I will help you implement this feature',
    {
      kind: 'plan',
      title: 'Feature Implementation Plan',
      status: 'ready',
      steps: [
        { id: '1', action: 'Create component', status: 'pending' },
        { id: '2', action: 'Add styling', status: 'pending' },
        { id: '3', action: 'Write tests', status: 'pending' },
      ],
    }
  ),

  // Long streaming response
  longStream: createChunkedStream(
    Array(20).fill('word ').map((word, i) => `${word}${i} `)
  ),
};

export default StreamFixtures;
