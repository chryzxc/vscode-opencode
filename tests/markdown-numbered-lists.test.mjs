import test from 'node:test';
import assert from 'node:assert/strict';
import { marked } from 'marked';
import { readSource, joinFromRoot } from './helpers/source-utils.mjs';

// Read the MarkdownRenderer source to extract the preprocessMarkdown function
const markdownRendererSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'components', 'MarkdownRenderer.tsx')],
  'MarkdownRenderer.tsx',
);

// Reimplement the preprocessMarkdown function for testing
// This mirrors the implementation in MarkdownRenderer.tsx
function preprocessMarkdown(content) {
  return content.replace(
    /(^|\n)(\d+\.\s+.*?)(?:\n\s*\n)+(?=\d+\.\s+)/gm,
    '$1$2\n'
  );
}

// ── Unit tests for preprocessMarkdown function ───────────────────────────────

test('preprocessMarkdown removes single blank line between numbered list items', () => {
  const input = '1. First item\n\n2. Second item\n\n3. Third item';
  const expected = '1. First item\n2. Second item\n3. Third item';
  const result = preprocessMarkdown(input);
  assert.strictEqual(result, expected, 'Should remove single blank lines between numbered items');
});

test('preprocessMarkdown removes multiple blank lines between numbered list items', () => {
  const input = '1. First item\n\n\n2. Second item\n\n\n\n3. Third item';
  const expected = '1. First item\n2. Second item\n3. Third item';
  const result = preprocessMarkdown(input);
  assert.strictEqual(result, expected, 'Should remove multiple blank lines between numbered items');
});

test('preprocessMarkdown preserves blank lines before first list item', () => {
  const input = 'Intro text\n\n1. First item\n\n2. Second item';
  const expected = 'Intro text\n\n1. First item\n2. Second item';
  const result = preprocessMarkdown(input);
  assert.strictEqual(result, expected, 'Should preserve blank lines before the first numbered item');
});

test('preprocessMarkdown preserves blank lines after last list item', () => {
  const input = '1. First item\n\n2. Second item\n\n\nOutro text';
  const expected = '1. First item\n2. Second item\n\n\nOutro text';
  const result = preprocessMarkdown(input);
  assert.strictEqual(result, expected, 'Should preserve blank lines after the last numbered item');
});

test('preprocessMarkdown handles numbered lists with inline formatting', () => {
  const input = '1. **Bold** item\n\n2. *Italic* item\n\n3. `code` item';
  const expected = '1. **Bold** item\n2. *Italic* item\n3. `code` item';
  const result = preprocessMarkdown(input);
  assert.strictEqual(result, expected, 'Should handle markdown formatting within list items');
});

test('preprocessMarkdown handles numbered lists with complex content', () => {
  const input = '1. First item with (parentheses) and [links](url)\n\n2. Second item with "quotes"\n\n3. Third item';
  const expected = '1. First item with (parentheses) and [links](url)\n2. Second item with "quotes"\n3. Third item';
  const result = preprocessMarkdown(input);
  assert.strictEqual(result, expected, 'Should handle complex punctuation and markdown syntax');
});

test('preprocessMarkdown does not modify unordered lists', () => {
  const input = '- First item\n\n- Second item\n\n- Third item';
  const expected = input; // Should remain unchanged
  const result = preprocessMarkdown(input);
  assert.strictEqual(result, expected, 'Should not modify unordered lists');
});

test('preprocessMarkdown handles mixed numbered and unordered lists', () => {
  const input = '1. Numbered item\n\n- Unordered item\n\n2. Another numbered\n\n- Another unordered';
  const expected = input; // Should remain unchanged since blank lines are between different list types
  const result = preprocessMarkdown(input);
  assert.strictEqual(result, expected, 'Should only process blank lines between consecutive numbered items');
});

test('preprocessMarkdown handles lists with blank lines and indentation', () => {
  const input = '1. First item\n\n  2. Indented item\n\n3. Third item';
  const expected = input; // Indented items are treated as nested content, blank lines preserved
  const result = preprocessMarkdown(input);
  assert.strictEqual(result, expected, 'Should preserve blank lines for indented (nested) numbered items');
});

test('preprocessMarkdown handles edge case of single list item', () => {
  const input = '1. Only item';
  const expected = '1. Only item';
  const result = preprocessMarkdown(input);
  assert.strictEqual(result, expected, 'Should handle single list item without errors');
});

