import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'ImagePreviewModal.tsx')],
  'ImagePreviewModal.tsx',
);

test('exports ImagePreviewModal with props type', () => {
  assert.match(
    source,
    /export function ImagePreviewModal\(\{[\s\S]*?\}: ImagePreviewModalProps\)/,
    'ImagePreviewModal.tsx must export ImagePreviewModal with ImagePreviewModalProps',
  );
});

test('defines the expected props fields', () => {
  assert.match(
    source,
    /type ImagePreviewModalProps = \{[\s\S]*?isOpen: boolean;[\s\S]*?imageSrc: string \| null;[\s\S]*?imageAlt\?: string;[\s\S]*?title\?: string;[\s\S]*?onClose: \(\) => void;[\s\S]*?\}/,
    'ImagePreviewModal.tsx must define ImagePreviewModalProps with isOpen, imageSrc, imageAlt, title, and onClose',
  );
});

test('returns null when closed or missing image', () => {
  assert.match(
    source,
    /if \(!isOpen \|\| !imageSrc\) \{[\s\S]*?return null;[\s\S]*?\}/,
    'ImagePreviewModal.tsx must early return null when closed or imageSrc is missing',
  );
});

test('handles Escape key on window keydown', () => {
  assert.match(
    source,
    /window\.addEventListener\(['"]keydown['"]/,
    'ImagePreviewModal.tsx must add a window keydown Escape handler',
  );
});

test('uses the image preview shell class', () => {
  assert.match(
    source,
    /oc-image-preview-shell/,
    'ImagePreviewModal.tsx must use the oc-image-preview-shell className',
  );
});

test('renders the preview image element', () => {
  assert.match(
    source,
    /<img[\s\S]*?src=\{imageSrc\}[\s\S]*?alt=\{imageAlt\}[\s\S]*?oc-image-preview-img/,
    'ImagePreviewModal.tsx must render <img src={imageSrc} alt={imageAlt} with oc-image-preview-img className',
  );
});

test('uses the X icon from lucide-react for closing', () => {
  assert.match(
    source,
    /import \{ X \} from "lucide-react";/,
    'ImagePreviewModal.tsx must use the X icon from lucide-react for the close button',
  );
});
