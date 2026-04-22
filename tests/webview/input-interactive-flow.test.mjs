import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

const chatShell = readSource([
  joinFromRoot('webview/shared/src/chat/ChatShell.tsx'),
], 'ChatShell');

const panelComponents = readSource([
  joinFromRoot('webview/shared/src/chat/PanelComponents.tsx'),
], 'PanelComponents');

test('shows stop button only while responding with empty input', () => {
  assert.match(panelComponents, /isAiResponding && inputValue\.trim\(\)\.length === 0/, 'stop button guard is missing');
  assert.match(panelComponents, /type: "stopRequest"/, 'stopRequest transport is missing');
});

test('shows send button when idle or input is non-empty', () => {
  assert.match(panelComponents, /!isAiResponding \|\| inputValue\.trim\(\)\.length > 0/, 'send button fallback guard is missing');
  assert.match(panelComponents, /<Send className="h-3\.5 w-3\.5" \/>/, 'send button label is missing');
});

test('renders question popup options', () => {
  assert.match(panelComponents, /event\.type === "question"[\s\S]*event\.options\.map/, 'question option rendering is missing');
  assert.match(panelComponents, /Custom Answer\.\.\./, 'question custom-answer affordance is missing');
});

test('renders confirm popup yes and no actions', () => {
  assert.match(panelComponents, /event\.type === "confirm"[\s\S]*event\.confirmLabel \|\| "Yes"[\s\S]*event\.cancelLabel \|\| "No"/, 'confirm yes/no buttons are missing');
  assert.match(panelComponents, /submitInteractiveResponse\(/, 'interactive confirm submission is missing');
});

test('renders quick action popup buttons', () => {
  assert.match(panelComponents, /event\.type === "quick_actions"[\s\S]*event\.actions\.map/, 'quick action buttons are missing');
  assert.match(panelComponents, /Select an action/, 'quick action fallback label is missing');
});

test('posts interactive answers through sendMessage with interactiveSubmit', () => {
  assert.match(panelComponents, /vscode\.postMessage\(\{[\s\S]*type: "sendMessage"[\s\S]*interactiveSubmit: true[\s\S]*\}\)/, 'interactive sendMessage transport is missing');
  assert.match(panelComponents, /Question \$\{index \+ 1\}: \$\{question\}[\s\S]*Answer: \$\{answer\}/, 'interactive answer composition is missing');
});

test('includes slash command trigger and suggestion list', () => {
  assert.match(panelComponents, /getSlashTrigger\(/, 'slash trigger helper is missing');
  assert.match(panelComponents, /slashTrigger && \([\s\S]*oc-suggestions[\s\S]*\/\{command\.name\.replace/, 'slash command suggestions are missing');
});

test('includes mention trigger and mention suggestions', () => {
  assert.match(panelComponents, /getMentionTrigger\(/, 'mention trigger helper is missing');
  assert.match(panelComponents, /showMentionSuggestions && mentionSuggestions\.length > 0/, 'mention suggestions list is missing');
  assert.match(panelComponents, /@ to mention/, 'mention hint text is missing');
});

test('hides the input area while switching sessions', () => {
  assert.match(chatShell, /const isSwitchingSession = state\.isLoadingSession;/, 'session-switching guard is missing');
  assert.match(chatShell, /!isSwitchingSession && <InputWrapper \/>/, 'input wrapper hide/show guard is missing');
  assert.match(chatShell, /isSwitchingSession \? \(/, 'session loading spinner branch is missing');
});

test('supports custom free-text answers for question events', () => {
  assert.match(panelComponents, /allowCustomInput === true/, 'allowCustomInput flag is missing');
  assert.match(panelComponents, /setIsCustomMode\(autoCustomMode\)/, 'auto custom mode is missing');
  assert.match(panelComponents, /Type your answer\.\.\./, 'custom answer input is missing');
});

test('mentions the helper-backed command and mention parsing functions', () => {
  const getSlashTriggerBody = extractFunctionBody(panelComponents, 'function getSlashTrigger(input: string, cursor: number): SlashTrigger | null {');
  assert.match(getSlashTriggerBody, /lastIndexOf\("\/"\)/, 'slash parsing body is missing');
  const getMentionTriggerBody = extractFunctionBody(panelComponents, 'export function getMentionTrigger(input: string, cursor: number): MentionTrigger | null {');
  assert.match(getMentionTriggerBody, /lastIndexOf\("@"\)/, 'mention parsing body is missing');
});
