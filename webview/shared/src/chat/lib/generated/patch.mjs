import fs from 'fs';
const path = 'webview/shared/src/chat/lib/generated/centralizedDebugPayloadFilter.ts';
let code = fs.readFileSync(path, 'utf8');

const helper = `

/**
 * Optimized append-and-dedupe that avoids O(N^2) recalculations of fingerprints.
 * We only check the new payload against the last 50 items because duplicates
 * usually happen close to each other. This is critical for stream chunks.
 */
export function appendAndDedupeCentralizedDebugPayload(existing: unknown[], newPayload: unknown): unknown[] {
  if (!Array.isArray(existing)) {
    return [newPayload];
  }
  const newKey =
    getCentralizedDebugPayloadIdentity(newPayload) ||
    centralizedDebugPayloadFingerprint(newPayload);

  // Check the last 50 items for a duplicate.
  const limit = Math.max(0, existing.length - 50);
  for (let i = existing.length - 1; i >= limit; i--) {
    const existingKey =
      getCentralizedDebugPayloadIdentity(existing[i]) ||
      centralizedDebugPayloadFingerprint(existing[i]);
    if (existingKey === newKey) {
      return existing; // Duplicate found, ignore new payload
    }
  }

  return [...existing, newPayload];
}
`;

if (!code.includes('appendAndDedupeCentralizedDebugPayload')) {
  code += helper;
  fs.writeFileSync(path, code);
  console.log('Patched centralizedDebugPayloadFilter.ts');
} else {
  console.log('Already patched');
}
