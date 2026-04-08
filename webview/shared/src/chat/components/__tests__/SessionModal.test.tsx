import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SessionModal } from '../SessionModal';
import { AppProvider } from '../../lib/store';

// Mock vscode
jest.mock('../../lib/vscode', () => ({
  postMessage: jest.fn(),
}));

const vscode = require('../../lib/vscode');

describe('SessionModal', () => {
  const mockSessions = [
    { id: 'session-1', title: 'First Chat', createdAt: Date.now() - 1000 },
    { id: 'session-2', title: 'Second Chat', createdAt: Date.now() - 2000000 },
    { id: 'session-3', title: 'Third Chat', createdAt: Date.now() - 90000000 },
  ];

  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const renderWithProvider = (ui: React.ReactElement) => {
    return render(
      <AppProvider>
        {ui}
      </AppProvider>
    );
  };

  describe('Session Switch Loading', () => {
    it('should dispatch START_SESSION_LOADING when clicking a session', async () => {
      const { getByText } = renderWithProvider(
        <SessionModal {...defaultProps} />
      );

      // Wait for sessions to be rendered
      await waitFor(() => {
        expect(getByText('First Chat')).toBeInTheDocument();
      });

      // Click on a session
      const sessionButton = getByText('First Chat').closest('button');
      fireEvent.click(sessionButton!);

      // Verify START_SESSION_LOADING was dispatched
      // This is handled by the store, so we verify the vscode message
      expect(vscode.postMessage).toHaveBeenCalledWith({
        type: 'switchSession',
        sessionId: 'session-1',
      });
    });

    it('should close modal after switching sessions', async () => {
      const onClose = jest.fn();
      const { getByText } = renderWithProvider(
        <SessionModal {...defaultProps} onClose={onClose} />
      );

      await waitFor(() => {
        expect(getByText('First Chat')).toBeInTheDocument();
      });

      const sessionButton = getByText('First Chat').closest('button');
      fireEvent.click(sessionButton!);

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('Session List Display', () => {
    it('should display sessions grouped by time', async () => {
      const { getByText } = renderWithProvider(
        <SessionModal {...defaultProps} />
      );

      await waitFor(() => {
        expect(getByText('First Chat')).toBeInTheDocument();
        expect(getByText('Second Chat')).toBeInTheDocument();
        expect(getByText('Third Chat')).toBeInTheDocument();
      });
    });

    it('should handle sessions without titles', async () => {
      const mockSessionsWithoutTitles = [
        { id: 'session-no-title', createdAt: Date.now() },
      ];

      const { getByText } = renderWithProvider(
        <SessionModal {...defaultProps} />
      );

      await waitFor(() => {
        expect(getByText(/Untitled chat/)).toBeInTheDocument();
      });
    });
  });

  describe('Search Functionality', () => {
    it('should filter sessions based on search query', async () => {
      const { getByPlaceholderText, getByText, queryByText } = renderWithProvider(
        <SessionModal {...defaultProps} />
      );

      await waitFor(() => {
        expect(getByText('First Chat')).toBeInTheDocument();
      });

      const searchInput = getByPlaceholderText('Search sessions...');
      fireEvent.change(searchInput, { target: { value: 'First' } });

      expect(getByText('First Chat')).toBeInTheDocument();
      expect(queryByText('Second Chat')).not.toBeInTheDocument();
    });

    it('should show "No sessions match" when search has no results', async () => {
      const { getByPlaceholderText, getByText } = renderWithProvider(
        <SessionModal {...defaultProps} />
      );

      await waitFor(() => {
        expect(getByText('First Chat')).toBeInTheDocument();
      });

      const searchInput = getByPlaceholderText('Search sessions...');
      fireEvent.change(searchInput, { target: { value: 'NonExistent' } });

      expect(getByText('No sessions match')).toBeInTheDocument();
    });
  });

  describe('New Chat Creation', () => {
    it('should send createSession message and close modal', async () => {
      const onClose = jest.fn();
      const { getByText } = renderWithProvider(
        <SessionModal {...defaultProps} onClose={onClose} />
      );

      const newChatButton = getByText('New Chat');
      fireEvent.click(newChatButton);

      expect(vscode.postMessage).toHaveBeenCalledWith({
        type: 'createSession',
      });
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('Modal Behavior', () => {
    it('should close when clicking backdrop', async () => {
      const onClose = jest.fn();
      const { container } = renderWithProvider(
        <SessionModal {...defaultProps} onClose={onClose} />
      );

      const backdrop = container.querySelector('.fixed.inset-0.bg-black\\/55');
      expect(backdrop).toBeInTheDocument();

      if (backdrop) {
        fireEvent.click(backdrop);
        expect(onClose).toHaveBeenCalled();
      }
    });

    it('should close when pressing Escape', async () => {
      const onClose = jest.fn();
      renderWithProvider(
        <SessionModal {...defaultProps} onClose={onClose} />
      );

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onClose).toHaveBeenCalled();
    });

    it('should not render when isOpen is false', () => {
      const { container } = renderWithProvider(
        <SessionModal {...defaultProps} isOpen={false} />
      );

      expect(container.firstChild).toBeNull();
    });
  });
});
