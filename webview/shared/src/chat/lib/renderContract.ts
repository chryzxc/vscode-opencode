import type { Message, StreamingState } from "./types";

/**
 * The only source-aware boundary for chat rendering. Raw SDK payloads are
 * interpreted before this point; all UI code consumes these blocks instead.
 */
export type RenderBlock =
  | { kind: "message"; source: "live" | "rehydrated"; message: Message }
  | {
      kind: "fileChanges";
      source: "live" | "rehydrated";
      ownerMessageId: string;
      message: Message;
    }
  | { kind: "streaming"; source: "live"; streaming: StreamingState };

type RenderBlockKind = RenderBlock["kind"];
type BlockOfKind<K extends RenderBlockKind> = Extract<RenderBlock, { kind: K }>;

export type RehydratedRenderSource = {
  kind: "rehydrated";
  messages: Message[];
};

export type LiveRenderSource = {
  kind: "live";
  messages: Message[];
  streaming: StreamingState | null | undefined;
};

/**
 * Adding a RenderBlock kind makes TypeScript require an explicit mapping for
 * both source shapes. A source may return no blocks of a kind, but that is a
 * deliberate, typed decision rather than an accidental UI omission.
 */
type SourceBlockBuilders<TSource> = {
  [K in RenderBlockKind]: (source: TSource) => BlockOfKind<K>[];
};

function messageBlocks(
  source: "live" | "rehydrated",
  messages: Message[],
): BlockOfKind<"message">[] {
  return messages.map((message) => ({ kind: "message", source, message }));
}

function fileChangeBlocks(
  source: "live" | "rehydrated",
  messages: Message[],
): BlockOfKind<"fileChanges">[] {
  return messages.flatMap((message) => {
    const ownerMessageId = message.changeSummary?.messageId ?? message.info?.id ?? message.id;
    return message.changeSummary && ownerMessageId
      ? [{ kind: "fileChanges", source, ownerMessageId, message }]
      : [];
  });
}

const rehydratedBuilders = {
  message: ({ messages }) => messageBlocks("rehydrated", messages),
  fileChanges: ({ messages }) => fileChangeBlocks("rehydrated", messages),
  streaming: () => [],
} satisfies SourceBlockBuilders<RehydratedRenderSource>;

const liveBuilders = {
  message: ({ messages }) => messageBlocks("live", messages),
  fileChanges: ({ messages }) => fileChangeBlocks("live", messages),
  streaming: ({ streaming }) =>
    streaming ? [{ kind: "streaming", source: "live", streaming }] : [],
} satisfies SourceBlockBuilders<LiveRenderSource>;

export function buildRenderBlocks(source: RehydratedRenderSource): RenderBlock[];
export function buildRenderBlocks(source: LiveRenderSource): RenderBlock[];
export function buildRenderBlocks(
  source: RehydratedRenderSource | LiveRenderSource,
): RenderBlock[] {
  const builders = source.kind === "live" ? liveBuilders : rehydratedBuilders;
  // The caller owns placement. Builders remain source-specific, while every
  // rendered value has the same discriminated block contract.
  return [
    ...builders.message(source as never),
    ...builders.fileChanges(source as never),
    ...builders.streaming(source as never),
  ];
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled render block: ${JSON.stringify(value)}`);
}
