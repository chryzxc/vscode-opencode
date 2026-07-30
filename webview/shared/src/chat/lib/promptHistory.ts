import type { Message } from "./types";

function getMessageRole(message: Message): string {
  return String(message.role ?? message.info?.role ?? "").toLowerCase();
}

function getMessageText(message: Message): string {
  const directText = [
    message.content,
    message.text,
    message.info?.content,
    message.info?.text,
  ].find((value): value is string => typeof value === "string" && value.trim().length > 0);

  if (directText) {
    return directText.trim();
  }

  return (message.parts ?? [])
    .filter((part) => part.type === "text" || !part.type)
    .map((part) => part.text ?? part.content ?? "")
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n")
    .trim();
}

function getMessageCreatedAt(message: Message): number | undefined {
  const created = message.created ?? message.info?.created ?? message.info?.time?.created;
  return typeof created === "number" && Number.isFinite(created) ? created : undefined;
}

/** Returns distinct user prompts in chronological order for composer history. */
export function getPromptHistory(messages: Message[]): string[] {
  const indexed = messages
    .map((message, index) => ({ message, index, created: getMessageCreatedAt(message) }))
    .filter(({ message }) => getMessageRole(message) === "user")
    .sort((left, right) => {
      if (left.created === undefined || right.created === undefined) {
        return left.index - right.index;
      }
      return left.created - right.created || left.index - right.index;
    });

  const history: string[] = [];
  const seen = new Set<string>();
  for (const { message } of indexed) {
    const text = getMessageText(message);
    if (text && !seen.has(text)) {
      seen.add(text);
      history.push(text);
    }
  }
  return history;
}

export function getPreviousPromptIndex(index: number | null, historyLength: number): number | null {
  if (historyLength === 0) return null;
  return index === null ? historyLength - 1 : Math.max(index - 1, 0);
}

export function getNextPromptIndex(index: number | null, historyLength: number): number | null {
  if (index === null || historyLength === 0) return null;
  return index + 1 < historyLength ? index + 1 : null;
}
