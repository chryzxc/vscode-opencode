import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Check,
  Copy,
  FileText as FileTextIcon,
  Loader2,
  X
} from 'lucide-react';
import { marked } from 'marked';

import { cn } from '@/utils';

import type { Message, MessagePart, StreamingState } from './lib/types';
import vscode from './lib/vscode';

function InlineProgressSteps({ steps }: { steps: StreamingState['steps'] }) {
  const [open, setOpen] = useState(true);
  if (!steps.length) {
    return null;
  }

  return (
    <div className="oc-steps-wrap mt-3 rounded border border-[var(--vscode-panel-border)] p-2">
      <button
        type="button"
        className="oc-steps-header mb-1 flex w-full items-center gap-1 text-left text-xs"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Progress ({steps.length})
      </button>
      {open ? (
        <div className="space-y-1">
          {steps.map((step, index) => (
            <div
              key={`${step.id ?? step.callID ?? step.title}-${index}`}
              className="oc-step-item flex items-center gap-2 rounded border border-[var(--vscode-panel-border)] bg-black/10 px-2 py-1 text-xs"
            >
              {step.status === 'pending' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : step.status === 'error' ? (
                <X className="h-3 w-3" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              <span className="truncate">{step.title}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function messageBodyFromParts(parts?: MessagePart[]): string {
  if (!parts) {
    return '';
  }
  return parts.map((part) => part.text ?? part.content ?? '').join('').trim();
}

function reasoningFromParts(parts?: MessagePart[]): string {
  if (!parts) {
    return '';
  }
  return parts.map((part) => part.reasoning ?? part.thought ?? part.thinking ?? '').join('\n').trim();
}

function modelLabel(message: Message): string {
  const modelObj = message.info?.model;
  if (modelObj && typeof modelObj === 'object') {
    const name = (modelObj as Record<string, unknown>).name;
    const modelID = (modelObj as Record<string, unknown>).modelID;
    if (typeof name === 'string' && name) return name;
    if (typeof modelID === 'string' && modelID) return modelID;
  }
  const model = message.info?.modelID;
  const provider = message.info?.providerID;
  if (model && provider) return `${provider}/${model}`;
  return model ?? provider ?? 'assistant';
}

function getMessageContent(message?: Message, streaming?: StreamingState): string {
  if (streaming) {
    return streaming.content;
  }
  if (!message) {
    return '';
  }
  return message.content ?? message.text ?? messageBodyFromParts(message.parts);
}

export function UserMessage({ message }: { message: Message }) {
  const content = message.content ?? message.text ?? messageBodyFromParts(message.parts);
  const fileChips = (message.parts ?? [])
    .map((part) => part.filename ?? part.source?.path)
    .filter((value): value is string => !!value);

  // Compute initials from content first word / fallback 'U'
  const initials = useMemo(() => {
    const first = content.trim().split(/\s+/)[0] ?? '';
    return first.charAt(0).toUpperCase() || 'U';
  }, [content]);

  return (
    <div className="mb-4 flex items-end justify-end gap-2 px-3">
      <div className="w-fit max-w-[78%] rounded-2xl rounded-br-sm border border-[var(--vscode-button-background,var(--oc-border))]/30 bg-[var(--vscode-button-background,var(--oc-accent))]/15 px-3 py-2 text-[var(--oc-text)]">
        <div className="whitespace-pre-wrap text-sm leading-relaxed">{content}</div>
        {fileChips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {fileChips.map((file) => (
              <span key={file} className="rounded border border-[var(--vscode-panel-border)] px-2 py-0.5 text-[11px] opacity-70">
                {file}
              </span>
            ))}
          </div>
        )}
      </div>
      {/* Avatar circle */}
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--vscode-button-background,var(--oc-accent))]/40 bg-[var(--vscode-button-background,var(--oc-accent))]/25 text-[11px] font-bold font-mono">
        {initials}
      </div>
    </div>
  );
}

export function AssistantMessage({ message, streaming }: { message?: Message; streaming?: StreamingState }) {
  const [showThoughts, setShowThoughts] = useState(true);
  const [copied, setCopied] = useState(false);
  const content = getMessageContent(message, streaming);
  const parsed = marked.parse(content || '');
  const html = typeof parsed === 'string' ? parsed : '';

  const reasoning = streaming?.reasoning || reasoningFromParts(message?.parts);
  const steps = streaming?.steps ?? [];
  const edits = streaming?.edits ?? (message?.edits ?? []).map((edit) => edit.file);
  const info = message?.info;
  const plan = message?.plan;
  const showStreamingLoading = !message && !!streaming?.isActive;

  const agentName = info?.agent ?? 'assistant';
  const modelName = modelLabel(message ?? ({} as Message));

  // Token chip values
  const inputTok = info?.tokens?.input ?? 0;
  const outputTok = info?.tokens?.output ?? 0;
  const cacheRead = info?.tokens?.cache?.read ?? 0;
  const cacheWrite = info?.tokens?.cache?.write ?? 0;
  const duration = info?.duration ?? message?.timing?.duration ?? streaming?.usage?.duration;
  const hasTokens = inputTok > 0 || outputTok > 0;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="mb-4 px-3">
      <div className="rounded-xl border border-[var(--oc-border)] bg-[var(--oc-panel)] p-3">
        {/* Header row */}
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {showStreamingLoading ? (
              <div className="inline-flex items-center gap-1 text-[11px] font-mono opacity-70">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                <span className="ml-1">Thinking…</span>
              </div>
            ) : (
              <>
                {/* Dot + Agent label */}
                <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--oc-accent)]/60" />
                <span className="truncate text-[11px] font-mono font-semibold uppercase tracking-widest opacity-80">
                  {agentName}
                  {modelName && modelName !== 'assistant' ? ` · ${modelName}` : ''}
                </span>
                {/* Token chips */}
                {hasTokens && (
                  <div className="flex shrink-0 items-center gap-1 font-mono text-[10px] opacity-60">
                    <span className="uppercase">in</span>
                    <span className="tabular-nums">{inputTok.toLocaleString()}</span>
                    <span className="opacity-40">·</span>
                    <span className="uppercase">out</span>
                    <span className="tabular-nums">{outputTok.toLocaleString()}</span>
                    {cacheRead > 0 && (
                      <>
                        <span className="opacity-40">·</span>
                        <span className="uppercase">cr</span>
                        <span className="tabular-nums">{cacheRead.toLocaleString()}</span>
                      </>
                    )}
                    {cacheWrite > 0 && (
                      <>
                        <span className="opacity-40">·</span>
                        <span className="uppercase">cw</span>
                        <span className="tabular-nums">{cacheWrite.toLocaleString()}</span>
                      </>
                    )}
                    {typeof duration === 'number' && (
                      <>
                        <span className="opacity-40">·</span>
                        <span className="tabular-nums">{duration.toFixed(1)}s</span>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {plan ? (
              <button
                type="button"
                title="Core Feature: View Implementation Plan"
                onClick={() => vscode.postMessage({ type: 'viewPlan', plan })}
                className="inline-flex items-center gap-1 rounded border border-[var(--vscode-panel-border)] px-2 py-1 text-xs hover:bg-[var(--vscode-list-hoverBackground)]"
              >
                <FileTextIcon className="h-3.5 w-3.5" /> View Plan
              </button>
            ) : null}
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded hover:bg-[var(--vscode-list-hoverBackground)]"
              onClick={handleCopy}
              title="Copy message"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {/* Thoughts / Reasoning — borderless details */}
        {reasoning && (
          <details
            className="group mb-3"
            open={showThoughts}
            onToggle={(e) => setShowThoughts((e.target as HTMLDetailsElement).open)}
          >
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-mono opacity-60 hover:opacity-90">
              <span className="inline-block text-[10px] transition-transform group-open:rotate-90">›</span>
              Thoughts
            </summary>
            <div className="mt-1 border-l border-[var(--vscode-panel-border)] pl-3 text-xs leading-relaxed opacity-75">
              <div className="whitespace-pre-wrap">{reasoning}</div>
            </div>
          </details>
        )}

        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: markdown rendering requires HTML injection */}
        <div className="markdown-body text-sm" dangerouslySetInnerHTML={{ __html: html }} />

        {edits.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {edits.map((file) => (
              <button
                key={file}
                type="button"
                className="rounded border border-[var(--vscode-panel-border)] px-2 py-0.5 text-xs hover:bg-[var(--vscode-list-hoverBackground)]"
                onClick={() => vscode.postMessage({ type: 'openFile', file })}
              >
                {file}
              </button>
            ))}
          </div>
        )}

        {steps.length > 0 ? <InlineProgressSteps steps={steps} /> : null}

        {plan ? (
          <div className="plan-card mt-2 rounded border border-[var(--vscode-panel-border)] p-3">
            <div className="mb-2 font-medium">Implementation Plan</div>
            <button
              type="button"
              title="Core Feature: Do not remove"
              onClick={() => vscode.postMessage({ type: 'viewPlan', plan })}
              className="rounded border border-[var(--vscode-panel-border)] px-2 py-1 text-xs hover:bg-[var(--vscode-list-hoverBackground)]"
            >
              View Implementation Plan
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function PermissionCard({ perm }: { perm: unknown }) {
  const label = typeof perm === 'string' ? perm : JSON.stringify(perm);
  return (
    <div className="mb-4 px-3">
      <div className="rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
        <div className="mb-1 font-medium">Permission Required</div>
        <div className="opacity-80">{label}</div>
      </div>
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mb-3 px-3">
      <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{message}</div>
    </div>
  );
}

export function ThinkingBubble() {
  return (
    <div className="mb-4 px-3">
      <div className="inline-flex items-center gap-1 rounded-full border border-[var(--vscode-panel-border)] bg-black/10 px-3 py-2">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className={cn('h-1.5 w-1.5 rounded-full bg-current opacity-70', index > 0 ? 'ml-0.5' : '')}
            style={{ animation: `thinking-pulse 1.3s ${index * 0.16}s infinite` }}
          />
        ))}
        <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin" />
      </div>
    </div>
  );
}

export function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center opacity-85">
      <div className="oc-empty-icon mb-2">
        ✴
      </div>
      <div className="text-xl font-semibold text-[var(--oc-accent)]">OpenCode</div>
      <div className="text-sm opacity-70">Ready to help you build.</div>
    </div>
  );
}

export function MessageStatus({ active, failed }: { active: boolean; failed: boolean }) {
  return (
    <div className="mb-2 px-3 text-xs opacity-70">
      <span className="inline-flex items-center gap-1">
        {active ? <Loader2 className="h-3 w-3 animate-spin" /> : failed ? <X className="h-3 w-3" /> : <Check className="h-3 w-3" />}
        {active ? 'Working...' : failed ? 'Failed' : 'Done'}
      </span>
    </div>
  );
}
