import assert from 'node:assert/strict';
import test from 'node:test';
import { LoggingCategories, LogEventTypes } from '../../src/utils/LoggingSchema.ts';

test('LoggingSchema', async (t) => {
  await t.test('LoggingCategories', async (t) => {
    await t.test('should define core categories', () => {
      // Only check for a small, stable subset of core categories
      assert.equal(LoggingCategories.EXTENSION, 'Extension');
      assert.equal(LoggingCategories.CHAT_VIEW, 'ChatView');
      assert.equal(LoggingCategories.SESSION_SERVICE, 'SessionService');
    });

    await t.test('should have consistent category format', () => {
      const categories = Object.values(LoggingCategories);
      assert.ok(categories.length >= 3, 'Should have at least core categories');

      categories.forEach(cat => {
        assert.equal(typeof cat, 'string', 'Category must be a string');
        assert.ok(cat.length > 0, 'Category must not be empty');
        assert.ok(cat === cat.trim(), 'Category must not have surrounding whitespace');
      });
    });

    await t.test('should have unique category values', () => {
      const categories = Object.values(LoggingCategories);
      const unique = new Set(categories);
      assert.equal(unique.size, categories.length, 'All category values must be unique');
    });
  });

  await t.test('LogEventTypes', async (t) => {
    await t.test('should define required event types', () => {
      // Check for core event types that are fundamental to the logging system
      assert.equal(LogEventTypes.FEATURE_START, 'feature_start');
      assert.equal(LogEventTypes.FEATURE_END, 'feature_end');
      assert.equal(LogEventTypes.STATE_CHANGE, 'state_change');
    });

    await t.test('should have lower_snake_case format', () => {
      const eventTypes = Object.values(LogEventTypes);
      const lowerSnakeCaseRegex = /^[a-z][a-z0-9_]*$/;

      eventTypes.forEach(event => {
        assert.ok(lowerSnakeCaseRegex.test(event), `Event type "${event}" must be lower_snake_case`);
      });
    });

    await t.test('should have non-empty event values', () => {
      const eventTypes = Object.values(LogEventTypes);
      eventTypes.forEach(event => {
        assert.equal(typeof event, 'string', 'Event type must be a string');
        assert.ok(event.length > 0, 'Event type must not be empty');
        assert.ok(event === event.trim(), 'Event type must not have surrounding whitespace');
      });
    });

    await t.test('should have unique event values', () => {
      const eventTypes = Object.values(LogEventTypes);
      const unique = new Set(eventTypes);
      assert.equal(unique.size, eventTypes.length, 'All event type values must be unique');
    });
  });
});
