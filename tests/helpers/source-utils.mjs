import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export const repoRoot = process.cwd();

export function resolveExistingPath(candidates, label) {
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  assert.ok(found, `${label} not found in expected locations`);
  return found;
}

export function readSource(candidates, label) {
  const filePath = resolveExistingPath(candidates, label);
  return fs.readFileSync(filePath, 'utf8');
}

export function extractFunctionBody(source, signature) {
  const fnStart = source.indexOf(signature);
  assert.notEqual(fnStart, -1, `${signature} definition not found`);

  const braceStart = source.indexOf('{', fnStart);
  assert.notEqual(braceStart, -1, `${signature} body start not found`);

  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(braceStart + 1, i);
      }
    }
  }

  throw new Error(`${signature} body end not found`);
}

export function joinFromRoot(...parts) {
  return path.join(repoRoot, ...parts);
}
