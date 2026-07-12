import { X } from "lucide-react";
import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/utils";
import { Badge } from "@/components/ui/badge";
import { Stepper } from "@/components/ui/stepper";
import { ActivityTimelineItem } from "./components/activity-steps/ActivityTimelineItem";
import { SharedActivityStep, type SharedActivityEvent } from "./MessageComponents";

import type { SubagentDetail } from "./lib/subagents/types";

type ModalTimelineEvent = {
	id: string;
	createdAt: number;
	status?: "pending" | "running" | "done" | "error" | "cancelled";
	activity: SharedActivityEvent;
};

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}

function rawToolTimeline(detail: SubagentDetail, forceCancelled: boolean): ModalTimelineEvent[] {
	const events = Array.isArray(detail.rawEvents) ? detail.rawEvents : [];
	const byPartId = new Map<string, ModalTimelineEvent>();
	for (const rawEvent of events) {
		const event = record(rawEvent);
		const properties = record(event?.properties);
		const part = record(properties?.part);
		if (!part || part.type !== "tool") continue;
		const partId = typeof part.id === "string" ? part.id : "";
		const tool = typeof part.tool === "string" ? part.tool : "tool";
		const state = record(part.state);
		const stateStatus = typeof state?.status === "string" ? state.status.toLowerCase() : "pending";
		const parsedStatus = stateStatus === "error" || stateStatus === "failed"
			? "error"
			: stateStatus === "done" || stateStatus === "completed" || stateStatus === "success"
				? "done"
				: stateStatus === "running" ? "running" : "pending";
		const status = forceCancelled && (parsedStatus === "running" || parsedStatus === "pending")
			? "cancelled"
			: parsedStatus;
		const startedAt = record(state?.time)?.start;
		const createdAt = typeof properties?.time === "number"
			? properties.time
			: typeof startedAt === "number" ? startedAt : Date.now();
		const key = partId || `${tool}:${createdAt}`;
		const input = record(state?.input);
		const existing = byPartId.get(key);
		byPartId.set(key, {
			id: key,
			createdAt: Math.max(existing?.createdAt ?? 0, createdAt),
			status,
			activity: {
				key,
				kind: "activity",
				label: tool,
				summary: typeof input?.command === "string" ? input.command : typeof input?.pattern === "string" ? input.pattern : "",
				status,
				startedAt: typeof startedAt === "number" ? startedAt : createdAt,
				activityDetail: { tool, input: input ?? {} },
				updateCount: 1,
			},
		});
	}
	return [...byPartId.values()].sort((left, right) => left.createdAt - right.createdAt);
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

function resolveDisplayStatus(
	detail: SubagentDetail,
	parentResponseFinished: boolean,
): "pending" | "running" | "done" | "error" | "orphaned" | "cancelled" {
	const status = (detail.status || "running").toLowerCase();
	if (parentResponseFinished && (status === "running" || status === "pending")) {
		return "cancelled";
	}
	if (status === "error" || status === "orphaned" || status === "pending" || status === "cancelled") {
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
	parentResponseFinished: boolean;
	onClose: () => void;
};

export function SubagentDetailModal({
	isOpen,
	title,
	detail,
	parentResponseFinished,
	onClose,
}: SubagentDetailModalProps) {
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

	useEffect(() => {
		if (!isOpen) return;

		const previousBodyOverflow = document.body.style.overflow;
		const previousDocumentOverflow = document.documentElement.style.overflow;
		document.body.style.overflow = "hidden";
		document.documentElement.style.overflow = "hidden";

		return () => {
			document.body.style.overflow = previousBodyOverflow;
			document.documentElement.style.overflow = previousDocumentOverflow;
		};
	}, [isOpen]);

	if (!isOpen) return null;

	const status = resolveDisplayStatus(detail, parentResponseFinished);
	const isDone = status === "done";
	const isError = status === "error";
	const isCancelled = status === "cancelled";
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

	const renderedTimeline = useMemo<ModalTimelineEvent[]>(() => {
		const rawTools = rawToolTimeline(detail, status === "cancelled");
		if (rawTools.length > 0) return rawTools;
		return [];
	}, [detail]);

	// Debug logging for conversation events
	useEffect(() => {
	}, [detail.conversationEvents, detail.progressEvents, detail.timelineEvents]);

	const shouldShowLoadingTimelineStep =
		!isError &&
		!isCancelled &&
		!hasTerminalStopMarker &&
		status !== "done" &&
		renderedTimeline.length === 0;

	// Determine step status based on event position in newest-first ordering.
	const getStepStatus = (index: number): 'pending' | 'done' | 'error' | 'running' | 'cancelled' => {
		// First visible item is the freshest event in newest-first mode.
		if (index === 0 && shouldShowLoadingTimelineStep) return 'running';
		return 'done';
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
				className="oc-modal-shell relative z-50 grid h-[min(92vh,860px)] min-h-0 w-full max-w-5xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden text-foreground animate-in zoom-in-95 duration-200"
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
												: isCancelled
													? "border-none bg-transparent oc-text-secondary"
													: "border-transparent bg-oc-accent/18 oc-tinted-badge-text",
										)}
									>
										{status.toUpperCase()}
									</Badge>
								</div>
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
				</div>

				<div className="oc-modal-content min-h-0 overflow-y-auto overscroll-contain p-3 sm:p-4 lg:p-5">
					<div className="mb-3 flex items-center justify-between border-b border-oc-border-soft pb-2">
						<span className="text-[11px] font-medium uppercase tracking-wider text-oc-text-soft">
							Activity Timeline
						</span>
						<span className="rounded-md border border-oc-border-soft px-2 py-0.5 text-[10px] font-medium text-oc-text-soft">
							{renderedTimeline.length} events
						</span>
					</div>

					{renderedTimeline.length > 0 || shouldShowLoadingTimelineStep ? (
						<Stepper
							className="oc-refined-stepper oc-activity-timeline-compact pl-2"
							autoScrollToBottom={false}
						>
							{shouldShowLoadingTimelineStep && (
								<ActivityTimelineItem id="waiting" isLast={renderedTimeline.length === 0} status="running">
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
								</ActivityTimelineItem>
							)}
							{renderedTimeline.map((event, index) => {
								const isLast = index === renderedTimeline.length - 1;
								const stepStatus = event.status || getStepStatus(index);

								return (
									<ActivityTimelineItem id={event.id} isLast={isLast} status={stepStatus}>
										<SharedActivityStep event={event.activity} />
									</ActivityTimelineItem>
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
