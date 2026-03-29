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

  let bodyStart = (b > 0 && p === 0) ? 0 : -1;

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
        const res = trimmedSource.slice(bodyStart, i);
        return res;
      }
    }
  }

  return '';
}

export function joinFromRoot(...parts) {
  return path.join(repoRoot, ...parts);
}
