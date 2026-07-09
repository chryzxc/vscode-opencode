import fs from 'fs';

const shellPath = 'webview/shared/src/chat/ChatShell.tsx';
let shellCode = fs.readFileSync(shellPath, 'utf8');

shellCode = shellCode.replace(
  'function buildCentralizedTranscriptProjection(',
  `function buildCentralizedTranscriptProjection(rawSdkEventPayloads: unknown[]) {
    const start = performance.now();
    console.log(\`[DIAGNOSTIC] buildCentralizedTranscriptProjection START. Payloads length: \${rawSdkEventPayloads.length}\`);
    const result = _buildCentralizedTranscriptProjection(rawSdkEventPayloads);
    console.log(\`[DIAGNOSTIC] buildCentralizedTranscriptProjection END. Time: \${(performance.now() - start).toFixed(2)}ms\`);
    return result;
}
function _buildCentralizedTranscriptProjection(`
);

shellCode = shellCode.replace(
  'function buildCentralizedRenderMessages(',
  `function buildCentralizedRenderMessages(rawSdkEventPayloads: unknown[]) {
    const start = performance.now();
    console.log(\`[DIAGNOSTIC] buildCentralizedRenderMessages START. Payloads length: \${rawSdkEventPayloads.length}\`);
    const result = _buildCentralizedRenderMessages(rawSdkEventPayloads);
    console.log(\`[DIAGNOSTIC] buildCentralizedRenderMessages END. Time: \${(performance.now() - start).toFixed(2)}ms\`);
    return result;
}
function _buildCentralizedRenderMessages(`
);

shellCode = shellCode.replace(
  'const transcriptProjection = useMemo(',
  `console.log('[DIAGNOSTIC] ChatShell rendering. isInitializing: ', state.isInitializing);
  const transcriptProjection = useMemo(`
);

fs.writeFileSync(shellPath, shellCode);

const storePath = 'webview/shared/src/chat/lib/store.ts';
let storeCode = fs.readFileSync(storePath, 'utf8');
storeCode = storeCode.replace(
  'export const reducer = (state: AppState, action: AppAction): AppState => {',
  `export const reducer = (state: AppState, action: AppAction): AppState => {
    const start = performance.now();
    console.log(\`[DIAGNOSTIC] reducer START: \${action.type}\`);
    const result = _reducer(state, action);
    const time = performance.now() - start;
    if (time > 10) console.log(\`[DIAGNOSTIC] reducer END: \${action.type} took \${time.toFixed(2)}ms\`);
    return result;
  };
  const _reducer = (state: AppState, action: AppAction): AppState => {`
);
fs.writeFileSync(storePath, storeCode);

const handlerPath = 'webview/shared/src/chat/lib/messageHandler.ts';
let handlerCode = fs.readFileSync(handlerPath, 'utf8');
handlerCode = handlerCode.replace(
  'export function setupMessageListener(',
  `export function setupMessageListener(dispatch: any, getState: any) {
    console.log('[DIAGNOSTIC] setupMessageListener installed.');
    return _setupMessageListener(dispatch, getState);
  }
  function _setupMessageListener(`
);
handlerCode = handlerCode.replace(
  'const handleMessage = async (event: MessageEvent) => {',
  `const handleMessage = async (event: MessageEvent) => {
    const start = performance.now();
    const type = event.data?.type || 'unknown';
    console.log(\`[DIAGNOSTIC] IPC Message Received: \${type}\`);
`
);
handlerCode = handlerCode.replace(
  'case "initState": {',
  `case "initState": {
    console.log(\`[DIAGNOSTIC] initState processing START. Current state isInitializing: \${getState().isInitializing}\`);
`
);
fs.writeFileSync(handlerPath, handlerCode);

console.log('Patched logs');
