/**
 * Conversation Flow Test Suite - Main Entry Point
 *
 * Imports all test suites for comprehensive conversation flow testing.
 * Run with: npm test -- tests/integration/conversation-flow/
 */

// Import all test suites
import './suites/single-message.test.mjs';
import './suites/multi-turn-conversation.test.mjs';
import './suites/streaming-events.test.mjs';
import './suites/session-management.test.mjs';
import './suites/ui-synchronization.test.mjs';
import './suites/webview-initialization.test.mjs';
import './suites/queue-management.test.mjs';
import './suites/model-agent-selection.test.mjs';
import './suites/session-lifecycle.test.mjs';
import './suites/message-retry.test.mjs';

console.log('✅ Conversation Flow Test Suite loaded');
console.log('📊 Test suites:');
console.log('   - Single Message Flow (10 tests)');
console.log('   - Multi-Turn Conversations (10 tests)');
console.log('   - Streaming Events (11 tests)');
console.log('   - Session Management (11 tests)');
console.log('   - UI Synchronization (13 tests)');
console.log('   - Webview Initialization (13 tests)');
console.log('   - Queue Management (14 tests)');
console.log('   - Model & Agent Selection (15 tests)');
console.log('   - Session Lifecycle (17 tests)');
console.log('   - Message Retry (15 tests)');
console.log('   Total: 129 integration tests');
