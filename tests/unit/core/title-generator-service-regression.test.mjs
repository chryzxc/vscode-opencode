/**
 * TitleGeneratorService Regression Tests
 *
 * These tests prevent regressions in session title generation functionality.
 * Title generation is important for session identification and user experience.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const titleGeneratorSource = readSource(
  [joinFromRoot('src', 'services', 'TitleGeneratorService.ts')],
  'TitleGeneratorService.ts',
);

test.describe('TitleGeneratorService - Title Generation', () => {

  test('has static generateTitle method', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /class TitleGeneratorService[\s\S]*static generateTitle/s,
      'must provide static generateTitle method'
    );
  });

  test('handles empty or null input', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /generateTitle.*!message.*!message\.trim\(\).*FALLBACK_TITLE/s,
      'must return fallback title for empty input'
    );
  });

  test('uses Untitled chat as fallback', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /FALLBACK_TITLE.*Untitled chat|return.*FALLBACK_TITLE/s,
      'must use "Untitled chat" as fallback title'
    );
  });

  test('cleans message before processing', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /const cleaned = this\.cleanMessage/s,
      'must clean message before extracting key phrase'
    );
  });

  test('extracts key phrase from cleaned message', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /const keyPhrase = this\.extractKeyPhrase/s,
      'must extract key phrase from cleaned message'
    );
  });

  test('truncates title to max length', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /const truncated = this\.truncateTitle/s,
      'must truncate title to maximum length'
    );
  });

  test('logs generation process', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /log\.info.*Generated session title|originalLength|cleaned|keyPhrase|finalTitle/s,
      'must log title generation with details'
    );
  });

});

test.describe('TitleGeneratorService - Message Cleaning', () => {

  test('removes common request prefixes', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /cleanMessage[\s\S]*please|can you|help me|i need|i want/s,
      'must remove common polite request prefixes'
    );
  });

  test('removes action verb prefixes', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /cleanMessage[\s\S]*implement|create|add|fix|update|refactor|remove|delete|change|modify/s,
      'must remove action verb prefixes'
    );
  });

  test('removes leading symbols', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /cleanMessage[\s\S]*replace.*\/\^\[?!@\]/s,
      'must remove leading symbols from message'
    );
  });

  test('removes special characters', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /cleanMessage[\s\S]*replace.*\[^\w\s\-\/@\.]/g/s,
      'must remove special characters but keep essential ones'
    );
  });

  test('normalizes whitespace', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /cleanMessage[\s\S]*replace\(\/\\s\+\/g, " "\)/s,
      'must collapse multiple spaces into single space'
    );
  });

  test('trims leading/trailing whitespace', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /cleanMessage[\s\S]*\.trim\(\)/s,
      'must trim leading and trailing whitespace'
    );
  });

});

test.describe('TitleGeneratorService - Key Phrase Extraction', () => {

  test('splits message into words', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /extractKeyPhrase[\s\S]*const words = cleaned\.split\(" "\)/s,
      'must split cleaned message into words'
    );
  });

  test('returns full message if under ideal word count', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /extractKeyPhrase[\s\S]*words\.length.*IDEAL_WORD_COUNT.*return cleaned/s,
      'must return full message if within ideal word count'
    );
  });

  test('truncates to ideal word count', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /extractKeyPhrase[\s\S]*words\.slice\(0.*IDEAL_WORD_COUNT\)/s,
      'must truncate to ideal word count if exceeded'
    );
  });

  test('uses 8 words as ideal count', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /IDEAL_WORD_COUNT.*8/s,
      'must use 8 words as ideal word count'
    );
  });

});

test.describe('TitleGeneratorService - Title Truncation', () => {

  test('returns title if under max length', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /truncateTitle[\s\S]*title\.length.*MAX_TITLE_LENGTH.*return title/s,
      'must return title as-is if under max length'
    );
  });

  test('truncates long titles with ellipsis', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /truncateTitle[\s\S]*title\.slice\(0.*MAX_TITLE_LENGTH.*\.\.\./s,
      'must truncate long titles and add ellipsis'
    );
  });

  test('trims before adding ellipsis', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /truncateTitle[\s\S]*\.slice\(0.*MAX_TITLE_LENGTH.*\)\.trim\(\)/s,
      'must trim whitespace before adding ellipsis'
    );
  });

  test('uses 60 characters as max length', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /MAX_TITLE_LENGTH.*60/s,
      'must use 60 characters as maximum title length'
    );
  });

});

test.describe('TitleGeneratorService - Constants', () => {

  test('defines maximum title length constant', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /MAX_TITLE_LENGTH.*60|const.*=.*60/s,
      'must define maximum title length constant'
    );
  });

  test('defines ideal word count constant', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /IDEAL_WORD_COUNT.*8|const.*=.*8/s,
      'must define ideal word count constant'
    );
  });

  test('defines minimum title length constant', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /MIN_TITLE_LENGTH.*10|const.*=.*10/s,
      'must define minimum title length constant'
    );
  });

});

test.describe('TitleGeneratorService - Edge Cases', () => {

  test('handles message with only special characters', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /cleanMessage[\s\S]*!cleaned.*FALLBACK_TITLE/s,
      'must return fallback if cleaning produces empty string'
    );
  });

  test('handles very long words', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /truncateTitle[\s\S]*MAX_TITLE_LENGTH.*slice/s,
      'must handle very long words by truncating'
    );
  });

  test('handles message with only whitespace', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /generateTitle.*message\.trim\(\)/s,
      'must handle message with only whitespace'
    );
  });

  test('handles mixed case prefixes', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /cleanMessage.*replace.*\/i|Please|PLEASE/s,
      'must handle mixed case prefixes with case-insensitive matching'
    );
  });

});

test.describe('TitleGeneratorService - Preserved Characters', () => {

  test('preserves hyphens in titles', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /cleanMessage.*replace.*\[^\w\s\\-\/@\.]/g/s,
      'must preserve hyphens in cleaned messages'
    );
  });

  test('preserves forward slashes in titles', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /cleanMessage.*replace.*\[^\w\s\\-\/@\.]/g/s,
      'must preserve forward slashes in cleaned messages'
    );
  });

  test('preserves at symbols in titles', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /cleanMessage.*replace.*\[^\w\s\\-\/@\.]/g/s,
      'must preserve at symbols in cleaned messages'
    );
  });

  test('preserves dots in titles', () => {
    const source = titleGeneratorSource;

    assert.match(
      source,
      /cleanMessage.*replace.*\[^\w\s\\-\/@\.]/g/s,
      'must preserve dots in cleaned messages'
    );
  });

});
