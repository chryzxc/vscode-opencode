import assert from 'node:assert/strict';
import test from 'node:test';
import { LoggingCategories, LogEventTypes } from '../../src/utils/LoggingSchema.js';

test('LoggingSchema', async (t) => {
  await t.test('LoggingCategories', async (t) => {
    await t.test('should define all required categories', () => {
      assert.equal(LoggingCategories.EXTENSION, 'Extension');
      assert.equal(LoggingCategories.CHAT_VIEW, 'ChatView');
      assert.equal(LoggingCategories.SESSION_SERVICE, 'SessionService');
      assert.equal(LoggingCategories.QUEUE_MANAGER, 'QueueManager');
      assert.equal(LoggingCategories.MODEL_AGENT_MANAGER, 'ModelAgentManager');
      assert.equal(LoggingCategories.PLAN_MANAGER, 'PlanManager');
      assert.equal(LoggingCategories.STREAM_HANDLER, 'StreamHandler');
      assert.equal(LoggingCategories.SERVER_MANAGER, 'ServerManager');
      assert.equal(LoggingCategories.UI_INTERACTION, 'UIInteraction');
      assert.equal(LoggingCategories.FEATURE_FLOW, 'FeatureFlow');
    });

    await t.test('should have consistent category format', () => {
      const categories = Object.values(LoggingCategories);
      categories.forEach(cat => {
        assert.equal(typeof cat, 'string');
        assert.ok(cat.length > 0);
        assert.ok(cat === cat.trim()); // No whitespace
      });
    });
  });

  await t.test('LogEventTypes', async (t) => {
    await t.test('should define feature flow events', () => {
      assert.equal(LogEventTypes.FEATURE_START, 'feature_start');
      assert.equal(LogEventTypes.FEATURE_END, 'feature_end');
      assert.equal(LogEventTypes.STATE_CHANGE, 'state_change');
      assert.equal(LogEventTypes.UI_ACTION, 'ui_action');
    });
  });
});
