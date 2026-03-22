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

  // Find the actual body start. 
  // We need to be careful with structural return types like `function foo(): { a: string } { ... }`
  let braceStart = -1;
  let depth = 0;

  for (let i = signatureEnd; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') {
      if (depth === 0) {
        braceStart = i;
      }
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        // This was the end of a block at depth 0. 
        // We need to decide if this was the function body or a structural return type.
        
        // Peek ahead to see if there is ANOTHER '{' before a semicolon or another function.
        let nextBlockStart = -1;
        for (let j = i + 1; j < Math.min(i + 300, source.length); j++) {
          const nextCh = source[j];
          if (nextCh === '{') {
            nextBlockStart = j;
            break;
          }
          if (nextCh === ';' || /export|function|const|class/.test(source.slice(j, j + 10))) {
            break;
          }
        }

        if (nextBlockStart !== -1) {
          // Found another block start. The one we just closed was likely a type.
          i = nextBlockStart - 1;
          braceStart = -1;
          depth = 0;
        } else {
          // No more blocks found before a stop condition. This must be the body.
          if (braceStart !== -1) {
            return source.slice(braceStart + 1, i);
          }
        }
      }
    }
  }

  throw new Error(`${signature} body end not found`);
}

export function joinFromRoot(...parts) {
  return path.join(repoRoot, ...parts);
}
