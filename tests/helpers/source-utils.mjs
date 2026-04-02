import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const repoRoot = path.resolve(__dirname, '../../');

export function readSource(filePaths, label) {
  const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
  for (const p of paths) {
    const abs = path.isAbsolute(p) ? p : path.join(repoRoot, p);
    if (fs.existsSync(abs)) {
      return fs.readFileSync(abs, 'utf8');
    }
  }
  throw new Error(`Could not find source for ${label || (Array.isArray(filePaths) ? filePaths[0] : filePaths)}`);
}

export function readAllSources(filePaths, label) {
  const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
  let combined = '';
  for (const p of paths) {
    const abs = path.isAbsolute(p) ? p : path.join(repoRoot, p);
    if (fs.existsSync(abs)) {
      combined += '\n\n/* FILE: ' + p + ' */\n\n' + fs.readFileSync(abs, 'utf8');
    }
  }
  if (!combined) {
    throw new Error(`Could not find any sources for ${label}`);
  }
  return combined;
}

export function extractFunctionBody(source, signature) {
  const startIndex = source.indexOf(signature);
  if (startIndex === -1) return '';

  const trimmedSource = source.slice(startIndex + signature.length);
  let p = 0; // parens balance
  let b = 0; // brace balance

  // Account for parens/braces in the signature itself
  for (let i = 0; i < signature.length; i++) {
    const c = signature[i];
    if (c === '(') p++; else if (c === ')') p--;
    else if (c === '{') b++; else if (c === '}') b--;
  }

  // If the signature ends with '{', the method body is already open — start capturing immediately.
  // Otherwise (e.g. signature has '{' inside a return-type annotation), wait for the scanner
  // to find the actual method-opening '{' at brace depth 0.
  const signatureEndsWithBrace = b > 0 && signature.trimEnd().endsWith('{');
  let bodyStart = signatureEndsWithBrace ? 0 : -1;

  for (let i = 0; i < trimmedSource.length; i++) {
    const char = trimmedSource[i];

    if (char === '(') {
      p++;
    } else if (char === ')') {
      p--;
    } else if (char === '{') {
      if (b === 0 && p === 0) {
        bodyStart = i + 1;
      }
      b++;
    } else if (char === '}') {
      b--;
      if (b === 0 && bodyStart !== -1) {
        // If the signature ends with '{', this '}' might be closing the return-type annotation,
        // not the method body. Peek ahead: if the next non-whitespace char is '{', the body
        // is still to come — reset and continue scanning.
        if (signatureEndsWithBrace) {
          let j = i + 1;
          while (j < trimmedSource.length && /\s/.test(trimmedSource[j])) j++;
          if (j < trimmedSource.length && trimmedSource[j] === '{') {
            // This } closed the return-type annotation; reset for method body
            bodyStart = -1;
            continue;
          }
        }
        return trimmedSource.slice(bodyStart, i);
      }
    }
  }

  return '';
}

export function joinFromRoot(...parts) {
  return path.join(repoRoot, ...parts);
}
