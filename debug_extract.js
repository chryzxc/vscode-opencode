const signature = 'private recordStructuredValidationFailure(';
const trimmedSource = `
    record: Record<string, unknown>,
    errors: string[],
    diagnostics?: {
      source?: string;
      providerID?: string;
      modelID?: string;
    },
  ): void {
    const responseType = "foo";
  }
`;

function extractFunctionBody(source, signature) {
  const startIndex = source.indexOf(signature);
  const trimmedSource = source.slice(startIndex + signature.length);
  let p = 0;
  let b = 0;
  for (let i = 0; i < signature.length; i++) {
    const c = signature[i];
    if (c === '(') p++; else if (c === ')') p--;
    else if (c === '{') b++; else if (c === '}') b--;
  }
  let bodyStart = -1;
  console.log('Initial p:', p, 'b:', b);

  for (let i = 0; i < trimmedSource.length; i++) {
    const char = trimmedSource[i];
    if (char === '(') p++; 
    else if (char === ')') p--;
    else if (char === '{') {
      console.log('Found { at', i, 'p:', p, 'b:', b);
      if (b === 0 && p === 0) {
        let nested = 1;
        let j = i + 1;
        while (j < trimmedSource.length && nested > 0) {
          const c2 = trimmedSource[j];
          if (c2 === '{') nested++; else if (c2 === '}') nested--;
          j++;
        }
        let k = j;
        let foundAnother = false;
        while (k < trimmedSource.length) {
          const kc = trimmedSource[k];
          if (/\s/.test(kc)) { k++; continue; }
          if (kc === '{') { foundAnother = true; break; }
          if (/[a-zA-Z0-9_:.|?&<>()[\]]/.test(kc) || kc === ',' || kc === '=' || kc === ';') {
             if (kc === ';') break;
             k++; continue;
          }
          break;
        }
        console.log('  foundAnother:', foundAnother);
        if (foundAnother) { 
           console.log('  skipping type block');
           b++; continue; 
        }
        bodyStart = i + 1;
        console.log('  bodyStart set to:', bodyStart);
      }
      b++;
    } else if (char === '}') {
      console.log('Found } at', i, 'p:', p, 'b:', b);
      b--;
      if (b === 0 && bodyStart !== -1) {
        return trimmedSource.slice(bodyStart, i);
      }
    }
  }
  return '';
}

const fullSource = signature + trimmedSource;
console.log('Result:', JSON.stringify(extractFunctionBody(fullSource, signature)));
