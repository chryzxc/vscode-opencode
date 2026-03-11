import fs from 'node:fs';
import path from 'node:path';
import { extractFunctionBody, readSource, joinFromRoot } from './tests/helpers/source-utils.mjs';

const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);

const exactSignature = 'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState) {';

console.log("Source length:", messageHandlerSource.length);
console.log("Signature length:", exactSignature.length);

const index = messageHandlerSource.indexOf(exactSignature);
console.log("Index of signature:", index);

if (index === -1) {
    console.log("NOT FOUND. Let's look for partials...");
    console.log("Index of 'export function createMessageHandler':", messageHandlerSource.indexOf('export function createMessageHandler'));
    
    // Check for CRLF
    if (messageHandlerSource.includes('\r\n')) {
        console.log("Source uses CRLF");
    } else {
        console.log("Source uses LF");
    }
} else {
    try {
        const body = extractFunctionBody(messageHandlerSource, exactSignature);
        console.log("Body length:", body.length);
        console.log("Body preview:", body.slice(0, 100));
    } catch (e) {
        console.error("Extraction error:", e.message);
    }
}
