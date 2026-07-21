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
	partID?: string;
	status?: "pending" | "running" | "done" | "error" | "cancelled";
	activity: SharedActivityEvent;
};

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}

/** Convert persisted SDK tool data into text without losing object-shaped output. */
function toolDataText(value: unknown): string {
	if (typeof value === "string") return value.trim();
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (value === undefined || value === null) return "";

	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return "";
	}
}

function isLifecycleEnvelope(value: string | undefined): boolean {
	const text = value?.trim() || "";
	return /^(?:step\s+(?:started|finished)\b|[a-z][a-z0-9_-]*\s+-\s+(?:completed|running|pending|failed|error)\b)/i.test(text);
}

function displayToolLabel(value: string): string {
	const match = /^tool:\s*(.+)$/i.exec(value.trim());
	return (match?.[1] || value).trim();
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
		const output = toolDataText(state?.output);
		const inputSummary =
			toolDataText(input?.command) ||
			toolDataText(input?.pattern) ||
			toolDataText(input?.url) ||
			toolDataText(input?.query);
		const existing = byPartId.get(key);
		byPartId.set(key, {
			id: key,
			createdAt: Math.max(existing?.createdAt ?? 0, createdAt),
			partID: partId || undefined,
			status,
			activity: {
				key,
				kind: "activity",
				label: tool,
				// The raw rehydration tape is the only source for completed tool
				// results (e.g. webfetch). Keep its output on the normal activity
				// detail contract so SharedActivityStep renders it in the existing
				// collapsible content preview.
				summary: output || inputSummary,
				status,
				source: "stream",
				partType: "tool",
				partID: partId || undefined,
				startedAt: typeof startedAt === "number" ? startedAt : createdAt,
				activityDetail: { tool, input: input ?? {}, output },
				updateCount: 1,
			},
		});
	}
	return [...byPartId.values()].sort((left, right) => left.createdAt - right.createdAt);
}

/**
 * Live child-session tracking produces normalized events before (and sometimes
 * without) a raw tool-event tape. Keep those events visible in the canonical
 * modal so opening a subagent always shows its own activity timeline.
 */
