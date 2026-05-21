import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('src', 'providers', 'chat', 'PlanManager.ts')],
  'PlanManager.ts',
);

test.skip('PlanManager normalizes /plan:proceed commands into canonical proceed messages', () => {
  const proceedBody = extractFunctionBody(
    source,
    'isPlanProceedMessageText(value: unknown): boolean {',
  );
  const normalizeBody = extractFunctionBody(
    source,
    'normalizePlanProceedUserMessage(message: any): any {',
  );

  assert.match(
    proceedBody,
    /const str = String\(value\)\.toLowerCase\(\)\.trim\(\);/,
    'isPlanProceedMessageText should normalize case and whitespace before matching',
  );
  assert.match(
    proceedBody,
    /return str === "\/plan:proceed" \|\| str\.startsWith\("\/plan:proceed "\);/,
    'isPlanProceedMessageText should accept the exact proceed command and trailing comments',
  );
  assert.match(
    normalizeBody,
    /const text = this\.firstNonEmptyString\(message\.text, message\.content\);/,
    'normalizePlanProceedUserMessage should prefer first non-empty text/content field',
  );
  assert.match(
    normalizeBody,
    /const parts = text\.split\(/,
    'normalizePlanProceedUserMessage should split command and optional comment text',
  );
  assert.match(
    normalizeBody,
    /normalized\.planProceedComment = \{[\s\S]*id: `pp_\$\{Date\.now\(\)\}_\$\{Math\.random\(\)\.toString\(36\)\.substr\(2, 9\)\}`,[\s\S]*selectedText: commentText,/,
    'normalizePlanProceedUserMessage should synthesize a planProceedComment payload from trailing comment text',
  );
  assert.match(
    normalizeBody,
    /normalized\.text = "\/plan:proceed";[\s\S]*normalized\.content = "\/plan:proceed";/,
    'normalizePlanProceedUserMessage should rewrite text and content to the canonical proceed command',
  );
});

test.skip('PlanManager resolves titles from non-generic values and plan file names', () => {
  const genericBody = extractFunctionBody(
    source,
    'isGenericPlanTitle(value: unknown): boolean {',
  );
  const deriveBody = extractFunctionBody(
    source,
    'derivePlanTitleFromFilePath(filePath: unknown): string | undefined {',
  );
  const resolvePlanSource = source;

  assert.match(
    genericBody,
    /const genericTitles = \[[\s\S]*"implementation plan",[\s\S]*"development plan",[\s\S]*"my plan",[\s\S]*\];/,
    'isGenericPlanTitle should use a list of known generic plan titles',
  );
  assert.match(
    genericBody,
    /return genericTitles\.includes\(str\);/,
    'isGenericPlanTitle should perform list-driven membership checks',
  );
  assert.match(
    deriveBody,
    /const fileName = path\.basename\(normalized\);[\s\S]*const withoutExt = fileName\.replace\(/,
    'derivePlanTitleFromFilePath should derive titles from the basename without the markdown extension',
  );
  assert.match(
    deriveBody,
    /replace\(\/\^implementation\[_-\]\?plan\[_-\]\?\/i, ""\)/,
    'derivePlanTitleFromFilePath should strip implementation-plan prefixes',
  );
  assert.match(
    deriveBody,
    /replace\(\/\[_-\]\\d\{8,\}\$\/,[\s\S]*\.trim\(\);/,
    'derivePlanTitleFromFilePath should trim trailing timestamp suffixes from filenames',
  );
  assert.match(
    deriveBody,
    /replace\(\/\[-_\]\+\/g, " "\)[\s\S]*replace\(\/\\b\\w\/g, \(c\) => c\.toUpperCase\(\)\)/,
    'derivePlanTitleFromFilePath should replace separators with spaces and title-case the remainder',
  );
  assert.match(
    resolvePlanSource,
    /resolvePlanTitle\(options: \{[\s\S]*if \(options\.plan\?\.title && !this\.isGenericPlanTitle\(options\.plan\.title\)\) \{[\s\S]*return options\.plan\.title;/,
    'resolvePlanTitle should prefer an explicit non-generic plan title first',
  );
  assert.match(
    resolvePlanSource,
    /resolvePlanTitle\(options: \{[\s\S]*if \(options\.planFile\) \{[\s\S]*derivePlanTitleFromFilePath\(options\.planFile\)[\s\S]*if \(derived\) return derived;/,
    'resolvePlanTitle should derive a title from the resolved plan file before other fallbacks',
  );
  assert.match(
    resolvePlanSource,
    /resolvePlanTitle\(options: \{[\s\S]*if \(options\.plan\?\.file\) \{[\s\S]*derivePlanTitleFromFilePath\(options\.plan\.file\)/,
    'resolvePlanTitle should fall back to the structured plan file path when present',
  );
  assert.match(
    resolvePlanSource,
    /resolvePlanTitle\(options: \{[\s\S]*if \(options\.fallback && !this\.isGenericPlanTitle\(options\.fallback\)\) \{[\s\S]*return options\.fallback;/,
    'resolvePlanTitle should only use fallback titles when they are not generic placeholders',
  );
});

test.skip('PlanManager persists plans through normalized workspace file paths', () => {
  const persistBody = extractFunctionBody(
    source,
    'async persistPlan(',
  );
  const normalizeFileBody = extractFunctionBody(
    source,
    'private normalizePlanFileReference(file: unknown): string | undefined {',
  );

  assert.match(
    persistBody,
    /const normalizedContent = this\.firstNonEmptyString\(content\);[\s\S]*if \(!normalizedContent\) \{[\s\S]*return undefined;/,
    'persistPlan should skip persistence when content normalizes to empty',
  );
  assert.match(
    persistBody,
    /const normalizedPreferred = this\.normalizePlanFileReference\(preferredPath\);[\s\S]*this\.resolvePlanFileCandidates\(normalizedPreferred\)\[0\] \|\|[\s\S]*path\.normalize\(normalizedPreferred\)/,
    'persistPlan should normalize and resolve preferred paths before writing',
  );
  assert.match(
    persistBody,
    /await vscode\.workspace\.fs\.createDirectory\([\s\S]*vscode\.Uri\.file\(path\.dirname\(normalizedPath\)\)/,
    'persistPlan should ensure the destination directory exists before writing',
  );
  assert.match(
    persistBody,
    /await vscode\.workspace\.fs\.writeFile\([\s\S]*new TextEncoder\(\)\.encode\(normalizedContent\)/,
    'persistPlan should write normalized plan content with vscode.workspace.fs.writeFile',
  );
  assert.match(
    normalizeFileBody,
    /if \(value\.startsWith\("file:\/\/"\)\) \{[\s\S]*const uri = vscode\.Uri\.parse\(value\);[\s\S]*value = uri\.fsPath;/,
    'normalizePlanFileReference should resolve file:// URIs to filesystem paths',
  );
  assert.match(
    normalizeFileBody,
    /\.replace\(\/\^`\+\|`\+\$\/g, ""\)/,
    'normalizePlanFileReference should strip code-fence-style backtick wrappers',
  );
  assert.match(
    normalizeFileBody,
    /\.replace\(\/\^"\+\|"\+\$\/g, ""\)/,
    'normalizePlanFileReference should strip double-quote wrappers',
  );
  assert.match(
    normalizeFileBody,
    /\.replace\(\/\^'\+\|'\+\$\/g, ""\)/,
    'normalizePlanFileReference should strip single-quote wrappers',
  );
  assert.match(
    normalizeFileBody,
    /\.replace\(\/\^<\+\|>\+\$\/g, ""\)/,
    'normalizePlanFileReference should strip angle-bracket wrappers',
  );
  assert.match(
    normalizeFileBody,
    /\.replace\(\/\^\\\(\+\|\\\)\+\$\/g, ""\)/,
    'normalizePlanFileReference should strip surrounding parentheses',
  );
});

test.skip('PlanManager scores, resolves, and extracts plan file candidates with markdown heuristics', () => {
  const likelyBody = extractFunctionBody(
    source,
    'isLikelyPlanMarkdownFile(file: unknown): boolean {',
  );
  const scoreBody = extractFunctionBody(
    source,
    'getPlanFileCandidateScore(filePath: string): number {',
  );
  const prioritizeBody = extractFunctionBody(
    source,
    'prioritizePlanFileCandidates(candidates: Array<unknown>, explicitFiles?: Set<string>): string[] {',
  );
  const collectBody = extractFunctionBody(
    source,
    'collectPlanFileCandidatesFromStructuredPlan(structured: any): string[] {',
  );
  const resolveCandidatesBody = extractFunctionBody(
    source,
    'resolvePlanFileCandidates(planFile: string): string[] {',
  );
  const extractRefsBody = extractFunctionBody(
    source,
    'extractMarkdownFileReferences(text: unknown): string[] {',
  );

  assert.match(
    likelyBody,
    /if \(!normalized \|\| !normalized\.toLowerCase\(\)\.endsWith\("\.md"\)\) \{[\s\S]*return false;/,
    'isLikelyPlanMarkdownFile should reject non-markdown inputs immediately',
  );
  assert.match(
    likelyBody,
    /if \(lower\.includes\("\/node_modules\/"\)\) \{[\s\S]*return false;/,
    'isLikelyPlanMarkdownFile should exclude markdown files under node_modules',
  );
  assert.match(
    likelyBody,
    /implementation_plan_comments_/,
    'isLikelyPlanMarkdownFile should recognize implementation_plan_comments markdown filenames as exclusions',
  );
  assert.match(
    likelyBody,
    /_comments\\\.md\$/,
    'isLikelyPlanMarkdownFile should recognize generic *_comments.md files as exclusions',
  );
  assert.match(
    scoreBody,
    /score \+= 60;[\s\S]*score \+= 50;[\s\S]*score \+= 40;[\s\S]*score \+= 35;[\s\S]*score \+= 30;/,
    'getPlanFileCandidateScore should add weighted bonuses for plan directories and implementation-plan naming',
  );
  assert.match(
    scoreBody,
    /score -= depth \* 2;[\s\S]*score -= 1000;[\s\S]*score -= 1000;[\s\S]*return Math\.max\(0, score\);/,
    'getPlanFileCandidateScore should penalize deep paths and exclude node_modules/.git via heavy negative scores',
  );
  assert.match(
    prioritizeBody,
    /if \(a\.isExplicit && !b\.isExplicit\) return -1;[\s\S]*return b\.score - a\.score;/,
    'prioritizePlanFileCandidates should prefer explicit files before score-based sorting',
  );
  assert.match(
    collectBody,
    /if \(structured\?\.file\) \{[\s\S]*candidates\.push\(normalized\);[\s\S]*if \(structured\?\.files && Array\.isArray\(structured\.files\)\) \{/,
    'collectPlanFileCandidatesFromStructuredPlan should gather both plan.file and plan.files candidates',
  );
  assert.match(
    resolveCandidatesBody,
    /if \(!normalized\.endsWith\("\.md"\)\) \{[\s\S]*candidates\.push\(`\$\{normalized\}\.md`\);[\s\S]*candidates\.push\(`\$\{absolutePath\}\.md`\);/,
    'resolvePlanFileCandidates should expand relative and extensionless plan references into markdown candidates',
  );
  assert.match(
    extractRefsBody,
    /const markdownLinkPattern = \/\\\[\(\[\^\\\]\]\+\)\\\]\\\(\(\[\^\)\]\+\\\.md\)\\\)\/gi;/,
    'extractMarkdownFileReferences should parse inline markdown links to .md files',
  );
  assert.match(
    extractRefsBody,
    /const markdownLinkRefPattern = \/\^\\\[\(\[\^\\\]\]\+\)\\\]:\\s\*\(\.\+\\\.md\)\$\/gmi;/,
    'extractMarkdownFileReferences should parse reference-style markdown links to .md files',
  );
  assert.match(
    extractRefsBody,
    /const plainMdPattern = \/\\b\[\\w-\]\+\\\.md\\b\/gi;/,
    'extractMarkdownFileReferences should parse plain markdown filenames ending in .md',
  );
  assert.match(
    extractRefsBody,
    /const cleaned = str[\s\S]*replace\(codeBlockPattern, ""\)[\s\S]*replace\(inlineCodePattern, ""\);/,
    'extractMarkdownFileReferences should strip fenced and inline code before plain markdown scanning',
  );
});

test.skip('PlanManager discovers candidate files and opens plan viewer with resolved content', () => {
  const discoverBody = extractFunctionBody(
    source,
    'async discoverLikelyPlanFileCandidates(): Promise<string[]> {',
  );
  const handleViewBody = source;

  assert.match(
    discoverBody,
    /await vscode\.workspace\.findFiles\([\s\S]*"\*\*\/\*plan\*\.md"[\s\S]*"\*\*\/\{node_modules,\.git,dist,build\}\/\*\*"/,
    'discoverLikelyPlanFileCandidates should search workspace markdown files while excluding heavy directories',
  );
  assert.match(
    discoverBody,
    /\.filter\(\(filePath\) => this\.isLikelyPlanMarkdownFile\(filePath\)\)[\s\S]*\.filter\(\(item\) => item\.score > 0\)[\s\S]*\.slice\(0, 10\)/,
    'discoverLikelyPlanFileCandidates should score, filter, and cap returned plan candidates',
  );
  assert.match(
    handleViewBody,
    /async handleViewPlan\(plan: \{[\s\S]*const prioritizedCandidates = this\.prioritizePlanFileCandidates\(fileCandidates, explicitFiles\);[\s\S]*if \(!normalizedPlanFile\) \{[\s\S]*await this\.discoverLikelyPlanFileCandidates\(\)/,
    'handleViewPlan should prioritize explicit candidates and fall back to workspace discovery when no plan file was provided',
  );
  assert.match(
    handleViewBody,
    /async handleViewPlan\(plan: \{[\s\S]*for \(const candidate of prioritizedCandidates\) \{[\s\S]*planData = await this\.readPlanFileFromDisk\(candidate\);[\s\S]*resolvedFile = candidate;/,
    'handleViewPlan should read candidates in priority order until a plan file resolves',
  );
  assert.match(
    handleViewBody,
    /async handleViewPlan\(plan: \{[\s\S]*if \([\s\S]*!planData[\s\S]*prioritizedCandidates\.length === 0[\s\S]*plan\.content[\s\S]*typeof plan\.content === "string"[\s\S]*\) \{[\s\S]*planData = plan\.content;/,
    'handleViewPlan should fall back to inline plan content when no file candidates are available',
  );
  assert.match(
    handleViewBody,
    /async handleViewPlan\(plan: \{[\s\S]*await vscode\.commands\.executeCommand\("opencode\.showPlan", \{[\s\S]*content: planData,[\s\S]*title: planTitle,[\s\S]*sourceFile: resolvedFile,[\s\S]*\}\);/,
    'handleViewPlan should open the plan viewer with resolved content, title, and source file metadata',
  );
});
