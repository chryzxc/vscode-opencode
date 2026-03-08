import { Copy, X } from "lucide-react";
import { useEffect } from "react";

import { cn } from "@/utils";

import type { SubagentDetail } from "./lib/types";

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

	return (
		<div className="oc-image-preview-shell">
			<button
				type="button"
				className="oc-image-preview-backdrop"
				onClick={onClose}
				aria-label="Close subagent details"
			/>
			<div
				className="oc-image-preview-modal"
				role="dialog"
				aria-modal="true"
				aria-label={title}
			>
				<div className="oc-image-preview-header">
					<div className="min-w-0">
						<div className={cn("truncate text-sm font-semibold", colorClass)}>
							{title}
						</div>
						<div className="truncate text-oc-2xs font-mono text-oc-text-muted">
							{providerLabel ?? "Unknown provider"}
						</div>
					</div>
					<button
						type="button"
						className="oc-image-preview-close"
						onClick={onClose}
						aria-label="Close"
						title="Close"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
				<div className="oc-image-preview-content">
					<div className="rounded border border-oc-border bg-oc-panel-soft px-2 py-1.5 text-oc-2xs text-oc-text-soft">
						{detail.latestActivity || "Initializing..."}
					</div>

					<div className="mt-2 flex flex-wrap gap-2">
						<button
							type="button"
							className="inline-flex items-center gap-1 text-oc-2xs font-mono text-oc-text-muted hover:text-oc-accent"
							onClick={() => onCopyRefs(detail)}
						>
							<Copy className="h-3 w-3" />
							Copy refs
						</button>
						<button
							type="button"
							className="inline-flex items-center gap-1 text-oc-2xs font-mono text-oc-text-muted hover:text-oc-accent"
							onClick={onJumpToParent}
						>
							Jump to parent
						</button>
						<span className="text-oc-2xs font-mono text-oc-text-muted">
							child session: {detail.childSessionId || "n/a"}
						</span>
					</div>

					{detail.progressEvents?.length > 0 ? (
						<details className="mt-3" open>
							<summary className="cursor-pointer text-oc-2xs font-mono text-oc-text-muted hover:text-oc-text-soft transition-colors">
								Progress ({detail.progressEvents.length})
							</summary>
							<div className="mt-1.5 max-h-44 space-y-1 overflow-y-auto pr-1">
								{detail.progressEvents.map((ev) => (
									<div
										key={ev.id}
										className="rounded border border-oc-border bg-oc-panel-soft px-2 py-1.5 text-oc-2xs"
									>
										<div className="text-oc-text-soft">{ev.title}</div>
										{ev.meta ? (
											<div className="mt-0.5 text-oc-text-muted">{ev.meta}</div>
										) : null}
									</div>
								))}
							</div>
						</details>
					) : null}

					{detail.timelineEvents?.length > 0 ? (
						<details className="mt-2" open>
							<summary className="cursor-pointer text-oc-2xs font-mono text-oc-text-muted hover:text-oc-text-soft transition-colors">
								Timeline ({detail.timelineEvents.length})
							</summary>
							<div className="mt-1.5 max-h-44 space-y-1 overflow-y-auto pr-1">
								{detail.timelineEvents.map((ev) => (
									<div
										key={ev.key}
										className="rounded border border-oc-border bg-oc-panel-soft px-2 py-1.5 text-oc-2xs"
									>
										<div className="text-oc-text-soft">{ev.label}</div>
										<div className="mt-0.5 font-mono text-oc-text-muted">
											{new Date(ev.createdAt).toLocaleTimeString()}
										</div>
									</div>
								))}
							</div>
						</details>
					) : null}

					{detail.thinkingEvents?.length > 0 ? (
						<details className="mt-2" open={false}>
							<summary className="cursor-pointer text-oc-2xs font-mono text-oc-text-muted hover:text-oc-text-soft transition-colors">
								Thinking ({detail.thinkingEvents.length})
							</summary>
							<div className="mt-1.5 max-h-44 space-y-1 overflow-y-auto pr-1">
								{detail.thinkingEvents.map((ev) => (
									<div
										key={ev.id}
										className="rounded border border-oc-border bg-oc-panel-soft px-2 py-1.5 text-oc-2xs text-oc-text-muted whitespace-pre-wrap"
									>
										{ev.text}
									</div>
								))}
							</div>
						</details>
					) : null}
				</div>
			</div>
		</div>
	);
}
