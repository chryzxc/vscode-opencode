/**
 * PlanManager Module
 *
 * Handles plan file detection, persistence, viewing, and file candidate resolution.
 *
 * Extracted from ChatViewProvider.ts (~450 lines)
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import { LoggingCategories } from "../../utils/LoggingSchema";

export class PlanManager {
  constructor(
    private logger: ReturnType<typeof import("../../utils/Logger").createLogger>,
    private firstNonEmptyString: (...values: unknown[]) => string | undefined,
    private workspaceState: vscode.Memento,
  ) { }

  /**
   * Check if text is a plan proceed message
   */
  isPlanProceedMessageText(value: unknown): boolean {
    if (!value) return false;
    const str = String(value).toLowerCase().trim();
    return str === "/plan:proceed" || str.startsWith("/plan:proceed ");
  }

  private buildFallbackPlanContent(plan: {
    title?: string;
    summary?: string;
    content?: string;
    file?: string;
  }): string | undefined {
    const existing = this.firstNonEmptyString(plan.content);
    if (existing) {
      return existing;
    }
    const title = this.firstNonEmptyString(plan.title) || "Implementation Plan";
    const summary =
      this.firstNonEmptyString(plan.summary) ||
      "I created an implementation plan with clear execution steps.";
    return `# ${title}\n\n${summary}\n`;
  }

  /**
   * Normalize plan proceed user message
   */
  normalizePlanProceedUserMessage(message: any): any {
    if (!message) return message;

    const text = this.firstNonEmptyString(message.text, message.content);
    if (!text) return message;

    if (!this.isPlanProceedMessageText(text)) {
      return message;
    }

    const normalized = { ...message };

    const parts = text.split(/\s+/, 2);
    const command = parts[0] || "";
    const rest = parts[1] || "";

    if (rest && command) {
      const trimmedRest = rest.trim();
      const quoteMatches = trimmedRest.match(/^["'](.+)["']$/);
      const commentText = quoteMatches ? quoteMatches[1] : trimmedRest;

      normalized.planProceedComment = {
        id: `pp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        text: commentText,
        createdAt: Date.now(),
        anchor: {
          startLine: 0,
          endLine: 0,
          selectedText: commentText,
        },
      };
    }

    normalized.text = "/plan:proceed";
    if (normalized.content) {
      normalized.content = "/plan:proceed";
    }

    return normalized;
  }

  /**
   * Check if plan title is generic
   */
  isGenericPlanTitle(value: unknown): boolean {
    if (!value) return false;
    const str = String(value).toLowerCase().trim();
    const genericTitles = [
      "implementation plan",
      "plan",
      "project plan",
      "development plan",
      "the plan",
      "my plan",
    ];
    return genericTitles.includes(str);
  }

  /**
   * Derive plan title from file path
   */
  derivePlanTitleFromFilePath(filePath: unknown): string | undefined {
    const normalized = this.normalizePlanFileReference(filePath);
    if (!normalized) return undefined;

    const fileName = path.basename(normalized);
    const withoutExt = fileName.replace(/\.md$/i, "");

    const cleaned = withoutExt
      .replace(/^implementation[_-]?plan[_-]?/i, "")
      .replace(/^plan[_-]?/i, "")
      .replace(/[_-]plan$/i, "")
      .replace(/[_-]\d{8,}$/, "")
      .trim();

    if (!cleaned) return undefined;

    const title = cleaned
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();

    return title || undefined;
  }

  /**
   * Resolve plan title from various sources
   */
  resolvePlanTitle(options: {
    plan?: { title?: string; file?: string };
    planFile?: string;
    fallback?: string;
  }): string | undefined {
    if (options.plan?.title && !this.isGenericPlanTitle(options.plan.title)) {
      return options.plan.title;
    }

    if (options.planFile) {
      const derived = this.derivePlanTitleFromFilePath(options.planFile);
      if (derived) return derived;
    }

    if (options.plan?.file) {
      const derived = this.derivePlanTitleFromFilePath(options.plan.file);
      if (derived) return derived;
    }

    if (options.fallback && !this.isGenericPlanTitle(options.fallback)) {
      return options.fallback;
    }

    return undefined;
  }

  /**
   * Persist plan content to disk
   */
  async persistPlan(
    content: string,
    preferredPath?: string,
  ): Promise<string | undefined> {
    const flow = this.logger.startFeatureFlow('PersistPlan', {
      hasContent: !!content,
      contentLength: content.length,
      preferredPath,
    });

    try {
      const normalizedContent = this.firstNonEmptyString(content);
      if (!normalizedContent) {
        this.logger.endFeatureFlow(flow, { status: 'skipped', reason: 'No content' });
        return undefined;
      }

      this.logger.featureStep(flow, 'normalizing_paths');
      const normalizedPreferred = this.normalizePlanFileReference(preferredPath);
      const resolvedPath = normalizedPreferred
        ? this.resolveWritablePlanPath(normalizedPreferred)
        : undefined;
      if (!resolvedPath) {
        this.logger.endFeatureFlow(flow, { status: 'failed', reason: 'No valid path' });
        return undefined;
      }

      this.logger.featureStep(flow, 'creating_directory', { path: path.dirname(resolvedPath) });
      const normalizedPath = path.normalize(resolvedPath);
      await vscode.workspace.fs.createDirectory(
        vscode.Uri.file(path.dirname(normalizedPath)),
      );

      this.logger.featureStep(flow, 'writing_file', { path: normalizedPath });
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(normalizedPath),
        new TextEncoder().encode(normalizedContent),
      );

      this.logger.info("Auto-persisted plan", { path: normalizedPath });
      this.logger.endFeatureFlow(flow, { status: 'completed' });
      return normalizedPath;
    } catch (err) {
      this.logger.error(`Failed to persist plan: ${err instanceof Error ? err.message : String(err)}`, { path: preferredPath });
      this.logger.endFeatureFlow(flow, { status: 'failed' });
      return undefined;
    }
  }

  private resolveWritablePlanPath(planFile: string): string | undefined {
    const candidates = this.resolvePlanFileCandidates(planFile);
    const absoluteCandidate = candidates.find((candidate) =>
      path.isAbsolute(candidate),
    );
    if (absoluteCandidate) {
      return path.normalize(absoluteCandidate);
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder && workspaceFolder.uri.scheme === "file") {
      return path.normalize(path.join(workspaceFolder.uri.fsPath, planFile));
    }

    if (path.isAbsolute(planFile)) {
      return path.normalize(planFile);
    }
    return undefined;
  }

  /**
   * Normalize plan file reference
   */
  private normalizePlanFileReference(file: unknown): string | undefined {
    const raw = this.firstNonEmptyString(file);
    if (!raw) {
      return undefined;
    }

    let value = raw.trim();
    if (!value) {
      return undefined;
    }

    if (value.startsWith("file://")) {
      try {
        const uri = vscode.Uri.parse(value);
        if (uri.scheme === "file" && uri.fsPath) {
          value = uri.fsPath;
        }
      } catch {
        // Keep string cleanup fallback below.
      }
    }

    // Strip common markdown wrappers around file paths.
    value = value
      .replace(/^`+|`+$/g, "")
      .replace(/^"+|"+$/g, "")
      .replace(/^'+|'+$/g, "")
      .replace(/^<+|>+$/g, "")
      .replace(/^\(+|\)+$/g, "")
      .trim();

    return value || undefined;
  }

  /**
   * Check if file is likely a plan markdown file
   */
  isLikelyPlanMarkdownFile(file: unknown): boolean {
    const normalized = this.normalizePlanFileReference(file);
    if (!normalized || !normalized.toLowerCase().endsWith(".md")) {
      return false;
    }
    const lower = normalized.replace(/\\/g, "/").toLowerCase();
    if (lower.includes("/node_modules/")) {
      return false;
    }
    if (
      /(^|\/)implementation_plan_comments_[^/]+\.md$/.test(lower) ||
      /(^|\/)[^/]+_comments\.md$/.test(lower)
    ) {
      return false;
    }
    const isPlanDirectoryPath =
      /(^|\/)\.?plans?\//.test(lower) || /(^|\/)planning\//.test(lower);
    return (
      isPlanDirectoryPath ||
      /(^|\/)implementation_plan(?:_[a-z0-9-]+)?\.md$/.test(lower) ||
      /(^|\/)plans?\//.test(lower) ||
      lower.includes("plan")
    );
  }

  /**
   * Get plan file candidate score
   */
  getPlanFileCandidateScore(filePath: string): number {
    const normalized = filePath.replace(/\\/g, "/").toLowerCase();
    let score = 0;
    const isPlanDirectoryPath =
      /(^|\/)\.?plans?\//.test(normalized) || /(^|\/)planning\//.test(normalized);
    if (isPlanDirectoryPath) {
      score += 60;
    }

    if (normalized.includes("plan")) {
      score += 50;
    }

    if (/(^|\/)implementation_plan\.md$/.test(normalized)) {
      score += 40;
    }

    if (/(^|\/)implementation_plan_[a-z0-9-]+\.md$/.test(normalized)) {
      score += 35;
    }

    if (/(^|\/)plans?\//.test(normalized)) {
      score += 30;
    }

    const depth = (normalized.match(/\//g) || []).length;
    score -= depth * 2;

    if (normalized.includes("/node_modules/")) {
      score -= 1000;
    }

    if (normalized.includes("/.git/")) {
      score -= 1000;
    }

    return Math.max(0, score);
  }

  /**
   * Prioritize plan file candidates
   */
  prioritizePlanFileCandidates(candidates: Array<unknown>, explicitFiles?: Set<string>): string[] {
    const normalizedCandidates = candidates
      .map((c) => this.normalizePlanFileReference(c))
      .filter((c): c is string => Boolean(c));

    const scored = normalizedCandidates.map((filePath) => ({
      filePath,
      score: this.getPlanFileCandidateScore(filePath),
      isExplicit: explicitFiles?.has(filePath),
    }));

    scored.sort((a, b) => {
      if (a.isExplicit && !b.isExplicit) return -1;
      if (!a.isExplicit && b.isExplicit) return 1;
      return b.score - a.score;
    });

    return scored.map((s) => s.filePath);
  }

  /**
   * Collect plan file candidates from structured plan
   */
  collectPlanFileCandidatesFromStructuredPlan(structured: any): string[] {
    const candidates: string[] = [];

    // DEBUG: Log input to trace file property
    this.logger.debug('collectPlanFileCandidatesFromStructuredPlan INPUT', {
      hasStructured: !!structured,
      type: typeof structured,
      keys: structured ? Object.keys(structured) : [],
      hasFile: structured && 'file' in structured,
      fileValue: structured?.file,
      hasFiles: structured && 'files' in structured,
      filesValue: structured?.files,
      fullObject: structured ? JSON.stringify(structured, null, 2) : 'undefined'
    });

    // structured is the plan object itself (with file, title, content, etc.)
    // not the parent structured output object
    if (structured?.file) {
      const normalized = this.normalizePlanFileReference(structured.file);
      if (normalized) {
        candidates.push(normalized);
      }
    }

    if (structured?.files && Array.isArray(structured.files)) {
      for (const file of structured.files) {
        const normalized = this.normalizePlanFileReference(file);
        if (normalized && !candidates.includes(normalized)) {
          candidates.push(normalized);
        }
      }
    }

    this.logger.debug('collectPlanFileCandidatesFromStructuredPlan OUTPUT', {
      candidatesCount: candidates.length,
      candidates: candidates,
      firstCandidate: candidates[0]
    });

    return candidates;
  }

  /**
   * Resolve plan file candidates
   */
  resolvePlanFileCandidates(planFile: string): string[] {
    const normalized = this.normalizePlanFileReference(planFile);
    if (!normalized) {
      return [];
    }

    const candidates: string[] = [];

    candidates.push(normalized);

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder && workspaceFolder.uri.scheme === "file") {
      const workspacePath = workspaceFolder.uri.fsPath;
      const absolutePath = path.isAbsolute(normalized)
        ? normalized
        : path.join(workspacePath, normalized);

      if (absolutePath !== normalized) {
        candidates.push(absolutePath);
      }

      if (!normalized.endsWith(".md")) {
        candidates.push(`${normalized}.md`);
        candidates.push(`${absolutePath}.md`);
      }
    }

    return Array.from(new Set(candidates));
  }

  /**
   * Read plan file from disk
   */
  private async readPlanFileFromDisk(filePath: string): Promise<string | undefined> {
    try {
      const normalized = path.normalize(filePath);
      const content = await vscode.workspace.fs.readFile(
        vscode.Uri.file(normalized),
      );
      return Buffer.from(content).toString("utf-8");
    } catch {
      return undefined;
    }
  }

  /**
   * Extract markdown file references from text
   */
  extractMarkdownFileReferences(text: unknown): string[] {
    if (!text) return [];
    const str = String(text);

    const markdownLinkPattern = /\[([^\]]+)\]\(([^)]+\.md)\)/gi;
    const markdownLinkRefPattern = /^\[([^\]]+)\]:\s*(.+\.md)$/gmi;
    const codeBlockPattern = /```[\s\S]*?```/g;
    const inlineCodePattern = /`[^`]+`/g;
    const plainMdPattern = /\b[\w-]+\.md\b/gi;

    const cleaned = str
      .replace(codeBlockPattern, "")
      .replace(inlineCodePattern, "");

    const references = new Set<string>();

    let match;
    while ((match = markdownLinkPattern.exec(cleaned)) !== null) {
      const filePath = match[2];
      const normalized = this.normalizePlanFileReference(filePath);
      if (normalized) {
        references.add(normalized);
      }
    }

    while ((match = markdownLinkRefPattern.exec(str)) !== null) {
      const filePath = match[2];
      const normalized = this.normalizePlanFileReference(filePath);
      if (normalized) {
        references.add(normalized);
      }
    }

    while ((match = plainMdPattern.exec(cleaned)) !== null) {
      const filePath = match[0];
      const normalized = this.normalizePlanFileReference(filePath);
      if (normalized) {
        references.add(normalized);
      }
    }

    return Array.from(references);
  }

  /**
   * Discover likely plan file candidates
   */
  async discoverLikelyPlanFileCandidates(): Promise<string[]> {
    const flow = this.logger.startFeatureFlow('DiscoverPlanFiles', {});

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder || workspaceFolder.uri.scheme !== "file") {
      this.logger.endFeatureFlow(flow, { status: 'skipped', reason: 'No valid workspace folder' });
      return [];
    }

    const workspacePath = workspaceFolder.uri.fsPath;
    this.logger.featureStep(flow, 'workspace_valid', { workspacePath });

    try {
      this.logger.featureStep(flow, 'searching_for_plan_files');
      const startTime = Date.now();
      const planFiles = await vscode.workspace.findFiles(
        new vscode.RelativePattern(workspaceFolder, "**/*plan*.md"),
        "**/{node_modules,.git,dist,build}/**",
      );
      this.logger.featureStep(flow, 'files_found', {
        count: planFiles.length,
        duration: Date.now() - startTime,
      });

      const scored = planFiles
        .map((uri) => uri.fsPath)
        .filter((filePath) => this.isLikelyPlanMarkdownFile(filePath))
        .map((filePath) => ({
          filePath,
          score: this.getPlanFileCandidateScore(filePath),
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map((item) => item.filePath);

      this.logger.info("Plan file discovery completed", {
        totalFound: planFiles.length,
        afterScoring: scored.length,
        topCandidates: scored.slice(0, 3),
      });

      this.logger.endFeatureFlow(flow, {
        status: 'completed',
        totalCandidates: scored.length,
        duration: Date.now() - startTime,
      });
      return scored;
    } catch (err) {
      this.logger.error("Plan file discovery failed", { workspacePath }, err as Error);
      this.logger.endFeatureFlow(flow, { status: 'failed', error: String(err) });
      return [];
    }
  }

  /**
   * Handle view plan command
   */
  async handleViewPlan(plan: {
    file?: string;
    content?: string;
    title?: string;
    summary?: string;
    files?: any[];
    fileCount?: number;
  }): Promise<void> {
    if (!plan) {
      return;
    }

    const normalizedPlanFile = this.normalizePlanFileReference(plan.file);
    const fileCandidates = normalizedPlanFile
      ? this.resolvePlanFileCandidates(normalizedPlanFile)
      : [];

    const explicitFiles = new Set<string>();
    if (normalizedPlanFile) {
      explicitFiles.add(normalizedPlanFile);
    }
    if (Array.isArray(plan.files)) {
      for (const file of plan.files) {
        const normalized = this.normalizePlanFileReference(file);
        if (normalized) {
          explicitFiles.add(normalized);
        }
      }
    }

    const prioritizedCandidates = this.prioritizePlanFileCandidates(fileCandidates, explicitFiles);
    if (!normalizedPlanFile) {
      prioritizedCandidates.push(
        ...(await this.discoverLikelyPlanFileCandidates()),
      );
    }

    let resolvedFile: string | undefined;
    let planData: string | undefined;

    for (const candidate of prioritizedCandidates) {
      planData = await this.readPlanFileFromDisk(candidate);
      if (planData) {
        resolvedFile = candidate;
        break;
      }
    }

    if (!planData && prioritizedCandidates.length > 0) {
      const inlinePlanContent = this.buildFallbackPlanContent(plan);
      if (inlinePlanContent) {
        const preferredMissingPath = normalizedPlanFile ?? prioritizedCandidates[0];
        const persistedPath = await this.persistPlan(
          inlinePlanContent.trim(),
          preferredMissingPath,
        );
        if (persistedPath) {
          planData = inlinePlanContent.trim();
          resolvedFile = persistedPath;
        }
      }
      if (!planData) {
        void vscode.window.showErrorMessage(
          `Could not read plan file: ${normalizedPlanFile ?? prioritizedCandidates[0]}`,
        );
        return;
      }
    }

    if (
      !planData &&
      prioritizedCandidates.length === 0 &&
      this.buildFallbackPlanContent(plan)
    ) {
      const fallbackContent = this.buildFallbackPlanContent(plan)!;
      const defaultPath =
        normalizedPlanFile ||
        "docs/implementation-plan.md";
      const persistedPath = await this.persistPlan(
        fallbackContent.trim(),
        defaultPath,
      );
      if (persistedPath) {
        resolvedFile = persistedPath;
      }
      planData = fallbackContent.trim();
    }

    if (!planData) {
      this.logger.warn("No plan content available to view", {
        planFile: normalizedPlanFile,
        candidates: prioritizedCandidates.slice(0, 5),
      });
      return;
    }

    const planTitle = this.resolvePlanTitle({
      plan,
      planFile: resolvedFile,
    });

    // Use VSCode command to show plan in PlanViewProvider panel
    await vscode.commands.executeCommand("opencode.showPlan", {
      content: planData,
      title: planTitle,
      sourceFile: resolvedFile,
    });
  }
}
