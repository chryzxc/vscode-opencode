import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot } from '../helpers/source-utils.mjs';

/**
 * Code-Selection Attachment Flow — Integration Tests
 *
 * Guards the end-to-end flow from editor selection (Ctrl+L / Cmd+L) through
 * ChatViewProvider part construction, webview type definitions, and React
 * rendering helpers. Every layer must agree that a code selection is a
 * structured `{type:"file", source:{type:"file", lineInfo:"31-32", text:{...}}}` part —
 * NOT a flat `{type:"text", text:"```lang\n// path:line\ncontent\n```"}`.
 *
 * Regression triggers:
 *   - Reverting to flat-text part shape (selection content vanishes from UI)
 *   - isExplicitFileAttachmentPart matching code_selection (duplicate chips)
 *   - Missing type guard / collector helpers (chips never render)
 *   - Strip helpers running on structured parts (content stripped)
 */

const providerSource = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
  'ChatViewProvider.ts',
);

const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

const typesSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'types.ts')],
  'types.ts',
);

const modalSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'CodeSelectionPreviewModal.tsx')],
  'CodeSelectionPreviewModal.tsx',
);

// ============================================================================
// Layer 1: Extension Host — Part Construction
// ============================================================================

describe('Code-selection part construction (ChatViewProvider)', () => {
  test('code selection context emits structured file part with file source', () => {
    // The ctx.content branch must push a {type:"file"} part with source.type:"file"
    assert.match(
      providerSource,
      /else if \(ctx\.content\)\s*\{[\s\S]*?type:\s*"file"[\s\S]*?source:\s*\{[\s\S]*?type:\s*"file"/,
      'ctx.content branch must emit type:"file" with source.type:"file"',
    );
  });

  test('code selection part includes path, text payload, lineInfo, and languageId', () => {
    assert.match(
      providerSource,
      /source:\s*\{[\s\S]*?type:\s*"file"[\s\S]*?path:\s*selectionPath[\s\S]*?text:\s*\{[\s\S]*?value:\s*selectionContent[\s\S]*?start:\s*0[\s\S]*?end:\s*selectionContent\.length[\s\S]*?lineInfo:\s*ctx\.lineInfo[\s\S]*?languageId:\s*ctx\.languageId/,
      'file source must carry path, text{value,start,end}, lineInfo, and languageId',
    );
  });

  test('deferred SDK prompt contexts always use text/plain instead of languageId-derived mime', () => {
    assert.match(
      providerSource,
      /for \(const context of options\.contexts \?\? \[\]\) \{[\s\S]*?promptFiles\.push\(\{[\s\S]*?mime:\s*"text\/plain"/,
      'deferred SDK prompt contexts must no longer derive mime from context.languageId',
    );
    assert.doesNotMatch(
      providerSource,
      /mime:\s*typeof context\?\.languageId === "string" \? context\.languageId : "text\/plain"/,
      'deferred SDK prompt must not send language IDs like markdown/typescript as file MIME types',
    );
  });

  test('deferred SDK prompt files and contexts keep full path metadata instead of basename-only names', () => {
    assert.match(
      providerSource,
      /promptFiles\.push\(\{[\s\S]*?uri:\s*path\.isAbsolute\(filePath\) \? vscode\.Uri\.file\(filePath\)\.toString\(\) : filePath,[\s\S]*?name:\s*filePath/,
      'plain attached files must preserve full filePath in the prompt file name metadata',
    );
    // Code selections in the deferred path now use a data URI (not raw file path)
    // so the server can't resolve the whole file from disk.
    assert.match(
      providerSource,
      /for \(const context of options\.contexts \?\? \[\]\) \{[\s\S]*?if \(content\) \{[\s\S]*?dataUri[\s\S]*?name:\s*nameWithLine/,
      'deferred code selections must use data URI with nameWithLine for AI metadata',
    );
    assert.match(
      providerSource,
      /const dataUri = `data:text\/plain;base64,\$\{Buffer\.from\([\s\S]*?content[\s\S]*?"base64"\)\}/,
      'deferred path must base64-encode selection content as data URI',
    );
  });

  test('code selection filename preserves full path plus line info for AI metadata while UI can still derive short labels', () => {
    assert.match(
      providerSource,
      /const\s+selectionPathWithLineInfo\s*=\s*[\s\S]*?selectionPath && ctx\.lineInfo[\s\S]*?filename:\s*selectionPathWithLineInfo/,
      'ctx.content branch must stamp full selection path plus lineInfo into filename metadata so the AI receives the complete path context',
    );
  });

  test('code selection part must NOT use the old flat-text markdown fence', () => {
    // The old bug: text:"```lang\n// file:line\ncontent\n```"
    // After our fix, the ctx.content branch should NOT contain the backtick fence pattern
    const ctxContentBranch = providerSource.match(
      /else if \(ctx\.content\)\s*\{([\s\S]*?)\}\s*else if/,
    );
    assert.ok(ctxContentBranch, 'ctx.content branch must exist and be followed by another else-if');
    assert.doesNotMatch(
      ctxContentBranch[1],
      /text:\s*`\\\u0060\\\u0060\\\u0060\$\{ctx\.languageId\}/,
      'ctx.content branch must NOT push a markdown-fenced text part',
    );
    assert.doesNotMatch(
      ctxContentBranch[1],
      /type:\s*"text"[\s\S]*?\/\/\s*\$\{ctx\.file\}:\$\{ctx\.lineInfo\}/,
      'ctx.content branch must NOT embed // path:line header in a text part',
    );
  });

  test('resource and file-reference branches remain unchanged', () => {
    assert.match(
      providerSource,
      /startsWith\("resource:"\)[\s\S]*?type:\s*"file"[\s\S]*?type:\s*"resource"\s+as const/,
      'resource branch must still emit structured file part with resource source',
    );
    assert.match(
      providerSource,
      /else if \(ctx\.file && workspaceFolder\)[\s\S]*?type:\s*"file"[\s\S]*?type:\s*"file"[\s\S]*?path:\s*ctx\.file/,
      'file-reference branch must still emit structured file part with path source',
    );
  });

  test('code selection url uses data URI with selection content instead of file URI to whole file', () => {
    const ctxContentBranch = providerSource.match(
      /else if \(ctx\.content\)\s*\{([\s\S]*?)\}\s*else if/,
    );
    assert.ok(ctxContentBranch, 'ctx.content branch must exist');
    assert.match(
      ctxContentBranch[1],
      /selectionDataUrl\s*=\s*`data:text\/plain;base64,[\s\S]*?Buffer\.from\([\s\S]*?selectionContent/,
      'ctx.content branch must build a data:text/plain URI from the selection content, not a file:// URI to the whole file',
    );
    assert.match(
      ctxContentBranch[1],
      /url:\s*selectionDataUrl/,
      'ctx.content branch url field must use the selection data URL',
    );
    assert.doesNotMatch(
      ctxContentBranch[1],
      /vscode\.Uri\.file\(selectionPath\)/,
      'ctx.content branch must NOT construct a file:// URI from the selection path — the server would read the whole file',
    );
  });
});

// ============================================================================
// Layer 2: Webview Type Definitions
// ============================================================================

describe('Code-selection type definitions (types.ts)', () => {
  test('MessagePart.source is broadened beyond {path?}', () => {
    assert.match(
      typesSource,
      /export\s+interface\s+MessagePartSource\s*\{[\s\S]*?type\?[\s\S]*?languageId\?[\s\S]*?lineInfo\?/,
      'MessagePartSource interface must include type, languageId, and lineInfo optional fields',
    );
    assert.match(
      typesSource,
      /source\?:\s*MessagePartSource/,
      'MessagePart.source must reference MessagePartSource type',
    );
  });

  test('CodeSelectionSource interface is exported with file discriminator', () => {
    assert.match(
      typesSource,
      /export\s+interface\s+CodeSelectionSource\s+extends\s+MessagePartSource/,
      'CodeSelectionSource must extend MessagePartSource',
    );
    assert.match(
      typesSource,
      /CodeSelectionSource[\s\S]*?type:\s*"file"/,
      'CodeSelectionSource must declare type:"file" discriminator',
    );
    assert.match(
      typesSource,
      /CodeSelectionSource[\s\S]*?path:\s*string[\s\S]*?text:\s*\{\s*value:\s*string;\s*start:\s*number;\s*end:\s*number\s*\}/,
      'CodeSelectionSource must carry required path and text{value,start,end} fields',
    );
  });

  test('CodeSelectionMessagePart interface is exported', () => {
    assert.match(
      typesSource,
      /export\s+interface\s+CodeSelectionMessagePart\s+extends\s+MessagePart/,
      'CodeSelectionMessagePart must extend MessagePart',
    );
    assert.match(
      typesSource,
      /CodeSelectionMessagePart[\s\S]*?source:\s*CodeSelectionSource/,
      'CodeSelectionMessagePart must require source: CodeSelectionSource',
    );
  });
});

// ============================================================================
// Layer 3: Webview Helpers — Type Guard + Collector
// ============================================================================

describe('Code-selection helpers (MessageComponents.tsx)', () => {
  test('isCodeSelectionPart type guard exists with correct discriminator logic', () => {
    assert.match(
      messageComponentsSource,
      /function\s+isCodeSelectionPart\s*\([^)]*\):\s*part is CodeSelectionMessagePart/,
      'isCodeSelectionPart must be a type predicate function returning "part is CodeSelectionMessagePart"',
    );
    assert.match(
      messageComponentsSource,
      /isCodeSelectionPart[\s\S]*?type\s*===\s*"file"\s*&&\s*sourceType\s*===\s*"file"\s*&&\s*lineInfo\.length\s*>\s*0/,
      'isCodeSelectionPart must check type==="file" AND sourceType==="file" AND lineInfo present',
    );
  });

  test('isExplicitFileAttachmentPart EXCLUDES code_selection parts (BUG #1 regression)', () => {
    // This is the critical regression guard: code_selection parts have type:"file"
    // and must NOT be picked up by isExplicitFileAttachmentPart (which would create
    // duplicate chips — one filename-only, one filename:lineRange).
    const funcBody = extractFunctionBodyFromTsx(
      messageComponentsSource,
      'function isExplicitFileAttachmentPart(',
    );
    assert.ok(funcBody, 'isExplicitFileAttachmentPart must exist');
    assert.match(
      funcBody,
      /partType\s*===\s*"file"[\s\S]*?isCodeSelectionPart\(part\)/,
      'isExplicitFileAttachmentPart must call isCodeSelectionPart before returning true for file parts',
    );
    assert.match(
      funcBody,
      /if\s*\(isCodeSelectionPart\(part\)\)\s*return\s*false/,
      'isExplicitFileAttachmentPart must return false when isCodeSelectionPart is true',
    );
  });

  test('collectCodeSelectionsFromParts extracts chip data from parts array', () => {
    assert.match(
      messageComponentsSource,
      /function\s+collectCodeSelectionsFromParts\s*\([\s\S]*?\):\s*CodeSelectionChipData\[\]/,
      'collectCodeSelectionsFromParts must return CodeSelectionChipData[]',
    );
    const body = extractFunctionBodyFromTsx(
      messageComponentsSource,
      'function collectCodeSelectionsFromParts(',
    );
    assert.match(body, /isCodeSelectionPart\(part\)/, 'must filter via isCodeSelectionPart');
    assert.match(body, /source\.text\?\.value/, 'must extract content from source.text.value');
    assert.match(body, /parseLineRange\(source\.lineInfo\)/, 'must parse line range from source.lineInfo');
    assert.match(body, /filename:\s*basenamePreservingLineSuffix\(part\.filename \|\| source\.path \|\| "", lineInfo\)\s*\|\|\s*undefined/, 'must derive chip filename from full-path metadata through the basename-preserving helper');
    assert.match(body, /languageId:\s*source\.languageId\s*\|\|\s*part\.mime/, 'must fall back to part.mime for languageId');
  });

  test('parseLineRange handles single line, range, and missing lineInfo', () => {
    const body = extractFunctionBodyFromTsx(
      messageComponentsSource,
      'function parseLineRange(',
    );
    assert.ok(body, 'parseLineRange must exist');
    assert.match(body, /lineInfo\.match\(/, 'must call lineInfo.match with a regex');
    assert.match(body, /match\[1\]\s*\?\s*Number\(match\[1\]\)/, 'must convert match[1] to startLine');
    assert.match(body, /match\[2\]\s*\?\s*Number\(match\[2\]\)/, 'must convert match[2] to endLine');
    assert.match(body, /if\s*\(!lineInfo\)\s*return\s*\{\}/, 'must return empty for missing lineInfo');
  });

  test('CodeSelectionChipData interface is exported', () => {
    assert.match(
      messageComponentsSource,
      /export\s+interface\s+CodeSelectionChipData\s*\{[\s\S]*?path\?[\s\S]*?filename\?[\s\S]*?languageId\?[\s\S]*?lineInfo\?[\s\S]*?content:\s*string[\s\S]*?startLine\?[\s\S]*?endLine\?/,
      'CodeSelectionChipData must be exported with all chip-rendering fields',
    );
  });
});

// ============================================================================
// Layer 4: UserMessage Rendering
// ============================================================================

describe('Code-selection chip rendering (UserMessage component)', () => {
  test('UserMessage collects code selections from message parts', () => {
    assert.match(
      messageComponentsSource,
      /collectCodeSelectionsFromParts\(message\?\.parts\)/,
      'UserMessage must call collectCodeSelectionsFromParts on message.parts',
    );
  });

  test('code-selection chips render with FileCode icon and filename:lineRange label', () => {
    // Find the chip rendering block — must use FileCode icon and build a label with line range
    assert.match(
      messageComponentsSource,
      /codeSelections\.length\s*>\s*0[\s\S]*?<FileCode/,
      'code-selection chips must render FileCode icon when selections exist',
    );
    assert.match(
      messageComponentsSource,
      /sel\.startLine\s*&&\s*sel\.endLine\s*&&\s*sel\.startLine\s*!==\s*sel\.endLine/,
      'chip label must check for multi-line range (startLine !== endLine)',
    );
    assert.match(
      messageComponentsSource,
      /sel\.filename\s*\?\?\s*sel\.path/,
      'chip label must use filename with path fallback',
    );
  });

  test('generic file attachments render as visible chips in the user bubble', () => {
    assert.match(
      messageComponentsSource,
      /fileChips\.length\s*>\s*0[\s\S]*?<FileIcon filePath=\{label\.path \|\| label\.label\}/,
      'non-image file attachments must render a visible file chip with the shared FileIcon renderer',
    );
    assert.match(
      messageComponentsSource,
      /isExplicitFileAttachmentPart\(part\)\s*&&\s*!isImageAttachmentPart\(part\)/,
      'generic file chips must exclude image attachments so they do not double-render',
    );
    assert.match(
      messageComponentsSource,
      /buildExplicitFileChip\(part\)/,
      'generic file chips must derive label and path through buildExplicitFileChip so file metadata can drive the shared icon renderer',
    );
  });

  test('generic file chip label appends line info when available without duplicating suffixes', () => {
    assert.match(
      messageComponentsSource,
      /function\s+buildExplicitFileChipLabel\s*\(/,
      'buildExplicitFileChipLabel helper must exist',
    );
    const body = extractFunctionBodyFromTsx(
      messageComponentsSource,
      'function buildExplicitFileChipLabel(',
    );
    assert.match(messageComponentsSource, /function\s+basenamePreservingLineSuffix\s*\(/, 'MessageComponents must define a helper that collapses full-path metadata into a basename display label');
    assert.match(body, /basenamePreservingLineSuffix\(filename \|\| sourcePath, lineInfo\)/, 'helper must collapse full-path metadata back to a basename for chip display');
    assert.match(body, /part\.source\?\.lineInfo/, 'helper must read source.lineInfo when available');
    assert.match(body, /baseLabel\.endsWith\(lineSuffix\)/, 'helper must avoid duplicating an existing :line suffix');
    assert.match(body, /return\s+baseLabel\.endsWith\(lineSuffix\)\s*\?\s*baseLabel\s*:\s*`\$\{baseLabel\}\$\{lineSuffix\}`/, 'helper must append :lineInfo to the displayed label when needed');
  });

  test('code selection collector derives a basename label even when filename metadata carries the full path', () => {
    assert.match(
      messageComponentsSource,
      /filename:\s*basenamePreservingLineSuffix\(part\.filename \|\| source\.path \|\| "", lineInfo\)\s*\|\|\s*undefined/,
      'collectCodeSelectionsFromParts must derive short chip labels from full-path filename metadata',
    );
  });

  test('clicking a code-selection chip opens CodeSelectionPreviewModal', () => {
    assert.match(
      messageComponentsSource,
      /setPreviewSelection\(sel\)/,
      'clicking a code-selection chip must set previewSelection state',
    );
    assert.match(
      messageComponentsSource,
      /<CodeSelectionPreviewModal/,
      'CodeSelectionPreviewModal must be rendered in UserMessage tree',
    );
    assert.match(
      messageComponentsSource,
      /previewSelection\b/,
      'previewSelection state must be wired to the modal',
    );
  });

  test('code-selection chip CSS classes match image chip classes', () => {
    // Both chip types must use the same Tailwind classes for visual consistency
    const chipClassPattern = /rounded-full border border-oc-border bg-oc-panel-soft px-2\.5 py-1 text-\[10px\] font-medium text-oc-text-soft transition-colors hover:bg-oc-bg-soft/;
    const matches = messageComponentsSource.match(new RegExp(chipClassPattern.source, 'g'));
    assert.ok(matches && matches.length >= 2, 'at least 2 chip elements must share the same CSS class string');
  });

  test('render guards include codeSelections in empty-message and content checks', () => {
    // The UserMessage must not bail out early when only code selections are present
    assert.match(
      messageComponentsSource,
      /codeSelections\.length\s*===\s*0/,
      'empty-message guard must include codeSelections.length === 0',
    );
    assert.match(
      messageComponentsSource,
      /codeSelections\.length\s*>\s*0/,
      'content-or-attachments guard must include codeSelections.length > 0',
    );
    assert.match(
      messageComponentsSource,
      /fileChips\.length\s*===\s*0/,
      'empty-message guard must include fileChips.length === 0',
    );
    assert.match(
      messageComponentsSource,
      /fileChips\.length\s*>\s*0/,
      'content-or-attachments guard must include fileChips.length > 0',
    );
  });

  test('user text aggregation excludes synthetic tool/file-dump text parts', () => {
    assert.match(
      messageComponentsSource,
      /function\s+isSyntheticUserToolTextPart\s*\(/,
      'user message rendering must define a helper for synthetic tool/file-dump text parts',
    );
    assert.match(
      messageComponentsSource,
      /\(part as \{ synthetic\?: unknown \}\)\.synthetic === true/,
      'synthetic text parts must be excluded structurally, not only by string heuristics',
    );
    assert.match(
      messageComponentsSource,
      /normalized\.startsWith\("called the "\)[\s\S]*?normalized\.includes\(" tool with the following input:"\)/,
      'synthetic tool-call echo text must be filtered from user bubbles',
    );
    assert.match(
      messageComponentsSource,
      /text\.includes\("<path>"\)[\s\S]*?text\.includes\("<\/path>"\)[\s\S]*?text\.includes\("<content>"\)/,
      'raw file-dump fragments must be filtered from user bubbles',
    );
    assert.match(
      messageComponentsSource,
      /role\?\.toLowerCase\(\) === "user"[\s\S]*?isRenderableUserTextPart/,
      'messageBodyFromParts must use stricter filtering for user messages',
    );
  });
});

// ============================================================================
// Layer 5: Stripping Short-Circuit
// ============================================================================

describe('Stripping short-circuit for structured code selections', () => {
  test('stripHydratedAttachmentEcho and stripGenericHydratedAttachmentFence are bypassed when code_selection parts exist', () => {
    // When structured code_selection parts are present, the markdown stripping
    // helpers must be skipped (the structured data is authoritative).
    assert.match(
      messageComponentsSource,
      /codeSelections\.length\s*>\s*0[\s\S]*?(skip|bypass|short-circuit|return|without)/i,
      'codeSelections presence must trigger a skip/bypass of stripping helpers',
    );
  });

  test('legacy strip helpers still exist for old persisted messages', () => {
    // Old messages without code_selection parts still need strip + infer path
    assert.match(
      messageComponentsSource,
      /function\s+stripHydratedAttachmentEcho/,
      'stripHydratedAttachmentEcho must still exist for legacy messages',
    );
    assert.match(
      messageComponentsSource,
      /function\s+stripGenericHydratedAttachmentFence/,
      'stripGenericHydratedAttachmentFence must still exist for legacy messages',
    );
    assert.match(
      messageComponentsSource,
      /function\s+inferAttachmentPathsFromHydratedUserText/,
      'inferAttachmentPathsFromHydratedUserText must still exist for legacy messages',
    );
  });
});

// ============================================================================
// Layer 6: Preview Modal
// ============================================================================

describe('CodeSelectionPreviewModal component', () => {
  test('modal component is exported and uses createPortal', () => {
    assert.match(modalSource, /export\s+function\s+CodeSelectionPreviewModal/, 'must be exported');
    assert.match(modalSource, /createPortal/, 'must use createPortal for DOM-level rendering');
  });

  test('modal supports escape-to-close and backdrop click', () => {
    assert.match(modalSource, /Escape/, 'must handle Escape key');
    assert.match(modalSource, /onClose/, 'must call onClose');
    assert.match(modalSource, /aria-modal/, 'must set aria-modal attribute');
  });

  test('modal uses highlight.js for syntax highlighting with auto fallback', () => {
    assert.match(modalSource, /hljs\.highlight\(code,\s*\{\s*language:\s*lang\s*\}\)/, 'must use hljs.highlight with language');
    assert.match(modalSource, /hljs\.highlightAuto\(code\)/, 'must fall back to hljs.highlightAuto');
    assert.match(modalSource, /hljs\.getLanguage\(lang\)/, 'must check language availability before highlighting');
  });

  test('modal header shows filename:lineRange title and language badge', () => {
    assert.match(modalSource, /buildTitle/, 'must have a title builder');
    assert.match(modalSource, /buildLineLabel/, 'must have a line label builder');
    assert.match(modalSource, /languageBadge|data\.languageId/i, 'must render language badge');
    assert.match(modalSource, /start\s*&&\s*end\s*&&\s*start\s*!==\s*end/, 'line label builder must handle line ranges');
  });
});

// ============================================================================
// Helper: Extract function body from TSX (same logic as extractFunctionBody
// but used inline to avoid import ambiguity for TSX files)
// ============================================================================

function extractFunctionBodyFromTsx(source, signature) {
  const idx = source.indexOf(signature);
  if (idx === -1) return '';
  const after = source.slice(idx + signature.length);
  // Find the first top-level { ... } block (could be a return type annotation
  // like `: { foo?: bar }` or the function body itself).
  let depth = 0;
  let startIdx = -1;
  let firstBlockEnd = -1;
  for (let i = 0; i < after.length; i++) {
    const ch = after[i];
    if (ch === '{') {
      if (depth === 0) startIdx = i + 1;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && startIdx !== -1) {
        firstBlockEnd = i;
        break;
      }
    }
  }
  if (firstBlockEnd === -1) return '';
  // Check if the next non-whitespace character after the first block's `}`
  // is another `{`. If so, the first block was a return type annotation and
  // the second block is the real function body.
  const rest = after.slice(firstBlockEnd + 1);
  const nextNonWs = rest.match(/^\s*(\S)/);
  if (nextNonWs && nextNonWs[1] === '{') {
    // Extract the second { ... } block (the actual body).
    let d = 0;
    let si = -1;
    for (let i = 0; i < rest.length; i++) {
      const ch = rest[i];
      if (ch === '{') {
        if (d === 0) si = i + 1;
        d++;
      } else if (ch === '}') {
        d--;
        if (d === 0 && si !== -1) {
          return rest.slice(si, i);
        }
      }
    }
    return '';
  }
  // No second block — the first block IS the function body.
  return after.slice(startIdx, firstBlockEnd);
}
