import { vi } from 'vitest';

// Mock vscode module
const getConfigurationMock = vi.fn((section: string) => {
  const defaultConfig: Record<string, any> = {
    opencode: {
      persistSessions: true,
      serverPort: 0,
      logging: {
        level: 'info',
      },
    },
  };

  const config = section
    ? (defaultConfig[section] || {})
    : defaultConfig;

  return {
    get: vi.fn((key: string, defaultValue?: any) => {
      if (key && config[key] !== undefined) {
        return config[key];
      }
      return defaultValue;
    }),
    update: vi.fn(),
    has: vi.fn(() => false),
    inspect: vi.fn(() => undefined),
  };
});

vi.mock('vscode', () => {
  return {
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
        getConfiguration: getConfigurationMock,
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
        file: vi.fn((path: string) => ({
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
  };
});

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
vi.mock('path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('path')>();
  const mockPath = {
    join: vi.fn((...args: string[]) => args.join('/')),
    isAbsolute: vi.fn((p: string) => p.startsWith('/')),
    basename: vi.fn((p: string) => p.split('/').pop()),
    dirname: vi.fn((p: string) => p.split('/').slice(0, -1).join('/')),
  };
  return {
    ...actual,
    ...mockPath,
    default: mockPath,
  };
});

// Mock os module
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: vi.fn(() => '/mock/home'),
    tmpdir: vi.fn(() => '/mock/tmp'),
  };
});
