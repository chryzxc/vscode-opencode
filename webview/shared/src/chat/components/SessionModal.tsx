import { useState, useEffect, useRef, useMemo } from "react";
import { X, Search, MessageSquare, Plus, Loader2, Edit, Trash2, Check, History } from "lucide-react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { useAppState, useAppDispatch } from "../lib/store";
import vscode from "../lib/vscode";

type SessionModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function SessionModal({ isOpen, onClose }: SessionModalProps) {
  const { sessionsList, currentSessionId, processingSessionIds } = useAppState();
  const dispatch = useAppDispatch();
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const visibleSessions = useMemo(() => {
    if (sessionsList.length === 0) {
      return [];
    }

    const sessionIds = new Set(sessionsList.map((session) => session.id));
    const topLevelSessions = sessionsList.filter((session) => {
      const parentSessionId = session.parentSessionId?.trim();
      if (!parentSessionId) return true;
      if (parentSessionId === session.id) return true;
      return !sessionIds.has(parentSessionId);
    });

    return topLevelSessions.length > 0 ? topLevelSessions : sessionsList;
  }, [sessionsList]);

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return visibleSessions;
    const q = searchQuery.toLowerCase();
    return visibleSessions.filter((s) =>
      (s.title || "Untitled chat").toLowerCase().includes(q),
    );
  }, [visibleSessions, searchQuery]);

  const groupedSessions = useMemo(() => {
    const day = 86_400_000;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayTs = todayStart.getTime();
    const yesterdayTs = todayTs - day;
    const weekTs = todayTs - 6 * day;

    const groups: { label: string; sessions: typeof filteredSessions }[] = [
      { label: "Today", sessions: [] },
      { label: "Yesterday", sessions: [] },
      { label: "This Week", sessions: [] },
      { label: "Older", sessions: [] },
    ];

    for (const session of filteredSessions) {
      const ts = session.createdAt ?? 0;
      if (ts >= todayTs) {
        groups[0].sessions.push(session);
      } else if (ts >= yesterdayTs) {
        groups[1].sessions.push(session);
      } else if (ts >= weekTs) {
        groups[2].sessions.push(session);
      } else {
        groups[3].sessions.push(session);
      }
    }

    return groups.filter((g) => g.sessions.length > 0);
  }, [filteredSessions]);

  useEffect(() => {
    if (editingSessionId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingSessionId]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchRef.current?.focus(), 220);
    } else {
      setSearchQuery("");
      setConfirmDeleteId(null);
      setEditingSessionId(null);
    }
  }, [isOpen]);

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

  function relativeSessionTime(ts: number | undefined): string {
    if (!ts) return "";
    const now = Date.now();
    const diff = now - ts;
    const minute = 60_000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (diff < minute) return "Just now";
    if (diff < hour) {
      const mins = Math.round(diff / minute);
      return `${mins}m`;
    }
    if (diff < day) {
      const hrs = Math.round(diff / hour);
      return `${hrs}h`;
    }
    if (diff < 7 * day) {
      const days = Math.round(diff / day);
      return days === 1 ? "Yesterday" : `${days}d`;
    }
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  const handleStartEdit = (sessionId: string, title: string) => {
    setEditingSessionId(sessionId);
    setNewTitle(title || "");
    setConfirmDeleteId(null);
  };

  const handleSaveEdit = () => {
    if (newTitle.trim() && editingSessionId) {
      vscode.postMessage({
        type: "renameSession",
        sessionId: editingSessionId,
        newTitle: newTitle.trim(),
      });
    }
    setEditingSessionId(null);
    setNewTitle("");
  };

  const handleCancelEdit = () => {
    setEditingSessionId(null);
    setNewTitle("");
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSaveEdit();
    else if (e.key === "Escape") handleCancelEdit();
  };

  const handleDeleteConfirm = (sessionId: string) => {
    vscode.postMessage({ type: "deleteSession", sessionId });
    setConfirmDeleteId(null);
  };

  const handleCreateSession = () => {
    vscode.postMessage({ type: "createSession" });
    onClose();
  };

  const handleSwitchSession = (sessionId: string) => {
    vscode.postMessage({ type: "switchSession", sessionId });
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  const modalContent = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={onClose}
        aria-label="Close session modal"
      />

      {/* Modal panel */}
      <div
        className="relative z-50 flex w-full max-w-md flex-col overflow-hidden rounded-xl border border-oc-border bg-oc-panel text-foreground shadow-2xl animate-in zoom-in-95 duration-200 max-h-[80vh]"
        role="dialog"
        aria-modal="true"
        aria-label="Sessions"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-oc-border bg-oc-panel-soft/70 px-4 py-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-oc-accent" />
            <span className="text-sm font-semibold text-foreground">Untitled</span>
            {visibleSessions.length > 0 && (
              <span className="rounded-full bg-oc-border px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground leading-none">
                {visibleSessions.length}
              </span>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close session modal"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Search Bar */}
        <div className="shrink-0 px-4 py-3 border-b border-oc-border">
          <div className="flex items-center gap-1.5 rounded-md border border-oc-border bg-oc-panel px-2.5 py-1.5 transition-colors focus-within:border-oc-accent">
            <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search sessions..."
              className="flex-1 bg-transparent text-xs text-foreground placeholder-muted-foreground outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
        </div>

        {/* Session List */}
        <div className="flex flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 py-2">
          {filteredSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              {searchQuery ? (
                <>
                  <Search className="h-8 w-8 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">No sessions match</p>
                  <p className="text-[10px] text-muted-foreground opacity-60">"{searchQuery}"</p>
                </>
              ) : (
                <>
                  <MessageSquare className="h-8 w-8 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">No sessions yet</p>
                  <p className="text-[10px] text-muted-foreground opacity-60">Start a new chat to begin</p>
                </>
              )}
            </div>
          ) : (
            groupedSessions.map((group) => (
              <div key={group.label} className="mb-3">
                <div className="mb-1.5 px-1 pt-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground opacity-60">
                  {group.label}
                </div>
                {group.sessions.map((session) => {
                  const isActive = session.id === currentSessionId;
                  const isProcessing = processingSessionIds?.includes(session.id) || false;
                  const isEditing = editingSessionId === session.id;
                  const isConfirmingDelete = confirmDeleteId === session.id;

                  return (
                    <div
                      key={session.id}
                      className="group relative mb-1"
                    >
                      {isEditing ? (
                        <div className="flex items-center gap-1 rounded-md border border-oc-accent bg-oc-accent-soft px-2 py-2">
                          <input
                            ref={inputRef}
                            type="text"
                            value={newTitle}
                            onChange={(e) => setNewTitle(e.target.value)}
                            onKeyDown={handleEditKeyDown}
                            onBlur={handleSaveEdit}
                            className="flex-1 bg-transparent text-xs text-foreground outline-none"
                            placeholder="Session title..."
                          />
                          <button
                            type="button"
                            title="Save"
                            className="flex h-5 w-5 items-center justify-center rounded text-oc-accent hover:bg-oc-accent hover:text-white transition-colors"
                            onClick={handleSaveEdit}
                          >
                            <Check className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            title="Cancel"
                            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-oc-border transition-colors"
                            onClick={handleCancelEdit}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : isConfirmingDelete ? (
                        <div className="flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-2">
                          <span className="flex-1 truncate text-xs text-muted-foreground">
                            Delete "{session.title || "Untitled chat"}"?
                          </span>
                          <button
                            type="button"
                            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-red-400 hover:bg-red-500/20 transition-colors"
                            onClick={() => handleDeleteConfirm(session.id)}
                          >
                            Delete
                          </button>
                          <button
                            type="button"
                            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-oc-border transition-colors"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div
                          className={`flex items-stretch rounded-md transition-all ${
                            isActive
                              ? "bg-oc-accent-soft"
                              : "hover:bg-oc-panel"
                          }`}
                        >
                          <div
                            className={`w-[3px] shrink-0 self-stretch rounded-l-md transition-colors ${
                              isActive ? "bg-oc-accent" : "bg-transparent"
                            }`}
                          />
                          <button
                            type="button"
                            onClick={() => handleSwitchSession(session.id)}
                            className="min-w-0 flex-1 overflow-hidden px-3 py-2.5 text-left"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              {isProcessing ? (
                                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-oc-accent" aria-label="Processing" />
                              ) : null}
                              <span
                                className={`truncate text-sm font-medium leading-tight ${
                                  isActive ? "text-foreground" : "text-muted-foreground"
                                }`}
                              >
                                {session.title || "Untitled chat"}
                              </span>
                            </div>
                            {session.createdAt ? (
                              <div className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
                                {relativeSessionTime(session.createdAt)}
                              </div>
                            ) : null}
                          </button>
                          <div className="flex shrink-0 items-center gap-0.5 pr-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              type="button"
                              title="Rename session"
                              aria-label={`Rename session ${session.title ?? session.id}`}
                              className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-oc-border hover:text-foreground"
                              onClick={() => handleStartEdit(session.id, session.title || "")}
                            >
                              <Edit className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              title="Delete session"
                              aria-label={`Delete session ${session.title ?? session.id}`}
                              className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-red-500/15 hover:text-red-400"
                              onClick={() => setConfirmDeleteId(session.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer - New Chat Button */}
        <div className="shrink-0 px-4 py-3 border-t border-oc-border bg-oc-panel-soft/50">
          <button
            type="button"
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-oc-accent bg-oc-accent-soft py-2 text-xs font-medium text-oc-accent transition-all hover:bg-oc-accent hover:text-white active:scale-[0.98]"
            onClick={handleCreateSession}
          >
            <Plus className="h-3.5 w-3.5" />
            New Chat
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
