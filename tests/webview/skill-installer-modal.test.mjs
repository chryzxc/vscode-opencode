import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const skillInstallerModalSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'SkillInstallerModal.tsx')],
  'SkillInstallerModal.tsx',
);

test('SkillInstallerModal exports the modal and props contract', () => {
  assert.match(
    skillInstallerModalSource,
    /export function SkillInstallerModal\(\{[\s\S]*isOpen,[\s\S]*onClose,[\s\S]*\}: SkillInstallerModalProps\)/,
    'SkillInstallerModal should export the component with the expected props signature',
  );
  assert.match(
    skillInstallerModalSource,
    /type SkillInstallerModalProps = \{[\s\S]*isOpen: boolean;[\s\S]*onClose: \(\) => void;[\s\S]*\};/,
    'SkillInstallerModalProps should declare isOpen and onClose',
  );
});

test('SkillInstallerModal tracks install state and keyboard dismissal', () => {
  assert.match(
    skillInstallerModalSource,
    /const \[url, setUrl\] = useState\(""\);[\s\S]*const \[isInstalling, setIsInstalling\] = useState\(false\);[\s\S]*const \[status, setStatus\] = useState<\{[\s\S]*\}>\(\{ type: "idle", message: "" \}\);/,
    'SkillInstallerModal should use state for url, isInstalling, and status',
  );
  assert.match(
    skillInstallerModalSource,
    /window\.addEventListener\("keydown", onKeyDown\);/,
    'SkillInstallerModal should register an Escape key handler with window.addEventListener("keydown")',
  );
});

test('SkillInstallerModal posts install messages and listens for results', () => {
  assert.match(
    skillInstallerModalSource,
    /createPortal\(modalContent, document\.body\);/,
    'SkillInstallerModal should render through createPortal into document.body',
  );
  assert.match(
    skillInstallerModalSource,
    /vscode\.postMessage\(\{[\s\S]*type: "installSkill",[\s\S]*source: "url",[\s\S]*data: url\.trim\(\),[\s\S]*\}\);/,
    'SkillInstallerModal should send installSkill messages with the trimmed URL payload',
  );
  assert.match(
    skillInstallerModalSource,
    /message\.type === "skillInstalled"[\s\S]*message\.type === "skillError"[\s\S]*message\.type === "installProgress"/,
    'SkillInstallerModal should listen for skillInstalled, skillError, and installProgress messages',
  );
});

test('SkillInstallerModal keeps install button state and icon switching', () => {
  assert.match(
    skillInstallerModalSource,
    /isInstalling \? \([\s\S]*<Loader2[\s\S]*\) : \([\s\S]*<Download[\s\S]*\)/,
    'SkillInstallerModal should switch between Loader2 and Download icons while installing',
  );
  assert.match(
    skillInstallerModalSource,
    /disabled=\{isInstalling \|\| !url\.trim\(\)\}/,
    'Install button should be disabled while installing or when the URL is empty',
  );
});
