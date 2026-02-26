// Types for webview chat app (used for clarity during development)
export type SelectedModel = {
  providerID: string;
  modelID: string;
  // Optional human-friendly provider name (display only)
  providerName?: string;
};

export interface AppState {
  selectedModel?: SelectedModel | null;
  selectedAgent?: string | null;
}

export type ModelRecord = {
  providerID: string;
  modelID: string;
  name: string;
  providerName: string;
};

export default AppState;
