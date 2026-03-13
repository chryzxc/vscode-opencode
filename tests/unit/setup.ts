import { vi } from 'vitest';

// Mock vscode module
vi.mock('vscode', () => ({
  default: {
    window: {
      createStatusBarItem: vi.fn(() => ({
        text: '',
        tooltip: '',
        command: '',
        show: vi.fn(),
        dispose: vi.fn(),
      })),
      showErrorMessage: vi.fn(),
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      createWebviewPanel: vi.fn(() => ({
        webview: {
          html: '',
          postMessage: vi.fn(),
          onDidReceiveMessage: vi.fn(),
          asWebviewUri: vi.fn((uri) => uri.toString()),
          cspSource: '',
        },
        onDidChangeViewState: vi.fn(),
        onDidDispose: vi.fn(),
        reveal: vi.fn(),
        dispose: vi.fn(),
        title: '',
      })),
      createOutputChannel: vi.fn(() => ({
        appendLine: vi.fn(),
        dispose: vi.fn(),
      })),
      activeTextEditor: {
        viewColumn: 1,
      },
      registerWebviewViewProvider: vi.fn(),
    },
    workspace: {
      workspaceFolders: [
        {
          uri: {
            fsPath: '/mock/workspace',
            scheme: 'file',
          },
        },
      ],
      getConfiguration: vi.fn(() => ({
        get: vi.fn(),
        update: vi.fn(),
      })),
      onDidChangeConfiguration: vi.fn(),
    },
    StatusBarAlignment: {
      Right: 1,
      Left: 2,
    },
    ViewColumn: {
      One: 1,
      Two: 2,
      Three: 3,
    },
    commands: {
      executeCommand: vi.fn(),
      registerCommand: vi.fn(),
    },
    Uri: {
      file: vi.fn((path) => ({
        fsPath: path,
        toString: () => path,
        scheme: 'file',
      })),
    },
    ExtensionContext: vi.fn(),
    EventEmitter: vi.fn(() => ({
      event: vi.fn(),
      fire: vi.fn(),
      dispose: vi.fn(),
    })),
    Disposable: {
      from: vi.fn(() => ({ dispose: vi.fn() })),
    },
    WebviewViewProvider: {},
    ConfigurationTarget: {
      Global: 1,
      Workspace: 2,
    },
  },
}));

// Mock child_process
vi.mock('child_process', () => ({
  execFile: vi.fn((cmd, args, options, callback) => {
    // Simulate successful execution by default
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    callback(null, '', '');
  }),
}));

// Mock path module
vi.mock('path', () => ({
  default: {
    join: vi.fn((...args) => args.join('/')),
    isAbsolute: vi.fn((p: string) => p.startsWith('/')),
    basename: vi.fn((p: string) => p.split('/').pop()),
    dirname: vi.fn((p: string) => p.split('/').slice(0, -1).join('/')),
  },
}));

// Mock os module
vi.mock('os', () => ({
  default: {
    homedir: vi.fn(() => '/mock/home'),
    tmpdir: vi.fn(() => '/mock/tmp'),
  },
}));
