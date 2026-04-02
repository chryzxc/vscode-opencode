# Agents Panel Refresh Functionality

## Overview
Added refresh functionality to the Agents section in the extended panel, allowing users to manually refresh the list of available agents.

## Implementation

### Component Update: `AgentsPanel` 
**File**: `webview/shared/src/chat/PanelComponents.tsx`

#### Changes:
1. **New State Variables**:
   - `isRefreshing`: Tracks whether a refresh operation is in progress
   
2. **New Dependencies**:
   - `dispatch`: Used to dispatch Redux actions via `useAppDispatch()`
   
3. **New Handler Method**: `handleRefresh()`
   - Sets `isRefreshing` to true for visual feedback
   - Clears the agents list: `dispatch({ type: "SET_AGENTS_LIST", payload: [] })`
   - Sends refresh message to extension: `vscode.postMessage({ type: "getAgents" })`
   - Auto-resets loading state after 3 seconds timeout (fallback)

4. **Updated UI Header**:
   - Added refresh button next to collapse button in panel header
   - Button is disabled while refresh is in progress
   - Refresh icon animates with `animate-spin` class during loading
   - Uses hover styling consistent with other panel buttons

### User Interaction Flow

1. User clicks the refresh icon (↻) in the Agents panel header
2. Icon enters spinning animation state
3. Locally cached agents list is cleared
4. Extension receives "getAgents" message and fetches fresh agent list
5. Extension broadcasts updated agent list back to webview
6. Agents list updates and icon stops spinning

### Message Protocol

**Webview → Extension**:
```
{ type: "getAgents" }
```

**Extension → Webview**:
```
{
  type: "agentsList",
  agents: [
    { id: string, name: string, description?: string, mode?: string, builtIn: boolean, color?: string }
  ]
}
```

### State Management

- Reuses existing Redux action: `SET_AGENTS_LIST`
- No new app state required
- Loading state is local to component component (`isRefreshing`)
- Timeout ensures UI recovers if extension response is delayed

### Styling & Accessibility

- Uses existing design tokens and button variants
- Supports hover states and transition animations
- ARIA labels for screen readers: `"Refresh agents"`
- Icon button follows project's icon button conventions (h-5 w-5)
- Disabled state prevents accidental double-clicks during refresh

## Testing

The component continues to pass existing tests:
- ✅ AgentsPanel renders color dot with agent specific color
- ✅ AgentsPanel implements modeBadgeClass mapping correctly
- ✅ AgentsPanel renders footer with custom and built-in counts

## Future Enhancements

- Add toast notification on successful refresh
- Track refresh timing to show "Last updated: X seconds ago"
- Add keyboard shortcut (e.g., Cmd/Ctrl+R) for refresh
- Add error state if agents fetch fails
