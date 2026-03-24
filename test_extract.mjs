import { extractFunctionBody } from './tests/helpers/source-utils.mjs';

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

  private other() {
    return 1;
  }
`;

console.log("--- Body ---");
console.log(extractFunctionBody(source, 'private normalizeStructuredOutput('));
console.log("--- End ---");
