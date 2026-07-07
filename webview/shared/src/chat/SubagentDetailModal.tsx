import { Copy, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/utils";
import { Badge } from "@/components/ui/badge";
import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { Stepper, StepperItem } from "@/components/ui/stepper";
import { StepIndicator } from "@/components/ui/StepIndicator";

import type { SubagentDetail } from "./lib/subagents/types";

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

function isBackgroundTaskId(value: string | undefined): boolean {
	if (!value) return false;
	return /^bg_[a-z0-9]+$/i.test(value.trim());
}

function isStopLike(value: string | undefined): boolean {
	if (!value) return false;
	const normalized = value.trim().toLowerCase();
	return normalized === "stop" || normalized === "stopped";
}

function resolveDisplayStatus(detail: SubagentDetail): "pending" | "running" | "done" | "error" | "orphaned" {
	const status = (detail.status || "running").toLowerCase();
	if (status === "error" || status === "orphaned" || status === "pending") {
		return status;
	}

	const timeline = Array.isArray(detail.timelineEvents) ? detail.timelineEvents : [];
	const progress = Array.isArray(detail.progressEvents) ? detail.progressEvents : [];
	const conversation = Array.isArray(detail.conversationEvents) ? detail.conversationEvents : [];

	const latestTimeline = [...timeline].sort((a, b) => b.createdAt - a.createdAt)[0];
	const latestProgress = [...progress].sort((a, b) => b.createdAt - a.createdAt)[0];
	const latestConversation = [...conversation].sort((a, b) => b.createdAt - a.createdAt)[0];

	// Terminal stop marker should count as completion in the modal.
	const hasTerminalStop =
		isStopLike(latestTimeline?.type) ||
		isStopLike(latestTimeline?.label) ||
		isStopLike(latestProgress?.title) ||
		isStopLike(latestConversation?.kind);

	if (hasTerminalStop) {
		return "done";
	}

	// Strict rule: never show DONE without an explicit terminal stop marker.
	// Upstream summaries can transiently report done before final stop arrives.
	if (status === "done") {
		return "running";
	}

	return status === "running" ? "running" : "pending";
}

type SubagentDetailModalProps = {
	isOpen: boolean;
	title: string;
	detail: SubagentDetail;
	onClose: () => void;
	onCopyRefs: (detail: SubagentDetail) => void;
	onJumpToParent: () => void;
	colorClass?: string;
};

export function SubagentDetailModal({
	isOpen,
	title,
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

	const status = resolveDisplayStatus(detail);
	const isDone = status === "done";
	const isError = status === "error";
	const backgroundTaskId = isBackgroundTaskId(detail.backgroundTaskId)
		? detail.backgroundTaskId
		: isBackgroundTaskId(detail.id)
			? detail.id
			: undefined;

	const hasTerminalStopMarker = useMemo(() => {
		const timeline = Array.isArray(detail.timelineEvents) ? detail.timelineEvents : [];
		const progress = Array.isArray(detail.progressEvents) ? detail.progressEvents : [];
		const conversation = Array.isArray(detail.conversationEvents) ? detail.conversationEvents : [];
		return (
			timeline.some((event) => isStopLike(event.type) || isStopLike(event.label)) ||
			progress.some((event) => isStopLike(event.title)) ||
			conversation.some((event) => isStopLike(event.kind))
		);
	}, [detail.timelineEvents, detail.progressEvents, detail.conversationEvents]);

	// Filter and deduplicate conversation events for stepper display
	const renderedConversation = useMemo(() => {
		const source = Array.isArray(detail.conversationEvents)
			? detail.conversationEvents
			: [];

		// Show latest activity first so current progress stays at the top.
		const sorted = [...source].sort((a, b) => b.createdAt - a.createdAt);

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

	// Debug logging for conversation events
	useEffect(() => {
	}, [detail.conversationEvents, detail.progressEvents, detail.timelineEvents]);

	const shouldShowLoadingTimelineStep =
		!isError &&
		!hasTerminalStopMarker &&
		status !== "done" &&
		renderedConversation.length === 0;

	// Determine step status based on event position in newest-first ordering.
	const getStepStatus = (index: number): 'pending' | 'done' | 'error' | 'running' => {
		// First visible item is the freshest event in newest-first mode.
		if (index === 0 && shouldShowLoadingTimelineStep) return 'running';
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
				className="oc-modal-shell relative z-50 flex h-[min(92vh,860px)] min-h-0 w-full max-w-5xl flex-col overflow-hidden text-foreground animate-in zoom-in-95 duration-200"
				role="dialog"
				aria-modal="true"
				aria-label={title}
			>
				<div className="oc-modal-header shrink-0 bg-oc-panel-soft/70 p-3 sm:p-4">
					<div className="flex items-start justify-between gap-3">
							<div className="flex min-w-0 items-start gap-3">
								<div className="min-w-0">
									<div className="flex flex-wrap items-center gap-2">
										<span className="oc-subagent-modal-title text-sm font-semibold sm:text-base">
											{title}
										</span>
									<Badge
										variant="outline"
										className={cn(
											"h-5 px-2 text-[10px] font-medium tracking-wider",
											isDone
												? "border-none bg-transparent oc-text-secondary"
												: isError
													? "border-destructive bg-transparent text-destructive"
													: "border-transparent bg-oc-accent/18 oc-tinted-badge-text",
										)}
									>
										{status.toUpperCase()}
									</Badge>
								</div>
								{detail.childSessionId && (
									<div className="mt-1 text-xs font-medium oc-text-secondary break-words">
										Session: {detail.childSessionId}
									</div>
								)}
								{backgroundTaskId && (
									<div className="mt-1 text-xs font-medium oc-text-secondary break-words">
										BG ID: {backgroundTaskId}
									</div>
								)}
							</div>
						</div>
						<button
							type="button"
							className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-oc-border bg-oc-bg-soft oc-text-secondary transition-colors hover:bg-oc-panel hover:text-foreground"
							onClick={onClose}
							aria-label="Close"
						>
							<X className="h-5 w-5" />
						</button>
					</div>
					<div className="mt-3 flex flex-wrap items-center gap-2">
						<button
							type="button"
							className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-oc-border bg-oc-bg-soft px-3 py-1.5 text-xs font-medium oc-text-secondary transition-colors hover:bg-oc-panel hover:text-foreground sm:w-auto"
							onClick={handleCopy}
						>
							<Copy className="h-3.5 w-3.5" />
							<span>{copied ? "Copied" : "Copy Refs"}</span>
						</button>
						<button
							type="button"
							className="inline-flex w-full items-center justify-center rounded-md border border-oc-border bg-oc-bg-soft px-3 py-1.5 text-xs font-medium oc-text-secondary transition-colors hover:bg-oc-panel hover:text-foreground sm:w-auto"
							onClick={onJumpToParent}
						>
							Jump to Parent
						</button>
					</div>
				</div>

				<div className="oc-modal-content min-h-0 flex-1 overflow-y-auto p-3 sm:p-4 lg:p-5">
					<div className="sticky top-0 z-[1] mb-3 flex items-center justify-between border-b border-oc-border-soft bg-oc-panel/95 pb-2 backdrop-blur-sm">
						<span className="text-[11px] font-medium uppercase tracking-wider text-oc-text-soft">
							Assistant Conversation
						</span>
						<span className="rounded-md border border-oc-border-soft px-2 py-0.5 text-[10px] font-medium text-oc-text-soft">
							{renderedConversation.length} messages
						</span>
					</div>

					{renderedConversation.length > 0 || shouldShowLoadingTimelineStep ? (
						<Stepper
							className="oc-refined-stepper oc-activity-timeline-compact max-h-[600px] overflow-y-auto pl-2"
							autoScrollToBottom={false}
						>
							{shouldShowLoadingTimelineStep && (
								<StepperItem
									isLast={renderedConversation.length === 0}
									indicator={<StepIndicator status="running" />}
									className="oc-refined-stepper-item group"
								>
									<div className="flex min-w-0 flex-col items-start gap-2 w-full">
										<div className="flex items-center gap-2 flex-wrap">
											<span className="oc-refined-event-label">Step</span>
											<span className="text-[10px] font-medium text-oc-text-soft">
												Now
											</span>
										</div>
										<div className="oc-refined-event-content text-[12px] text-oc-text-soft italic">
											Waiting for next progress...
										</div>
									</div>
								</StepperItem>
							)}
							{renderedConversation.map((event, index) => {
								const isLast = index === renderedConversation.length - 1;
								const stepStatus = getStepStatus(index);
								const stepLabel = getStepLabel(event.kind);

								return (
									<StepperItem
										key={event.id}
										isLast={isLast}
										indicator={<StepIndicator status={stepStatus} />}
										className="oc-refined-stepper-item group"
									>
										<div className="flex min-w-0 flex-col items-start gap-2 w-full">
											<div className="flex items-center gap-2 flex-wrap">
												<span className="oc-refined-event-label">
													{stepLabel}
												</span>
												<span className="text-[10px] font-medium text-oc-text-soft">
													{new Date(event.createdAt).toLocaleTimeString([], {
														hour: "2-digit",
														minute: "2-digit",
														second: "2-digit",
													})}
												</span>
											</div>

											<div className="oc-refined-event-content">
												<MarkdownRenderer content={event.text} />
											</div>
										</div>
									</StepperItem>
								);
							})}
						</Stepper>
					) : (
						<div className="rounded-lg border border-dashed border-oc-border bg-oc-bg-soft/50 p-6 text-center text-sm italic oc-text-secondary">
							No assistant conversation available yet for this subagent session.
						</div>
					)}
				</div>
			</div>
		</div>
	);

	return createPortal(modalContent, document.body);
}
