import { Check, Copy, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/utils";
import { Badge } from "@/components/ui/badge";
import { Stepper, StepperItem } from "@/components/ui/stepper";

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
	const timelineScrollRef = useRef<HTMLDivElement>(null);

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

	// Auto-scroll timeline to latest activity
	useEffect(() => {
		if (timelineScrollRef.current && detail.timelineEvents?.length > 0) {
			timelineScrollRef.current.scrollTop = timelineScrollRef.current.scrollHeight;
		}
	}, [detail.timelineEvents?.length]);

	if (!isOpen) return null;

	const handleCopy = () => {
		onCopyRefs(detail);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	const status = detail.status || "running";
	const isDone = status === "done";
	const isError = status === "error";
	const hasRawProgressEvents = (detail.progressEvents?.length || 0) > 0;
	const latestActivity = cleanLabel(detail.latestActivity || "") || "Initializing...";
	const renderedProgress = useMemo(() => {
		const source = Array.isArray(detail.progressEvents) ? detail.progressEvents : [];
		const mergedByCall = new Map<string, (typeof source)[number]>();
		const kept: typeof source = [];
		for (const event of source) {
			const title = cleanLabel(event.title || "");
			if (!title) {
				continue;
			}
			const normalized = {
				...event,
				title,
				meta: cleanLabel(event.meta || "") || undefined,
			};
			if (normalized.callID) {
				const existing = mergedByCall.get(normalized.callID);
				if (!existing) {
					mergedByCall.set(normalized.callID, normalized);
					kept.push(normalized);
					continue;
				}
				existing.createdAt = Math.max(existing.createdAt, normalized.createdAt);
				existing.status =
					normalized.status === "error"
						? "error"
						: normalized.status === "done" || existing.status === "done"
							? "done"
							: "pending";
				existing.title = normalized.title || existing.title;
				existing.meta = normalized.meta || existing.meta;
				existing.filePath = normalized.filePath || existing.filePath;
				continue;
			}
			const previous = kept[kept.length - 1];
			if (
				previous &&
				previous.title === normalized.title &&
				previous.status === normalized.status &&
				previous.filePath === normalized.filePath &&
				previous.meta === normalized.meta
			) {
				continue;
			}
			kept.push(normalized);
		}
		return kept;
	}, [detail.progressEvents]);
	const renderedTimeline = useMemo(() => {
		const source = Array.isArray(detail.timelineEvents) ? detail.timelineEvents : [];
		const sorted = [...source].sort((a, b) => a.createdAt - b.createdAt);
		const deduped: typeof sorted = [];
		for (const event of sorted) {
			const label = cleanLabel(event.label || "");
			if (!label) {
				continue;
			}
			const normalized = { ...event, label };
			const previous = deduped[deduped.length - 1];
			if (
				previous &&
				previous.type === normalized.type &&
				previous.label.toLowerCase() === normalized.label.toLowerCase()
			) {
				previous.createdAt = Math.max(previous.createdAt, normalized.createdAt);
				continue;
			}
			deduped.push(normalized);
		}
		return deduped;
	}, [detail.timelineEvents]);

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

				<div className="flex min-h-0 flex-1 flex-col lg:flex-row">
					<div className="order-2 flex min-h-0 flex-1 flex-col overflow-y-auto p-3 sm:p-4 lg:order-1 lg:p-5">
						<div className="space-y-6">
							<div className="flex flex-col gap-2">
								<span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
									Latest Activity
								</span>
								<div className="rounded-md border border-oc-border bg-oc-bg-soft px-3 py-2.5 text-[13px] font-mono text-foreground shadow-inner break-words">
									{latestActivity}
								</div>
							</div>

							<div className="flex flex-col gap-2">
								<span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
									Progress ({renderedProgress.length})
								</span>
								{renderedProgress.length > 0 || hasRawProgressEvents ? (
									<div className="space-y-2">
										{renderedProgress.map((ev) => (
											<div
												key={ev.id}
												className="rounded-md border border-oc-border bg-oc-bg-soft px-3 py-2.5 shadow-sm transition-colors hover:bg-oc-panel"
											>
												<div className="text-sm font-medium text-foreground break-words">{ev.title}</div>
												{ev.meta ? (
													<div className="mt-1 text-[11px] font-mono text-muted-foreground opacity-80 break-words">
														{ev.meta}
													</div>
												) : null}
											</div>
										))}
									</div>
								) : (
									<div className="py-2 text-sm italic text-muted-foreground/50">No progress events available.</div>
								)}
							</div>

							{detail.thinkingEvents && detail.thinkingEvents.length > 0 && (
								<div className="flex flex-col gap-2 pt-1">
									<span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
										Thinking ({detail.thinkingEvents.length})
									</span>
									<div className="space-y-2">
										{detail.thinkingEvents.map((ev) => (
											<div
												key={ev.id}
												className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5 text-[13px] font-sans leading-relaxed text-foreground whitespace-pre-wrap"
											>
												{ev.text}
											</div>
										))}
									</div>
								</div>
							)}
						</div>
					</div>

					<div
						ref={timelineScrollRef}
						className="order-1 w-full shrink-0 max-h-[38vh] overflow-y-auto overflow-x-hidden border-b border-oc-border bg-oc-bg-soft/40 p-3 sm:p-4 lg:order-2 lg:max-h-none lg:w-80 lg:border-b-0 lg:border-l lg:p-5"
					>
						<div className="flex flex-col gap-4">
							<span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
								Timeline ({renderedTimeline.length})
							</span>

							{renderedTimeline.length > 0 ? (
								<div className="pr-1 text-sm">
									<Stepper>
										{renderedTimeline.map((ev, index) => {
											const isLast = index === renderedTimeline.length - 1;
											const time = new Date(ev.createdAt).toLocaleTimeString([], {
												hour: "2-digit",
												minute: "2-digit",
												second: "2-digit",
											});
											const eventLooksError =
												ev.type.toLowerCase().includes("error") ||
												ev.label.toLowerCase().includes("error") ||
												ev.label.toLowerCase().includes("failed");
											const eventLooksDone =
												ev.label.toLowerCase() === "completed" ||
												ev.label.toLowerCase().includes("done") ||
												ev.label.toLowerCase().includes("finished");

											const dotIndicator = eventLooksError || isError ? (
												<X className="h-3 w-3 text-destructive" />
											) : isLast && !isDone && !isError && !eventLooksDone ? (
												<div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
											) : (
												<Check className="h-3 w-3 text-emerald-500" />
											);

											return (
												<StepperItem
													key={ev.key}
													isLast={isLast}
													indicator={dotIndicator}
													className="group"
												>
													<div className="mt-[-2px] flex flex-col gap-0.5">
														<div className="break-words text-[13px] font-medium text-foreground/90 transition-colors group-hover:text-foreground">
															{ev.label}
														</div>
														<div className="mb-3 text-[10px] font-mono tracking-tight text-muted-foreground/70">
															{time}
														</div>
													</div>
												</StepperItem>
											);
										})}
									</Stepper>
								</div>
							) : (
								<div className="text-sm italic text-muted-foreground/50">No timeline events recorded.</div>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);

	return createPortal(modalContent, document.body);
}
