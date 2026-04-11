import { Copy, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/utils";
import { Badge } from "@/components/ui/badge";
import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { Stepper, StepperItem } from "@/components/ui/stepper";
import { StepIndicator } from "@/components/ui/StepIndicator";

import type { SubagentDetail } from "./lib/types";

function isOpaqueIdLike(value: string): boolean {
	const text = value.trim();
	if (text.length < 8) {
		return false;
	}
	return (
		/^[a-f0-9-]{8,}$/i.test(text) ||
		/^msg[_-][a-z0-9-]+$/i.test(text) ||
		/^call[_-][a-z0-9-]+$/i.test(text) ||
		/^ses[_-][a-z0-9-]+$/i.test(text)
	);
}

function cleanLabel(value: string): string {
	const trimmed = value.trim().replace(/\s+/g, " ");
	if (!trimmed || isOpaqueIdLike(trimmed)) {
		return "";
	}
	return trimmed;
}

type SubagentDetailModalProps = {
	isOpen: boolean;
	title: string;
	providerLabel?: string;
	detail: SubagentDetail;
	onClose: () => void;
	onCopyRefs: (detail: SubagentDetail) => void;
	onJumpToParent: () => void;
	colorClass?: string;
};

export function SubagentDetailModal({
	isOpen,
	title,
	providerLabel,
	detail,
	onClose,
	onCopyRefs,
	onJumpToParent,
	colorClass,
}: SubagentDetailModalProps) {
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!isOpen) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				onClose();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [isOpen, onClose]);

	if (!isOpen) return null;

	const handleCopy = () => {
		onCopyRefs(detail);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	const status = detail.status || "running";
	const isDone = status === "done";
	const isError = status === "error";

	// Filter and deduplicate conversation events for stepper display
	const renderedConversation = useMemo(() => {
		const source = Array.isArray(detail.conversationEvents)
			? detail.conversationEvents
			: [];

		// Sort by creation time
		const sorted = [...source].sort((a, b) => a.createdAt - b.createdAt);

		// Filter out non-assistant events, stop events, and empty text
		const filtered = sorted.filter((event) => {
			const role = (event.role || "").toLowerCase();
			const kind = (event.kind || "").toLowerCase();
			const hasContent = cleanLabel(event.text || "").length > 0;

			// Only show assistant messages with content
			if (role !== "assistant" || !hasContent) return false;

			// Filter out stop, error, and other non-content events
			const excludedKinds = ["stop", "error", "exception", "cancelled", "cancel"];
			if (excludedKinds.includes(kind)) return false;

			return true;
		});

		// Remove duplicate messages based on text content
		const seenTexts = new Set<string>();
		const deduped: typeof filtered = [];

		for (const event of filtered) {
			const normalizedText = (event.text || "").trim().toLowerCase();
			// Create a simple hash of the text for comparison
			const textHash = normalizedText.slice(0, 100); // First 100 chars as signature

			if (!seenTexts.has(textHash)) {
				seenTexts.add(textHash);
				deduped.push(event);
			}
		}

		return deduped;
	}, [detail.conversationEvents]);

	// Determine step status based on event kind and position
	const getStepStatus = (index: number, total: number, kind?: string): 'pending' | 'done' | 'error' | 'running' => {
		// Last step is "running" if subagent is still active
		if (index === total - 1 && !isDone && !isError) return 'running';
		return 'done';
	};

	// Get step label from event kind
	const getStepLabel = (kind?: string): string => {
		if (!kind) return "Response";
		const kindLower = kind.toLowerCase();
		switch (kindLower) {
			case 'message': return "Message";
			case 'reasoning': return "Reasoning";
			case 'step': return "Step";
			default: return kind.charAt(0).toUpperCase() + kind.slice(1);
		}
	};

	const modalContent = (
		<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-2 backdrop-blur-sm animate-in fade-in duration-200 sm:p-4 md:p-6">
			<button
				type="button"
				className="absolute inset-0 h-full w-full cursor-default"
				onClick={onClose}
				aria-label="Close subagent details"
			/>
			<div
				className="relative z-50 flex h-[min(92vh,860px)] min-h-0 w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-oc-border bg-oc-panel text-foreground shadow-2xl animate-in zoom-in-95 duration-200"
				role="dialog"
				aria-modal="true"
				aria-label={title}
			>
				<div className="shrink-0 border-b border-oc-border bg-oc-panel-soft/70 p-3 sm:p-4">
					<div className="flex items-start justify-between gap-3">
						<div className="flex min-w-0 items-start gap-3">
							<div className={cn("mt-0.5 flex shrink-0 items-center justify-center", colorClass)}>
								<Sparkles className="h-5 w-5" />
							</div>
							<div className="min-w-0">
								<div className="flex flex-wrap items-center gap-2">
									<span className={cn("text-sm font-semibold sm:text-base", colorClass)}>
										{title}
									</span>
									<Badge
										variant="outline"
										className={cn(
											"h-5 px-2 text-[10px] font-mono tracking-wider",
											isDone
												? "border-muted-foreground/50 bg-transparent text-muted-foreground"
												: isError
													? "border-destructive bg-transparent text-destructive"
													: "border-primary bg-transparent text-primary pulse-border",
										)}
									>
										{status.toUpperCase()}
									</Badge>
								</div>
								<div className="mt-1 text-xs font-mono text-muted-foreground break-words">
									{providerLabel ?? "Unknown provider"}
								</div>
								{detail.childSessionId && (
									<div className="mt-1 text-xs font-mono text-muted-foreground break-words">
										Session: {detail.childSessionId}
									</div>
								)}
							</div>
						</div>
						<button
							type="button"
							className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-oc-border bg-oc-bg-soft text-muted-foreground transition-colors hover:bg-oc-panel hover:text-foreground"
							onClick={onClose}
							aria-label="Close"
						>
							<X className="h-5 w-5" />
						</button>
					</div>
					<div className="mt-3 flex flex-wrap items-center gap-2">
						<button
							type="button"
							className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-oc-border bg-oc-bg-soft px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-oc-panel hover:text-foreground sm:w-auto"
							onClick={handleCopy}
						>
							<Copy className="h-3.5 w-3.5" />
							<span>{copied ? "Copied" : "Copy Refs"}</span>
						</button>
						<button
							type="button"
							className="inline-flex w-full items-center justify-center rounded-md border border-oc-border bg-oc-bg-soft px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-oc-panel hover:text-foreground sm:w-auto"
							onClick={onJumpToParent}
						>
							Jump to Parent
						</button>
					</div>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4 lg:p-5">
					<div className="sticky top-0 z-[1] mb-3 flex items-center justify-between border-b border-oc-border/70 bg-oc-panel/95 pb-2 backdrop-blur-sm">
						<span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
							Assistant Conversation
						</span>
						<span className="rounded-md border border-oc-border px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
							{renderedConversation.length} messages
						</span>
					</div>

					{renderedConversation.length > 0 ? (
						<Stepper
							className="oc-refined-stepper max-h-[600px] overflow-y-auto pl-2"
							autoScrollToBottom={!isDone && !isError}
						>
							{renderedConversation.map((event, index) => {
								const isLast = index === renderedConversation.length - 1;
								const stepStatus = getStepStatus(index, renderedConversation.length, event.kind);
								const stepLabel = getStepLabel(event.kind);

								return (
									<StepperItem
										key={event.id}
										isLast={isLast}
										indicator={<StepIndicator status={stepStatus} />}
										className="oc-refined-stepper-item group"
									>
										<div className="flex min-w-0 flex-col gap-2 w-full">
											{/* Step header with label and timestamp */}
											<div className="flex items-center gap-2 flex-wrap">
												<span className="inline-block min-w-[70px] shrink-0 rounded border border-oc-border px-2 py-[3px] text-center font-mono text-[10px] font-semibold text-oc-text-muted bg-oc-bg-soft/50">
													{stepLabel}
												</span>
												<span className="text-[10px] font-mono text-oc-text-muted/70">
													{new Date(event.createdAt).toLocaleTimeString([], {
														hour: "2-digit",
														minute: "2-digit",
														second: "2-digit",
													})}
												</span>
											</div>

											{/* Step content */}
											<div className="overflow-hidden rounded-md border border-oc-border/60 bg-oc-panel/60 px-3 py-2">
												<MarkdownRenderer content={event.text} />
											</div>
										</div>
									</StepperItem>
								);
							})}
						</Stepper>
					) : (
						<div className="rounded-lg border border-dashed border-oc-border bg-oc-bg-soft/50 p-6 text-center text-sm italic text-muted-foreground/70">
							No assistant conversation available yet for this subagent session.
						</div>
					)}
				</div>
			</div>
		</div>
	);

	return createPortal(modalContent, document.body);
}
