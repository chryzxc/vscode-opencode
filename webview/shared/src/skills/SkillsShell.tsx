import { useEffect, useState, useMemo } from "react";
import type React from "react";
import {
  Search,
  RefreshCw,
  CheckCircle2,
  Circle,
  ChevronDown,
  Layers,
  Zap,
  Shield,
  ListChecks,
  X,
} from "lucide-react";

import { cn } from "@/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

declare global {
  interface Window {
    acquireVsCodeApi?: () => { postMessage: (msg: unknown) => void };
    __SKILLS_DATA__?: SkillsEnvelope;
  }
}

interface SkillInfo {
  name: string;
  description: string;
  path: string;
  enabled: boolean;
  category?: string;
  source: "project" | "global";
}

interface SkillsStats {
  total: number;
  enabled: number;
  disabled: number;
  global: number;
  project: number;
}

interface SkillsEnvelope {
  skills: SkillInfo[];
  stats: SkillsStats;
}

const vscodeApi = (() => {
  if (typeof window !== "undefined" && window.acquireVsCodeApi) {
    return window.acquireVsCodeApi();
  }
  return { postMessage: () => {} };
})();

const PRESETS: Array<{
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  danger?: boolean;
}> = [
  { id: "minimal", label: "Minimal", icon: Circle },
  { id: "development", label: "Development", icon: Zap },
  { id: "security", label: "Security", icon: Shield },
  { id: "all", label: "All Skills", icon: Layers, danger: true },
];

