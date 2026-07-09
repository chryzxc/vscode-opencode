import fs from 'fs';
const path = 'webview/shared/src/chat/lib/store.ts';
let code = fs.readFileSync(path, 'utf8');

if (!code.includes('appendAndDedupeCentralizedDebugPayload')) {
  // Add import
  code = code.replace(
    '  dedupeCentralizedDebugPayloads,',
    '  dedupeCentralizedDebugPayloads,\n  appendAndDedupeCentralizedDebugPayload,'
  );

  // Patch APPEND_RAW_SDK_EVENT_PAYLOAD (line 2901+)
  code = code.replace(
    'const next = dedupeCentralizedDebugPayloads([...existing, sanitizedEvent]);',
    'const next = appendAndDedupeCentralizedDebugPayload(existing, sanitizedEvent) as unknown[];'
  );

  // Patch APPEND_SDK_EVENT_PAYLOAD (line 3209)
  code = code.replace(
    'const next = dedupeCentralizedDebugPayloads([...existing, action.payload]);',
    'const next = appendAndDedupeCentralizedDebugPayload(existing, action.payload) as unknown[];'
  );

  // Patch the session scoped cache in APPEND_SDK_EVENT_PAYLOAD
  code = code.replace(
    /dedupeCentralizedDebugPayloads\(\[\s*\.\.\.\(state\.rawSdkEventPayloadsBySessionId\?\.\[state\.currentSessionId\] \?\? \[\]\),\s*action\.payload,\s*\]\)/g,
    'appendAndDedupeCentralizedDebugPayload(state.rawSdkEventPayloadsBySessionId?.[state.currentSessionId] ?? [], action.payload)'
  );

  fs.writeFileSync(path, code);
  console.log('Patched store.ts');
} else {
  console.log('Already patched');
}
