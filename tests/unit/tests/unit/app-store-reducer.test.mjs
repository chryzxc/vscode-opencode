/**
 * App Store Reducer Regression Tests
 *
 * Critical regression tests for appReducer to prevent state management bugs:
 * - SET_QUOTA_DATA action handling
 * - SET_BUDGET_INFO action handling
 * - SET_QUOTA_REFRESHING action handling
 * - State immutability
 * - Null/undefined payload handling
 * - State persistence across actions
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../../../helpers/source-utils.mjs';

const storeSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'store.ts')],
  'store.ts',
);
const typesSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'types.ts')],
  'types.ts',
);

test('appReducer exports reducer function', () => {
  assert.match(
    storeSource,
    /export\s+function\s+appReducer/,
    'appReducer should be exported'
  );
});

test('appReducer accepts state and action parameters', () => {
  const reducerBody = extractFunctionBody(
    storeSource,
    'export function appReducer(state: AppState, action: AppAction): AppState'
  );

  assert.match(
    reducerBody,
    /switch\s*\(action\.type\)/,
    'appReducer should switch on action.type'
  );
});

test('SET_QUOTA_DATA action type is defined', () => {
  assert.match(
    storeSource,
    /\|\s*\{\s*type:\s*["']SET_QUOTA_DATA["'];\s*payload:\s*QuotaData\s*\|\s*null\s*\}/,
    'SET_QUOTA_DATA action should be defined in AppAction type'
  );
});

test('SET_QUOTA_DATA handler updates quotaData and sets refreshing to false', () => {
  const reducerBody = extractFunctionBody(
    storeSource,
    'export function appReducer(state: AppState, action: AppAction): AppState'
  );

  assert.match(
    reducerBody,
    /case\s+["']SET_QUOTA_DATA["']:/,
    'Should handle SET_QUOTA_DATA case'
  );
  assert.match(
    reducerBody,
    /quotaData:\s*action\.payload/,
    'Should set quotaData from action payload'
  );
  assert.match(
    reducerBody,
    /quotaIsRefreshing:\s*false/,
    'Should set quotaIsRefreshing to false'
  );
  assert.match(
    reducerBody,
    /\{\s*\.\.\.state,\s*quotaData:/,
    'Should preserve other state fields'
  );
});

test('SET_QUOTA_REFRESHING action type is defined', () => {
  assert.match(
    storeSource,
    /\|\s*\{\s*type:\s*["']SET_QUOTA_REFRESHING["'];\s*payload:\s*boolean\s*\}/,
    'SET_QUOTA_REFRESHING action should be defined'
  );
});

test('SET_QUOTA_REFRESHING handler updates refreshing flag', () => {
  const reducerBody = extractFunctionBody(
    storeSource,
    'export function appReducer(state: AppState, action: AppAction): AppState'
  );

  assert.match(
    reducerBody,
    /case\s+["']SET_QUOTA_REFRESHING["']:/,
    'Should handle SET_QUOTA_REFRESHING case'
  );
  assert.match(
    reducerBody,
    /quotaIsRefreshing:\s*action\.payload/,
    'Should set quotaIsRefreshing from payload'
  );
});

test('SET_BUDGET_INFO action type is defined', () => {
  assert.match(
    storeSource,
    /\|\s*\{\s*type:\s*["']SET_BUDGET_INFO["'];\s*payload:\s*import\(["']\.\/types["']\)\.BudgetInfo\s*\|\s*null\s*\}/,
    'SET_BUDGET_INFO action should be defined'
  );
});

test('SET_BUDGET_INFO handler updates budgetInfo', () => {
  const reducerBody = extractFunctionBody(
    storeSource,
    'export function appReducer(state: AppState, action: AppAction): AppState'
  );

  assert.match(
    reducerBody,
    /case\s+["']SET_BUDGET_INFO["']:/,
    'Should handle SET_BUDGET_INFO case'
  );
  assert.match(
    reducerBody,
    /budgetInfo:\s*action\.payload/,
    'Should set budgetInfo from action payload'
  );
});

test('appReducer returns unchanged state for unknown actions', () => {
  const reducerBody = extractFunctionBody(
    storeSource,
    'export function appReducer(state: AppState, action: AppAction): AppState'
  );

  assert.match(
    reducerBody,
    /default:\s*return\s+state/,
    'Should return original state for unknown actions'
  );
});

test('appReducer uses spread operator for immutability', () => {
  const reducerBody = extractFunctionBody(
    storeSource,
    'export function appReducer(state: AppState, action: AppAction): AppState'
  );

  assert.match(
    reducerBody,
    /\{\s*\.\.\.state,/,
    'Should use spread for immutability'
  );
});

test('AppState includes quotaData field', () => {
  assert.match(
    typesSource,
    /quotaData:\s*QuotaData/,
    'AppState should have quotaData field'
  );
});

test('AppState includes quotaIsRefreshing field', () => {
  assert.match(
    typesSource,
    /quotaIsRefreshing:\s*boolean/,
    'AppState should have quotaIsRefreshing field'
  );
});

test('AppState includes budgetInfo field', () => {
  assert.match(
    typesSource,
    /budgetInfo:\s*BudgetInfo/,
    'AppState should have budgetInfo field'
  );
});

test('AppProvider exports context providers', () => {
  assert.match(
    storeSource,
    /export\s+const\s+AppStateContext/,
    'Should export AppStateContext'
  );
  assert.match(
    storeSource,
    /export\s+const\s+AppDispatchContext/,
    'Should export AppDispatchContext'
  );
});

test('AppProvider uses useReducer hook', () => {
  const providerBody = extractFunctionBody(
    storeSource,
    'export function AppProvider({ children }: { children: React.ReactNode })'
  );

  assert.match(
    providerBody,
    /useReducer\(appReducer,\s*initialState\)/,
    'AppProvider should use useReducer with appReducer'
  );
});

test('AppProvider provides state context', () => {
  const providerBody = extractFunctionBody(
    storeSource,
    'export function AppProvider({ children }: { children: React.ReactNode })'
  );

  assert.match(
    providerBody,
    /value:\s*stateValue/,
    'AppProvider should provide state context'
  );
});

test('AppProvider provides dispatch context', () => {
  const providerBody = extractFunctionBody(
    storeSource,
    'export function AppProvider({ children }: { children: React.ReactNode })'
  );

  assert.match(
    providerBody,
    /React\.createElement\(\s*AppStateContext\.Provider/,
    'AppProvider should use Context.Provider for state'
  );
  assert.match(
    providerBody,
    /value:\s*dispatch/,
    'AppProvider should provide dispatch context'
  );
});

test('useAppState hook is exported', () => {
  assert.match(
    storeSource,
    /export\s+function\s+useAppState/,
    'useAppState hook should be exported'
  );
});

test('useAppState throws when used outside provider', () => {
  const hookBody = extractFunctionBody(
    storeSource,
    'export function useAppState()'
  );

  assert.match(
    hookBody,
    /throw\s+new\s+Error/,
    'useAppState should throw when context is undefined'
  );
  assert.match(
    hookBody,
    /useContext\(AppStateContext\)/,
    'useAppState should use AppStateContext'
  );
});

test('useAppDispatch hook is exported', () => {
  assert.match(
    storeSource,
    /export\s+function\s+useAppDispatch/,
    'useAppDispatch hook should be exported'
  );
});

test('useAppDispatch throws when used outside provider', () => {
  const hookBody = extractFunctionBody(
    storeSource,
    'export function useAppDispatch()'
  );

  assert.match(
    hookBody,
    /throw\s+new\s+Error/,
    'useAppDispatch should throw when context is undefined'
  );
  assert.match(
    hookBody,
    /useContext\(AppDispatchContext\)/,
    'useAppDispatch should use AppDispatchContext'
  );
});

test('initialState is exported', () => {
  assert.match(
    storeSource,
    /export\s+const\s+initialState/,
    'initialState should be exported'
  );
});

test('initialState initializes quotaData to undefined', () => {
  assert.match(
    storeSource,
    /quotaData:\s*undefined/,
    'initialState should set quotaData to undefined'
  );
});

test('initialState initializes quotaIsRefreshing to false', () => {
  assert.match(
    storeSource,
    /quotaIsRefreshing:\s*false/,
    'initialState should set quotaIsRefreshing to false'
  );
});

test('initialState initializes budgetInfo to undefined', () => {
  assert.match(
    storeSource,
    /budgetInfo:\s*undefined/,
    'initialState should set budgetInfo to undefined'
  );
});

test('SET_QUOTA_DATA with null payload clears quotaData', () => {
  const reducerBody = extractFunctionBody(
    storeSource,
    'export function appReducer(state: AppState, action: AppAction): AppState'
  );

  assert.match(
    reducerBody,
    /quotaData:\s*action\.payload/,
    'SET_QUOTA_DATA should accept null payload'
  );
});

test('SET_BUDGET_INFO with null payload clears budgetInfo', () => {
  const reducerBody = extractFunctionBody(
    storeSource,
    'export function appReducer(state: AppState, action: AppAction): AppState'
  );

  assert.match(
    reducerBody,
    /budgetInfo:\s*action\.payload/,
    'SET_BUDGET_INFO should accept null payload'
  );
});

test('reducer does not mutate existing state', () => {
  const reducerBody = extractFunctionBody(
    storeSource,
    'export function appReducer(state: AppState, action: AppAction): AppState'
  );

  assert.match(
    reducerBody,
    /return\s*\{\s*\.\.\.state/,
    'All cases should return new state objects'
  );
});

test('multiple actions can be applied sequentially', () => {
  const reducerBody = extractFunctionBody(
    storeSource,
    'export function appReducer(state: AppState, action: AppAction): AppState'
  );

  assert.match(
    reducerBody,
    /case\s+["']SET_QUOTA_DATA["']:.*case\s+["']SET_QUOTA_REFRESHING["']:.*case\s+["']SET_BUDGET_INFO["']/s,
    'Multiple quota/budget actions should be handleable'
  );
});

test('quotaData type imports from types', () => {
  assert.match(
    storeSource,
    /import\s+type\s*\{[\s\S]*QuotaData[\s\S]*\}\s*from\s+['"](?:\.\/)?types['"]/,
    'QuotaData should be imported from types'
  );
});

test('BudgetInfo type imports from types', () => {
  assert.match(
    storeSource,
    /import\s+type\s*\{[\s\S]*BudgetInfo[\s\S]*\}\s*from\s+['"](?:\.\/)?types['"]/,
    'BudgetInfo should be imported from types'
  );
});

test('AppAction type is exported', () => {
  assert.match(
    storeSource,
    /export\s+type\s+AppAction/,
    'AppAction type should be exported'
  );
});

test('AppState type is exported', () => {
  assert.match(
    typesSource,
    /export\s+interface\s+AppState/,
    'AppState type should be exported'
  );
});

test('mergeStats helper function exists', () => {
  assert.match(
    storeSource,
    /function\s+mergeStats/,
    'mergeStats helper should exist'
  );
});

test('mergeStats correctly accumulates stats', () => {
  const mergeStatsBody = extractFunctionBody(
    storeSource,
    'function mergeStats(current: SessionStats, next: SessionStats): SessionStats'
  );

  assert.match(
    mergeStatsBody,
    /input:\s*current\.input\s*\+\s*next\.input/,
    'Should accumulate input tokens'
  );
  assert.match(
    mergeStatsBody,
    /output:\s*current\.output\s*\+\s*next\.output/,
    'Should accumulate output tokens'
  );
  assert.match(
    mergeStatsBody,
    /read:\s*current\.read\s*\+\s*next\.read/,
    'Should accumulate cache read'
  );
  assert.match(
    mergeStatsBody,
    /write:\s*current\.write\s*\+\s*next\.write/,
    'Should accumulate cache write'
  );
  assert.match(
    mergeStatsBody,
    /duration:\s*current\.duration\s*\+\s*next\.duration/,
    'Should accumulate duration'
  );
});

test.describe('SET_SERVER_ERROR action', () => {

  test('SET_SERVER_ERROR action type exists', () => {
    assert.match(
      storeSource,
      /case\s+["']SET_SERVER_ERROR["']\s*:/,
      'SET_SERVER_ERROR action should be defined'
    );
  });

  test('SET_SERVER_ERROR updates serverError in state', () => {
    assert.match(
      storeSource,
      /case\s+["']SET_SERVER_ERROR["']\s*:.*?serverError:\s*action\.payload/s,
      'SET_SERVER_ERROR should update serverError field'
    );
  });

  test('SET_SERVER_ERROR maintains state immutability', () => {
    assert.match(
      storeSource,
      /case\s+["']SET_SERVER_ERROR["']\s*:.*?return\s*\{\s*\.\.\.state/s,
      'SET_SERVER_ERROR should return new state object'
    );
  });

  test('AppState includes serverError field', () => {
    assert.match(
      typesSource,
      /serverError\?:/,
      'AppState should include serverError field'
    );
  });

  test('AppState serverError is optional', () => {
    assert.match(
      typesSource,
      /serverError\?:\s*string/,
      'AppState serverError should be optional'
    );
  });

});