function trackedActivityTimeline(
	detail: SubagentDetail,
	forceCancelled: boolean,
): ModalTimelineEvent[] {
	const tracked: ModalTimelineEvent[] = [];
	const status = forceCancelled ? "cancelled" : undefined;
	const timelinePartIds = new Set<string>();

	for (const event of detail.timelineEvents ?? []) {
		if (!event?.label) continue;
		if (
			event.type === "step-start" ||
			event.type === "step-finish" ||
			(event.type === "message.updated" &&
				(isLifecycleEnvelope(event.label) || event.label === "Completed"))
		) {
			continue;
		}
		if (event.partID) timelinePartIds.add(event.partID);
		const isThought = event.type === "reasoning" || event.type === "thinking" || event.type === "thought";
		const toolLabel = event.type === "tool" ? displayToolLabel(event.label) : "";
		const label = isThought ? "Thought" : toolLabel || event.type || "Activity";
		tracked.push({
			id: event.key || `timeline:${event.createdAt}:${event.label}`,
			createdAt: event.createdAt || Date.now(),
			partID: event.partID,
			status,
			activity: {
				key: event.key || `timeline:${event.createdAt}:${event.label}`,
				kind: isThought ? "reasoning" : "activity",
				label,
				summary: toolLabel ? undefined : event.label,
				status,
				source: "stream",
				partType: event.type || "activity",
				messageID: event.messageID,
				partID: event.partID,
				callID: event.callID,
				startedAt: event.createdAt,
				activityDetail: { tool: event.type || "activity", kind: isThought ? "reasoning" : "activity" },
				updateCount: 1,
			},
		});
	}

	for (const event of detail.thinkingEvents ?? []) {
		if (!event?.text || (event.partID && timelinePartIds.has(event.partID))) continue;
		tracked.push({
			id: event.id || `thought:${event.createdAt}:${event.text}`,
			createdAt: event.createdAt || Date.now(),
			partID: event.partID,
			status,
			activity: {
				key: event.id || `thought:${event.createdAt}:${event.text}`,
				kind: "reasoning",
				label: "Thought",
				summary: event.text,
				status,
				source: "stream",
				partType: "reasoning",
				messageID: event.messageID,
				partID: event.partID,
				startedAt: event.createdAt,
				activityDetail: { tool: "reasoning", kind: "reasoning" },
				updateCount: 1,
			},
		});
	}

	for (const event of detail.progressEvents ?? []) {
		if (!event?.title || (event.partID && timelinePartIds.has(event.partID))) continue;
		if (isLifecycleEnvelope(event.title) || /^[a-f0-9-]{16,}$/i.test(event.title)) continue;
		const label = displayToolLabel(event.title);
		tracked.push({
			id: event.id || `progress:${event.createdAt}:${event.title}`,
			createdAt: event.createdAt || Date.now(),
			partID: event.partID,
			status,
			activity: {
				key: event.id || `progress:${event.createdAt}:${event.title}`,
				kind: "activity",
				label,
				summary: event.meta,
				status,
				source: "stream",
				partType: "progress",
				messageID: event.messageID,
				partID: event.partID,
				startedAt: event.createdAt,
				activityDetail: { tool: "progress" },
				updateCount: 1,
			},
		});
	}

	for (const event of detail.conversationEvents ?? []) {
		if (!event?.text || (event.partID && timelinePartIds.has(event.partID))) continue;
		if (event.kind !== "message" || isLifecycleEnvelope(event.text)) continue;
		tracked.push({
			id: event.id || `message:${event.createdAt}:${event.text}`,
			createdAt: event.createdAt || Date.now(),
			partID: event.partID,
			status,
			activity: {
				key: event.id || `message:${event.createdAt}:${event.text}`,
				kind: "activity",
				label: event.kind === "reasoning" ? "Thought" : "Message",
				summary: event.text,
				status,
				source: "stream",
				partType: event.kind || "message",
				messageID: event.messageID,
				partID: event.partID,
				startedAt: event.createdAt,
				activityDetail: { tool: event.kind || "message" },
				updateCount: 1,
			},
		});
	}

	return tracked.sort((left, right) => left.createdAt - right.createdAt);
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
	const agentLabel = detail.agentId?.trim() || "Subagent";
	const taskLabel =
		detail.latestActivity && !["Completed", "Running", "Pending"].includes(detail.latestActivity)
			? detail.latestActivity
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
		const rawToolPartIds = new Set(
			rawTools.map((event) => event.partID).filter((id): id is string => Boolean(id)),
		);
		const tracked = trackedActivityTimeline(detail, status === "cancelled").filter(
			(event) => !event.partID || !rawToolPartIds.has(event.partID),
		);
		return [...rawTools, ...tracked].sort((left, right) => left.createdAt - right.createdAt);
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
				className="oc-modal-shell relative z-50 grid h-[min(72vh,620px)] min-h-0 w-full max-w-3xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden text-foreground animate-in zoom-in-95 duration-200"
				role="dialog"
				aria-modal="true"
				aria-label={title}
			>
				<div className="oc-modal-header shrink-0 bg-oc-panel-soft/70 p-2.5 sm:p-3">
					<div className="flex items-start justify-between gap-3">
							<div className="flex min-w-0 items-start gap-3">
								<div className="min-w-0">
									<div className="flex flex-wrap items-center gap-2">
										<span className="oc-subagent-modal-title text-[11px] font-semibold leading-tight">
											{agentLabel}
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
									{taskLabel && (
										<div className="mt-1 text-[11px] leading-[1.34] oc-text-secondary break-words">{taskLabel}</div>
									)}
									<div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10px] leading-[1.3] oc-text-secondary">
										{title !== agentLabel && <span>Model: {title}</span>}
										{backgroundTaskId && <span>BG: {backgroundTaskId}</span>}
										{detail.childSessionId && <span>Session: {detail.childSessionId}</span>}
									</div>
							</div>
						</div>
						<button
							type="button"
							className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-oc-border bg-oc-bg-soft oc-text-secondary transition-colors hover:bg-oc-panel hover:text-foreground"
							onClick={onClose}
							aria-label="Close"
						>
							<X className="h-4 w-4" />
						</button>
					</div>
				</div>

				<div className="oc-modal-content min-h-0 overflow-y-auto overscroll-contain p-2.5 sm:p-3">
					<div className="mb-2 flex items-center justify-between border-b border-oc-border-soft pb-1.5">
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
