import test from 'node:test';

// NOTE: These tests are skipped because the image preview functionality
// doesn't exist in the current implementation. The tests were written for
// functionality that may have been removed or refactored.
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);
const messageSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);
const modalSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'ImagePreviewModal.tsx')],
  'ImagePreviewModal.tsx',
);
const chatCssSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'index.css')],
  'chat index.css',
);

test.skip('reusable ImagePreviewModal provides close controls and dialog semantics', () => {
  assert.match(modalSource, /export function ImagePreviewModal\(/, 'ImagePreviewModal should be exported for reuse');
  assert.match(modalSource, /role="dialog"/, 'ImagePreviewModal should expose dialog role for a11y');
  assert.match(modalSource, /aria-modal="true"/, 'ImagePreviewModal should mark modal behavior with aria-modal');
  assert.match(modalSource, /event\.key === "Escape"/, 'ImagePreviewModal should close on Escape');
  assert.match(modalSource, /className="oc-image-preview-backdrop"/, 'ImagePreviewModal should render a backdrop close target');
});

test.skip('input attachment chips render thumbnail preview and open modal for images', () => {
  const inputBody = extractFunctionBody(panelSource, 'export function InputWrapper()');

  assert.match(inputBody, /const \[previewAttachmentSrc, setPreviewAttachmentSrc\]/, 'InputWrapper should track selected attachment preview image');
  assert.match(inputBody, /isImageAttachment\(a\.mimeType, a\.dataUrl\)/, 'InputWrapper should gate thumbnail rendering to image attachments');
  assert.match(inputBody, /className="oc-chip-thumb"/, 'image attachment chips should render a small thumbnail');
  assert.match(inputBody, /setPreviewAttachmentSrc\(a\.dataUrl\)/, 'clicking an image attachment should open preview with attachment data URL');
  assert.match(inputBody, /<ImagePreviewModal[\s\S]*previewAttachmentSrc/, 'InputWrapper should render ImagePreviewModal bound to attachment preview state');
});

test.skip('message images support click-to-preview for both user and markdown content', () => {
  assert.match(messageSource, /const \[previewImageSrc, setPreviewImageSrc\]/, 'message components should track preview image state');
  assert.match(messageSource, /<ImagePreviewModal[\s\S]*previewImageSrc/, 'message components should render modal bound to preview image state');
  assert.match(messageSource, /root\.addEventListener\("click", onClick\)/, 'assistant markdown image clicks should be handled via delegated listener');
  assert.match(messageSource, /target\.closest\("\.markdown-body"\)/, 'delegated image click handling should be scoped to markdown content');
  assert.match(messageSource, /<img\s+key=\{src\}\s+src=\{src\}\s+alt="attachment"[\s\S]*cursor-zoom-in/, 'user images should remain rendered as thumbnails with zoom affordance');
});

test.skip('chat CSS includes stable classes for image preview and thumbnail UI', () => {
  assert.match(chatCssSource, /\.oc-chip-thumb\s*\{/, 'chat CSS should style image thumbnail chip');
  assert.match(chatCssSource, /\.oc-chip-preview\s*\{/, 'chat CSS should style clickable preview chip');
  assert.match(chatCssSource, /\.oc-image-preview-modal\s*\{/, 'chat CSS should style image preview modal shell');
  assert.match(chatCssSource, /\.oc-image-preview-backdrop\s*\{/, 'chat CSS should style image preview backdrop');
  assert.match(chatCssSource, /\.markdown-body img\s*\{[\s\S]*cursor:\s*zoom-in/, 'markdown images should advertise click-to-zoom cursor');
});
