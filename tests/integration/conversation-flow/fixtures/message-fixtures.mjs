/**
 * Message Fixtures - Pre-built message data for testing
 *
 * Provides realistic message objects matching the structure used
 * in the OpenCode extension.
 */

/**
 * Creates a user message fixture
 * @param {string} text - Message text
 * @param {Object} overrides - Properties to override
 */
export function createUserMessage(text, overrides = {}) {
  return {
    role: 'user',
    content: text,
    text: text,
    parts: [
      {
        type: 'text',
        text: text,
      },
    ],
    time: {
      created: Date.now(),
    },
    ...overrides,
  };
}

/**
 * Creates an assistant message fixture
 * @param {string} text - Message text
 * @param {Object} overrides - Properties to override
 */
export function createAssistantMessage(text, overrides = {}) {
  return {
    role: 'assistant',
    content: text,
    text: text,
    parts: [
      {
        type: 'text',
        text: text,
      },
    ],
    time: {
      created: Date.now(),
    },
    ...overrides,
  };
}

/**
 * Creates a user message with file attachments
 * @param {string} text - Message text
 * @param {Array<string>} files - File paths
 */
export function createUserMessageWithFiles(text, files) {
  return createUserMessage(text, {
    files: files,
  });
}

/**
 * Creates a user message with image attachments
 * @param {string} text - Message text
 * @param {Array<string>} imageUrls - Image data URLs
 */
export function createUserMessageWithImages(text, imageUrls) {
  return createUserMessage(text, {
    images: imageUrls,
    parts: [
      {
        type: 'text',
        text: text,
      },
    ],
  });
}

/**
 * Creates an assistant message with tool use
 * @param {string} text - Message text
 * @param {Array} toolUses - Tool use parts
 */
export function createAssistantMessageWithTools(text, toolUses) {
  return {
    role: 'assistant',
    content: text,
    text: text,
    parts: [
      {
        type: 'text',
        text: text,
      },
      ...toolUses,
    ],
    time: {
      created: Date.now(),
    },
  };
}

/**
 * Creates a tool use part
 * @param {string} name - Tool name
 * @param {Object} input - Tool input
 * @param {string} status - Tool status
 */
export function createToolPart(name, input, status = 'done') {
  const part = {
    type: 'tool',
    name: name,
    input: input,
  };

  if (status) {
    part.state = { status };
  }

  return part;
}

// Pre-built fixtures for common scenarios
export const MessageFixtures = {
  // Simple user message
  userHello: createUserMessage('Hello, how are you?'),

  // Simple assistant message
  assistantGreeting: createAssistantMessage('Hello! I am doing well, thank you for asking.'),

  // User asking about React
  userReactQuestion: createUserMessage('Explain React hooks to me'),

  // Assistant explaining React
  assistantReactExplanation: createAssistantMessage(
    'React hooks are functions that let you use state and other React features in functional components.'
  ),

  // User message with file
  userWithFile: createUserMessageWithFiles(
    'Can you review this code?',
    ['src/components/Button.tsx']
  ),

  // User message with multiple files
  userWithMultipleFiles: createUserMessageWithFiles(
    'Refactor these components',
    ['src/components/Button.tsx', 'src/components/Input.tsx', 'src/components/Form.tsx']
  ),

  // Assistant with file write tool
  assistantWithWriteTool: createAssistantMessageWithTools(
    'I will create a new component for you',
    [createToolPart('write', { filepath: 'src/components/NewComponent.tsx', content: 'export default function NewComponent() {}' }, 'done')]
  ),

  // Assistant with file edit tool
  assistantWithEditTool: createAssistantMessageWithTools(
    'I have updated the component',
    [createToolPart('edit', { filepath: 'src/components/Button.tsx', edits: [{ range: { start: 0, end: 10 }, newText: 'updated code' }] }, 'done')]
  ),

  // Multi-part assistant response
  assistantMultiPart: createAssistantMessageWithTools(
    'Here is the code you requested',
    [
      createToolPart('text', 'I will create the component now'),
      createToolPart('write', { filepath: 'src/components/Example.tsx', content: 'export default function Example() {}' }, 'done'),
    ],
  ),

  // Long message for testing compaction
  longAssistantMessage: createAssistantMessage(
    'A'.repeat(1000) // Long text
  ),
};

export default MessageFixtures;
