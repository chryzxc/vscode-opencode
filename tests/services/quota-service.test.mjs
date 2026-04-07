import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const quotaServiceSource = readSource(
  [joinFromRoot('src', 'services', 'QuotaService.ts')],
  'QuotaService.ts',
);

test('QuotaService implements core service structure', () => {
  // Verify class extends EventEmitter
  assert.match(quotaServiceSource, /export\s+class\s+QuotaService\s+extends\s+EventEmitter/, 'QuotaService should extend EventEmitter');

  // Verify private fields
  assert.match(quotaServiceSource, /private\s+timer:\s*NodeJS\.Timeout\s*\|\s*null/, 'QuotaService should have timer field');
  assert.match(quotaServiceSource, /private\s+isDisposed\s*=\s*false/, 'QuotaService should have isDisposed field');
  assert.match(quotaServiceSource, /private\s+_cachedData:\s*QuotaData\s*\|\s*null/, 'QuotaService should have cachedData field');

  // Verify constructor initializes auto-refresh
  const constructorBody = extractFunctionBody(quotaServiceSource, 'constructor()');
  assert.match(constructorBody, /this\.startAutoRefresh\(\)/, 'constructor should start auto-refresh');
});

test('QuotaService implements auto-refresh lifecycle', () => {
  // Verify startAutoRefresh method
  assert.match(quotaServiceSource, /public\s+startAutoRefresh\(intervalMs\s*=\s*DEFAULT_REFRESH_INTERVAL\):\s*void/, 'QuotaService should expose startAutoRefresh method');
  const startAutoBody = extractFunctionBody(quotaServiceSource, 'public startAutoRefresh(');
  assert.match(startAutoBody, /if\s*\(this\.timer\)\s*\{[\s\S]*clearInterval\(this\.timer\)/, 'startAutoRefresh should clear existing timer');
  assert.match(startAutoBody, /this\.refreshQuota\(\)\.catch\(\(\)\s*=>\s*\{\s*\}\)/, 'startAutoRefresh should do initial fetch');
  assert.match(startAutoBody, /this\.timer\s*=\s*setInterval\(/, 'startAutoRefresh should set interval timer');
  assert.match(startAutoBody, /if\s*\(!this\.isDisposed\)\s*\{[\s\S]*this\.refreshQuota\(\)/, 'startAutoRefresh should check disposal before refresh');

  // Verify DEFAULT_REFRESH_INTERVAL constant
  assert.match(quotaServiceSource, /const\s+DEFAULT_REFRESH_INTERVAL\s*=\s*5\s*\*\s*60\s*\*\s*1000/, 'Should define 5-minute refresh interval');
});

test('QuotaService implements quota refresh orchestration', () => {
  // Verify refreshQuota method
  assert.match(quotaServiceSource, /public\s+async\s+refreshQuota\(\):\s*Promise<QuotaData>/, 'QuotaService should expose refreshQuota method');
  const refreshBody = extractFunctionBody(quotaServiceSource, 'public async refreshQuota(): Promise<QuotaData>');

  // Verify auth file reading
  assert.match(refreshBody, /const\s+auth\s*=\s*readJsonFile<AuthData>\(authPath\)/, 'refreshQuota should read auth data');

  // Verify parallel platform fetching
  assert.match(refreshBody, /const\s+tasks:\s*Promise<void>\[\]\s*=\s*\[\]/, 'refreshQuota should create tasks array');
  assert.match(refreshBody, /await\s+Promise\.allSettled\(tasks\)/, 'refreshQuota should fetch all platforms in parallel');

  // Verify quota data structure
  assert.match(refreshBody, /const\s+data:\s*QuotaData\s*=\s*\{[\s\S]*platforms,[\s\S]*lastUpdated:\s*Date\.now\(\)/, 'refreshQuota should create QuotaData with platforms and timestamp');

  // Verify caching and emission
  assert.match(refreshBody, /this\._cachedData\s*=\s*data/, 'refreshQuota should cache result');
  assert.match(refreshBody, /this\.emit\("quotaUpdate",\s*data\)/, 'refreshQuota should emit quotaUpdate event');

  // Verify cachedData getter
  assert.match(quotaServiceSource, /public\s+get\s+cachedData\(\):\s*QuotaData\s*\|\s*null/, 'QuotaService should expose cachedData getter');
});

test('QuotaService implements OpenAI quota fetching', () => {
  // Verify fetchOpenAI method
  assert.match(quotaServiceSource, /private\s+async\s+fetchOpenAI\([\s\S]*:\s*Promise<PlatformQuota\s*\|\s*null>/, 'QuotaService should expose fetchOpenAI method');
  const openaiBody = extractFunctionBody(quotaServiceSource, 'private async fetchOpenAI(auth: OpenAIAuthData): Promise<PlatformQuota | null>');

  // Verify authentication check
  assert.match(openaiBody, /if\s*\(!auth\?\.access\)\s*\{[\s\S]*return\s+null/, 'fetchOpenAI should return null if no access token');

  // Verify HTTPS request
  assert.match(openaiBody, /const\s+response\s*=\s*await\s+httpsGet\(OPENAI_USAGE_URL/, 'fetchOpenAI should make HTTPS GET request');
  assert.match(openaiBody, /Authorization:\s*`Bearer\s*\$\{(auth\.access|token)\}`/, 'fetchOpenAI should use Bearer auth');
  assert.match(openaiBody, /response\.statusCode/, 'fetchOpenAI should check HTTP status code');
  assert.match(openaiBody, /JSON\.parse\(response\.body\)/, 'fetchOpenAI should parse response body');

  // Verify weekly window parsing
  assert.match(openaiBody, /const\s+weeklyWindow\s*=/, 'fetchOpenAI should extract weekly window');
  assert.match(openaiBody, /json\?\.rate_limit\?\.weekly_window\s*\?\?\s*json\?\.rate_limit\?\.secondary_window/, 'fetchOpenAI should fallback to secondary_window');
  assert.match(openaiBody, /const\s+usedPercent\s*=\s*Number\(weeklyWindow\.used_percent\s*\?\?\s*0\)/, 'fetchOpenAI should parse used_percent');
  assert.match(openaiBody, /const\s+remain\s*=\s*percentBar\(100\s*-\s*usedPercent\)/, 'fetchOpenAI should calculate remaining percentage');

  // Verify primary window parsing
  assert.match(openaiBody, /const\s+primaryWindow\s*=\s*json\?\.rate_limit\?\.primary_window/, 'fetchOpenAI should extract primary window');
  assert.match(openaiBody, /const\s+windowSeconds\s*=\s*Number\(primaryWindow\.limit_window_seconds\s*\?\?\s*0\)/, 'fetchOpenAI should parse window duration');
  assert.match(openaiBody, /const\s+windowHours\s*=\s*Math\.max\(1,\s*Math\.round\(windowSeconds\s*\/\s*3600\)\)/, 'fetchOpenAI should convert to hours');

  // Verify allotments parsing
  assert.match(openaiBody, /const\s+allotments:[\s\S]*json\?\.allotments\s*\?\?\s*\[\]/, 'fetchOpenAI should extract allotments array');
  assert.match(openaiBody, /for\s*\(const\s+allotment\s+of\s+allotments\)/, 'fetchOpenAI should iterate allotments');
  assert.match(openaiBody, /quotas\.push\([\s\S]*label:[\s\S]*remainPercent:[\s\S]*usedTotalDisplay/, 'fetchOpenAI should build quota items');

  // Verify error handling
  assert.match(openaiBody, /catch\s*\(\s*e\s*\)\s*\{[\s\S]*return\s*\{[\s\S]*status:\s*"error"/, 'fetchOpenAI should return error status on exception');
});

test('QuotaService implements Zhipu/ZAI quota fetching', () => {
  // Verify fetchZhipu method
  assert.match(quotaServiceSource, /private\s+async\s+fetchZhipu\([\s\S]*platformName:\s*string[\s\S]*url:\s*string[\s\S]*:\s*Promise<PlatformQuota\s*\|\s*null>/, 'QuotaService should expose fetchZhipu method');
  const zhipuBody = extractFunctionBody(quotaServiceSource, 'private async fetchZhipu(auth: ZhipuAuthData, platformName: string, url: string): Promise<PlatformQuota | null>');

  // Verify authentication check
  assert.match(zhipuBody, /if\s*\(!auth\?\.key\)\s*\{[\s\S]*return\s+null/, 'fetchZhipu should return null if no key');

  // Verify HTTPS request
  assert.match(zhipuBody, /const\s+response\s*=\s*await\s+httpsGet\(url/, 'fetchZhipu should make HTTPS GET request');
  assert.match(zhipuBody, /Authorization:\s*`Bearer\s*\$\{auth\.key\}`/, 'fetchZhipu should use Bearer auth');
  assert.match(zhipuBody, /JSON\.parse\(response\.body\)/, 'fetchZhipu should parse response body');

  // Verify limits parsing
  assert.match(zhipuBody, /const\s+limits:[\s\S]*Array\.isArray\(json\?\.data\?\.limits\)/, 'fetchZhipu should check data.limits array');
  assert.match(zhipuBody, /:\s*Array\.isArray\(json\?\.limits\)/, 'fetchZhipu should fallback to limits array');

  // Verify limit iteration
  assert.match(zhipuBody, /for\s*\(const\s+limit\s+of\s+limits\)/, 'fetchZhipu should iterate limits');
  assert.match(zhipuBody, /const\s+type\s*=\s*typeof\s+limit\?\.type\s*===\s*"string"\s*\?\s*limit\.type\s*:\s*"TOKENS_LIMIT"/, 'fetchZhipu should parse type with fallback');
  assert.match(zhipuBody, /const\s+total\s*=\s*Number\(limit\?\.usage\s*\?\?\s*0\)/, 'fetchZhipu should parse total usage');
  assert.match(zhipuBody, /const\s+used\s*=\s*Number\(limit\?\.currentValue\s*\?\?\s*0\)/, 'fetchZhipu should parse current value');

  // Verify token limit special handling
  assert.match(zhipuBody, /const\s+isTokenLimit\s*=\s*type\s*===\s*"TOKENS_LIMIT"/, 'fetchZhipu should check if token limit');
  assert.match(zhipuBody, /const\s+label\s*=\s*isTokenLimit\s*\?\s*"5\s+hrs\s+token\s+limit"\s*:\s*"Monthly\s+limit"/, 'fetchZhipu should use appropriate label');

  // Verify account masking
  assert.match(zhipuBody, /const\s+account\s*=\s*auth\.key\s*\?\s*maskAccount\(auth\.key\)\s*:\s*platformName/, 'fetchZhipu should mask account key');
});

test('QuotaService implements GitHub Copilot quota fetching', () => {
  // Verify fetchCopilot method
  assert.match(quotaServiceSource, /private\s+async\s+fetchCopilot\([\s\S]*:\s*Promise<PlatformQuota\s*\|\s*null>/, 'QuotaService should expose fetchCopilot method');
  const copilotBody = extractFunctionBody(quotaServiceSource, 'private async fetchCopilot(auth: CopilotAuthData | undefined, config: CopilotQuotaConfig | undefined): Promise<PlatformQuota | null>');

  // Verify token refresh logic
  assert.match(copilotBody, /let\s+token\s*=\s*auth\?\.access/, 'fetchCopilot should start with current access token');
  assert.match(copilotBody, /const\s+expired\s*=\s*auth\?\.expires\s*\?\s*auth\.expires\s*<\s*Date\.now\(\)\s*\/\s*1000\s*-\s*60\s*:\s*true/, 'fetchCopilot should check expiration with 60s buffer');
  assert.match(copilotBody, /if\s*\(expired\s*&&\s*auth\?\.refresh\)/, 'fetchCopilot should refresh if expired');
  assert.match(copilotBody, /const\s+refreshResponse\s*=\s*await\s+httpsPost\([\s\S]*"https:\/\/github\.com\/login\/oauth\/access_token"/, 'fetchCopilot should refresh token via GitHub OAuth');
  assert.match(copilotBody, /JSON\.parse\(refreshResponse\.body\)/, 'fetchCopilot should parse refresh response body');

  // Verify Copilot API token fetch
  assert.match(copilotBody, /const\s+copilotTokenResponse\s*=\s*await\s+httpsGet\([\s\S]*GITHUB_API_BASE_URL.*copilot_internal/, 'fetchCopilot should fetch Copilot API token');
  assert.match(copilotBody, /const\s+apiToken:\s*string\s*=\s*copilotToken\.token\s*\?\?\s*token/, 'fetchCopilot should extract or fallback to access token');

  // Verify user data fetch
  assert.match(copilotBody, /const\s+userResponse\s*=\s*await\s+httpsGet\([\s\S]*GITHUB_API_BASE_URL.*copilot_internal\/user/, 'fetchCopilot should fetch user data');
  assert.match(copilotBody, /JSON\.parse\(userResponse\.body\)/, 'fetchCopilot should parse user response body');

  // Verify quota snapshot parsing
  assert.match(copilotBody, /const\s+premiumSnapshot\s*=\s*userJson\?\.quota_snapshots\?\.premium_interactions/, 'fetchCopilot should extract premium interactions snapshot');
  assert.match(copilotBody, /const\s+snapshotEntitlement\s*=\s*Number\(premiumSnapshot\?\.entitlement\s*\?\?\s*0\)/, 'fetchCopilot should parse entitlement');
  assert.match(copilotBody, /const\s+snapshotRemain\s*=\s*Number\(premiumSnapshot\?\.remaining\s*\?\?\s*0\)/, 'fetchCopilot should parse remaining');

  // Verify fallback usage endpoint
  assert.match(copilotBody, /if\s*\(!premiumSnapshot\)[\s\S]*const\s+usageResponse\s*=\s*await\s+httpsGet\([\s\S]*githubcopilot\.com\/usage/, 'fetchCopilot should fallback to usage endpoint if no snapshot');
  assert.match(copilotBody, /JSON\.parse\(usageResponse\.body\)/, 'fetchCopilot should parse usage response body');

  // Verify tier-based limit logic
  assert.match(copilotBody, /const\s+tier:\s*CopilotTier\s*=\s*config\?\.tier\s*\?\?\s*"free"/, 'fetchCopilot should use config tier or default to free');
  assert.match(copilotBody, /const\s+limitFallback\s*=\s*COPILOT_PLAN_LIMITS\[tier\]\s*\?\?\s*50/, 'fetchCopilot should use tier-based limits with fallback');
  assert.match(copilotBody, /const\s+effectiveLimit\s*=\s*snapshotEntitlement\s*>\s*0\s*\?\s*snapshotEntitlement\s*:\s*limitFallback/, 'fetchCopilot should prefer API entitlement over hardcoded limit');

  // Verify status determination
  assert.match(copilotBody, /status:\s*remainPct\s*<\s*10\s*\?\s*"warning"\s*:\s*"ok"/, 'fetchCopilot should set warning status when below 10%');
});

test('QuotaService implements Google/Antigravity quota fetching', () => {
  // Verify fetchGoogle method
  assert.match(quotaServiceSource, /private\s+async\s+fetchGoogle\([\s\S]*:\s*Promise<PlatformQuota\[\]>/, 'QuotaService should expose fetchGoogle method returning array');
  const googleBody = extractFunctionBody(quotaServiceSource, 'private async fetchGoogle(account: { email?: string; refreshToken: string }): Promise<PlatformQuota[]>');

  // Verify token refresh
  assert.match(googleBody, /let\s+accessToken:\s*string/, 'fetchGoogle should declare accessToken');
  assert.match(googleBody, /const\s+refreshResponse\s*=\s*await\s+httpsPost\([\s\S]*GOOGLE_TOKEN_REFRESH_URL/, 'fetchGoogle should refresh access token');
  assert.match(googleBody, /JSON\.parse\(refreshResponse\.body\)/, 'fetchGoogle should parse refresh response body');
  assert.match(googleBody, /new\s+URLSearchParams\([\s\S]*client_id:\s*GOOGLE_CLIENT_ID,[\s\S]*grant_type:/, 'fetchGoogle should use OAuth refresh flow');

  // Verify quota API fetch
  assert.match(googleBody, /const\s+response\s*=\s*await\s+httpsPost\([\s\S]*GOOGLE_QUOTA_API_URL/, 'fetchGoogle should fetch from Google quota API');
  assert.match(googleBody, /JSON\.parse\(response\.body\)/, 'fetchGoogle should parse response body');
  assert.match(googleBody, /Authorization:\s*`Bearer\s*\$\{accessToken\}`/, 'fetchGoogle should use refreshed token');

  // Verify model iteration
  assert.match(googleBody, /const\s+modelsInfo:[\s\S]*json\?\.models\s*\?\?\s*\[\]/, 'fetchGoogle should extract models array');
  assert.match(googleBody, /for\s*\(const\s+gm\s+of\s+GOOGLE_MODELS\)/, 'fetchGoogle should iterate known models');
  assert.match(googleBody, /modelData\s*=\s*modelsInfo\.find\([\s\S]*gm\.key/, 'fetchGoogle should find model by key');

  // Verify quota calculation
  assert.match(googleBody, /const\s+used:\s*number\s*=\s*quota\.dailyUsage\s*\?\?\s*0/, 'fetchGoogle should parse dailyUsage');
  assert.match(googleBody, /const\s+total:\s*number\s*=\s*quota\.dailyLimit\s*\?\?\s*quota\.limit\s*\?\?\s*0/, 'fetchGoogle should parse dailyLimit with fallback');
  assert.match(googleBody, /const\s+remainPct\s*=\s*total\s*>\s*0\s*\?\s*\(remaining\s*\/\s*total\)\s*\*\s*100\s*:\s*0/, 'fetchGoogle should calculate percentage safely');

  // Verify tracked usage integration
  assert.match(googleBody, /const\s+tracker\s*=\s*GeminiTokenUsageTracker\.getInstance\(\)/, 'fetchGoogle should get token tracker singleton');
  assert.match(googleBody, /const\s+allTrackedUsage\s*=\s*tracker\.getAllUsage\(\)/, 'fetchGoogle should get all tracked usage');
  assert.match(googleBody, /const\s+geminiModels\s*=\s*allTrackedUsage\.filter\(/, 'fetchGoogle should filter tracked usage');

  // Verify tracked token display
  assert.match(googleBody, /const\s+totalTracked\s*=\s*geminiModels\.reduce\([\s\S]*sum\s*\+\s*usage\.grandTotal/, 'fetchGoogle should sum tracked tokens');
  assert.match(googleBody, /const\s+dailyLimit\s*=\s*1_000_000/, 'fetchGoogle should use 1M daily limit');
  assert.match(googleBody, /quotas\.push\(\{[\s\S]*label:\s*"Tracked\s+Today\s*\(usageMetadata\)"/, 'fetchGoogle should add tracked usage section');
});

test('QuotaService implements HTTPS request helpers', () => {
  // Verify httpsGet function
  assert.match(quotaServiceSource, /function\s+httpsGet\([\s\S]*Promise<HttpResponse>/, 'Should have httpsGet helper');
  assert.match(quotaServiceSource, /interface\s+HttpResponse\s*\{[\s\S]*body:\s*string;[\s\S]*statusCode:\s*number;[\s\S]*\}/, 'Should define HttpResponse interface');
  const getBody = extractFunctionBody(quotaServiceSource, 'function httpsGet(');
  assert.match(getBody, /new\s+Promise\(\(resolve,\s*reject\)\s*=>/, 'httpsGet should return Promise');
  assert.match(getBody, /const\s+req\s*=\s*https\.request\(/, 'httpsGet should use https.request');
  assert.match(getBody, /timeout:\s*REQUEST_TIMEOUT_MS/, 'httpsGet should set timeout');
  assert.match(getBody, /req\.on\("timeout",\s*\(\)\s*=>/, 'httpsGet should handle timeout');
  assert.match(getBody, /req\.on\("error",\s*reject\)/, 'httpsGet should handle errors');
  assert.match(getBody, /resolve\(\{\s*body:\s*data,\s*statusCode:\s*res\.statusCode\s*\|\|\s*200\s*\}\)/, 'httpsGet should return HttpResponse with body and status');

  // Verify httpsPost function
  assert.match(quotaServiceSource, /function\s+httpsPost\([\s\S]*Promise<HttpResponse>/, 'Should have httpsPost helper');
  const postBody = extractFunctionBody(quotaServiceSource, 'function httpsPost(');
  assert.match(postBody, /req\.write\(body\)/, 'httpsPost should write body');
  assert.match(postBody, /req\.end\(\)/, 'httpsPost should end request');
  assert.match(postBody, /resolve\(\{\s*body:\s*data,\s*statusCode:\s*res\.statusCode\s*\|\|\s*200\s*\}\)/, 'httpsPost should return HttpResponse with body and status');

  // Verify constants
  assert.match(quotaServiceSource, /const\s+REQUEST_TIMEOUT_MS\s*=\s*10_000/, 'Should define 10s timeout');
  assert.match(quotaServiceSource, /const\s+USER_AGENT\s*=\s*"vscode-opencode-quota-monitor\/1\.0"/, 'Should define user agent');
});

test('QuotaService implements formatting helpers', () => {
  // Verify formatNumber function
  assert.match(quotaServiceSource, /function\s+formatNumber\(n:\s*number\):\s*string/, 'Should have formatNumber helper');
  assert.match(quotaServiceSource, /if\s*\(n\s*>=\s*1_000_000\)\s*return\s*`\$\{\(n\s*\/\s*1_000_000\)\.toFixed\(1\)\}M`/, 'formatNumber should format millions');
  assert.match(quotaServiceSource, /if\s*\(n\s*>=\s*1_000\)\s*return\s*`\$\{\(n\s*\/\s*1_000\)\.toFixed\(1\)\}K`/, 'formatNumber should format thousands');

  // Verify formatDuration function
  assert.match(quotaServiceSource, /function\s+formatDuration\(seconds:\s*number\):\s*string/, 'Should have formatDuration helper');
  assert.match(quotaServiceSource, /const\s+days\s*=\s*Math\.floor\(safeSeconds\s*\/\s*86_400\)/, 'formatDuration should calculate days');
  assert.match(quotaServiceSource, /const\s+hours\s*=\s*Math\.floor\(\(safeSeconds\s*%\s*86_400\)\s*\/\s*3_600\)/, 'formatDuration should calculate hours');

  // Verify formatResetFromTimestampMs function
  assert.match(quotaServiceSource, /function\s+formatResetFromTimestampMs\([\s\S]*string\s*\|\s*undefined/, 'Should have formatResetFromTimestampMs helper');
  assert.match(quotaServiceSource, /const\s+diffSec\s*=\s*Math\.floor\(\(resetAtMs\s*-\s*Date\.now\(\)\)\s*\/\s*1000\)/, 'formatResetFromTimestampMs should calculate seconds until reset');
  assert.match(quotaServiceSource, /if\s*\(diffSec\s*<=\s*0\)\s*\{[\s\S]*return\s*"soon";[\s\S]*\}/, 'formatResetFromTimestampMs should return "soon" if passed');

  // Verify maskAccount function
  assert.match(quotaServiceSource, /function\s+maskAccount\([\s\S]*start\s*=\s*4,\s*end\s*=\s*4\):\s*string/, 'Should have maskAccount helper');
  assert.match(quotaServiceSource, /return\s+`.*slice.*\*\*\*\*/, 'maskAccount should mask middle of string');
});

test('QuotaService implements platform detection', () => {
  // Verify provider recognition in refreshQuota
  const refreshBody = extractFunctionBody(quotaServiceSource, 'public async refreshQuota(): Promise<QuotaData>');
  assert.match(refreshBody, /const\s+hasRecognizedProviders\s*=\s*Boolean\([\s\S]*auth\?\.openai\s*\|\|/, 'refreshQuota should check for recognized providers');
  assert.match(refreshBody, /auth\?\.\["zhipuai-coding-plan"\]/, 'refreshQuota should check for Zhipu');
  assert.match(refreshBody, /auth\?\.\["zai-coding-plan"\]/, 'refreshQuota should check for ZAI');
  assert.match(refreshBody, /auth\?\.\["github-copilot"\]/, 'refreshQuota should check for GitHub Copilot');
  assert.match(refreshBody, /antigravityFile\s*&&[\s\S]*antigravityFile\.accounts/, 'refreshQuota should check for Antigravity accounts');

  // Verify error state when no auth
  assert.match(refreshBody, /if\s*\(!auth\)[\s\S]*platform:\s*"opencode"[\s\S]*status:\s*"error"[\s\S]*error:\s*"No\s+auth\.json\s+found"/, 'refreshQuota should show error when no auth file');

  // Verify connected state when auth exists but no recognized providers
  assert.match(refreshBody, /else\s+if\s*\(!hasRecognizedProviders\)/, 'refreshQuota should check if has recognized providers');
  assert.match(refreshBody, /platforms\.push\([\s\S]*status:\s*"ok"[\s\S]*label:\s*"Connected"/, 'refreshQuota should show connected when auth but unknown providers');
});

test('QuotaService implements disposal', () => {
  // Verify dispose method
  assert.match(quotaServiceSource, /public\s+dispose\(\):\s*void/, 'QuotaService should expose dispose method');
  const disposeBody = extractFunctionBody(quotaServiceSource, 'public dispose(): void');

  assert.match(disposeBody, /this\.isDisposed\s*=\s*true/, 'dispose should set isDisposed flag');
  assert.match(disposeBody, /if\s*\(this\.timer\)\s*\{[\s\S]*clearInterval\(this\.timer\)/, 'dispose should clear refresh timer');
  assert.match(disposeBody, /this\.timer\s*=\s*null/, 'dispose should null timer reference');
  assert.match(disposeBody, /this\.removeAllListeners\(\)/, 'dispose should remove event listeners');
});

test('QuotaService defines API endpoints', () => {
  // Verify endpoint constants
  assert.match(quotaServiceSource, /const\s+OPENAI_USAGE_URL\s*=\s*"https:\/\/chatgpt\.com\/backend-api\/wham\/usage"/, 'Should define OpenAI usage URL');
  assert.match(quotaServiceSource, /const\s+ZHIPU_USAGE_URL\s*=\s*"https:\/\/bigmodel\.cn\/api\/monitor\/usage\/quota\/limit"/, 'Should define Zhipu usage URL');
  assert.match(quotaServiceSource, /const\s+ZAI_USAGE_URL\s*=\s*"https:\/\/api\.z\.ai\/api\/monitor\/usage\/quota\/limit"/, 'Should define ZAI usage URL');
  assert.match(quotaServiceSource, /const\s+GITHUB_API_BASE_URL\s*=\s*"https:\/\/api\.github\.com"/, 'Should define GitHub API base URL');
  assert.match(quotaServiceSource, /const\s+GOOGLE_QUOTA_API_URL\s*=\s*"https:\/\/cloudcode-pa\.googleapis\.com\/v1internal:fetchAvailableModels"/, 'Should define Google quota API URL');
  assert.match(quotaServiceSource, /const\s+GOOGLE_TOKEN_REFRESH_URL\s*=\s*"https:\/\/oauth2\.googleapis\.com\/token"/, 'Should define Google token refresh URL');
});

test('QuotaService defines Google model configuration', () => {
  // Verify GOOGLE_MODELS array
  assert.match(quotaServiceSource, /const\s+GOOGLE_MODELS\s*=\s*\[/, 'Should define GOOGLE_MODELS array');
  assert.match(quotaServiceSource, /\{\s*key:\s*"gemini-3-pro-high",\s*altKey:\s*"gemini-3-pro-low",\s*display:\s*"G3\s+Pro"\s*\}/, 'Should define G3 Pro model');
  assert.match(quotaServiceSource, /\{\s*key:\s*"gemini-3-flash"[\s\S]*display:\s*"G3\s+Flash"\s*\}/, 'Should define G3 Flash model');
  assert.match(quotaServiceSource, /\{\s*key:\s*"claude-opus-4-5-thinking"[\s\S]*display:\s*"Claude"/, 'Should define Claude model');
});

test('QuotaService defines Copilot plan limits', () => {
  // Verify COPILOT_PLAN_LIMITS object
  assert.match(quotaServiceSource, /const\s+COPILOT_PLAN_LIMITS:\s*Record<string,\s*number>\s*=\s*\{/, 'Should define COPILOT_PLAN_LIMITS');
  assert.match(quotaServiceSource, /free:\s*50,/, 'Should define free plan limit as 50');
  assert.match(quotaServiceSource, /pro:\s*300,/, 'Should define pro plan limit as 300');
  assert.match(quotaServiceSource, /"pro\+":\s*1500,/, 'Should define pro+ plan limit as 1500');
  assert.match(quotaServiceSource, /business:\s*300,/, 'Should define business plan limit as 300');
  assert.match(quotaServiceSource, /enterprise:\s*1000,/, 'Should define enterprise plan limit as 1000');
});

test('QuotaService defines file paths', () => {
  // Verify path constants
  assert.match(quotaServiceSource, /const\s+authPath\s*=\s*path\.join\([\s\S]*\.local[\s\S]*share[\s\S]*opencode[\s\S]*auth\.json/, 'Should define authPath');
  assert.match(quotaServiceSource, /const\s+antigravityPath\s*=\s*path\.join\([\s\S]*\.config[\s\S]*opencode[\s\S]*antigravity-accounts\.json/, 'Should define antigravityPath');
  assert.match(quotaServiceSource, /const\s+copilotConfigPath\s*=\s*path\.join\([\s\S]*\.config[\s\S]*opencode[\s\S]*copilot-quota-token\.json/, 'Should define copilotConfigPath');
});

test('QuotaService implements error handling', () => {
  // Verify OpenAI error handling returns error status
  const openaiBody = extractFunctionBody(quotaServiceSource, 'private async fetchOpenAI(auth: OpenAIAuthData): Promise<PlatformQuota | null>');
  assert.match(openaiBody, /catch\s*\(e\)\s*\{[\s\S]*return\s*\{[\s\S]*platform:\s*"openai"[\s\S]*status:\s*"error"/, 'fetchOpenAI should return error platform on exception');
  assert.match(openaiBody, /response\.statusCode\s*===\s*401/, 'fetchOpenAI should check for 401 status');
  assert.match(openaiBody, /Authentication Error/, 'fetchOpenAI should return authentication error for 401');
  assert.match(openaiBody, /logger\.error\('OpenAI API returned 401 Unauthorized'/, 'fetchOpenAI should log 401 errors');

  // Verify Zhipu error handling
  const zhipuBody = extractFunctionBody(quotaServiceSource, 'private async fetchZhipu(auth: ZhipuAuthData, platformName: string, url: string): Promise<PlatformQuota | null>');
  assert.match(zhipuBody, /catch\s*\(e\)\s*\{[\s\S]*return\s*\{[\s\S]*status:\s*"error"[\s\S]*error:\s*String\(e\)/, 'fetchZhipu should return error platform on exception');

  // Verify Google token refresh error handling
  const googleBody = extractFunctionBody(quotaServiceSource, 'private async fetchGoogle(account: { email?: string; refreshToken: string }): Promise<PlatformQuota[]>');
  assert.match(googleBody, /catch\s*\(e\)[\s\S]*platform:\s*"google"[\s\S]*status:\s*"error"[\s\S]*Token\s+refresh\s+failed/, 'fetchGoogle should return error on token refresh failure');
  assert.match(googleBody, /catch\s*\(e\)[\s\S]*status:\s*"error"[\s\S]*error:\s*String\(e\)/, 'fetchGoogle should return error on quota fetch failure');
});

test('QuotaService integrates with GeminiTokenUsageTracker', () => {
  // Verify import
  assert.match(quotaServiceSource, /import\s+\{\s*GeminiTokenUsageTracker\s*\}\s+from\s+"\.\/GeminiTokenUsageTracker"/, 'QuotaService should import GeminiTokenUsageTracker');

  // Verify usage in fetchGoogle
  const googleBody = extractFunctionBody(quotaServiceSource, 'private async fetchGoogle(account: { email?: string; refreshToken: string }): Promise<PlatformQuota[]>');
  assert.match(googleBody, /const\s+tracker\s*=\s*GeminiTokenUsageTracker\.getInstance\(\)/, 'fetchGoogle should get tracker instance');
  assert.match(googleBody, /const\s+allTrackedUsage\s*=\s*tracker\.getAllUsage\(\)/, 'fetchGoogle should get all usage from tracker');
  assert.match(googleBody, /const\s+geminiModels\s*=\s*allTrackedUsage\.filter\(/, 'fetchGoogle should filter to Gemini models');
  assert.match(googleBody, /for\s*\(const\s+usage\s+of\s+geminiModels\)/, 'fetchGoogle should iterate tracked usage');
  assert.match(googleBody, /const\s+modelPercent\s*=\s*\(usage\.grandTotal\s*\/\s*dailyLimit\)\s*\*\s*100/, 'fetchGoogle should calculate percentage for each model');
});

test('QuotaService handles request timeout', () => {
  // Verify timeout in httpsGet
  const getBody = extractFunctionBody(quotaServiceSource, 'function httpsGet(');
  assert.match(getBody, /timeout:\s*REQUEST_TIMEOUT_MS/, 'httpsGet should set timeout option');
  assert.match(getBody, /req\.on\("timeout"[\s\S]*req\.destroy\([\s\S]*Request\s+timed\s+out/, 'httpsGet should destroy request on timeout');

  // Verify timeout in httpsPost
  const postBody = extractFunctionBody(quotaServiceSource, 'function httpsPost(');
  assert.match(postBody, /timeout:\s*REQUEST_TIMEOUT_MS/, 'httpsPost should set timeout option');
  assert.match(postBody, /req\.on\("timeout"[\s\S]*req\.destroy\([\s\S]*Request\s+timed\s+out/, 'httpsPost should destroy request on timeout');
});

test('QuotaService normalizes platform IDs', () => {
  // Verify normalizePlatformId function
  assert.match(quotaServiceSource, /function\s+normalizePlatformId\(platformName:\s*string\):\s*string/, 'Should have normalizePlatformId helper');
  const normalizeBody = extractFunctionBody(quotaServiceSource, 'function normalizePlatformId(');
  assert.match(normalizeBody, /return\s+platformName\.toLowerCase\(\)\.replace\([\s\S]*\.replace\([\s\S]*""\)/, 'normalizePlatformId should lowercase and replace spaces/dots');
});

test('QuotaService implements percent bar utility', () => {
  // Verify percentBar function
  assert.match(quotaServiceSource, /function\s+percentBar\(pct:\s*number\):\s*number/, 'Should have percentBar helper');
  assert.match(quotaServiceSource, /return\s+Math\.max\(0,\s*Math\.min\(100,\s*Math\.round\(pct\)\)\)/, 'percentBar should clamp to 0-100 range');
});

test('QuotaService handles conditional platform fetching', () => {
  // Verify OpenAI conditional fetch in refreshQuota
  const refreshBody = extractFunctionBody(quotaServiceSource, 'public async refreshQuota(): Promise<QuotaData>');
  assert.match(refreshBody, /if\s*\(\s*auth\?\.\s*openai/,'refreshQuota should conditionally fetch OpenAI');

  // Verify Zhipu conditional fetch
  assert.match(refreshBody, /if\s*\(\s*auth\?\.\["zhipuai-coding-plan"\]\?\.key\)[\s\S]*this\.fetchZhipu\([\s\S]*ZHIPU_USAGE_URL/, 'refreshQuota should conditionally fetch Zhipu');

  // Verify ZAI conditional fetch
  assert.match(refreshBody, /if\s*\(\s*auth\?\.\["zai-coding-plan"\]\?\.key\)[\s\S]*this\.fetchZhipu\([\s\S]*ZAI_USAGE_URL/, 'refreshQuota should conditionally fetch ZAI');

  // Verify Copilot conditional fetch
  assert.match(refreshBody, /if\s*\(\s*auth\?\.\["github-copilot"\]\?\.access/,'refreshQuota should check Copilot auth');
  assert.match(refreshBody, /tasks\.push\([\s\S]*this\.fetchCopilot\(/, 'refreshQuota should push Copilot fetch task');

  // Verify Antigravity conditional fetch
  assert.match(refreshBody, /if\s*\(antigravityFile\?\.accounts\?\.length\)\s*\{[\s\S]*for\s*\(const\s+account\s+of\s+antigravityFile\.accounts\)/, 'refreshQuota should iterate Antigravity accounts');
  assert.match(refreshBody, /tasks\.push\([\s\S]*this\.fetchGoogle\(/, 'refreshQuota should push Google fetch for each account');
});