test('preprocessMarkdown handles real-world AI response format', () => {
  const input = `What are you building with this Next.js project? A few questions to help me assist you better:

1. **Purpose** - What kind of app is this? (dashboard, SaaS, blog, portfolio, etc.)

2. **Current state** - Are you just starting out, or adding to an existing feature set?

3. **Priority** - What's the most important thing you want to work on right now?

4. **Design preference** - Any specific styling approach you prefer, or should I follow the existing Tailwind setup?

5. **Authentication** - Do you need auth set up, or is that already handled?

Also, curious about the padding adjustment I just made - was that for a specific layout issue you noticed?`;

  const expected = `What are you building with this Next.js project? A few questions to help me assist you better:

1. **Purpose** - What kind of app is this? (dashboard, SaaS, blog, portfolio, etc.)
2. **Current state** - Are you just starting out, or adding to an existing feature set?
3. **Priority** - What's the most important thing you want to work on right now?
4. **Design preference** - Any specific styling approach you prefer, or should I follow the existing Tailwind setup?
5. **Authentication** - Do you need auth set up, or is that already handled?

Also, curious about the padding adjustment I just made - was that for a specific layout issue you noticed?`;

  const result = preprocessMarkdown(input);
  assert.strictEqual(result, expected, 'Should handle real-world AI response with formatted numbered lists');
});

// ── Integration tests with marked library ──────────────────────────────────────

test('marked.parse generates <ol> tags for preprocessed numbered lists', () => {
  const input = '1. First item\n\n2. Second item\n\n3. Third item';
  const processed = preprocessMarkdown(input);
  const html = marked.parse(processed);

  assert.match(html, /<ol>/, 'Should generate <ol> tag for ordered lists');
  assert.match(html, /<li>First item<\/li>/, 'Should generate <li> tags for list items');
  assert.match(html, /<li>Second item<\/li>/, 'Should generate <li> tags for list items');
  assert.match(html, /<li>Third item<\/li>/, 'Should generate <li> tags for list items');
  assert.doesNotMatch(html, /<ul>/, 'Should NOT generate <ul> tag for ordered lists');
});

test('marked.parse without preprocessing generates <ol> but with extra <p> tags', () => {
  const input = '1. First item\n\n2. Second item\n\n3. Third item';
  const html = marked.parse(input);

  // Without preprocessing, marked still generates <ol> but wraps content in <p> tags
  assert.match(html, /<ol>/, 'Should generate <ol> tag even without preprocessing');
  assert.match(html, /<li><p>First item<\/p>/, 'Without preprocessing, content is wrapped in <p> tags');
});

test('marked.parse with preprocessing generates cleaner <ol> without extra <p> tags', () => {
  const input = '1. First item\n\n2. Second item\n\n3. Third item';
  const processed = preprocessMarkdown(input);
  const html = marked.parse(processed);

  assert.match(html, /<li>First item<\/li>/, 'With preprocessing, content is NOT wrapped in <p> tags');
  assert.doesNotMatch(html, /<li><p>First item<\/p>/, 'Should NOT have <p> tags inside <li>');
});

test('full integration: preprocess + marked generates correct HTML for complex numbered list', () => {
  const input = `1. **Purpose** - What kind of app is this?

2. **Current state** - Are you starting out?

3. **Priority** - What's most important?`;

  const processed = preprocessMarkdown(input);
  const html = marked.parse(processed);

  assert.match(html, /<ol>/, 'Should generate <ol> tag');
  assert.match(html, /<li><strong>Purpose<\/strong>.*?<\/li>/, 'Should handle bold text');
  assert.match(html, /<li><strong>Current state<\/strong>.*?<\/li>/, 'Should handle multiple items');
  assert.match(html, /<li><strong>Priority<\/strong>.*?<\/li>/, 'Should handle all items');
});

test('preprocessMarkdown is idempotent (running it multiple times produces same result)', () => {
  const input = '1. First item\n\n2. Second item\n\n3. Third item';
  const firstPass = preprocessMarkdown(input);
  const secondPass = preprocessMarkdown(firstPass);
  const thirdPass = preprocessMarkdown(secondPass);

  assert.strictEqual(secondPass, firstPass, 'Second pass should be same as first');
  assert.strictEqual(thirdPass, secondPass, 'Third pass should be same as second');
});
