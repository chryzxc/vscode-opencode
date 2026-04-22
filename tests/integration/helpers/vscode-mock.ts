/**
 * VS Code API Mock for Integration Tests
 *
 * Provides a minimal, functional mock of the VS Code API surface
 * used by the chat modules. This is injected via module.registerHooks()
 * to redirect `import * as vscode from "vscode"` at import resolution time.
 *
 * Design:
 * - Mementos are in-memory Maps
 * - EventEmitter follows the VS Code contract (event, fire, dispose)
 * - Uri supports file/parse statics
 * - workspace.fs delegates to Node fs/promises
 * - window/commands are no-op stubs (not used in behavioral tests)
 */

import * as nodeFs from "fs/promises";
import * as nodePath from "path";

// ---------------------------------------------------------------------------
// Disposable
// ---------------------------------------------------------------------------
export class Disposable {
  constructor(private readonly callOnDispose: () => void) {}
  dispose(): void {
    this.callOnDispose();
  }
}

// ---------------------------------------------------------------------------
// EventEmitter<T>
// ---------------------------------------------------------------------------
export class EventEmitter<T> {
  private listeners = new Set<(e: T) => void>();

  get event(): (listener: (e: T) => void, ...args: unknown[]) => Disposable {
    const self = this;
    return function (listener: (e: T) => void): Disposable {
      self.listeners.add(listener);
      return new Disposable(() => self.listeners.delete(listener));
    };
  }

  fire(data: T): void {
    for (const fn of this.listeners) {
      fn(data);
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}

// ---------------------------------------------------------------------------
// Memento (in-memory)
// ---------------------------------------------------------------------------
export class InMemoryMemento implements Memento {
  private store = new Map<string, unknown>();

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get(key: string, defaultValue?: unknown): unknown {
    if (this.store.has(key)) return this.store.get(key);
    return defaultValue;
  }

  get keys(): string[] {
    return [...this.store.keys()];
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.store.delete(key);
    } else {
      this.store.set(key, value);
    }
  }
}

export interface Memento {
  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  readonly keys: string[];
  update(key: string, value: unknown): Thenable<void>;
}

// ---------------------------------------------------------------------------
// Uri
// ---------------------------------------------------------------------------
export class Uri {
  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
  readonly query: string;
  readonly fragment: string;
  readonly fsPath: string;

  private constructor(scheme: string, authority: string, path: string, query = "", fragment = "") {
    this.scheme = scheme;
    this.authority = authority;
    this.path = path;
    this.query = query;
    this.fragment = fragment;
    this.fsPath = scheme === "file" ? decodeURIComponent(path) : path;
  }

  static file(path: string): Uri {
    return new Uri("file", "", path);
  }

  static parse(value: string): Uri {
    try {
      const url = new URL(value);
      return new Uri(url.protocol.replace(":", ""), url.host, url.pathname, url.search.replace("?", ""), url.hash.replace("#", ""));
    } catch {
      // Fallback: treat as file path
      return Uri.file(value);
    }
  }

  toString(): string {
    return `${this.scheme}://${this.authority}${this.path}`;
  }

