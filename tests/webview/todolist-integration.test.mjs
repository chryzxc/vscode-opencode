/**
 * TodoList Integration Tests
 *
 * Comprehensive tests for todolist functionality including:
 * - Todo creation, update, and completion flows
 * - Session-scoped todo management
 * - Priority and status handling
 * - SDK integration and normalization
 * - UI interaction and state management
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);

const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);

const storeSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'store.ts')],
  'store.ts',
);

// ===========================================================================
// TODO CREATION AND NORMALIZATION
// ===========================================================================

test('todo creation flow: SDK event -> normalization -> state update -> UI display', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');

  // 1. SDK todo events received
  assert.match(handlerBody, /case\s+["']todoUpdate["']:\s*\{/, 'todoUpdate events from SDK are handled');
  assert.match(handlerBody, /const\s+action\s*=\s*asString\(rec\.action\s*\|\|\s*rec\.type\s*\|\|\s*rec\.kind\s*\)/, 'action type is normalized from various fields');

  // 2. Todo normalization
  assert.match(handlerBody, /const\s+normalized\s*=\s*normalizeTodo\(\s*item,\s*sessionId\s*\)/, 'todo items are normalized with session context');
  assert.match(messageHandlerSource, /function\s+normalizeTodo\(\s*rawTodo,\s*sessionId\s*\)/, 'normalizeTodo function exists');
  assert.match(messageHandlerSource, /firstNonEmptyString\(rec\.text,\s*rec\.content,\s*rec\.description\s*\)/, 'todo text is extracted from multiple possible fields');

  // 3. Todo state updates
  assert.match(handlerBody, /if\s*\(\s*action\s*===\s*["']add["']\s*\)\s*\{[\s\S]*type:\s*["']ADD_TODO_ITEM"']\s*,\s*payload:\s*normalized/, 'add actions dispatch ADD_TODO_ITEM');
  assert.match(handlerBody, /else\s+if\s*\(\s*action\s*===\s*["']update["']\s*\)\s*\{[\s\S]*type:\s*["']UPDATE_TODO_ITEM"']\s*,\s*payload:\s*normalized/, 'update actions dispatch UPDATE_TODO_ITEM');

  // 4. Reducer processing
  assert.match(reducerBody, /case\s+["']ADD_TODO_ITEM["']:\s*\{[\s\S]*todoItems:\s*\[\.\.\.(state\.todoItems\s*\|\|\s*\[\]),\s*action\.payload\]/, 'new todos are appended to state');
  assert.match(reducerBody, /case\s+["']UPDATE_TODO_ITEM["']:\s*\{[\s\S]*todoItems\.map\(\s*t\s*=>\s*t\.id\s*===\s*action\.payload\.id\s*\?\s*\{\s*\.\.\.t,\s*\.\.\.action\.payload\s*\}\s*:\s*t\s*\)/, 'existing todos are updated by ID');
});

test('todo normalization handles various SDK input formats', () => {
  const normalizeTodoBody = extractFunctionBody(messageHandlerSource, 'function normalizeTodo(');

  // Text field normalization
  assert.match(normalizeTodoBody, /const\s+text\s*=\s*firstNonEmptyString\(\s*rawTodo\.text,\s*rawTodo\.content,\s*rawTodo\.description\s*\)/, 'text is extracted from multiple field names');
  assert.match(normalizeTodoBody, /const\s+status\s*=\s*normalizeTodoStatus\(\s*rawTodo\.status\s*\|\|\s*rawTodo\.state\s*\)/, 'status is normalized from various field names');

  // Priority normalization
  assert.match(normalizeTodoBody, /const\s+priority\s*=\s*normalizeTodoPriority\(\s*rawTodo\.priority\s*\)/, 'priority is normalized');
  assert.match(messageHandlerSource, /function\s+normalizeTodoPriority\(/, 'normalizeTodoPriority function exists');
  assert.match(messageHandlerSource, /priorityRaw\.toLowerCase\(\)\s*===\s*["']high["'][\s\S]*["']medium["'][\s\S]*["']low"']/, 'priority values are normalized to standard values');

  // ID generation
  assert.match(normalizeTodoBody, /const\s+id\s*=\s*rawTodo\.id\s*\|\|\s*rawTodo\.todoId\s*\|\|\s*generateTodoId\(\)/, 'ID is extracted or generated');
  assert.match(messageHandlerSource, /function\s+generateTodoId\(/, 'generateTodoId function exists');

  // Session association
  assert.match(normalizeTodoBody, /sessionId:\s*sessionId\s*\|\|\s*rawTodo\.sessionId/, 'todo is associated with current session');
});

// ===========================================================================
// TODO STATUS AND PRIORITY HANDLING
// ===========================================================================

test('todo status flow: pending -> in_progress -> completed -> archived', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');
  const panelBody = extractFunctionBody(panelSource, 'export function TodoPanel()');

  // Status normalization
  assert.match(messageHandlerSource, /function\s+normalizeTodoStatus\(/, 'normalizeTodoStatus function exists');
  assert.match(messageHandlerSource, /["']pending"']|["']todo"']|["']in_progress"']|["']in-progress"'][\s\S]*["']pending"']/i, 'pending/todo statuses are normalized to pending');
  assert.match(messageHandlerSource, /["']completed"']|["']done"']|["']finished"'][\s\S]*["']completed"']/i, 'completion statuses are normalized to completed');

  // Status progression in reducer
  assert.match(reducerBody, /case\s+["']UPDATE_TODO_ITEM["']:\s*\{[\s\S]*status:\s*action\.payload\.status\s*\|\|\s*it\.status/, 'status updates are handled');
  assert.match(reducerBody, /incomingStatus\s*===\s*["']completed"'][\s\S]*isTerminalStatus\(it\.status\)/, 'transition to completed is validated');
  assert.match(reducerBody, /isTerminalStatus\(it\.status\)\s*&&\s*incomingStatus\s*!==\s*it\.status[\s\S]*return\s+it;/, 'terminal statuses cannot be changed');

  // Status-based UI rendering
  assert.match(panelBody, /todo\.status\s*===\s*["']completed"'][\s\S]*line-through/i, 'completed todos have strikethrough styling');
  assert.match(panelBody, /todo\.status\s*===\s*["']pending"'][\s\S]*checkbox/i, 'pending todos show checkbox');
  assert.match(panelBody, /todo\.status\s*===\s*["']in_progress"'][\s\S]*spinner|loading/i, 'in_progress todos show activity indicator');

  // Status toggle functionality
  assert.match(panelBody, /onToggleComplete\s*=\s*\{\(\)\s*=>\s*handleToggleComplete\(todo\.id\)\}/, 'status can be toggled via user action');
  assert.match(handlerBody, /status:\s*todo\.status\s*===\s*["']completed"']\s*\?\s*["']pending"']\s*:\s*["']completed"']/i, 'toggle switches between pending and completed');
});

test('todo priority flow: high -> medium -> low with visual distinction', () => {
  const panelBody = extractFunctionBody(panelSource, 'export function TodoPanel()');
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');

  // Priority levels
  assert.match(reducerBody, /priority:\s*["']high"']|["']medium"']|["']low"']/i, 'todos support high, medium, low priorities');
  assert.match(reducerBody, /priority:\s*action\.payload\.priority\s*\|\|\s*it\.priority\s*\|\|\s*["']medium"']/i, 'priority defaults to medium');

  // Priority-based styling
  assert.match(panelBody, /todo\.priority\s*===\s*["']high"'][\s\S]*red|danger/i, 'high priority todos have warning styling');
  assert.match(panelBody, /todo\.priority\s*===\s*["']medium"'][\s\S]*yellow|warning/i, 'medium priority todos have medium styling');
  assert.match(panelBody, /todo\.priority\s*===\s*["']low"'][\s\S]*gray|neutral/i, 'low priority todos have neutral styling');

  // Priority ordering
  assert.match(panelBody, /todoItems\.sort\(\s*\(\s*a,\s*b\s*\)\s*=>\s*\{[\s\S]*priority/i, 'todos are sorted by priority');
  assert.match(panelBody, /const\s+priorityWeight\s*=\s*\{\s*["']high"']:\s*3,\s*["']medium"']:\s*2,\s*["']low"']:\s*1\s*\}/i, 'priority weights are defined for sorting');
});

// ===========================================================================
// TODO SESSION SCOPING AND FILTERING
// ===========================================================================

test('todo session flow: session association -> filtering -> display', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const panelBody = extractFunctionBody(panelSource, 'export function TodoPanel()');

  // Session association in normalization
  assert.match(handlerBody, /sessionId\s*\|\|\s*currentSessionId\s*\|\|\s*undefined/, 'todos are associated with current session');
  assert.match(messageHandlerSource, /sessionId:\s*sessionId\s*\|\|\s*rawTodo\.sessionId/, 'session ID is preserved from SDK or assigned');

  // Session filtering for display
  assert.match(panelBody, /const\s*visibleTodos\s*=\s*todoItems\.filter\(\s*todo\s*=>\s*todo\.sessionId\s*===\s*currentSessionId\s*\)/, 'todos are filtered by current session');
  assert.match(panelBody, /todoItems\.filter\(\s*t\s*=>\s*t\.sessionId\s*===\s*currentSessionId\s*\)/, 'only current session todos are shown');

  // Cross-session todo visibility
  assert.match(handlerBody, /const\s+allTodos\s*=\s*useSelector\(\s*state\s*=>\s*state\.todoItems\s*\)/, 'all todos are accessible from state');
  assert.match(handlerBody, /const\s*currentSessionTodos\s*=\s*allTodos\.filter\(\s*t\s*=>\s*t\.sessionId\s*===\s*currentSessionId\s*\)/, 'current session todos are filtered');

  // Session switching handling
  assert.match(handlerBody, /useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*currentSessionId\s*\|\|\s*sessionId/, 'todo display updates on session change');
  assert.match(panelBody, /key=\{currentSessionId\}/, 'todo panel re-renders on session change');
});

test('todo snapshot flow: bulk update -> state replacement -> UI refresh', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');

  // Snapshot event handling
  assert.match(handlerBody, /case\s+["']todoSnapshot["']:\s*\{/, 'todoSnapshot events are handled');
  assert.match(handlerBody, /normalizeTodoList\(\s*rawItems,\s*sessionId\s*\|\|\s*currentSessionId\s*\|\|\s*undefined\s*\)/, 'snapshot is normalized with session context');

  // Bulk state replacement
  assert.match(handlerBody, /type:\s*["']SET_TODO_ITEMS"']\s*,\s*payload:\s*normalizedItems/, 'snapshot replaces entire todo list');
  assert.match(reducerBody, /case\s+["']SET_TODO_ITEMS["']:\s*\{[\s\S]*todoItems:\s*action\.payload/, 'todo list is completely replaced');

  // Snapshot vs individual update handling
  assert.match(reducerBody, /SET_TODO_ITEMS.*?todoItems:\s*action\.payload[\s\S]{1,100}UPDATE_TODO_ITEM.*?todoItems\.map/, 'SET_TODO_ITEMS replaces all, UPDATE_TODO_ITEM updates individual');
  assert.match(handlerBody, /SET_TODO_ITEMS.*?addTimestamp:\s*Date\.now\(\)/, 'snapshots have timestamp for ordering');
});

// ===========================================================================
// TODO UI INTERACTION AND STATE MANAGEMENT
// ===========================================================================

test('todo UI flow: add -> toggle -> delete -> reorder', () => {
  const panelBody = extractFunctionBody(panelSource, 'export function TodoPanel()');

  // Add todo functionality
  assert.match(panelBody, /onAddTodo\s*=\s*\{\(\)\s*=>\s*handleAddTodo\(\)/, 'add todo handler exists');
  assert.match(panelBody, /const\s+handleAddTodo\s*=\s*\(\s*\)\s*=>\s*\{[\s\S]*type:\s*["']ADD_TODO_ITEM"']/, 'add todo dispatches action with new item');

  // Toggle complete functionality
  assert.match(panelBody, /onToggleComplete\s*=\s*\{\(\)\s*=>\s*handleToggleComplete\(todo\.id\)\}/, 'toggle complete is handled per todo');
  assert.match(panelBody, /const\s+handleToggleComplete\s*=\s*\(\s*id:\s*string\s*\)\s*=>\s*\{[\s\S]*type:\s*["']UPDATE_TODO_ITEM"'][\s\S]*status:\s*todo\.status\s*===\s*["']completed"']\s*\?\s*["']pending"']\s*:\s*["']completed"']/, 'toggle switches status');

  // Delete todo functionality
  assert.match(panelBody, /onDelete\s*=\s*\{\(\)\s*=>\s*handleDelete\(todo\.id\)\}/, 'delete handler exists');
  assert.match(panelBody, /const\s*handleDelete\s*=\s*\(\s*id:\s*string\s*\)\s*=>\s*\{[\s\S]*type:\s*["']REMOVE_TODO_ITEM"']/, 'delete dispatches remove action');

  // Reorder functionality
  assert.match(panelBody, /onReorder\s*=\s*\{\(\)\s*=>\s*handleReorder\(/, 'reorder handler exists');
  assert.match(panelBody, /drag\s*&&\s*drop/i, 'drag and drop is supported for reordering');
  assert.match(panelBody, /todoItems\.map\(\s*todo\s*=>\s*todo\.id\s*===\s*draggedId\s*\?\s*\{\s*\.\.\.todo,\s*order:\s*newOrder\s*\}\s*:\s*todo\s*\)/, 'order is updated during reorder');
});

test('todo UI flow: inline editing and description handling', () => {
  const panelBody = extractFunctionBody(panelSource, 'export function TodoPanel()');

  // Inline editing
  assert.match(panelBody, /onEdit\s*=\s*\{\(\)\s*=>\s*handleEdit\(todo\.id\)/, 'edit handler exists');
  assert.match(panelBody, /isEditing\s*=\s*editingId\s*===\s*todo\.id/, 'editing state is tracked per todo');
  assert.match(panelBody, /isEditing\s*\?\s*<input/i, 'input field is shown when editing');
  assert.match(panelBody, /onBlur\s*=\s*\{\(\)\s*=>\s*handleBlur\(todo\.id,\s*newValue\)\}/, 'edit is completed on blur');

  // Description handling
  assert.match(panelBody, /todo\.description\s*\|\|\s*todo\.text/, 'description field is used for display');
  assert.match(panelBody, /todo\.description\?.length\s*>\s*0[\s\S]*<p/i, 'descriptions are rendered as paragraphs');
  assert.match(panelBody, /description:\s*todo\.description/, 'description is passed to todo item component');

  // Rich text handling
  assert.match(panelBody, /markdown\s*=\s*todo\.description\s*\|\|\s*todo\.text/, 'markdown content is supported');
  assert.match(panelBody, /<ReactMarkdown[^>]*>.*?<\/ReactMarkdown>/i, 'markdown is rendered for descriptions');
});

// ===========================================================================
// TODO INTEGRATION WITH CHAT FLOW
// ===========================================================================

test('todo integration with chat: todo mentions -> context -> action suggestions', () => {
  const messageHandlerBody = extractFunctionBody(messageHandlerSource, 'function handleStreamEvent');
  const panelBody = extractFunctionBody(panelSource, 'export function TodoPanel()');

  // Todo mentions in chat
  assert.match(messageHandlerBody, /structuredOutput\.todoUpdates\s*\|\|\s*structuredOutput\.todos/, 'todo updates can come from structured output');
  assert.match(messageHandlerBody, /forEach\(\s*todo\s*=>\s*upsertTodo\(/, 'todos from structured output are upserted');

  // Todo context in message generation
  assert.match(panelBody, /const\s+todoContext\s*=\s*todoItems\.filter\(\s*t\s*=>\s*t\.status\s*!==\s*["']completed"']\s*\)/, 'active todos are available as context');
  assert.match(panelBody, /todos:\s*todoContext\.map\(\s*t\s*=>\s*t\.text\s*\)/, 'todo text is included in message context');

  // Action suggestions based on todos
  assert.match(panelBody, /todoItems\.some\(\s*t\s*=>\s*t\.status\s*===\s*["']pending"']\s*\)/, 'pending todos can trigger suggestions');
  assert.match(panelBody, /suggestedActions\s*=\s*\[\s*["']Complete\s+todos["'],\s*["']Update\s+todo\s+list["']\]/i, 'todo-related actions are suggested');

  // Todo panel visibility based on todos
  assert.match(panelBody, /showTodoPanel\s*=\s*todoItems\.length\s*>\s*0/, 'todo panel is shown when todos exist');
  assert.match(panelBody, /\{showTodoPanel\s*&&\s*<TodoPanel/i, 'todo panel is conditionally rendered');
});

test('todo flow: chat command -> todo creation -> confirmation -> display', () => {
  const messageHandlerBody = extractFunctionBody(messageHandlerSource, 'function handleStreamEvent');
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );

  // Todo creation via chat commands
  assert.match(messageHandlerBody, /\/todo|\/task|\/add/i, 'chat commands can trigger todo creation');
  assert.match(messageHandlerBody, /command\s*===\s*["']add-todo["'][\s\S]*extractTodoFromCommand\(/, 'add-todo command creates todos from chat');

  // Todo extraction from chat content
  assert.match(messageHandlerSource, /function\s+extractTodoFromCommand\(/, 'extractTodoFromCommand function exists');
  assert.match(messageHandlerSource, /const\s+todoText\s*=\s*command\.args\.join\(\s*["'\s"']\s*\)/, 'todo text is extracted from command arguments');
  assert.match(messageHandlerSource, /priority:\s*command\.flags\.priority\s*\|\|\s*["']medium"']/i, 'priority can be specified via flags');

  // Confirmation feedback
  assert.match(messageHandlerBody, /type:\s*["']todoCreated"'][\s\S]*text:\s*["']Todo\s+created:\s*["']/i, 'todo creation sends confirmation event');
  assert.match(handlerBody, /case\s+["']todoCreated"']:\s*\{[\s\S]*type:\s*["']SET_TODO_ITEMS"']/i, 'todo creation updates state immediately');

  // Display in UI
  assert.match(handlerBody, /SET_TODO_ITEMS.*?todoItems.*?action\.payload/i, 'new todo appears in UI immediately');
  assert.match(handlerBody, /showTodoPanel\s*=\s*true/, 'todo panel is shown when todo is created');
});

// ===========================================================================
// TODO ERROR HANDLING AND VALIDATION
// ===========================================================================

test('todo error handling: validation -> error display -> recovery', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const panelBody = extractFunctionBody(panelSource, 'export function TodoPanel()');

  // Input validation
  assert.match(handlerBody, /if\s*\(\s*!item\s*\|\s*!item\.text\s*\|\s*!item\.id\s*\)\s*\{[\s\S]*break;/, 'invalid todo items are rejected');
  assert.match(panelBody, /logger\.warn\(\s*["']Invalid\s+todo\s+item["'][\s\S]*item\s*\)/, 'invalid todos are logged');

  // Error display
  assert.match(panelBody, /todo\.error\s*\|\|\s*undefined/, 'todo errors can be stored');
  assert.match(panelBody, /error\s*&&\s*<.*?error.*?>/i, 'error messages are shown in UI');

  // Retry mechanism
  assert.match(panelBody, /onRetry\s*=\s*\{\(\)\s*=>\s*handleRetry\(todo\.id\)\}/, 'retry functionality exists for failed todos');
  assert.match(handlerBody, /const\s*handleRetry\s*=\s*\(\s*id:\s*string\s*\)\s*=>\s*\{[\s\S]*type:\s*["']UPDATE_TODO_ITEM"'][\s\S]*error:\s*null/i, 'retry clears error and updates todo');

  // Error recovery
  assert.match(handlerBody, /todo\.status\s*===\s*["']error"'][\s\S]*retry/i, 'error status shows retry option');
  assert.match(handlerBody, /autoRetry\s*=\s*todo\.retryCount\s*<\s*3/i, 'automatic retry is attempted for transient errors');

  // Duplicate handling
  assert.match(handlerBody, /const\s+existingTodo\s*=\s*state\.todoItems\.find\(\s*t\s*=>\s*t\.id\s*===\s*item\.id\s*\)/, 'duplicate todos are detected');
  assert.match(handlerBody, /if\s*\(\s*existingTodo\s*\)\s*\{[\s\S]*UPDATE_TODO_ITEM[\s\S]*\}\s*else\s*\{[\s\S]*ADD_TODO_ITEM/, 'duplicates trigger update instead of add');
});