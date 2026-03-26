# Architecture Overview

This document provides a high-level overview of the VSCode OpenCode extension architecture.

## System Architecture

The OpenCode extension is a VSCode extension that provides AI-powered chat capabilities with advanced features like structured output, multi-agent systems, and plan tracking.

```
┌─────────────────────────────────────────────────────────────┐
│                     VSCode Extension Host                    │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              extension.ts (Entry Point)                │ │
│  │  - Activates extension                                 │ │
│  │  - Registers providers and commands                   │ │
│  └────────────────────────────────────────────────────────┘ │
│                              │                              │
│  ┌──────────────────────────┼──────────────────────────┐  │
│  │                          │                          │  │
│  ▼                          ▼                          │  │
│ ┌─────────────────┐  ┌─────────────────┐              │  │
│ │  Providers      │  │   Services      │              │  │
│ │                 │  │                 │              │  │
│ │ • ChatView      │  │ • Session       │              │  │
│ │ • StatusBar     │  │ • Quota         │              │  │
│ │ • DiffReview    │  │ • Message       │              │  │
│ │ • PlanView      │  │ • Stream        │              │  │
│ │ • ConfigFiles   │  │ • Plan          │              │  │
│ └─────────────────┘  │ • Subagent      │              │  │
│                      │ • Settings      │              │  │
│                      │ • TokenUsage    │              │  │
│                      └─────────────────┘              │  │
│                                                      │  │
└─────────────────────────────────────────────────────┘  │
         │                                                 │
         │ WebView Communication                            │
         │ (Webview.postMessage)                            │
         ▼                                                 │
┌───────────────────────────────────────────────────────┐ │
│              WebView (React Application)               │ │
│  ┌──────────────────────────────────────────────────┐ │ │
│  │  Frontend Components                             │ │ │
│  │  - ChatShell, MessageComponents                  │ │ │
│  │  - PanelComponents (Todo, ActiveTask, Agents)    │ │ │
│  │  - PlanViewer, InteractiveEvents                │ │ │
│  └──────────────────────────────────────────────────┘ │ │
│                                                         │ │
│  ┌──────────────────────────────────────────────────┐ │ │
│  │  State Management                                │ │ │
│  │  - useAppState() hook                            │ │ │
│  │  - Message store, streaming state                │ │ │
│  └──────────────────────────────────────────────────┘ │ │
└───────────────────────────────────────────────────────┘ │
         │                                                   │
         │ HTTP/WebSocket                                    │
         ▼                                                   │
┌───────────────────────────────────────────────────────┐ │
│              External Services                         │ │
│  • Claude API (Anthropic)                             │ │
│  • OpenCode Server (if configured)                    │ │
│  • Model providers (Gemini, etc.)                     │ │
└───────────────────────────────────────────────────────┘
```

## Core Components

### 1. Extension Entry Point
**File**: [`src/extension.ts`](src/extension.ts:1)

Main activation and lifecycle management:
- Initializes all providers
- Registers VSCode commands
- Manages extension context
- Handles cleanup on deactivation

### 2. Providers Layer
**Directory**: [`src/providers/`](src/providers/)

Providers integrate with VSCode's extension API and manage UI components.

#### ChatViewProvider
**File**: [`src/providers/ChatViewProvider.ts`](src/providers/ChatViewProvider.ts:1)
- **Purpose**: Main chat interface provider
- **Responsibilities**:
  - Manages webview panel lifecycle
  - Handles bidirectional communication with webview
  - Coordinates message streaming and display
  - Manages chat state and persistence
  - Integrates with SessionService for message storage

#### StatusBarProvider
**File**: [`src/providers/StatusBarProvider.ts`](src/providers/StatusBarProvider.ts:1)
- **Purpose**: Status bar integration
- **Responsibilities**:
  - Displays quota information
  - Shows active model/status
  - Provides quick actions

#### PlanViewProvider
**File**: [`src/providers/PlanViewProvider.ts`](src/providers/PlanViewProvider.ts:1)
- **Purpose**: Plan visualization and tracking
- **Responsibilities**:
  - Displays structured plans
  - Tracks plan execution progress
  - Integrates with PlanParser