  with(change: { scheme?: string; authority?: string; path?: string; query?: string; fragment?: string }): Uri {
    return new Uri(
      change.scheme ?? this.scheme,
      change.authority ?? this.authority,
      change.path ?? this.path,
      change.query ?? this.query,
      change.fragment ?? this.fragment,
    );
  }
}

// ---------------------------------------------------------------------------
// RelativePattern
// ---------------------------------------------------------------------------
export class RelativePattern {
  constructor(
    public readonly base: string | { uri: Uri },
    public readonly pattern: string,
  ) {}
}

// ---------------------------------------------------------------------------
// QuickPickItem
// ---------------------------------------------------------------------------
export interface QuickPickItem {
  label: string;
  description?: string;
  detail?: string;
  picked?: boolean;
}

// ---------------------------------------------------------------------------
// StatusBarAlignment
// ---------------------------------------------------------------------------
export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

// ---------------------------------------------------------------------------
// workspace.fs — delegates to Node fs/promises
// ---------------------------------------------------------------------------
function uriToPath(uri: Uri | { fsPath: string }): string {
  return "fsPath" in uri ? uri.fsPath : (uri as Uri).fsPath;
}

const fileSystem = {
  stat(uri: Uri | { fsPath: string }) {
    return nodeFs.stat(uriToPath(uri));
  },
  readFile(uri: Uri | { fsPath: string }) {
    return nodeFs.readFile(uriToPath(uri)).then((b) => new Uint8Array(b));
  },
  writeFile(uri: Uri | { fsPath: string }, content: Uint8Array | string) {
    const data = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
    return nodeFs.writeFile(uriToPath(uri), data);
  },
  createDirectory(uri: Uri | { fsPath: string }) {
    return nodeFs.mkdir(uriToPath(uri), { recursive: true });
  },
  delete(uri: Uri | { fsPath: string }, _options?: { recursive?: boolean; useTrash?: boolean }) {
    return nodeFs.rm(uriToPath(uri), { recursive: true, force: true });
  },
};

// ---------------------------------------------------------------------------
// workspace
// ---------------------------------------------------------------------------
const configurationStore = new Map<string, unknown>();

export const workspace = {
  workspaceFolders: [] as Array<{ uri: Uri; name: string; index: number }>,
  fs: fileSystem,
  getConfiguration(section?: string) {
    const prefix = section ? `${section}.` : "";
    return {
      get<T>(key: string, defaultValue?: T): T {
        return (configurationStore.get(`${prefix}${key}`) as T) ?? defaultValue as T;
      },
      update(key: string, value: unknown): Thenable<void> {
        configurationStore.set(`${prefix}${key}`, value);
        return Promise.resolve();
      },
      has(key: string): boolean {
        return configurationStore.has(`${prefix}${key}`);
      },
    };
  },
  findFiles(_pattern: RelativePattern | string): Thenable<Uri[]> {
    // Simplified stub — returns empty for tests unless overridden
    return Promise.resolve([]);
  },
  _setWorkspaceFolders(folders: Array<{ uri: Uri; name: string; index: number }>) {
    workspace.workspaceFolders = folders;
  },
  _resetConfiguration() {
    configurationStore.clear();
  },
};

// ---------------------------------------------------------------------------
// window
// ---------------------------------------------------------------------------
export const window = {
  showInformationMessage: (..._args: unknown[]) => Promise.resolve(undefined),
  showWarningMessage: (..._args: unknown[]) => Promise.resolve(undefined),
  showErrorMessage: (..._args: unknown[]) => Promise.resolve(undefined),
  showInputBox: (..._args: unknown[]) => Promise.resolve(undefined),
  showQuickPick: (..._args: unknown[]) => Promise.resolve(undefined),
  createOutputChannel: (_name?: string) => ({
    appendLine: () => {},
    append: () => {},
    clear: () => {},
    show: () => {},
    hide: () => {},
    dispose: () => {},
  }),
  createStatusBarItem: (_alignment?: StatusBarAlignment, _priority?: number) => ({
    text: "",
    tooltip: "",
    command: "",
    show: () => {},
    hide: () => {},
    dispose: () => {},
  }),
  registerTreeDataProvider: () => new Disposable(() => {}),
};

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------
export const commands = {
  executeCommand: (..._args: unknown[]) => Promise.resolve(undefined),
  registerCommand: (_command: string, _handler: (...args: unknown[]) => unknown) =>
    new Disposable(() => {}),
};

// ---------------------------------------------------------------------------
// ExtensionContext mock factory
// ---------------------------------------------------------------------------
export function createMockExtensionContext() {
  return {
    globalState: new InMemoryMemento(),
    workspaceState: new InMemoryMemento(),
    subscriptions: [] as Disposable[],
    extensionPath: "/tmp/test-extension",
    globalStorageUri: Uri.file("/tmp/test-global-storage"),
    workspaceStorageUri: Uri.file("/tmp/test-workspace-storage"),
    asAbsolutePath(relativePath: string) {
      return nodePath.resolve("/tmp/test-extension", relativePath);
    },
  };
}
