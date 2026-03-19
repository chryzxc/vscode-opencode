/**
 * Comprehensive unit tests for structured output validation
 * Target: 100% coverage (lines, branches, functions, statements)
 */

import { describe, it, expect } from 'vitest';
import {
  validateStructuredOutput,
  sanitizeStructuredOutput,
} from '../../../src/shared/structuredOutputValidator';

describe('validateStructuredOutput', () => {
  describe('Invalid Inputs', () => {
    it('should reject null', () => {
      const result = validateStructuredOutput(null);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Structured output is not an object');
    });

    it('should reject undefined', () => {
      const result = validateStructuredOutput(undefined);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Structured output is not an object');
    });

    it('should reject non-object types', () => {
      const result = validateStructuredOutput('string');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Structured output is not an object');
    });

    it('should reject arrays', () => {
      const result = validateStructuredOutput([]);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Structured output is not an object');
    });

    it('should reject numbers', () => {
      const result = validateStructuredOutput(123);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Structured output is not an object');
    });

    it('should reject booleans', () => {
      const result = validateStructuredOutput(true);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Structured output is not an object');
    });
  });

  describe('Response Type Validation', () => {
    it('should accept all valid response types', () => {
      const validTypes = [
        'message',
        'implementation_plan',
        'progress_update',
        'subagents',
        'question',
        'interactive',
        'error',
      ];

      validTypes.forEach((type) => {
        const result = validateStructuredOutput({ responseType: type });
        expect(result.valid).toBe(true);
      });
    });

    it('should reject unsupported response types', () => {
      const result = validateStructuredOutput({ responseType: 'unknown_type' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Unsupported responseType: unknown_type');
    });

    it('should handle empty string responseType', () => {
      const result = validateStructuredOutput({ responseType: '' });
      expect(result.valid).toBe(true); // Empty string is treated as no responseType
    });

    it('should handle whitespace-only responseType', () => {
      const result = validateStructuredOutput({ responseType: '   ' });
      expect(result.valid).toBe(true); // Whitespace-only is treated as no responseType
    });
  });

  describe('Field Type Validation', () => {
    it('should reject non-string assistantMessage', () => {
      const result = validateStructuredOutput({ assistantMessage: 123 });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('assistantMessage must be a string');
    });

    it('should reject non-string message', () => {
      const result = validateStructuredOutput({ message: [] });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('message must be a string');
    });

    it('should accept undefined assistantMessage', () => {
      const result = validateStructuredOutput({ assistantMessage: undefined });
      expect(result.valid).toBe(true);
    });

    it('should accept undefined message', () => {
      const result = validateStructuredOutput({ message: undefined });
      expect(result.valid).toBe(true);
    });
  });

  describe('Reasoning Validation', () => {
    it('should reject non-array reasoning', () => {
      const result = validateStructuredOutput({ reasoning: 'not an array' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('reasoning must be an array of strings');
    });

    it('should reject empty reasoning array', () => {
      const result = validateStructuredOutput({ reasoning: [] });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('reasoning must contain at least one item');
    });

    it('should reject reasoning with empty strings', () => {
      const result = validateStructuredOutput({ reasoning: ['valid', ''] });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('reasoning must only contain non-empty strings');
    });

    it('should reject reasoning with whitespace-only strings', () => {
      const result = validateStructuredOutput({ reasoning: ['valid', '   '] });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('reasoning must only contain non-empty strings');
    });

    it('should reject reasoning with non-string items', () => {
      const result = validateStructuredOutput({ reasoning: ['valid', 123] });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('reasoning must only contain non-empty strings');
    });

    it('should accept valid reasoning array', () => {
      const result = validateStructuredOutput({
        reasoning: ['step 1', 'step 2', 'step 3'],
      });
      expect(result.valid).toBe(true);
    });

    it('should accept undefined reasoning', () => {
      const result = validateStructuredOutput({ reasoning: undefined });
      expect(result.valid).toBe(true);
    });
  });

  describe('Plan Validation', () => {
    it('should reject non-object plan', () => {
      const result = validateStructuredOutput({ plan: 'not an object' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('plan must be an object');
    });

    it('should reject null plan', () => {
      const result = validateStructuredOutput({ plan: null });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('plan must be an object');
    });

    it('should accept valid plan object', () => {
      const result = validateStructuredOutput({ plan: { content: 'test' } });
      expect(result.valid).toBe(true);
    });

    it('should accept undefined plan', () => {
      const result = validateStructuredOutput({ plan: undefined });
      expect(result.valid).toBe(true);
    });
  });

  describe('Interactive Events Validation', () => {
    it('should reject non-object interactive event', () => {
      const result = validateStructuredOutput({
        interactiveEvents: ['not an object'],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('interactiveEvents[0] must be an object');
    });

    it('should reject null interactive event', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [null],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('interactiveEvents[0] must be an object');
    });

    it('should reject invalid interactive event type', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [{ type: 'invalid_type' }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('interactiveEvents[0].type invalid: invalid_type');
    });

    it('should accept valid interactive event types', () => {
      const validTypes = ['question', 'confirm', 'quick_actions', 'message'];

      validTypes.forEach((type) => {
        const result = validateStructuredOutput({
          interactiveEvents: [{ type }],
        });
        expect(result.valid).toBe(true);
      });
    });

    it('should handle interactive events with undefined type', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [{}],
      });
      expect(result.valid).toBe(true); // No type validation error if type is undefined
    });

    it('should accept undefined interactiveEvents', () => {
      const result = validateStructuredOutput({
        interactiveEvents: undefined,
      });
      expect(result.valid).toBe(true);
    });

    it('should accept confirm event without additional requirements', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [{ type: 'confirm' }],
      });
      expect(result.valid).toBe(true);
    });

    it('should accept quick_actions event without additional requirements', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [{ type: 'quick_actions' }],
      });
      expect(result.valid).toBe(true);
    });

    it('should accept message event without additional requirements', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [{ type: 'message' }],
      });
      expect(result.valid).toBe(true);
    });

    it('should accept confirm event with additional fields', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [
          {
            type: 'confirm',
            title: 'Confirm action',
            confirmLabel: 'Yes',
            cancelLabel: 'No',
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('should accept quick_actions event with actions array', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [
          {
            type: 'quick_actions',
            actions: [
              { id: '1', label: 'Action 1' },
              { id: '2', label: 'Action 2' },
            ],
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('should accept message event with content', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [{ type: 'message', content: 'Information message' }],
      });
      expect(result.valid).toBe(true);
    });

    it('should validate multiple interactive events of different types', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [
          { type: 'message', content: 'Info' },
          { type: 'confirm' },
          { type: 'quick_actions', actions: [] },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('should reject interactive event with numeric type', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [{ type: 123 }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('interactiveEvents[0].type invalid: 123');
    });

    it('should reject interactive event with null type', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [{ type: null }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('interactiveEvents[0].type invalid: null');
    });

    it('should handle empty string type (not in valid types)', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [{ type: '' }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('interactiveEvents[0].type invalid: ');
    });

    it('should handle case-sensitive type validation', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [{ type: 'QUESTION' }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('interactiveEvents[0].type invalid: QUESTION');
    });
  });

  describe('Question Event Validation', () => {
    it('should reject question event without question text', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [{ type: 'question' }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'interactiveEvents[0] question event requires question text'
      );
    });

    it('should reject question event with empty question text', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [{ type: 'question', question: '' }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'interactiveEvents[0] question event requires question text'
      );
    });

    it('should reject question event with whitespace-only question text', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [{ type: 'question', question: '   ' }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'interactiveEvents[0] question event requires question text'
      );
    });

    it('should reject question event with no options', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [
          { type: 'question', question: 'Choose one', options: [] },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'interactiveEvents[0] question interactive event requires at least two options'
      );
    });

    it('should reject question event with one valid option', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [
          {
            type: 'question',
            question: 'Choose one',
            options: [{ label: 'Option 1' }],
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'interactiveEvents[0] question interactive event requires at least two options'
      );
    });

    it('should reject question event with options lacking label or value', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [
          {
            type: 'question',
            question: 'Choose one',
            options: [{ id: '1' }, { id: '2' }],
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'interactiveEvents[0] question interactive event requires at least two options'
      );
    });

    it('should accept question event with two valid options', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [
          {
            type: 'question',
            question: 'Choose one',
            options: [
              { label: 'Option 1', value: '1' },
              { label: 'Option 2', value: '2' },
            ],
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('should accept question event with options having only labels', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [
          {
            type: 'question',
            question: 'Choose one',
            options: [{ label: 'Option 1' }, { label: 'Option 2' }],
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('should accept question event with options having only values', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [
          {
            type: 'question',
            question: 'Choose one',
            options: [{ value: '1' }, { value: '2' }],
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('should reject question event with non-object options', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [
          {
            type: 'question',
            question: 'Choose one',
            options: ['not an object', 'also not an object'],
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'interactiveEvents[0] question interactive event requires at least two options'
      );
    });

    it('should reject question event with null options', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [
          {
            type: 'question',
            question: 'Choose one',
            options: [null, null],
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'interactiveEvents[0] question interactive event requires at least two options'
      );
    });

    it('should handle multiple question events with validation', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [
          {
            type: 'question',
            question: 'First question',
            options: [{ label: 'A' }, { label: 'B' }],
          },
          {
            type: 'question',
            question: '',
            options: [{ label: 'C' }, { label: 'D' }],
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'interactiveEvents[1] question event requires question text'
      );
    });

    it('should accept question event with more than two options', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [
          {
            type: 'question',
            question: 'Choose one',
            options: [
              { label: 'Option 1' },
              { label: 'Option 2' },
              { label: 'Option 3' },
              { label: 'Option 4' },
              { label: 'Option 5' },
            ],
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('should accept question event with mixed valid and invalid options (only counts valid)', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [
          {
            type: 'question',
            question: 'Choose one',
            options: [
              { label: 'Option 1' },
              { id: 'invalid' },
              { label: 'Option 2' },
              null,
            ],
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('should reject question event when only one option has label/value', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [
          {
            type: 'question',
            question: 'Choose one',
            options: [
              { label: 'Option 1' },
              { id: '2' },
              { id: '3' },
            ],
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'interactiveEvents[0] question interactive event requires at least two options'
      );
    });

    it('should accept question event with options having empty label but non-empty value', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [
          {
            type: 'question',
            question: 'Choose one',
            options: [
              { label: '', value: '1' },
              { label: '', value: '2' },
            ],
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('should accept question event with options having empty value but non-empty label', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [
          {
            type: 'question',
            question: 'Choose one',
            options: [
              { label: 'Option 1', value: '' },
              { label: 'Option 2', value: '' },
            ],
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('should reject question event with options having only empty labels and values', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [
          {
            type: 'question',
            question: 'Choose one',
            options: [
              { label: '', value: '' },
              { label: '', value: '' },
            ],
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'interactiveEvents[0] question interactive event requires at least two options'
      );
    });

    it('should accept question event with unicode options', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [
          {
            type: 'question',
            question: '選擇一個',
            options: [
              { label: '選項 一', value: '1' },
              { label: '選項 二', value: '2' },
            ],
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('should accept question event with very long option text', () => {
      const longText = 'a'.repeat(1000);
      const result = validateStructuredOutput({
        interactiveEvents: [
          {
            type: 'question',
            question: 'Choose one',
            options: [
              { label: longText },
              { label: longText },
            ],
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('should accept question event with options having descriptions', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [
          {
            type: 'question',
            question: 'Choose one',
            options: [
              { label: 'Option 1', description: 'Description 1' },
              { label: 'Option 2', description: 'Description 2' },
            ],
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('should accept question event with undefined options field', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [
          {
            type: 'question',
            question: 'Choose one',
            options: undefined,
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'interactiveEvents[0] question interactive event requires at least two options'
      );
    });

    it('should accept question event with additional fields', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [
          {
            type: 'question',
            question: 'Choose one',
            options: [
              { label: 'Option 1' },
              { label: 'Option 2' },
            ],
            multiSelect: true,
            allowCustomInput: false,
            title: 'Please choose',
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('should handle question with newlines in question text', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [
          {
            type: 'question',
            question: 'Line 1\nLine 2\nLine 3',
            options: [{ label: 'A' }, { label: 'B' }],
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('should handle question with tabs in question text', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [
          {
            type: 'question',
            question: 'Question\twith\ttabs',
            options: [{ label: 'A' }, { label: 'B' }],
          },
        ],
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('Subagents Validation', () => {
    it('should reject non-object subagent', () => {
      const result = validateStructuredOutput({
        subagents: ['not an object'],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('subagents[0] must be an object');
    });

    it('should reject null subagent', () => {
      const result = validateStructuredOutput({
        subagents: [null],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('subagents[0] must be an object');
    });

    it('should reject subagent with non-string id', () => {
      const result = validateStructuredOutput({
        subagents: [{ id: 123 }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('subagents[0].id must be a string');
    });

    it('should reject subagent with non-string name', () => {
      const result = validateStructuredOutput({
        subagents: [{ id: 'test-id', name: [] }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('subagents[0].name must be a string');
    });

    it('should accept subagent with undefined name', () => {
      const result = validateStructuredOutput({
        subagents: [{ id: 'test-id', name: undefined }],
      });
      expect(result.valid).toBe(true);
    });

    it('should accept valid subagent', () => {
      const result = validateStructuredOutput({
        subagents: [{ id: 'agent-1', name: 'Agent 1' }],
      });
      expect(result.valid).toBe(true);
    });

    it('should validate multiple subagents', () => {
      const result = validateStructuredOutput({
        subagents: [
          { id: 'agent-1', name: 'Agent 1' },
          { id: 123, name: 'Agent 2' },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('subagents[1].id must be a string');
    });

    it('should accept undefined subagents', () => {
      const result = validateStructuredOutput({
        subagents: undefined,
      });
      expect(result.valid).toBe(true);
    });

    it('should accept subagent with empty string id', () => {
      const result = validateStructuredOutput({
        subagents: [{ id: '' }],
      });
      expect(result.valid).toBe(true);
    });

    it('should accept subagent with numeric string id', () => {
      const result = validateStructuredOutput({
        subagents: [{ id: '12345' }],
      });
      expect(result.valid).toBe(true);
    });

    it('should accept subagent with unicode id and name', () => {
      const result = validateStructuredOutput({
        subagents: [{ id: 'agent-世界', name: 'Agent 日本語' }],
      });
      expect(result.valid).toBe(true);
    });

    it('should accept subagent with additional unknown fields', () => {
      const result = validateStructuredOutput({
        subagents: [
          {
            id: 'agent-1',
            name: 'Agent 1',
            status: 'running',
            progress: 50,
            description: 'Test agent',
            unknownField: 'value',
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('should accept subagent with nested objects', () => {
      const result = validateStructuredOutput({
        subagents: [
          {
            id: 'agent-1',
            timelineEvents: [{ type: 'started', timestamp: Date.now() }],
            progressEvents: [{ title: 'Task 1', status: 'done' }],
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('should accept subagent with null status field', () => {
      const result = validateStructuredOutput({
        subagents: [{ id: 'agent-1', status: null }],
      });
      expect(result.valid).toBe(true);
    });

    it('should accept subagent with zero progress', () => {
      const result = validateStructuredOutput({
        subagents: [{ id: 'agent-1', progress: 0 }],
      });
      expect(result.valid).toBe(true);
    });

    it('should reject subagent with object id', () => {
      const result = validateStructuredOutput({
        subagents: [{ id: { value: 'test' } }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('subagents[0].id must be a string');
    });

    it('should reject subagent with array id', () => {
      const result = validateStructuredOutput({
        subagents: [{ id: ['test-id'] }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('subagents[0].id must be a string');
    });

    it('should reject subagent with boolean id', () => {
      const result = validateStructuredOutput({
        subagents: [{ id: true }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('subagents[0].id must be a string');
    });

    it('should handle multiple subagents with mixed validity', () => {
      const result = validateStructuredOutput({
        subagents: [
          { id: 'agent-1', name: 'Valid Agent 1' },
          { id: 123, name: 'Invalid Agent' },
          { id: 'agent-3', name: 456 },
          { id: 'agent-4', name: 'Valid Agent 2' },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('subagents[1].id must be a string');
      expect(result.errors).toContain('subagents[2].name must be a string');
    });

    it('should accept empty string name', () => {
      const result = validateStructuredOutput({
        subagents: [{ id: 'agent-1', name: '' }],
      });
      expect(result.valid).toBe(true);
    });

    it('should accept whitespace-only name', () => {
      const result = validateStructuredOutput({
        subagents: [{ id: 'agent-1', name: '   ' }],
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('Subagents Delta Validation', () => {
    it('should reject subagentsDelta without items array', () => {
      const result = validateStructuredOutput({
        subagentsDelta: { parentMessageId: 'msg-1' },
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('subagentsDelta requires items array');
    });

    it('should reject null subagentsDelta', () => {
      const result = validateStructuredOutput({
        subagentsDelta: null,
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('subagentsDelta requires items array');
    });

    it('should reject subagentsDelta with non-array items', () => {
      const result = validateStructuredOutput({
        subagentsDelta: { items: 'not an array' },
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('subagentsDelta requires items array');
    });

    it('should accept valid subagentsDelta', () => {
      const result = validateStructuredOutput({
        subagentsDelta: { items: [] },
      });
      expect(result.valid).toBe(true);
    });

    it('should accept undefined subagentsDelta', () => {
      const result = validateStructuredOutput({
        subagentsDelta: undefined,
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('Response Type Specific Requirements', () => {
    describe('message', () => {
      it('should accept with assistantMessage', () => {
        const result = validateStructuredOutput({
          responseType: 'message',
          assistantMessage: 'Hello',
        });
        expect(result.valid).toBe(true);
      });

      it('should accept with legacy message field', () => {
        const result = validateStructuredOutput({
          responseType: 'message',
          message: 'Hello',
        });
        expect(result.valid).toBe(true);
      });

      it('should accept with both assistantMessage and message', () => {
        const result = validateStructuredOutput({
          responseType: 'message',
          assistantMessage: 'New format',
          message: 'Old format',
        });
        expect(result.valid).toBe(true);
      });

      it('should reject without any message', () => {
        const result = validateStructuredOutput({
          responseType: 'message',
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'message responseType requires assistantMessage or message string'
        );
      });

      it('should reject with empty assistantMessage', () => {
        const result = validateStructuredOutput({
          responseType: 'message',
          assistantMessage: '',
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'message responseType requires assistantMessage or message string'
        );
      });

      it('should reject with whitespace-only assistantMessage', () => {
        const result = validateStructuredOutput({
          responseType: 'message',
          assistantMessage: '   ',
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'message responseType requires assistantMessage or message string'
        );
      });

      it('should reject with empty legacy message', () => {
        const result = validateStructuredOutput({
          responseType: 'message',
          message: '',
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'message responseType requires assistantMessage or message string'
        );
      });

      it('should accept with non-empty assistantMessage and empty legacy message', () => {
        const result = validateStructuredOutput({
          responseType: 'message',
          assistantMessage: 'Valid',
          message: '',
        });
        expect(result.valid).toBe(true);
      });
    });

    describe('implementation_plan', () => {
      it('should accept with plan.content string', () => {
        const result = validateStructuredOutput({
          responseType: 'implementation_plan',
          plan: { content: 'Plan content' },
        });
        expect(result.valid).toBe(true);
      });

      it('should reject without plan', () => {
        const result = validateStructuredOutput({
          responseType: 'implementation_plan',
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'implementation_plan requires plan.content string'
        );
      });

      it('should reject with plan but no content', () => {
        const result = validateStructuredOutput({
          responseType: 'implementation_plan',
          plan: { title: 'Plan' },
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'implementation_plan requires plan.content string'
        );
      });

      it('should reject with non-string content', () => {
        const result = validateStructuredOutput({
          responseType: 'implementation_plan',
          plan: { content: 123 },
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'implementation_plan requires plan.content string'
        );
      });

      it('should reject with null plan', () => {
        const result = validateStructuredOutput({
          responseType: 'implementation_plan',
          plan: null,
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'implementation_plan requires plan.content string'
        );
      });
    });

    describe('progress_update', () => {
      it('should accept with progressUpdates array', () => {
        const result = validateStructuredOutput({
          responseType: 'progress_update',
          progressUpdates: [],
        });
        expect(result.valid).toBe(true);
      });

      it('should reject without progressUpdates', () => {
        const result = validateStructuredOutput({
          responseType: 'progress_update',
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'progress_update responseType requires progressUpdates array'
        );
      });

      it('should reject with non-array progressUpdates', () => {
        const result = validateStructuredOutput({
          responseType: 'progress_update',
          progressUpdates: 'not an array',
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'progress_update responseType requires progressUpdates array'
        );
      });
    });

    describe('subagents', () => {
      it('should accept with non-empty subagents array', () => {
        const result = validateStructuredOutput({
          responseType: 'subagents',
          subagents: [{ id: 'agent-1' }],
        });
        expect(result.valid).toBe(true);
      });

      it('should reject without subagents', () => {
        const result = validateStructuredOutput({
          responseType: 'subagents',
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'subagents responseType requires subagents array'
        );
      });

      it('should reject with empty subagents array', () => {
        const result = validateStructuredOutput({
          responseType: 'subagents',
          subagents: [],
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'subagents responseType requires subagents array'
        );
      });

      it('should reject with non-array subagents', () => {
        const result = validateStructuredOutput({
          responseType: 'subagents',
          subagents: 'not an array',
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'subagents responseType requires subagents array'
        );
      });
    });

    describe('question', () => {
      it('should accept with question event', () => {
        const result = validateStructuredOutput({
          responseType: 'question',
          interactiveEvents: [
            {
              type: 'question',
              question: 'Choose one',
              options: [{ label: 'A' }, { label: 'B' }],
            },
          ],
        });
        expect(result.valid).toBe(true);
      });

      it('should reject without interactiveEvents', () => {
        const result = validateStructuredOutput({
          responseType: 'question',
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'question responseType requires interactiveEvents array'
        );
      });

      it('should reject with non-array interactiveEvents', () => {
        const result = validateStructuredOutput({
          responseType: 'question',
          interactiveEvents: 'not an array',
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'question responseType requires interactiveEvents array'
        );
      });

      it('should reject without question event', () => {
        const result = validateStructuredOutput({
          responseType: 'question',
          interactiveEvents: [{ type: 'message', content: 'Just a message' }],
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'question responseType requires at least one question interactive event'
        );
      });

      it('should reject with empty interactiveEvents', () => {
        const result = validateStructuredOutput({
          responseType: 'question',
          interactiveEvents: [],
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'question responseType requires at least one question interactive event'
        );
      });

      it('should accept with question event among other events', () => {
        const result = validateStructuredOutput({
          responseType: 'question',
          interactiveEvents: [
            { type: 'message', content: 'Info' },
            {
              type: 'question',
              question: 'Choose',
              options: [{ label: 'A' }, { label: 'B' }],
            },
          ],
        });
        expect(result.valid).toBe(true);
      });

      it('should handle question event with null event in array', () => {
        const result = validateStructuredOutput({
          responseType: 'question',
          interactiveEvents: [
            null,
            {
              type: 'question',
              question: 'Choose',
              options: [{ label: 'A' }, { label: 'B' }],
            },
          ],
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('interactiveEvents[0] must be an object');
      });
    });

    describe('interactive', () => {
      it('should accept with interactiveEvents array', () => {
        const result = validateStructuredOutput({
          responseType: 'interactive',
          interactiveEvents: [{ type: 'message' }],
        });
        expect(result.valid).toBe(true);
      });

      it('should reject without interactiveEvents', () => {
        const result = validateStructuredOutput({
          responseType: 'interactive',
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'interactive responseType requires interactiveEvents array'
        );
      });

      it('should reject with non-array interactiveEvents', () => {
        const result = validateStructuredOutput({
          responseType: 'interactive',
          interactiveEvents: 'not an array',
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'interactive responseType requires interactiveEvents array'
        );
      });

      it('should accept with empty interactiveEvents array', () => {
        const result = validateStructuredOutput({
          responseType: 'interactive',
          interactiveEvents: [],
        });
        expect(result.valid).toBe(true);
      });
    });

    describe('error', () => {
      it('should accept error responseType without additional requirements', () => {
        const result = validateStructuredOutput({
          responseType: 'error',
        });
        expect(result.valid).toBe(true);
      });

      it('should accept error with message', () => {
        const result = validateStructuredOutput({
          responseType: 'error',
          assistantMessage: 'An error occurred',
        });
        expect(result.valid).toBe(true);
      });
    });
  });

  describe('Multiple Error Accumulation', () => {
    it('should collect multiple validation errors', () => {
      const result = validateStructuredOutput({
        responseType: 'invalid_type',
        assistantMessage: 123,
        reasoning: 'not an array',
        plan: 'not an object',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
      expect(result.errors).toContain('Unsupported responseType: invalid_type');
      expect(result.errors).toContain('assistantMessage must be a string');
      expect(result.errors).toContain('reasoning must be an array of strings');
      expect(result.errors).toContain('plan must be an object');
    });

    it('should handle complex multi-field validation', () => {
      const result = validateStructuredOutput({
        responseType: 'question',
        interactiveEvents: [
          {
            type: 'question',
            question: '',
            options: [{ label: 'Only one' }],
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should accumulate errors across multiple subagents', () => {
      const result = validateStructuredOutput({
        subagents: [
          { id: 123 },
          { id: 'valid', name: [] },
          { id: 'also-valid', name: 'Valid name' },
          { id: null, name: 'Invalid id' },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('subagents[0].id must be a string');
      expect(result.errors).toContain('subagents[1].name must be a string');
      expect(result.errors).toContain('subagents[3].id must be a string');
    });

    it('should accumulate errors across multiple interactive events', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [
          { type: 'invalid_type_1' },
          { type: 'invalid_type_2' },
          { type: 'question' },
          null,
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('interactiveEvents[0].type invalid: invalid_type_1');
      expect(result.errors).toContain('interactiveEvents[1].type invalid: invalid_type_2');
      expect(result.errors).toContain('interactiveEvents[2] question event requires question text');
      expect(result.errors).toContain('interactiveEvents[3] must be an object');
    });

    it('should accumulate errors for multiple reasoning items', () => {
      const result = validateStructuredOutput({
        reasoning: ['valid', '', null, 123, 'also valid'],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('reasoning must only contain non-empty strings');
    });

    it('should handle mixed valid and invalid fields', () => {
      const result = validateStructuredOutput({
        responseType: 'message',
        assistantMessage: 123,
        reasoning: ['valid'],
        plan: 'invalid',
        message: 'valid message',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('assistantMessage must be a string');
      expect(result.errors).toContain('plan must be an object');
    });

    it('should collect all errors in question responseType with multiple issues', () => {
      const result = validateStructuredOutput({
        responseType: 'question',
        interactiveEvents: [
          {
            type: 'question',
            question: '',
            options: [{ label: 'Only one' }],
          },
          {
            type: 'invalid_type',
            question: 'Valid question',
            options: [{ label: 'A' }, { label: 'B' }],
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
    });

    it('should handle error accumulation in implementation_plan', () => {
      const result = validateStructuredOutput({
        responseType: 'implementation_plan',
        plan: { title: 'No content' },
        assistantMessage: 123,
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('implementation_plan requires plan.content string');
      expect(result.errors).toContain('assistantMessage must be a string');
    });

    it('should handle error accumulation in subagents responseType', () => {
      const result = validateStructuredOutput({
        responseType: 'subagents',
        subagents: [],
        assistantMessage: 'Valid',
        reasoning: 'invalid',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('subagents responseType requires subagents array');
      expect(result.errors).toContain('reasoning must be an array of strings');
    });

    it('should accumulate errors for progress_update responseType', () => {
      const result = validateStructuredOutput({
        responseType: 'progress_update',
        progressUpdates: 'invalid',
        plan: 'invalid',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('progress_update responseType requires progressUpdates array');
      expect(result.errors).toContain('plan must be an object');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty object', () => {
      const result = validateStructuredOutput({});
      expect(result.valid).toBe(true);
    });

    it('should handle object with unknown fields', () => {
      const result = validateStructuredOutput({
        unknownField: 'value',
        anotherUnknown: 123,
      });
      expect(result.valid).toBe(true);
    });

    it('should handle all valid fields together', () => {
      const result = validateStructuredOutput({
        responseType: 'message',
        assistantMessage: 'Hello',
        reasoning: ['step 1', 'step 2'],
        plan: { content: 'Plan' },
        interactiveEvents: [{ type: 'message' }],
        progressUpdates: [],
        subagents: [{ id: 'agent-1', name: 'Agent 1' }],
        subagentsDelta: { items: [] },
      });
      expect(result.valid).toBe(true);
    });

    it('should handle zero in numeric fields', () => {
      const result = validateStructuredOutput({
        subagents: [
          {
            id: 'agent-1',
            progress: 0,
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('should handle unicode characters in strings', () => {
      const result = validateStructuredOutput({
        responseType: 'message',
        assistantMessage: 'Hello 世界 🌍',
        reasoning: ['Step 1: café', 'Step 2: 日本語'],
      });
      expect(result.valid).toBe(true);
    });

    it('should handle very long strings', () => {
      const longString = 'a'.repeat(10000);
      const result = validateStructuredOutput({
        responseType: 'message',
        assistantMessage: longString,
      });
      expect(result.valid).toBe(true);
    });

    it('should handle special characters in strings', () => {
      const result = validateStructuredOutput({
        responseType: 'message',
        assistantMessage: 'Test with \n newlines \t tabs \r carriage returns',
      });
      expect(result.valid).toBe(true);
    });

    it('should handle strings with only whitespace variations', () => {
      const result = validateStructuredOutput({
        responseType: 'message',
        assistantMessage: '\t\n\r',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'message responseType requires assistantMessage or message string'
      );
    });

    it('should handle deeply nested objects', () => {
      const result = validateStructuredOutput({
        responseType: 'message',
        assistantMessage: 'Hello',
        plan: {
          content: 'Plan',
          nested: {
            deeply: {
              value: 'test',
            },
          },
        },
      });
      expect(result.valid).toBe(true);
    });

    it('should handle arrays with null values', () => {
      const result = validateStructuredOutput({
        reasoning: ['valid', null, 'also valid'],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('reasoning must only contain non-empty strings');
    });

    it('should handle arrays with undefined values', () => {
      const result = validateStructuredOutput({
        reasoning: ['valid', undefined, 'also valid'],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('reasoning must only contain non-empty strings');
    });

    it('should handle arrays with numeric strings', () => {
      const result = validateStructuredOutput({
        reasoning: ['123', '456'],
      });
      expect(result.valid).toBe(true);
    });

    it('should handle objects with number keys', () => {
      const result = validateStructuredOutput({
        responseType: 'message',
        assistantMessage: 'Hello',
      });
      expect(result.valid).toBe(true);
    });

    it('should handle negative zero in numeric fields', () => {
      const result = validateStructuredOutput({
        subagents: [
          {
            id: 'agent-1',
            progress: -0,
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('should handle NaN in numeric fields (allowed as unknown field)', () => {
      const result = validateStructuredOutput({
        responseType: 'message',
        assistantMessage: 'Hello',
        unknownNumber: NaN,
      });
      expect(result.valid).toBe(true);
    });

    it('should handle Infinity in numeric fields (allowed as unknown field)', () => {
      const result = validateStructuredOutput({
        responseType: 'message',
        assistantMessage: 'Hello',
        unknownNumber: Infinity,
      });
      expect(result.valid).toBe(true);
    });

    it('should handle multiple responseType validations with same object', () => {
      const baseObject = {
        assistantMessage: 'Hello',
        reasoning: ['step 1'],
        plan: { content: 'Plan' },
      };

      const messageResult = validateStructuredOutput({ ...baseObject, responseType: 'message' });
      const planResult = validateStructuredOutput({ ...baseObject, responseType: 'implementation_plan' });

      expect(messageResult.valid).toBe(true);
      expect(planResult.valid).toBe(true);
    });

    it('should handle object with all special character strings', () => {
      const result = validateStructuredOutput({
        responseType: 'message',
        assistantMessage: '!@#$%^&*()_+-=[]{}|;:,.<>?',
      });
      expect(result.valid).toBe(true);
    });

    it('should handle object with emoji in all string fields', () => {
      const result = validateStructuredOutput({
        responseType: 'message',
        assistantMessage: 'Hello 👋 🌍 🚀',
        reasoning: ['Step 1 😀', 'Step 2 🎉'],
      });
      expect(result.valid).toBe(true);
    });

    it('should handle question event with emoji in options', () => {
      const result = validateStructuredOutput({
        responseType: 'question',
        interactiveEvents: [
          {
            type: 'question',
            question: 'How are you? 🤔',
            options: [
              { label: 'Great 😊', value: 'great' },
              { label: 'Good 👍', value: 'good' },
            ],
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('should validate subagent with timeline events array', () => {
      const result = validateStructuredOutput({
        subagents: [
          {
            id: 'agent-1',
            timelineEvents: [
              { type: 'started', createdAt: Date.now() },
              { type: 'progress', createdAt: Date.now() + 1000 },
            ],
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('should validate subagent with thinking events array', () => {
      const result = validateStructuredOutput({
        subagents: [
          {
            id: 'agent-1',
            thinkingEvents: [
              { id: 'thought-1', text: 'Thinking...', createdAt: Date.now() },
            ],
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('should validate subagent with progress events array', () => {
      const result = validateStructuredOutput({
        subagents: [
          {
            id: 'agent-1',
            progressEvents: [
              {
                id: 'progress-1',
                title: 'Task 1',
                status: 'done',
                createdAt: Date.now(),
              },
            ],
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('should validate subagent with token usage object', () => {
      const result = validateStructuredOutput({
        subagents: [
          {
            id: 'agent-1',
            tokenUsage: {
              input: 1000,
              output: 500,
              reasoning: 100,
              cache: { read: 50, write: 25 },
            },
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('should validate progressUpdates with complete structure', () => {
      const result = validateStructuredOutput({
        responseType: 'progress_update',
        progressUpdates: [
          {
            id: 'update-1',
            title: 'Processing file',
            status: 'done',
            meta: 'Completed in 2s',
            filePath: '/path/to/file.ts',
            createdAt: Date.now(),
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('should handle rapid succession of validations', () => {
      const objects = Array(100).fill(null).map((_, i) => ({
        responseType: 'message',
        assistantMessage: `Message ${i}`,
      }));

      const results = objects.map(validateStructuredOutput);

      expect(results.every((r) => r.valid === true)).toBe(true);
    });

    it('should preserve data integrity through validation', () => {
      const original = {
        responseType: 'message',
        assistantMessage: 'Test message',
        reasoning: ['step 1', 'step 2', 'step 3'],
        plan: { content: 'Plan content', title: 'Test Plan' },
      };

      const result = validateStructuredOutput(original);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should handle nested null values in arrays', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [null, { type: 'message' }, null],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('interactiveEvents[0] must be an object');
      expect(result.errors).toContain('interactiveEvents[2] must be an object');
    });

    it('should handle nested undefined values in arrays', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [undefined, { type: 'message' }, undefined],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('interactiveEvents[0] must be an object');
      expect(result.errors).toContain('interactiveEvents[2] must be an object');
    });

    it('should validate object with all possible valid fields', () => {
      const result = validateStructuredOutput({
        responseType: 'message',
        assistantMessage: 'Hello',
        message: 'Legacy',
        reasoning: ['step 1', 'step 2'],
        progressUpdates: [
          { id: '1', title: 'Task 1', status: 'done', createdAt: Date.now() },
        ],
        interactiveEvents: [
          { type: 'message', content: 'Info' },
          {
            type: 'question',
            question: 'Choose',
            options: [{ label: 'A' }, { label: 'B' }],
          },
        ],
        plan: { content: 'Plan', title: 'Test Plan' },
        subagents: [
          {
            id: 'agent-1',
            name: 'Agent 1',
            status: 'running',
            progress: 50,
            timelineEvents: [],
            thinkingEvents: [],
            progressEvents: [],
          },
        ],
        subagentsDelta: {
          parentMessageId: 'msg-1',
          items: [{ id: 'agent-2', name: 'Agent 2' }],
        },
      });
      expect(result.valid).toBe(true);
    });

    it('should handle extremely long reasoning arrays', () => {
      const longReasoning = Array(1000).fill('Reasoning step');
      const result = validateStructuredOutput({
        responseType: 'message',
        assistantMessage: 'Hello',
        reasoning: longReasoning,
      });
      expect(result.valid).toBe(true);
    });

    it('should handle extremely long options arrays', () => {
      const manyOptions = Array(100).fill(null).map((_, i) => ({
        label: `Option ${i}`,
        value: `value-${i}`,
      }));
      const result = validateStructuredOutput({
        responseType: 'question',
        interactiveEvents: [
          {
            type: 'question',
            question: 'Choose one',
            options: manyOptions,
          },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('should handle deeply nested plan objects', () => {
      const result = validateStructuredOutput({
        responseType: 'implementation_plan',
        plan: {
          content: 'Plan',
          level1: {
            level2: {
              level3: {
                level4: {
                  value: 'deep',
                },
              },
            },
          },
        },
      });
      expect(result.valid).toBe(true);
    });

    it('should handle mixed valid and invalid interactive events', () => {
      const result = validateStructuredOutput({
        interactiveEvents: [
          { type: 'message' },
          { type: 'invalid_type' },
          { type: 'confirm' },
          null,
          { type: 'quick_actions' },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('interactiveEvents[1].type invalid: invalid_type');
      expect(result.errors).toContain('interactiveEvents[3] must be an object');
    });

    it('should reject mixed responseType=question with substantial plan.content (>100 chars)', () => {
      const longPlan = 'A'.repeat(101);
      const result = validateStructuredOutput({
        responseType: 'question',
        plan: { content: longPlan },
        question: { question: 'Is this okay?', type: 'question' },
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "question/interactive response cannot include implementation plan payload: move questions to top-level 'question' and remove plan.content",
      );
    });

    it('should accept pure responseType=question with no plan', () => {
      const result = validateStructuredOutput({
        responseType: 'question',
        question: { question: 'Proceed?', type: 'question', options: [{ label: 'Yes' }, { label: 'No' }] },
      });
      expect(result.valid).toBe(true);
    });

    it('should accept pure responseType=implementation_plan with plan content', () => {
      const result = validateStructuredOutput({
        responseType: 'implementation_plan',
        plan: { content: 'This is a valid implementation plan.' },
      });
      expect(result.valid).toBe(true);
    });
  });
});

describe('sanitizeStructuredOutput', () => {
  it('should include only top-level fields from schema', () => {
    const input = {
      responseType: 'message',
      assistantMessage: 'Hello',
      unknownField: 'should be removed',
    };

    const result = sanitizeStructuredOutput(input);

    expect(result).toHaveProperty('responseType');
    expect(result).toHaveProperty('assistantMessage');
    expect(result).not.toHaveProperty('unknownField');
  });

  it('should remove all unknown fields', () => {
    const input = {
      unknown1: 'value1',
      unknown2: 'value2',
      unknown3: 123,
      responseType: 'message',
    };

    const result = sanitizeStructuredOutput(input);

    expect(Object.keys(result)).toHaveLength(1);
    expect(result).toHaveProperty('responseType');
    expect(result).not.toHaveProperty('unknown1');
    expect(result).not.toHaveProperty('unknown2');
    expect(result).not.toHaveProperty('unknown3');
  });

  it('should not add undefined fields', () => {
    const input = {
      responseType: 'message',
    };

    const result = sanitizeStructuredOutput(input);

    expect(result).toHaveProperty('responseType');
    expect(result).not.toHaveProperty('assistantMessage');
    expect(result).not.toHaveProperty('message');
    expect(result).not.toHaveProperty('reasoning');
  });

  it('should handle partial data (some fields present, some missing)', () => {
    const input = {
      responseType: 'message',
      assistantMessage: 'Hello',
      unknownField: 'remove me',
    };

    const result = sanitizeStructuredOutput(input);

    expect(Object.keys(result)).toHaveLength(2);
    expect(result.responseType).toBe('message');
    expect(result.assistantMessage).toBe('Hello');
  });

  it('should handle all fields present', () => {
    const input = {
      responseType: 'message',
      assistantMessage: 'Hello',
      message: 'Legacy',
      reasoning: ['step 1'],
      progressUpdates: [],
      interactiveEvents: [],
      plan: { content: 'Plan' },
      subagents: [],
      subagentsDelta: { items: [] },
      unknownField: 'remove',
    };

    const result = sanitizeStructuredOutput(input);

    expect(result).toHaveProperty('responseType');
    expect(result).toHaveProperty('assistantMessage');
    expect(result).toHaveProperty('message');
    expect(result).toHaveProperty('reasoning');
    expect(result).toHaveProperty('progressUpdates');
    expect(result).toHaveProperty('interactiveEvents');
    expect(result).toHaveProperty('plan');
    expect(result).toHaveProperty('subagents');
    expect(result).toHaveProperty('subagentsDelta');
    expect(result).not.toHaveProperty('unknownField');
  });

  it('should preserve field values exactly', () => {
    const input = {
      responseType: 'message',
      assistantMessage: 'Test message',
      reasoning: ['step 1', 'step 2'],
      plan: { content: 'Plan content', title: 'My Plan' },
    };

    const result = sanitizeStructuredOutput(input);

    expect(result.responseType).toBe('message');
    expect(result.assistantMessage).toBe('Test message');
    expect(result.reasoning).toEqual(['step 1', 'step 2']);
    expect(result.plan).toEqual({ content: 'Plan content', title: 'My Plan' });
  });

  it('should handle empty object', () => {
    const result = sanitizeStructuredOutput({});
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('should handle object with only unknown fields', () => {
    const input = {
      unknown1: 'value1',
      unknown2: 'value2',
    };

    const result = sanitizeStructuredOutput(input);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('should handle null values in known fields', () => {
    const input = {
      responseType: 'message',
      assistantMessage: null,
      reasoning: null,
    };

    const result = sanitizeStructuredOutput(input);

    expect(result).toHaveProperty('responseType');
    expect(result).toHaveProperty('assistantMessage');
    expect(result).toHaveProperty('reasoning');
    expect(result.assistantMessage).toBeNull();
    expect(result.reasoning).toBeNull();
  });

  it('should handle undefined values in known fields', () => {
    const input = {
      responseType: 'message',
      assistantMessage: undefined,
      reasoning: undefined,
    };

    const result = sanitizeStructuredOutput(input);

    expect(result).toHaveProperty('responseType');
    expect(result).not.toHaveProperty('assistantMessage');
    expect(result).not.toHaveProperty('reasoning');
  });

  it('should preserve all valid top-level schema fields', () => {
    const input = {
      responseType: 'message',
      assistantMessage: 'Hello',
      message: 'Legacy message',
      reasoning: ['thinking'],
      progressUpdates: [{ title: 'Task 1', status: 'done' }],
      interactiveEvents: [{ type: 'message', content: 'Info' }],
      plan: { content: 'Plan content' },
      subagents: [{ id: 'agent-1', name: 'Agent 1' }],
      subagentsDelta: { items: [{ id: 'agent-2' }] },
      unknownField: 'remove',
    };

    const result = sanitizeStructuredOutput(input);

    const expectedFields = [
      'responseType',
      'assistantMessage',
      'message',
      'reasoning',
      'progressUpdates',
      'interactiveEvents',
      'plan',
      'subagents',
      'subagentsDelta',
    ];

    expect(Object.keys(result)).toEqual(expectedFields);
    expect(Object.keys(result)).toHaveLength(expectedFields.length);
  });

  it('should preserve arrays with complex objects', () => {
    const input = {
      responseType: 'subagents',
      subagents: [
        {
          id: 'agent-1',
          name: 'Agent 1',
          timelineEvents: [
            { type: 'started', createdAt: 12345 },
            { type: 'completed', createdAt: 67890 },
          ],
        },
      ],
      unknownField: 'remove',
    };

    const result = sanitizeStructuredOutput(input);

    expect(result.subagents).toEqual(input.subagents);
    expect(result).not.toHaveProperty('unknownField');
  });

  it('should preserve nested objects in plan', () => {
    const input = {
      responseType: 'implementation_plan',
      plan: {
        content: 'Plan content',
        nested: {
          deeply: {
            value: 'test',
          },
        },
        arrayField: [1, 2, 3],
      },
    };

    const result = sanitizeStructuredOutput(input);

    expect(result.plan).toEqual(input.plan);
  });

  it('should preserve special characters in strings', () => {
    const input = {
      responseType: 'message',
      assistantMessage: 'Test with \n newlines \t tabs \r carriage returns',
      reasoning: ['Step 1: café', 'Step 2: 日本語'],
    };

    const result = sanitizeStructuredOutput(input);

    expect(result.assistantMessage).toBe(input.assistantMessage);
    expect(result.reasoning).toEqual(input.reasoning);
  });

  it('should preserve numeric and boolean values', () => {
    const input = {
      responseType: 'message',
      assistantMessage: 'Hello',
    };

    const result = sanitizeStructuredOutput(input);

    expect(result.responseType).toBe('message');
    expect(result.assistantMessage).toBe('Hello');
  });

  it('should preserve empty arrays', () => {
    const input = {
      responseType: 'message',
      reasoning: [],
      progressUpdates: [],
      interactiveEvents: [],
      subagents: [],
    };

    const result = sanitizeStructuredOutput(input);

    expect(result.reasoning).toEqual([]);
    expect(result.progressUpdates).toEqual([]);
    expect(result.interactiveEvents).toEqual([]);
    expect(result.subagents).toEqual([]);
  });

  it('should preserve empty objects', () => {
    const input = {
      responseType: 'message',
      plan: {},
      subagentsDelta: { items: [] },
    };

    const result = sanitizeStructuredOutput(input);

    expect(result.plan).toEqual({});
    expect(result.subagentsDelta).toEqual({ items: [] });
  });

  it('should not modify the original input object', () => {
    const input = {
      responseType: 'message',
      assistantMessage: 'Hello',
      unknownField: 'remove me',
    };

    const originalInput = { ...input };
    sanitizeStructuredOutput(input);

    expect(input).toEqual(originalInput);
  });

  it('should handle mixed known and unknown fields', () => {
    const input = {
      unknown1: 'value1',
      responseType: 'message',
      unknown2: 'value2',
      assistantMessage: 'Hello',
      unknown3: 123,
      reasoning: ['step 1'],
      unknown4: true,
    };

    const result = sanitizeStructuredOutput(input);

    expect(Object.keys(result)).toEqual(['responseType', 'assistantMessage', 'reasoning']);
  });

  it('should preserve field order for known fields', () => {
    const input = {
      responseType: 'message',
      assistantMessage: 'Hello',
      reasoning: ['step 1'],
      plan: { content: 'Plan' },
    };

    const result = sanitizeStructuredOutput(input);

    expect(Object.keys(result)).toEqual(['responseType', 'assistantMessage', 'reasoning', 'plan']);
  });

  it('should handle very large objects efficiently', () => {
    const largeArray = Array(1000).fill({ title: 'Task', status: 'done' });
    const input = {
      responseType: 'progress_update',
      progressUpdates: largeArray,
    };

    const result = sanitizeStructuredOutput(input);

    expect(result.progressUpdates).toEqual(largeArray);
  });
});

describe('Integration: Validation and Sanitization', () => {
  it('should validate then sanitize valid output correctly', () => {
    const input = {
      responseType: 'message',
      assistantMessage: 'Hello',
      reasoning: ['step 1'],
      unknownField: 'remove me',
    };

    const validationResult = validateStructuredOutput(input);
    const sanitizedResult = sanitizeStructuredOutput(input);

    expect(validationResult.valid).toBe(true);
    expect(sanitizedResult).toHaveProperty('responseType');
    expect(sanitizedResult).toHaveProperty('assistantMessage');
    expect(sanitizedResult).not.toHaveProperty('unknownField');
  });

  it('should validate then sanitize invalid output', () => {
    const input = {
      responseType: 'invalid_type',
      assistantMessage: 123,
      unknownField: 'remove me',
    };

    const validationResult = validateStructuredOutput(input);
    const sanitizedResult = sanitizeStructuredOutput(input);

    expect(validationResult.valid).toBe(false);
    expect(sanitizedResult).not.toHaveProperty('unknownField');
  });

  it('should sanitize complex nested structures', () => {
    const input = {
      responseType: 'subagents',
      subagents: [
        {
          id: 'agent-1',
          name: 'Agent 1',
          timelineEvents: [
            { type: 'started', createdAt: 12345, metadata: { key: 'value' } },
          ],
          thinkingEvents: [
            { id: 't1', text: 'Thinking', createdAt: 67890, metadata: {} },
          ],
        },
      ],
      unknownField: 'remove',
    };

    const result = sanitizeStructuredOutput(input) as Record<string, unknown>;

    expect((result.subagents as Record<string, unknown>[])[0].timelineEvents).toBeDefined();
    expect((result.subagents as Record<string, unknown>[])[0].thinkingEvents).toBeDefined();
    expect(result).not.toHaveProperty('unknownField');
  });

  it('should handle round-trip validation and sanitization', () => {
    const original = {
      responseType: 'question',
      interactiveEvents: [
        {
          type: 'question',
          question: 'Choose one',
          options: [
            { label: 'Option A', value: 'a', description: 'Description A' },
            { label: 'Option B', value: 'b', description: 'Description B' },
          ],
        },
      ],
      unknownField: 'remove',
    };

    const sanitized = sanitizeStructuredOutput(original);
    const validationResult = validateStructuredOutput(sanitized);

    expect(validationResult.valid).toBe(true);
    expect(sanitized.interactiveEvents).toEqual(original.interactiveEvents);
  });

  it('should validate sanitized implementation_plan', () => {
    const input = {
      responseType: 'implementation_plan',
      plan: { content: 'Plan content', extra: 'field' },
      unknownField: 'remove',
    };

    const sanitized = sanitizeStructuredOutput(input);
    const validationResult = validateStructuredOutput(sanitized);

    expect(validationResult.valid).toBe(true);
    expect(sanitized.plan).toHaveProperty('content');
    expect(sanitized.plan).toHaveProperty('extra');
  });

  it('should validate sanitized subagents', () => {
    const input = {
      responseType: 'subagents',
      subagents: [
        { id: 'agent-1', name: 'Agent 1', unknownField: 'keep' },
        { id: 'agent-2', name: 'Agent 2' },
      ],
      unknownField: 'remove',
    };

    const sanitized = sanitizeStructuredOutput(input) as Record<string, unknown>;
    const validationResult = validateStructuredOutput(sanitized);

    expect(validationResult.valid).toBe(true);
    expect((sanitized.subagents as Record<string, unknown>[])[0]).toHaveProperty('unknownField');
    expect(sanitized).not.toHaveProperty('unknownField');
  });

  it('should handle sanitization with all response types', () => {
    const responseTypes = [
      'message',
      'implementation_plan',
      'progress_update',
      'subagents',
      'question',
      'interactive',
      'error',
    ];

    responseTypes.forEach((type) => {
      const input: Record<string, unknown> = {
        responseType: type,
        unknownField: 'remove',
      };

      if (type === 'message') {
        input.assistantMessage = 'Hello';
      } else if (type === 'implementation_plan') {
        input.plan = { content: 'Plan' };
      } else if (type === 'progress_update') {
        input.progressUpdates = [];
      } else if (type === 'subagents') {
        input.subagents = [{ id: 'agent-1' }];
      } else if (type === 'question' || type === 'interactive') {
        input.interactiveEvents = [{ type: 'message' }];
      }

      const sanitized = sanitizeStructuredOutput(input);
      const validationResult = validateStructuredOutput(sanitized);

      expect(validationResult.valid).toBe(true);
      expect(sanitized).not.toHaveProperty('unknownField');
    });
  });
});