#### DiffReviewProvider
**File**: [`src/providers/DiffReviewProvider.ts`](src/providers/DiffReviewProvider.ts:1)
- **Purpose**: Code diff review interface
- **Responsibilities**:
  - Shows proposed changes
  - Manages diff navigation
  - Handles acceptance/rejection

#### ConfigFilesProvider
**File**: [`src/providers/ConfigFilesProvider.ts`](src/providers/ConfigFilesProvider.ts:1)
- **Purpose**: Configuration file management
- **Responsibilities**:
  - Tracks configuration files
  - Provides config editing interface

### 3. Services Layer
**Directory**: [`src/services/`](src/services/)

Business logic and state management services.

#### SessionService
**File**: [`src/services/SessionService.ts`](src/services/SessionService.ts:1)
- **Purpose**: Session and message persistence
- **Key Features**:
  - CRUD operations for chat sessions
  - Message storage and retrieval
  - Session hydration and restoration
  - Message canonicalization
  - System message handling

#### QuotaService
**File**: [`src/services/QuotaService.ts`](src/services/QuotaService.ts:1)
- **Purpose**: Token usage tracking and quota management
- **Key Features**:
  - Token counting and budgeting
  - Quota enforcement
  - Usage tracking across sessions
  - Model-specific quota limits

#### MessageStreamService
**File**: [`src/services/MessageStreamService.ts`](src/services/MessageStreamService.ts:1)
- **Purpose**: Message streaming and processing
- **Key Features**:
  - SSE (Server-Sent Events) stream handling
  - Structured output parsing
  - Streaming state management
  - Progress tracking

#### ChatPlanService
**File**: [`src/services/ChatPlanService.ts`](src/services/ChatPlanService.ts:1)
- **Purpose**: Plan management and execution
- **Key Features**:
  - Plan creation and parsing
  - Plan step tracking
  - Plan completion detection
  - Integration with PlanParser

#### ChatMessageService
**File**: [`src/services/ChatMessageService.ts`](src/services/ChatMessageService.ts:1)
- **Purpose**: Message handling and transformation
- **Key Features**:
  - Message preprocessing
  - System message filtering
  - Reasoning content handling
  - Message formatting

#### SubagentTracker
**File**: [`src/services/SubagentTracker.ts`](src/services/SubagentTracker.ts:1)
- **Purpose**: Multi-agent session management
- **Key Features**:
  - Subagent lifecycle tracking
  - Session isolation
  - UI state synchronization
  - Structured output coordination

#### RequestBudgeter
**File**: [`src/services/RequestBudgeter.ts`](src/services/RequestBudgeter.ts:1)
- **Purpose**: Request cost estimation and budgeting
- **Key Features**:
  - Token cost prediction
  - Budget allocation
  - Cost optimization

#### OpencodeServerManager
**File**: [`src/services/OpencodeServerManager.ts`](src/services/OpencodeServerManager.ts:1)
- **Purpose**: OpenCode server integration
- **Key Features**:
  - Server lifecycle management
  - Health checks
  - Connection pooling

#### Additional Services
- **ChatSettingsService**: Configuration management
- **ChatQueueService**: Request queuing and scheduling
- **ChatStreamHandler**: Stream event handling
- **GeminiTokenUsageTracker**: Gemini-specific token tracking
- **ModelCapabilitiesService**: Model capability detection
- **SkillManagerService**: Skill/plugin management
- **CheckpointRestore**: State checkpointing

### 4. WebView Frontend
**Directory**: [`webview/shared/src/chat/`](webview/shared/src/chat/)

React-based user interface running in VSCode webview.

#### Component Structure

**Core Layout**:
- **ChatShell**: Main chat container
- **MessageComponents**: Message rendering (user, assistant, system)
- **PanelComponents**: Side panels (todo, active tasks, agents)

**Interactive Components**:
- **InputArea**: Message input and controls
- **InteractiveEvents**: Clickable elements in responses
- **PlanViewer**: Plan visualization
- **StreamingState**: Streaming progress indicators

**State Management**:
- **useAppState()**: Global state hook
- **Message Store**: Message history
- **Streaming State**: Real-time updates
- **Panel State**: Side panel toggles

