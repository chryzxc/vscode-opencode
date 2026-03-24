function extractFunctionBody(source, signature) {
  const startIndex = source.indexOf(signature);
  if (startIndex === -1) return '';

  const trimmedSource = source.slice(startIndex + signature.length);

  // Calculate starting parenLevel based on the source before trimmedSource
  let parenLevel = 0;
  for (let j = 0; j < startIndex + signature.length; j++) {
    if (source[j] === '(') parenLevel++;
    if (source[j] === ')') parenLevel--;
  }

  let braceLevel = 0;
  let start = -1;

  for (let i = 0; i < trimmedSource.length; i++) {
    const char = trimmedSource[i];
    if (char === '(') parenLevel++;
    else if (char === ')') parenLevel--;
    else if (char === '{') {
      if (braceLevel === 0) {
        if (parenLevel > 0) {
          // Inside parameters (e.g. diagnostics?: { ... }), skip this block
          let nested = 1;
          let j = i + 1;
          while (j < trimmedSource.length && nested > 0) {
            if (trimmedSource[j] === '{') nested++;
            else if (trimmedSource[j] === '}') nested--;
            j++;
          }
          i = j - 1;
          continue;
        }

        // Outside parameters. Check if it's a return type.
        const before = trimmedSource.slice(0, i).trim();
        if (before.endsWith(':') && !before.includes('case')) {
          // Skip return type
          let nested = 1;
          let j = i + 1;
          while (j < trimmedSource.length && nested > 0) {
            if (trimmedSource[j] === '{') nested++;
            else if (trimmedSource[j] === '}') nested--;
            j++;
          }
           i = j - 1;
           continue;
        }
        start = i + 1;
      }
      braceLevel++;
    } else if (char === '}') {
      braceLevel--;
      if (braceLevel === 0) {
        return trimmedSource.slice(start, i);
      }
    }
  }
  return '';
}

const source = `
  private normalizeStructuredOutput(
    raw: unknown,
    diagnostics?: {
      source?: string;
      providerID?: string;
      modelID?: string;
    },
  ): StructuredAssistantOutput | undefined {
    let value: unknown = raw;
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        return undefined;
      }
    }
    return { responseType: "message" };
  }

  case "newSession": {
    await clear();
  }
`;

console.log("--- normalize ---");
console.log(extractFunctionBody(source, 'private normalizeStructuredOutput('));
console.log("--- case ---");
console.log(extractFunctionBody(source, 'case "newSession":'));
