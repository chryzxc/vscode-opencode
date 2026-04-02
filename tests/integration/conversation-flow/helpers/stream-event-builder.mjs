/**
 * Stream Event Builder - Fluent API for building stream event fixtures
 *
 * Provides a builder pattern for creating realistic stream events
 * that simulate OpenCode server responses during testing.
 */

/**
 * Stream Event types from the OpenCode server
 */
export const StreamEventTypes = {
  MESSAGE_PART_UPDATED: 'message.part.updated',
  MESSAGE_UPDATED: 'message.updated',
  PERMISSION_REQUEST: 'permission.request',
  SESSION_ERROR: 'session.error',
  TOOL_USE: 'tool.use',
  STRUCTURED_OUTPUT: 'structured.output',
};

/**
 * Builder for creating stream event sequences
 */
export class StreamEventBuilder {
  constructor() {
    this._events = [];
    this._currentText = '';
    this._currentParts = [];
    this._sessionId = 'test-session-123';
    this._responseId = 'test-response-123';
  }

  /**
   * Set the session ID for all events
   * @param {string} sessionId
   */
  withSessionId(sessionId) {
    this._sessionId = sessionId;
    return this;
  }

  /**
   * Set the response ID for all events
   * @param {string} responseId
   */
  withResponseId(responseId) {
    this._responseId = responseId;
    return this;
  }

  /**
   * Add a text part to the current message
   * @param {string} text - Text content
   * @param {boolean} isPartial - Whether this is partial content (default: true)
   */
  withTextPart(text, isPartial = true) {
    if (isPartial) {
      this._currentText += text;
    }

    this._currentParts.push({
      type: 'text',
      text: text,
    });

    // Create message.part.updated event
    this._events.push({
      type: StreamEventTypes.MESSAGE_PART_UPDATED,
      properties: {
        sessionId: this._sessionId,
        responseId: this._responseId,
        part: {
          type: 'text',
          text: this._currentText,
        },
      },
    });

    return this;
  }

  /**
   * Add multiple text parts in sequence (simulating streaming)
   * @param {Array<string>} textChunks - Array of text chunks
   */
  withTextChunks(textChunks) {
    textChunks.forEach(chunk => this.withTextPart(chunk, true));
    return this;
  }

  /**
   * Add a complete text part (not partial)
   * @param {string} text
   */
  withCompleteText(text) {
    this._currentText = text;
    this._currentParts.push({
      type: 'text',
      text: text,
    });

    this._events.push({
      type: StreamEventTypes.MESSAGE_PART_UPDATED,
      properties: {
        sessionId: this._sessionId,
        responseId: this._responseId,
        part: {
          type: 'text',
          text: text,
        },
      },
    });

    return this;
  }

  /**
   * Add a tool use event
   * @param {Object} tool - Tool use details
   * @param {string} tool.name - Tool name (e.g., "write", "edit")
   * @param {Object} tool.input - Tool input parameters
   * @param {string} tool.status - Tool status ("in_progress" | "done")
   */
  withToolUse(tool) {
    const toolPart = {
      type: 'tool',
      name: tool.name,
      input: tool.input || {},
      state: tool.status ? { status: tool.status } : undefined,
    };

    this._currentParts.push(toolPart);

    this._events.push({
      type: StreamEventTypes.MESSAGE_PART_UPDATED,
      properties: {
        sessionId: this._sessionId,
        responseId: this._responseId,
        part: toolPart,
      },
    });

    return this;
  }

  /**
   * Add a file write tool use event
   * @param {string} filepath - Path to write
   * @param {string} content - Content to write
   */
  withFileWrite(filepath, content) {
    return this.withToolUse({
      name: 'write',
      input: { filepath, content },
      status: 'done',
    });
  }

  /**
   * Add a file edit tool use event
   * @param {string} filepath - Path to edit
   * @param {Object} edits - Edit operations
   */
  withFileEdit(filepath, edits) {
    return this.withToolUse({
      name: 'edit',
      input: { filepath, edits },
      status: 'done',
    });
  }

  /**
   * Add structured output to the message
   * @param {Object} structuredOutput - Structured output data
   */
  withStructuredOutput(structuredOutput) {
    this._events.push({
      type: StreamEventTypes.STRUCTURED_OUTPUT,
      properties: {
        sessionId: this._sessionId,
        responseId: this._responseId,
        structured: structuredOutput,
      },
    });

    return this;
  }