#### Key Libraries
- **React**: UI framework
- **TailwindCSS**: Styling
- **shadcn/ui**: Component library
- **Message Handler**: Communication bridge

### 5. Shared Utilities
**Directory**: [`src/utils/`](src/utils/)

- Common utility functions
- Helper modules
- Shared constants

**Directory**: [`src/shared/`](src/shared/)

- Shared types and interfaces
- Common data structures
- Extension-webview shared code

## Data Flow

### Message Flow

```
User Input (WebView)
    ↓
ChatViewProvider receives message
    ↓
ChatMessageService preprocesses
    ↓
SessionService stores user message
    ↓
RequestBudgeter estimates cost
    ↓
QuotaService checks budget
    ↓
MessageStreamService initiates stream
    ↓
Stream events → WebView (real-time updates)
    ↓
SessionService stores assistant message
    ↓
Message canonicalization
```

### Plan Flow

```
User requests plan execution
    ↓
ChatPlanService creates plan
    ↓
PlanParser parses structure
    ↓
PlanViewProvider displays plan
    ↓
User executes steps (manual/auto)
    ↓
ChatPlanService tracks progress
    ↓
Plan completion detection
```

### Streaming Flow

```
API Stream (SSE)
    ↓
MessageStreamService receives events
    ↓
Parse structured output
    ↓
Filter reasoning content
    ↓
Send to WebView via postMessage
    ↓
WebView updates UI in real-time
    ↓
StreamingState manages progress
```

## Key Design Patterns

### 1. Provider Pattern
VSCode providers encapsulate UI components and extension API interactions.

### 2. Service Layer Pattern
Business logic is separated into services that can be reused across providers.

### 3. Event-Driven Architecture
Communication between extension and webview uses postMessage events.

### 4. Repository Pattern
SessionService acts as a repository for message persistence.

### 5. State Management
WebView uses a centralized state pattern with useAppState() hook.

## Testing Strategy

Tests are organized by category in the [`tests/`](tests/) directory:

- **Unit tests**: Individual functions and utilities
- **Integration tests**: Multiple system interactions
- **Regression tests**: Bug fix verification
- **E2E tests**: Complete user workflows
- **Component tests**: UI components
- **Service tests**: Business logic
- **Provider tests**: VSCode integration

See [`tests/README.md`](tests/README.md) for detailed test organization.

## Configuration

### Extension Settings
- Model selection and configuration
- Quota limits
- Server endpoints
- UI preferences

### Environment
- VSCode extension API
- Node.js runtime
- Webview context (isolated)

## Extension Points

### Adding New Features

1. **New Provider**: Extend VSCode UI or commands
   - Create provider class
   - Register in extension.ts
   - Add tests in tests/providers/

2. **New Service**: Add business logic
   - Create service class
   - Inject into providers
   - Add tests in tests/services/

3. **New Webview Component**: Extend UI
   - Create React component
   - Wire into ChatShell
   - Add tests in tests/webview/

4. **New Command**: Add VSCode command
   - Register in extension.ts
   - Implement handler
   - Add integration tests

## Performance Considerations

- **Streaming**: Real-time updates reduce perceived latency
- **Caching**: Session caching improves load times
- **Lazy Loading**: Webview components load on demand
- **Quota Management**: Prevents API overuse
- **Message Compaction**: Reduces storage overhead

## Security

- **Token Storage**: Secure credential management
- **Message Sanitization**: Prevents XSS in webview
- **API Key Protection**: Encrypted storage
- **Session Isolation**: Subagent sessions are isolated

## Dependencies

### External APIs
- **Anthropic Claude API**: Primary AI model
- **Gemini API**: Alternative model provider
- **OpenCode Server**: Optional backend server

### Internal
- **VSCode Extension API**: Extension host integration
- **React**: Frontend framework
- **Node.js**: Runtime environment

## Future Architecture Considerations

### Modularization
The codebase is currently undergoing modularization to improve maintainability:
- Breaking down large components (ChatViewProvider)
- Separating concerns (services, providers, UI)
- Improving testability

### Scalability
- Support for more model providers
- Enhanced multi-agent capabilities
- Improved state management
- Better error handling and recovery

---

**Last Updated**: 2026-03-26

**Note**: This architecture is actively evolving. Check git history for recent changes.
