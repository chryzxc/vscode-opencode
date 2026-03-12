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

  // Find the end of the signature (the closing parenthesis of the parameter list)
  let signatureEnd = fnStart + signature.length;
  // If the signature passed in is just a prefix, find the actual end
  if (signature.includes('(') && !signature.includes(')')) {
    let parenDepth = 0;
    // Find the position of '(' within the signature itself, so we start from the correct '('
    const signatureParenPos = signature.indexOf('(');
    for (let i = fnStart + signatureParenPos; i < source.length; i++) {
      if (source[i] === '(') parenDepth++;
      if (source[i] === ')') {
        parenDepth--;
        if (parenDepth === 0) {
          signatureEnd = i + 1;
          break;
        }
      }
    }
  }

  const braceStart = source.indexOf('{', signatureEnd);
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