function StatPill({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color?: "green" | "red" | "default";
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span
        className={cn(
          "text-base font-semibold tabular-nums leading-none",
          color === "green" && "text-oc-green",
          color === "red" && "text-oc-red",
          !color || (color === "default" && "text-foreground"),
        )}
      >
        {value}
      </span>
      <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function SkillRow({
  skill,
  selected,
  onToggleSelect,
  onToggleEnabled,
}: {
  skill: SkillInfo;
  selected: boolean;
  onToggleSelect: () => void;
  onToggleEnabled: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-3 border-b border-oc-border-soft px-3 py-2 transition-colors",
        "hover:bg-oc-accent-soft",
        selected && "bg-oc-accent-soft",
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelect}
        className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-[var(--oc-accent)]"
        aria-label={`Select ${skill.name}`}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12px] font-semibold text-foreground">
            {skill.name}
          </span>
          <Badge
            variant="outline"
            className="h-auto shrink-0 rounded border-oc-border bg-oc-panel-soft px-1 py-0 font-mono text-[9px] uppercase tracking-wider text-muted-foreground"
          >
            {skill.source}
          </Badge>
        </div>
        {skill.description && (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {skill.description}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div
          className={cn(
            "h-1.5 w-1.5 rounded-full transition-all",
            skill.enabled
              ? "bg-oc-green shadow-[0_0_0_2px_color-mix(in_srgb,var(--oc-green)_20%,transparent)]"
              : "bg-muted-foreground opacity-30",
          )}
        />
        <Switch
          checked={skill.enabled}
          onCheckedChange={onToggleEnabled}
          className="h-4 w-7 data-[state=checked]:bg-oc-accent"
          aria-label={skill.enabled ? `Disable ${skill.name}` : `Enable ${skill.name}`}
        />
      </div>
    </div>
  );
}

export function SkillsShell() {
  const [skills, setSkills] = useState<SkillInfo[]>(
    window.__SKILLS_DATA__?.skills ?? [],
  );
  const [stats, setStats] = useState<SkillsStats>(
    window.__SKILLS_DATA__?.stats ?? {
      total: 0,
      enabled: 0,
      disabled: 0,
      global: 0,
      project: 0,
    },
  );
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notification, setNotification] = useState<string | null>(null);
  const [presetsOpen, setPresetsOpen] = useState(false);

  useEffect(() => {
    vscodeApi.postMessage({ command: "requestData" });

    const timer = setTimeout(() => {
      if (skills.length === 0) {
        vscodeApi.postMessage({ command: "requestData" });
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [skills.length]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === "skillsData") {
        setSkills(msg.skills);
        setStats(msg.stats);
      } else if (msg.type === "showNotification") {
        setNotification(msg.message);
        setTimeout(() => setNotification(null), 3000);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return skills;
    const q = query.toLowerCase();
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    );
  }, [skills, query]);

  const allSelected =
    filtered.length > 0 && filtered.every((s) => selected.has(s.name));

  function toggleSelectAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((s) => s.name)));
    }
  }

  function toggleSelect(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  function toggleEnabled(skill: SkillInfo) {
    vscodeApi.postMessage({
      command: skill.enabled ? "disableSkill" : "enableSkill",
      skillName: skill.name,
    });
  }

  function enableSelected() {
    vscodeApi.postMessage({
      command: "enableMultiple",
      skillNames: Array.from(selected),
    });
    setSelected(new Set());
  }

  function disableSelected() {
    vscodeApi.postMessage({
      command: "disableMultiple",
      skillNames: Array.from(selected),
    });
    setSelected(new Set());
  }

  function applyPreset(preset: string) {
    if (
      preset === "all" &&
      !confirm(
        "This will enable all 760+ skills, which may cause performance issues. Continue?",
      )
    ) {
      return;
    }
    vscodeApi.postMessage({ command: "applyPreset", preset });
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-oc-bg text-foreground">
      <div className="shrink-0 border-b border-oc-border px-3 py-2.5">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[13px] font-semibold text-foreground">
            Skills
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={() => vscodeApi.postMessage({ command: "refresh" })}
              title="Refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={() => setPresetsOpen((v) => !v)}
              title="Presets"
            >
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform",
                  presetsOpen && "rotate-180",
                )}
              />
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <StatPill label="Total" value={stats.total} />
          <StatPill label="Enabled" value={stats.enabled} color="green" />
          <StatPill label="Disabled" value={stats.disabled} color="red" />
          <div className="mx-1 h-6 w-px bg-oc-border" />
          <StatPill label="Global" value={stats.global} />
          <StatPill label="Project" value={stats.project} />
        </div>
      </div>

      {presetsOpen && (
        <div className="shrink-0 border-b border-oc-border bg-oc-panel-soft/40 px-3 py-2">
          <p className="mb-1.5 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
            Presets
          </p>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map(({ id, label, icon: Icon, danger }) => (
              <button
                key={id}
                type="button"
                onClick={() => applyPreset(id)}
                className={cn(
                  "flex items-center gap-1 rounded border px-2 py-1 font-mono text-[11px] font-medium transition-all",
                  danger
                    ? "border-oc-red/30 text-oc-red hover:border-oc-red/70 hover:bg-oc-red/10"
                    : "border-oc-border text-muted-foreground hover:border-oc-accent/40 hover:bg-oc-accent-soft hover:text-oc-accent",
                )}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="shrink-0 border-b border-oc-border px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search skills..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-7 pl-7 text-xs"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-oc-border bg-oc-accent-soft px-3 py-1.5">
          <ListChecks className="h-3.5 w-3.5 shrink-0 text-oc-accent" />
          <span className="flex-1 font-mono text-[11px] text-foreground">
            {selected.size} selected
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={enableSelected}
            className="h-6 px-2 text-[11px] text-oc-green hover:bg-oc-green/10 hover:text-oc-green"
          >
            Enable selected
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={disableSelected}
            className="h-6 px-2 text-[11px] text-oc-red hover:bg-oc-red/10 hover:text-oc-red"
          >
            Disable selected
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set())}
            className="h-6 px-2 text-[11px] text-muted-foreground"
          >
            Clear
          </Button>
        </div>
      )}

      <div className="shrink-0 flex items-center gap-1 border-b border-oc-border px-3 py-1">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={toggleSelectAll}
          className="h-3 w-3 cursor-pointer accent-[var(--oc-accent)]"
          aria-label="Select all visible skills"
        />
        <span className="flex-1 font-mono text-[10px] text-muted-foreground">
          {filtered.length} skill{filtered.length !== 1 ? "s" : ""}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => vscodeApi.postMessage({ command: "enableAll" })}
          className="h-5 px-2 text-[10px] text-muted-foreground hover:text-oc-green"
        >
          All on
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => vscodeApi.postMessage({ command: "disableAll" })}
          className="h-5 px-2 text-[10px] text-muted-foreground hover:text-oc-red"
        >
          All off
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {skills.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <Layers className="h-8 w-8 text-muted-foreground opacity-40" />
            <p className="text-xs text-muted-foreground">Loading skills...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <Search className="h-6 w-6 text-muted-foreground opacity-40" />
            <p className="text-xs text-muted-foreground">No skills match "{query}"</p>
          </div>
        ) : (
          filtered.map((skill) => (
            <SkillRow
              key={skill.name}
              skill={skill}
              selected={selected.has(skill.name)}
              onToggleSelect={() => toggleSelect(skill.name)}
              onToggleEnabled={() => toggleEnabled(skill)}
            />
          ))
        )}
      </div>

      {notification && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg border border-oc-border bg-oc-panel px-3 py-2 text-xs shadow-xl animate-in slide-in-from-right-4 fade-in duration-200">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-oc-green" />
          <span>{notification}</span>
        </div>
      )}
    </div>
  );
}
