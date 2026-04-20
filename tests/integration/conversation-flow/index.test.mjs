/**
 * Conversation Flow Test Suite - Main Entry Point
 *
 * Imports active test suites for conversation flow testing.
 * These tests cover the full message lifecycle: send → stream → render.
 */

import './suites/single-message.test.mjs';
import './suites/streaming-events.test.mjs';
import './suites/ui-synchronization.test.mjs';