  /**
   * Add a permission request event
   * @param {Object} permission - Permission request details
   */
  withPermissionRequest(permission) {
    this._events.push({
      type: StreamEventTypes.PERMISSION_REQUEST,
      properties: {
        sessionId: this._sessionId,
        responseId: this._responseId,
        ...permission,
      },
    });

    return this;
  }

  /**
   * Mark the message as complete (message.updated event)
   * @param {Object} metadata - Additional metadata
   */
  withCompletion(metadata = {}) {
    const completeMessage = {
      role: 'assistant',
      content: this._currentText,
      text: this._currentText,
      parts: this._currentParts,
      time: { created: Date.now() },
      ...metadata,
    };

    this._events.push({
      type: StreamEventTypes.MESSAGE_UPDATED,
      properties: {
        sessionId: this._sessionId,
        responseId: this._responseId,
        message: completeMessage,
        tokens: metadata.tokens || { input: 10, output: 20 },
      },
    });

    return this;
  }

  /**
   * Add token usage information
   * @param {Object} tokens - Token counts
   * @param {number} tokens.input - Input tokens
   * @param {number} tokens.output - Output tokens
   * @param {number} tokens.reasoning - Reasoning tokens
   */
  withTokenUsage(tokens) {
    // Find the last MESSAGE_UPDATED event and add tokens
    const lastEvent = this._events[this._events.length - 1];
    if (lastEvent && lastEvent.type === StreamEventTypes.MESSAGE_UPDATED) {
      lastEvent.properties.tokens = tokens;
    }

    return this;
  }

  /**
   * Add a custom event of any type
   * @param {string} eventType - Event type
   * @param {Object} properties - Event properties
   */
  withCustomEvent(eventType, properties) {
    this._events.push({
      type: eventType,
      properties: {
        sessionId: this._sessionId,
        responseId: this._responseId,
        ...properties,
      },
    });

    return this;
  }

  /**
   * Build and return the events array
   * @returns {Array} Complete stream events array
   */
  build() {
    return [...this._events];
  }

  /**
   * Reset the builder for reuse
   */
  reset() {
    this._events = [];
    this._currentText = '';
    this._currentParts = [];
    return this;
  }
}

/**
 * Convenience function to create a simple text streaming response
 * @param {string} text - Complete text response
 * @param {Object} options - Options
 * @returns {Array} Stream events
 */
export function createSimpleTextStream(text, options = {}) {
  const { sessionId = 'test-session-123', responseId = 'test-response-123' } = options;

  return new StreamEventBuilder()
    .withSessionId(sessionId)
    .withResponseId(responseId)
    .withCompleteText(text)
    .withCompletion()
    .build();
}

/**
 * Convenience function to create a chunked text streaming response
 * @param {Array<string>} chunks - Text chunks in order
 * @param {Object} options - Options
 * @returns {Array} Stream events
 */
export function createChunkedTextStream(chunks, options = {}) {
  const { sessionId = 'test-session-123', responseId = 'test-response-123' } = options;

  const builder = new StreamEventBuilder()
    .withSessionId(sessionId)
    .withResponseId(responseId);

  chunks.forEach(chunk => builder.withTextPart(chunk, true));

  return builder
    .withCompletion()
    .build();
}

/**
 * Convenience function to create a tool use response
 * @param {string} toolName - Name of the tool
 * @param {Object} toolInput - Tool input parameters
 * @param {string} responseText - Text response before/after tool use
 * @returns {Array} Stream events
 */
export function createToolUseStream(toolName, toolInput, responseText = '') {
  const builder = new StreamEventBuilder();

  if (responseText) {
    builder.withCompleteText(responseText);
  }

  return builder
    .withToolUse({
      name: toolName,
      input: toolInput,
      status: 'done',
    })
    .withCompletion()
    .build();
}

/**
 * Convenience function to create a multi-turn conversation stream
 * @param {Array<Array<string>>} turns - Array of text chunks for each turn
 * @returns {Array} Stream events for all turns
 */
export function createMultiTurnStream(turns) {
  const allEvents = [];

  turns.forEach((chunks, turnIndex) => {
    const sessionId = `test-session-${turnIndex}`;
    const responseId = `test-response-${turnIndex}`;

    const builder = new StreamEventBuilder()
      .withSessionId(sessionId)
      .withResponseId(responseId);

    chunks.forEach(chunk => builder.withTextPart(chunk, true));

    allEvents.push(...builder.withCompletion().build());
  });

  return allEvents;
}
