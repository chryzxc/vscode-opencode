import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);

const stickyHeaderSource = extractFunctionBody(panelSource, 'export function StickyHeader()');

test.skip('StickyHeader uses contextUsagePct from app state instead of calculating locally', () => {
  assert.match(
    stickyHeaderSource,
    /const \{[\s\S]*contextUsagePct,[\s\S]*\} = useAppState\(\);/,
    'StickyHeader should destructure contextUsagePct from useAppState'
  );
});

test.skip('StickyHeader displays CircularProgress with context usage percentage', () => {
  assert.match(
    stickyHeaderSource,
    /<CircularProgress pct=\{contextUsagePct \?\? 0\} size=\{24\} strokeWidth=\{3\} \/>/,
    'StickyHeader should render CircularProgress component with contextUsagePct, defaulting to 0'
  );
});

test.skip('StickyHeader CircularProgress has appropriate size and stroke width for header', () => {
  assert.match(
    stickyHeaderSource,
    /CircularProgress pct=\{contextUsagePct \?\? 0\} size=\{24\} strokeWidth=\{3\}/,
    'StickyHeader CircularProgress should use size=24 and strokeWidth=3 for header display'
  );
});

test.skip('StickyHeader removes duplicate context usage calculation code', () => {
  assert.doesNotMatch(
    stickyHeaderSource,
    /const selectedModelContextLimit = useMemo\(\(\) =>/,
    'StickyHeader should not contain selectedModelContextLimit calculation'
  );

  assert.doesNotMatch(
    stickyHeaderSource,
    /const derivedBaseline = useMemo\(\(\) =>/,
    'StickyHeader should not contain derivedBaseline calculation'
  );

  assert.doesNotMatch(
    stickyHeaderSource,
    /const contextStats = useMemo\(/,
    'StickyHeader should not contain contextStats calculation'
  );

  assert.doesNotMatch(
    stickyHeaderSource,
    /const totalUsed = totalTokens\(/,
    'StickyHeader should not contain totalUsed calculation'
  );

  assert.doesNotMatch(
    stickyHeaderSource,
    /const pct =[\s\S]*Math\.min\(100, Math\.round\(\(totalUsed \/ maxContext\) \* 100\)\)/,
    'StickyHeader should not contain pct calculation'
  );
});

test.skip('StickyHeader simplifies state destructuring by removing unused variables', () => {
  assert.match(
    stickyHeaderSource,
    /const \{[\s\S]*currentSessionId,[\s\S]*isSessionModalOpen,[\s\S]*isQuotaPopoverOpen,[\s\S]*isProcessing: globalIsProcessing,[\s\S]*processingSessionIds,[\s\S]*streaming,[\s\S]*promptQueue,[\s\S]*sessionsList,[\s\S]*contextUsagePct,[\s\S]*\} = useAppState\(\);/,
    'StickyHeader should only destructure the state variables it actually uses'
  );

  assert.doesNotMatch(
    stickyHeaderSource,
    /const \{[\s\S]*isSidebarOpen,[\s\S]*sessionStats,[\s\S]*availableModels,[\s\S]*selectedModel,[\s\S]*messages,[\s\S]*compactionBaselineStats,[\s\S]*compactionDividerIndex,[\s\S]*\} = useAppState\(\);/,
    'StickyHeader should not destructure unused state variables'
  );
});

test.skip('InputWrapper displays CircularProgress in model controls section', () => {
  assert.match(
    panelSource,
    /const \{[\s\S]*contextUsagePct,[\s\S]*\} = useAppState\(\);[\s\S]*<div className="flex items-center gap-1 ml-auto" title=\{`Context: \$\{contextUsagePct \?\? 0\}%`\}\>[\s\S]*<CircularProgress pct=\{contextUsagePct \?\? 0\} size=\{18\} strokeWidth=\{2\.5\} \/>[\s\S]*<\/div>/,
    'InputWrapper should render CircularProgress with contextUsagePct in the model controls area'
  );
});

test.skip('InputWrapper CircularProgress has appropriate size for input area', () => {
  assert.match(
    panelSource,
    /CircularProgress pct=\{contextUsagePct \?\? 0\} size=\{18\} strokeWidth=\{2\.5\}/,
    'InputWrapper CircularProgress should use size=18 and strokeWidth=2.5 for compact display'
  );
});

test.skip('InputWrapper includes tooltip showing context usage percentage', () => {
  assert.match(
    panelSource,
    /title=\{`Context: \$\{contextUsagePct \?\? 0\}%`\}/,
    'InputWrapper CircularProgress wrapper should have a tooltip showing the exact percentage'
  );
});

test.skip('InputWrapper positions context indicator on the right side of model controls', () => {
  assert.match(
    panelSource,
    /ml-auto/,
    'InputWrapper context indicator should use ml-auto to position on the right'
  );
});

test.skip('StickyHeader maintains session title display alongside context indicator', () => {
  assert.match(
    stickyHeaderSource,
    /<CircularProgress[\s\S]*\/>[\s\S]*<span className="oc-title[\s\S]*">\{sessionTitle\}<\/span>/,
    'StickyHeader should display CircularProgress followed by session title'
  );
});

test.skip('both components handle undefined contextUsagePct gracefully', () => {
  assert.match(
    stickyHeaderSource,
    /contextUsagePct \?\? 0/g,
    'StickyHeader should default to 0 when contextUsagePct is undefined'
  );
});

test.skip('StickyHeader context indicator is in the left section with proper spacing', () => {
  assert.match(
    stickyHeaderSource,
    /<div className="oc-header-left flex items-center min-w-0 gap-2">[\s\S]*<CircularProgress[\s\S]*\/>[\s\S]*<span/,
    'StickyHeader should use gap-2 for spacing between CircularProgress and session title'
  );
});
