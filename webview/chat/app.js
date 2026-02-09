// @ts-check
(function () {
  /* @ts-expect-error - VS Code API provided by environment */
  const vscode = acquireVsCodeApi();

  // Override console to forward logs to VS Code Debug Console
  const originalConsole = {
      log: console.log,
      warn: console.warn,
      error: console.error
  };

  /** @param {string} level @param {any[]} args */
  function postLog(level, args) {
      const message = args.map(arg => {
          if (typeof arg === 'object') {
              try {
                  return JSON.stringify(arg);
              } catch (e) {
                  return String(arg);
              }
          }
          return String(arg);
      }).join(' ');
      
      vscode.postMessage({ type: "log", level, message });
  }

  console.log = (...args) => {
      originalConsole.log(...args);
      postLog("info", args);
  };

  console.warn = (...args) => {
      originalConsole.warn(...args);
      postLog("warn", args);
  };

  console.error = (...args) => {
      originalConsole.error(...args);
      postLog("error", args);
  };

  // State
  /** @type {string[]} */
  let selectedFiles = [];
  /** @type {any[]} */
  let selectedContexts = [];
  let isSearchingFiles = false;
  let selectedSuggestionIndex = -1;
  /** @type {any[]} */
  let suggestionResults = [];
  /** @type {any[]} */
  let availableModels = [];
  /** @type {any} */
  let selectedModel = null;
  let modelSearchQuery = "";
  /** @type {any[]} */
  let availableAgents = [];
  /** @type {string | null} */
  let selectedAgent = "general";
  let agentSearchQuery = "";
  /** @type {string | null} */
  let currentSessionId = null;
  /** @type {Set<string>} */
  const sessionEdits = new Set();
  let isProcessing = false;
  let receivedInitState = false;
  /** @type {any[]} */
  let promptQueue = [];
  let isExecutingQueue = false;

  // FORBIDDEN TO REMOVE: Do not remove token accumulation or header update logic.
  let sessionStats = {
      input: 0,
      output: 0,
      read: 0,
      write: 0,
      duration: 0
  };

  /** @type {HTMLElement | null} */
  let currentStreamingCard = null;
  /** @type {HTMLElement | null} */
  let currentStreamingStep = null;
  /** @type {string[]} */
  let currentStreamingEdits = [];
  /** @type {any[]} */
  let currentStreamingSteps = [];
  /** @type {string | null} */
  let currentMessageId = null;
  /** @type {HTMLElement | null} */
  let lastStreamingCard = null;

  // DOM Elements
  const messagesContainer = document.getElementById("messages");
  const chatHeader = document.getElementById("chat-header");
  const sessionTokensSpan = document.getElementById("session-tokens");
  const tokensInSpan = document.getElementById("tokens-in");
  const tokensOutSpan = document.getElementById("tokens-out");
  const tokensReadSpan = document.getElementById("tokens-read");
  const tokensWriteSpan = document.getElementById("tokens-write");
  const sessionTimeSpan = document.getElementById("session-time");
  const headerSessionId = document.getElementById("header-session-id");
  const filesChangedCount = document.getElementById("files-changed-count");
  const reviewChangesBtn = document.getElementById("review-changes-btn");
  /** @type {HTMLTextAreaElement | null} */
  const messageInput = /** @type {HTMLTextAreaElement | null} */ (
    document.getElementById("message-input")
  );
  const sendButton = document.getElementById("send-button");
  const contextButton = document.getElementById("add-context-btn");
  const modelSelector = document.getElementById("model-selector");
  const agentSelector = document.getElementById("agent-selector");
  // const reviewChangesButton = document.getElementById("review-changes-btn"); // Future use
  const filesPreviewContainer = document.getElementById("files-preview");
  const queueContainer = document.getElementById("queue-container");
  const queueList = document.getElementById("queue-list");
  const queueCount = document.getElementById("queue-count");
  const executeQueueBtn = document.getElementById("execute-queue-btn");
  const clearQueueBtn = document.getElementById("clear-queue-btn");
  const toggleQueueBtn = document.getElementById("toggle-queue-btn");
  const addToQueueBtn = document.getElementById("add-to-queue-btn");

  // History Sidebar Elements - Injected dynamically or assumed present
  const historyToggle = document.getElementById("history-toggle");
  const historySidebar = document.getElementById("history-sidebar");
  const closeHistoryBtn = document.getElementById("close-history-btn");
  const sessionListContainer = document.getElementById("session-list");
  const newChatSidebarBtn = document.getElementById("new-chat-sidebar-btn");

  // let currentSessions = []; // Removed since unused

  // Create suggestions container (dynamic)
  const suggestionsContainer = document.createElement("div");
  suggestionsContainer.className = "suggestions-container";
  const inputContainer = document.querySelector(".input-container");
  // Insert suggestions before the input container but after files preview
  inputContainer?.parentElement?.insertBefore(
    suggestionsContainer,
    inputContainer,
  );

  // Configure marked if available
  // @ts-expect-error - marked defined in vendor.js
  if (window.marked && window.hljs) {
    // @ts-expect-error - marked defined in vendor.js
    window.marked.setOptions({
      highlight: function (
        /** @type {string} */ code,
        /** @type {string} */ lang,
      ) {
        // @ts-expect-error - hljs defined in vendor.js
        if (lang && window.hljs.getLanguage(lang)) {
          // @ts-expect-error - hljs defined in vendor.js
          return window.hljs.highlight(code, { language: lang }).value;
        }
        // @ts-expect-error - hljs defined in vendor.js
        return window.hljs.highlightAuto(code).value;
      },
      breaks: true,
      gfm: true,
    });
  }

  // Initialize
  function init() {
    // Event Listeners
    sendButton?.addEventListener("click", () => {
      if (isProcessing) {
        stopRequest();
      } else {
        sendMessage();
      }
    });
    messageInput?.addEventListener("keydown", handleKeyDown);
    messageInput?.addEventListener("input", handleInput);

    // Bind History Events
    if (historyToggle) {
      historyToggle.addEventListener("click", () => {
        console.log("[OpenCode] Toggling history sidebar");
        if (historySidebar) historySidebar.classList.add("visible");
        vscode.postMessage({ type: "getSessions" });
      });
    } else {
      console.error("[OpenCode] history-toggle element not found");
    }

    if (closeHistoryBtn) {
      closeHistoryBtn.addEventListener("click", () => {
        if (historySidebar) historySidebar.classList.remove("visible");
      });
    }

    if (newChatSidebarBtn) {
      newChatSidebarBtn.addEventListener("click", () => {
        console.log("[OpenCode] Creating new session from sidebar");
        vscode.postMessage({ type: "newSession" });
        if (historySidebar) historySidebar.classList.remove("visible");
      });
    }

    // Close sidebar when clicking outside
    document.addEventListener("click", (e) => {
      if (
        historySidebar &&
        historySidebar.classList.contains("visible") &&
        !historySidebar.contains(/** @type {Node} */ (e.target)) &&
        historyToggle &&
        !historyToggle.contains(/** @type {Node} */ (e.target))
      ) {
        historySidebar.classList.remove("visible");
      }
    });

    contextButton?.addEventListener("click", () => {
      vscode.postMessage({ type: "attachFiles" });
    });


    modelSelector?.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleModelDropdown();
    });

    agentSelector?.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleAgentDropdown();
    });

    // Close dropdowns on click outside
    document.addEventListener("click", (e) => {
      const modelDropdown = document.getElementById("model-dropdown");
      const agentDropdown = document.getElementById("agent-dropdown");

      if (
        modelDropdown &&
        !modelDropdown.classList.contains("hidden") &&
        !modelDropdown.contains(/** @type {Node} */ (e.target)) &&
        !modelSelector?.contains(/** @type {Node} */ (e.target))
      ) {
        modelDropdown.classList.add("hidden");
      }

      if (
        agentDropdown &&
        !agentDropdown.classList.contains("hidden") &&
        !agentDropdown.contains(/** @type {Node} */ (e.target)) &&
        !agentSelector?.contains(/** @type {Node} */ (e.target))
      ) {
        agentDropdown.classList.add("hidden");
      }
    });

    // Queue Events
    addToQueueBtn?.addEventListener("click", () => {
      addToQueue();
    });

    executeQueueBtn?.addEventListener("click", () => {
      vscode.postMessage({ type: "executeQueue" });
    });

    clearQueueBtn?.addEventListener("click", () => {
      if (confirm("Clear all items from the queue?")) {
        vscode.postMessage({ type: "clearQueue" });
      }
    });

    toggleQueueBtn?.addEventListener("click", () => {
      queueContainer?.classList.add("hidden");
    });

    // Request initial state with retry
    console.log("[OpenCode] [app.js] Sending ready message...");
    vscode.postMessage({ type: "ready" });

    // Retry every 1s until we get a response (mode or status)
    const readyInterval = setInterval(() => {
      if (!receivedInitState) {
        console.log("[OpenCode] [app.js] Retrying ready message...");
        vscode.postMessage({ type: "ready" });
      } else {
        clearInterval(readyInterval);
      }
    }, 1000);
  }

  // Handle messages from extension
  window.addEventListener("message", (/** @type {MessageEvent} */ event) => {
    const message = event.data;

    switch (message.type) {
      case "initState":
      case "init":
        receivedInitState = true;
        if (message.sessionId) {
          currentSessionId = message.sessionId;
          if (headerSessionId) {
            headerSessionId.textContent = currentSessionId;
          }
        }
        if (message.selectedModel) {
          selectedModel = message.selectedModel;
          updateSelectedModelUI();
        }
        if (message.selectedAgent) {
          selectedAgent = message.selectedAgent;
          updateSelectedAgentUI();
        }
        if (message.serverStatus) {
          updateStatusUI(message.serverStatus);
        }
        break;

      case "modelsList":
        availableModels = message.models;
        if (message.selectedModel) {
          selectedModel = message.selectedModel;
        }
        renderModelsList();
        updateSelectedModelUI();
        break;

      case "agentsList":
        availableAgents = message.agents;
        if (message.selectedAgent) {
          selectedAgent = message.selectedAgent;
        }
        renderAgentsList();
        updateSelectedAgentUI();
        break;

      case "statusUpdate":
        updateStatusUI(message.status);
        break;

      case "messageResponse":
        // FORBIDDEN TO REMOVE: Do not remove token accumulation or header update logic.
        if (message.message.info?.tokens) {
          sessionStats.input += message.message.info.tokens.input || 0;
          sessionStats.output += message.message.info.tokens.output || 0;
          if (message.message.info.tokens.cache) {
            sessionStats.read += message.message.info.tokens.cache.read || 0;
            sessionStats.write += message.message.info.tokens.cache.write || 0;
          }
        }
        if (message.message.info?.duration) {
          sessionStats.duration += message.message.info.duration;
        }
        updateHeaderStats();

        if (message.message.edits) {
          message.message.edits.forEach((/** @type {any} */ e) =>
            sessionEdits.add(e.file),
          );
          updateFooterEdits();
        } else if (currentStreamingEdits.length > 0) {
          // merge them in for rendering.
          message.message.edits = currentStreamingEdits.map(
            (/** @type {string} */ f) => ({ file: f }),
          );
        }

        // Merge streaming steps if not present in message
        if (
          currentStreamingSteps.length > 0 &&
          (!message.message.steps || message.message.steps.length === 0)
        ) {
          message.message.steps = currentStreamingSteps;
        }

        // Remove the streaming card before adding the final one to avoid duplicates
        if (lastStreamingCard && lastStreamingCard.parentNode) {
          lastStreamingCard.remove();
          lastStreamingCard = null;
        }

        addAssistantMessage(message.message);
        currentStreamingEdits = [];
        currentStreamingSteps = [];
        break;

      case "chatHistory":
        console.log(
          "[OpenCode] [app.js] Received chat history:",
          message.messages.length,
          "messages",
        );
        sessionEdits.clear();
        message.messages.forEach((/** @type {any} */ m) => {
          if (m.edits)
            m.edits.forEach((/** @type {any} */ e) => sessionEdits.add(e.file));
        });
        updateFooterEdits();
        renderChatHistory(message.messages);
        if (message.messages.length === 0) {
          clearStickyHeader();
        }
        break;

      case "streamEvent":
        handleStreamEvent(message.event);
        break;

      case "error":
        showError(message.message);
        removeThinkingBubble();
        if (currentStreamingCard) {
          currentStreamingCard.remove();
          currentStreamingCard = null;
        }
        break;

      case "appendPrompt":
        if (messageInput) {
          messageInput.value += (messageInput.value ? "\n" : "") + message.text;
          messageInput.focus();
        }
        break;

      case "addContext":
        if (message.context) {
          selectedContexts.push(message.context);
          updateFileChipsUI();
        }
        break;

      case "fileSearchResults":
        showFileSuggestions(message.results);
        break;

      case "sessionsList":
        currentSessionId = message.currentSessionId;
        if (currentSessionId && headerSessionId) {
          headerSessionId.textContent = currentSessionId;
        }
        renderSessionsList(message.sessions, message.currentSessionId);
        break;

      case "queueUpdate":
        promptQueue = message.queue;
        renderQueue();
        break;

      case "queueExecutionStarted":
        isExecutingQueue = true;
        updateQueueUIState();
        break;

      case "queueExecutionFinished":
        isExecutingQueue = false;
        updateQueueUIState();
        break;
    }
  });

  // --- Logic Functions ---

  function renderSessionsList(/** @type {any[]} */ sessions, /** @type {string} */ activeId) {
    if (!sessionListContainer) return;

    sessionListContainer.innerHTML = "";
    // currentSessions = sessions; // Removed since unused
    currentSessionId = activeId;

    if (!sessions || sessions.length === 0) {
      const empty = document.createElement("div");
      empty.style.padding = "16px";
      empty.style.color = "var(--text-secondary)";
      empty.style.fontSize = "13px";
      empty.style.textAlign = "center";
      empty.textContent = "No history";
      sessionListContainer.appendChild(empty);
      return;
    }

    sessions.forEach((/** @type {any} */ session) => {
      const item = document.createElement("div");
      item.className = "session-item";
      if (session.id === activeId) item.classList.add("active");

      const title = document.createElement("div");
      title.className = "session-title";
      title.textContent = session.title || "Untitled Session";
      item.appendChild(title);

      const actions = document.createElement("div");
      actions.className = "session-actions";

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "delete-session-btn";
      deleteBtn.innerHTML = "×";
      deleteBtn.title = "Delete Session";
      deleteBtn.onclick = (e) => {
        e.stopPropagation();
        if (confirm("Delete this session?")) {
          vscode.postMessage({ type: "deleteSession", sessionId: session.id });
        }
      };
      actions.appendChild(deleteBtn);

      item.appendChild(actions);

      item.onclick = () => {
        if (session.id !== activeId) {
          vscode.postMessage({ type: "loadSession", sessionId: session.id });
          // Optimistic update
          document
            .querySelectorAll(".session-item")
            .forEach((el) => el.classList.remove("active"));
          item.classList.add("active");
        }
      };

      sessionListContainer.appendChild(item);
    });
  }

  function sendMessage() {
    const text = messageInput?.value.trim();
    if (!text && selectedFiles.length === 0) return;

    // Add user message to UI
    addUserMessage(text || "", selectedFiles, selectedContexts);

    // Send to extension
    vscode.postMessage({
      type: "sendMessage",
      text,
      files: selectedFiles,
      contexts: selectedContexts,
      agent: selectedAgent,
    });

    // Clear and Reset
    if (messageInput) {
      messageInput.value = "";
      messageInput.style.height = "auto"; // Reset height
    }
    selectedFiles = [];
    selectedContexts = [];
    updateFileChipsUI();
    hideSuggestions();

    // Show Thinking Bubble
    addThinkingBubble();
    
    // Set processing state
    setProcessing(true);
  }

  function setProcessing(/** @type {boolean} */ processing) {
    isProcessing = processing;
    const sendButton = document.getElementById("send-button");
    if (!sendButton) return;

    if (processing) {
      sendButton.classList.add("stop-btn");
      sendButton.title = "Stop Generation";
      // Change to Stop Icon (Square)
      sendButton.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor"/>
        </svg>
      `;
    } else {
      sendButton.classList.remove("stop-btn");
      sendButton.title = "Send (Shift+Enter)";
      // Back to Send Icon (Right Arrow)
      sendButton.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8.25 3L14 8.75M14 8.75L8.25 14.5M14 8.75H2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;
    }
  }

  function stopRequest() {
    if (!isProcessing) return;
    
    vscode.postMessage({
      type: "stopRequest",
      sessionId: currentSessionId
    });

    // Optimistically reset UI
    setProcessing(false);
    removeThinkingBubble();
    
    if (currentStreamingCard) {
      const markdownBody = currentStreamingCard.querySelector(".markdown-body");
      if (markdownBody instanceof HTMLElement) {
        markdownBody.innerHTML += "\n\n*(Generation stopped by user)*";
      }
      currentStreamingCard = null;
    }
    
    currentMessageId = null;
    currentStreamingStep = null;
  }
  /** @param {KeyboardEvent} event */
  function handleKeyDown(event) {
    if (isSearchingFiles && suggestionsContainer.style.display === "block") {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        updateSelectedSuggestion(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        updateSelectedSuggestion(-1);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        selectSuggestion(selectedSuggestionIndex);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        hideSuggestions();
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  function handleInput() {
    // Auto-resize
    if (messageInput) {
      messageInput.style.height = "auto";
      messageInput.style.height = messageInput.scrollHeight + "px";

      const value = messageInput.value;
      const cursorPosition = messageInput.selectionStart;

      // Check for @ mention
      const lastAt = value.lastIndexOf("@", cursorPosition - 1);
      if (lastAt !== -1 && (lastAt === 0 || /\s/.test(value[lastAt - 1]))) {
        const query = value.substring(lastAt + 1, cursorPosition);
        if (!query.includes(" ")) {
          isSearchingFiles = true;
          vscode.postMessage({ type: "searchFiles", query });
          return;
        }
      }
    }
    hideSuggestions();
  }

  function toggleModelDropdown() {
    const dropdown = document.getElementById("model-dropdown");
    if (!dropdown) return;

    dropdown.classList.toggle("hidden");
    if (!dropdown.classList.contains("hidden")) {
      const searchInput = /** @type {HTMLInputElement | null} */ (
        document.getElementById("model-search-input")
      );
      if (searchInput) {
        searchInput.value = "";
        modelSearchQuery = "";
        searchInput.focus();
      }

      // Show loading state if no models are loaded yet
      if (availableModels.length === 0) {
        const listContainer = document.getElementById("model-list-container");
        if (listContainer) {
          listContainer.innerHTML =
            '<div class="model-item loading">Loading models...</div>';
        }
        vscode.postMessage({ type: "getModels" });
      } else {
        renderModelsList();
      }
    }
  }

  function renderModelsList() {
    const dropdown = document.getElementById("model-dropdown");
    const listContainer = document.getElementById("model-list-container");
    const searchInput = document.getElementById("model-search-input");

    if (!dropdown || !listContainer) return;

    // Initialize search listener once
    if (searchInput && !searchInput.dataset.initialized) {
      searchInput.addEventListener("input", (e) => {
        // @ts-expect-error - Event target value access
        modelSearchQuery = e.target.value.toLowerCase();
        renderModelsList();
      });
      searchInput.dataset.initialized = "true";
    }

    listContainer.innerHTML = "";

    // Filter models
    const filteredModels = availableModels.filter(
      (/** @type {any} */ model) => {
        const nameMatch = model.name.toLowerCase().includes(modelSearchQuery);
        const providerMatch = (model.providerName || model.providerID)
          .toLowerCase()
          .includes(modelSearchQuery);
        const idMatch = model.modelID.toLowerCase().includes(modelSearchQuery);
        return nameMatch || providerMatch || idMatch;
      },
    );

    if (filteredModels.length === 0) {
      listContainer.innerHTML =
        '<div class="model-item loading">No models found</div>';
      return;
    }

    // Group models by provider
    /** @type {Object.<string, any[]>} */
    const groups = {};
    filteredModels.forEach((/** @type {any} */ model) => {
      const provider = model.providerName || model.providerID;
      if (!groups[provider]) groups[provider] = [];
      groups[provider].push(model);
    });

    // Render groups
    Object.keys(groups)
      .sort()
      .forEach((providerName) => {
        const header = document.createElement("div");
        header.className = "provider-header";
        header.textContent = providerName;
        listContainer.appendChild(header);

        groups[providerName].forEach((/** @type {any} */ model) => {
          const isSelected =
            selectedModel &&
            selectedModel.providerID === model.providerID &&
            selectedModel.modelID === model.modelID;

          const item = document.createElement("div");
          item.className = `model-item ${isSelected ? "selected" : ""}`;
          item.innerHTML = `
              <span class="model-name">${model.name}</span>
              <span class="model-provider">${model.modelID}</span>
          `;
          item.onclick = (e) => {
            e.stopPropagation();
            selectModel(model);
          };
          listContainer.appendChild(item);
        });
      });
  }

  function selectModel(/** @type {any} */ model) {
    selectedModel = { providerID: model.providerID, modelID: model.modelID };
    updateSelectedModelUI();
    renderModelsList();

    // Explicitly hide dropdown
    const dropdown = document.getElementById("model-dropdown");
    if (dropdown) {
      dropdown.classList.add("hidden");
    }

    vscode.postMessage({
      type: "selectModel",
      model: selectedModel,
    });
  }

  function updateSelectedModelUI() {
    const currentModelNameSpan = document.getElementById("current-model-name");
    if (currentModelNameSpan && selectedModel) {
      // Find friendly name
      const modelInfo = availableModels.find(
        (m) =>
          m.providerID === selectedModel.providerID &&
          m.modelID === selectedModel.modelID,
      );
      
      if (modelInfo) {
        currentModelNameSpan.textContent = `${modelInfo.name} (${modelInfo.providerName || modelInfo.providerID})`;
      } else if (availableModels.length > 0) {
        currentModelNameSpan.textContent = selectedModel.modelID;
      }
      // If availableModels is empty (still loading), keep the existing text (placeholder)
    }
  }

  function toggleAgentDropdown() {
    const dropdown = document.getElementById("agent-dropdown");
    if (!dropdown) return;

    dropdown.classList.toggle("hidden");
    if (!dropdown.classList.contains("hidden")) {
      const searchInput = /** @type {HTMLInputElement | null} */ (
        document.getElementById("agent-search-input")
      );
      if (searchInput) {
        searchInput.value = "";
        agentSearchQuery = "";
        searchInput.focus();
      }

      // Show loading state if no agents are loaded yet
      if (availableAgents.length === 0) {
        const listContainer = document.getElementById("agent-list-container");
        if (listContainer) {
          listContainer.innerHTML =
            '<div class="model-item loading">Loading agents...</div>';
        }
        vscode.postMessage({ type: "getAgents" });
      } else {
        renderAgentsList();
      }
    }
  }

  function renderAgentsList() {
    const dropdown = document.getElementById("agent-dropdown");
    const listContainer = document.getElementById("agent-list-container");
    const searchInput = document.getElementById("agent-search-input");

    if (!dropdown || !listContainer) return;

    // Initialize search listener once
    if (searchInput && !searchInput.dataset.initialized) {
      searchInput.addEventListener("input", (e) => {
        // @ts-expect-error - Event target value access
        agentSearchQuery = e.target.value.toLowerCase();
        renderAgentsList();
      });
      searchInput.dataset.initialized = "true";
    }

    listContainer.innerHTML = "";

    // Filter agents
    const filteredAgents = availableAgents.filter(
      (/** @type {any} */ agent) => {
        const nameMatch = agent.name.toLowerCase().includes(agentSearchQuery);
        const descMatch = agent.description.toLowerCase().includes(agentSearchQuery);
        const idMatch = agent.id.toLowerCase().includes(agentSearchQuery);
        return nameMatch || descMatch || idMatch;
      },
    );

    if (filteredAgents.length === 0) {
      listContainer.innerHTML =
        '<div class="model-item loading">No agents found</div>';
      return;
    }

    // Render agents
    filteredAgents.forEach((/** @type {any} */ agent) => {
      const isSelected = selectedAgent === agent.id;

      const item = document.createElement("div");
      item.className = `model-item ${isSelected ? "selected" : ""}`;
      item.innerHTML = `
          <span class="model-name">${agent.name}</span>
          <span class="model-provider">${agent.description}</span>
      `;
      item.onclick = (e) => {
        e.stopPropagation();
        selectAgent(agent.id);
      };
      listContainer.appendChild(item);
    });
  }

  function selectAgent(/** @type {string} */ agentId) {
    selectedAgent = agentId;
    updateSelectedAgentUI();
    renderAgentsList();

    // Explicitly hide dropdown
    const dropdown = document.getElementById("agent-dropdown");
    if (dropdown) {
      dropdown.classList.add("hidden");
    }

    vscode.postMessage({
      type: "selectAgent",
      agent: selectedAgent,
    });
  }

  function updateSelectedAgentUI() {
    const currentAgentNameSpan = document.getElementById("current-agent-name");
    if (currentAgentNameSpan && selectedAgent) {
      // Find friendly name
      const agentInfo = availableAgents.find((a) => a.id === selectedAgent);
      
      if (agentInfo) {
        currentAgentNameSpan.textContent = agentInfo.name;
      } else {
        // If not found (e.g. still loading or default), capitalize the ID
        currentAgentNameSpan.textContent = selectedAgent.charAt(0).toUpperCase() + selectedAgent.slice(1);
      }
    }
  }



  function updateStatusUI(/** @type {string} */ status) {
    const overlay = document.getElementById("loading-overlay");
    const loadingText = document.getElementById("loading-text");
    if (!overlay) return;

    switch (status) {
      case "starting":
        overlay.classList.add("visible");
        if (loadingText) loadingText.textContent = "Initializing OpenCode...";
        break;
      case "running":
        overlay.classList.remove("visible");
        break;
      case "error":
        overlay.classList.add("visible");
        if (loadingText) loadingText.textContent = "❌ Failed to connect";
        break;
      case "idle":
        overlay.classList.add("visible"); // Maybe just show loading still?
        if (loadingText) loadingText.textContent = "OpenCode is idle";
        break;
    }
  }

  function updateFileChipsUI() {
    if (!filesPreviewContainer) return;

    filesPreviewContainer.innerHTML = "";

    // Render Context Badges (removable code snippets)
    selectedContexts.forEach((ctx, index) => {
      const chip = document.createElement("div");
      chip.className = "file-chip context-chip";
      chip.innerHTML = `
        <span class="chip-icon">📄</span>
        <span>${ctx.file}:${ctx.lineInfo}</span>
        <span class="file-chip-remove" title="Remove">&times;</span>
      `;
      chip.querySelector(".file-chip-remove")?.addEventListener("click", () => {
        selectedContexts.splice(index, 1);
        updateFileChipsUI();
      });
      filesPreviewContainer.appendChild(chip);
    });

    // Render File Chips
    selectedFiles.forEach((path, index) => {
      const chip = document.createElement("div");
      chip.className = "file-chip";
      const name = path.split(/[\\/]/).pop() || path;
      chip.innerHTML = `
        <span>${name}</span>
        <span class="file-chip-remove" title="Remove">&times;</span>
      `;
      chip.querySelector(".file-chip-remove")?.addEventListener("click", () => {
        selectedFiles.splice(index, 1);
        updateFileChipsUI();
      });
      filesPreviewContainer.appendChild(chip);
    });
  }

  // --- Suggestions Logic ---

  function showFileSuggestions(/** @type {any[]} */ results) {
    if (!isSearchingFiles || results.length === 0) {
      hideSuggestions();
      return;
    }

    /** @type {any[]} */
    suggestionResults = results;
    suggestionsContainer.innerHTML = "";
    suggestionsContainer.style.display = "block";
    selectedSuggestionIndex = 0;

    results.forEach(
      (/** @type {any} */ result, /** @type {number} */ index) => {
        const item = document.createElement("div");
        item.className = "suggestion-item" + (index === 0 ? " selected" : "");
        item.innerHTML = `
        <span class="suggestion-name">${result.name}</span>
        <span class="suggestion-path">${result.path}</span>
      `;
        item.onclick = () => selectSuggestion(index);
        suggestionsContainer.appendChild(item);
      },
    );
  }

  function hideSuggestions() {
    isSearchingFiles = false;
    suggestionsContainer.style.display = "none";
    selectedSuggestionIndex = -1;
  }

  function updateSelectedSuggestion(/** @type {number} */ delta) {
    const items = suggestionsContainer.querySelectorAll(".suggestion-item");
    if (items.length === 0) return;

    items[selectedSuggestionIndex]?.classList.remove("selected");
    selectedSuggestionIndex =
      (selectedSuggestionIndex + delta + items.length) % items.length;
    items[selectedSuggestionIndex]?.classList.add("selected");
    items[selectedSuggestionIndex]?.scrollIntoView({ block: "nearest" });
  }

  function selectSuggestion(/** @type {number} */ index) {
    const result = suggestionResults[index];
    if (!result) return;

    if (!selectedFiles.includes(result.path)) {
      selectedFiles.push(result.path);
      updateFileChipsUI();
    }

    if (messageInput) {
      const value = messageInput.value;
      const cursorPosition = messageInput.selectionStart;
      const lastAt = value.lastIndexOf("@", cursorPosition - 1);
      const beforeAt = value.substring(0, lastAt);
      const afterCursor = value.substring(cursorPosition);

      messageInput.value = beforeAt + afterCursor;
      messageInput.focus();
    }

    hideSuggestions();
  }

  // --- Message Rendering ---

  function renderChatHistory(/** @type {any[]} */ messages) {
    if (!messagesContainer) return;
    console.log("[OpenCode] [app.js] Raw messages from extension:", messages);

    // Clear existing messages (except empty state if we want to reuse it, but replacing is safer)
    messagesContainer.innerHTML = "";

    if (!messages || messages.length === 0) {
      messagesContainer.innerHTML = `
        <div id="empty-state" class="empty-state">
            <div class="empty-brand">OpenCode</div>
            <p>Ready to help you build.</p>
        </div>`;
      return;
    }

    messages.forEach((message) => {
      // Normalize role (handle casing and synonyms)
      const role = (message.role || "").toLowerCase();
      const isUser = role === "user" || role === "human";
      const isAssistant = role === "assistant" || role === "model" || role === "ai" || role === "bot";

      if (isUser) {
        let text = "";
        /** @type {string[]} */
        let files = [];
        /** @type {any[]} */
        let contexts = [];
        
        if (message.parts && Array.isArray(message.parts)) {
          message.parts.forEach((/** @type {any} */ p) => {
            if (p.type === "text") {
              text += (p.text || p.content || "") + "\n";
            } else if (p.type === "file") {
              files.push(p.url || p.filename || p.source?.path || "File");
            }
          });
          text = text.trim();
        } else if (message.text) {
          text = message.text;
        } else if (typeof message.content === "string") {
          text = message.content;
        }

        // Extract contexts from previous logic (if any) or look for text segments
        // In our case, contexts are sent as text parts with a specific format
        // For now, if we have just files/text, it's fine. 
        // Real history might not have 'contexts' as separate types yet.

        if (text || files.length > 0) {
          addUserMessage(text, files, contexts);
        } else {
          console.warn("[OpenCode] [app.js] Skipped rendering user message with no content:", message);
        }
      } else if (isAssistant) {
        addAssistantMessage(message);
      } else {
        console.warn("[OpenCode] [app.js] Skipped rendering message with unknown role:", message);
      }
    });
    
    // Calculate total stats from scratch when rendering history
    sessionStats = { input: 0, output: 0, read: 0, write: 0, duration: 0 };
    messages.forEach(msg => {
        if (msg.info?.tokens) {
            sessionStats.input += (msg.info.tokens.input || 0);
            sessionStats.output += (msg.info.tokens.output || 0);
            if (msg.info.tokens.cache) {
                sessionStats.read += (msg.info.tokens.cache.read || 0);
                sessionStats.write += (msg.info.tokens.cache.write || 0);
            }
        }
        if (msg.info?.duration) {
            sessionStats.duration += msg.info.duration;
        }
    });

    updateHeaderStats();

    console.log(`[OpenCode] [app.js] Rendered ${messagesContainer.querySelectorAll('.message').length} messages from history. Total context tokens: ${sessionStats.input + sessionStats.output}`);
    scrollToBottom();
  }

  function addUserMessage(/** @type {string} */ text, /** @type {string[]} */ files = [], /** @type {any[]} */ contexts = []) {
    // Remove empty state if present
    document.getElementById("empty-state")?.remove();

    const messageDiv = document.createElement("div");
    messageDiv.className = "message user";
    
    // Add Attachments if any
    if ((files && files.length > 0) || (contexts && contexts.length > 0)) {
        const attachmentsDiv = document.createElement("div");
        attachmentsDiv.className = "message-attachments";
        
        // Contexts
        contexts.forEach(ctx => {
            const chip = document.createElement("div");
            chip.className = "attachment-chip context-chip";
            chip.innerHTML = `<span class="chip-icon">📄</span> ${ctx.file}:${ctx.lineInfo}`;
            attachmentsDiv.appendChild(chip);
        });
        
        // Files
        files.forEach(path => {
            const chip = document.createElement("div");
            chip.className = "attachment-chip";
            const name = path.split(/[\\/]/).pop() || path;
            attachmentsDiv.appendChild(chip);
            chip.innerHTML = name;
        });
        
        messageDiv.appendChild(attachmentsDiv);
    }

    if (text) {
        const contentDiv = document.createElement("div");
        contentDiv.className = "message-content";
        contentDiv.textContent = text;
        messageDiv.appendChild(contentDiv);
    }

    messagesContainer?.appendChild(messageDiv);
    scrollToBottom();
  }

  function addAssistantMessage(/** @type {any} */ message) {
    // Remove empty state if present
    document.getElementById("empty-state")?.remove();

    // Remove thinking bubble
    removeThinkingBubble();

    // Use Task Card for assistant messages
    const usage = message.info?.tokens ? {
        total: (message.info.tokens.input || 0) + (message.info.tokens.output || 0),
        duration: message.info.duration || message.timing?.duration
    } : null;

    const card = renderTaskCard(getFormattedAgentLabel(message.info), message.info?.id, usage);
    
    // Add Thoughts if present (from steps or parts)
    let reasoningText = "";
    if (message.steps) {
         reasoningText = message.steps
            .filter((/** @type {any} */ s) => s.type === "reasoning")
            .map((/** @type {any} */ s) => s.content || s.title)
            .join("\n\n");
    }
    
    if (!reasoningText && message.parts) {
        reasoningText = message.parts
            .filter((/** @type {any} */ p) => p.type === "reasoning" || p.reasoning || p.thought || p.thinking)
            .map((/** @type {any} */ p) => p.text || p.content || p.reasoning || p.thought || p.thinking || "")
            .join("\n\n");
    }

    if (reasoningText) {
         const thoughtsContainer = card.querySelector(".thought-section");
         const thoughtsContent = card.querySelector(".thought-content");
         if (thoughtsContainer && thoughtsContent) {
             thoughtsContainer.classList.remove("hidden");
             thoughtsContent.textContent = reasoningText;
         }
    }

    const markdownBody = card.querySelector(".markdown-body");
    const summarySection = card.querySelector(".task-summary");
    const list = card.querySelector(".progress-steps-list");

    // Content Parts with Fallbacks
    let fullText = "";
    if (message.parts && Array.isArray(message.parts)) {
      message.parts.forEach((/** @type {any} */ part) => {
        const text = part.text || part.content || part.reasoning || part.thought || part.thinking || "";
        
        if (!(part.type === "reasoning" || part.reasoning || part.thought || part.thinking)) {
            fullText += text + "\n";
        }
      });
    } else {
      fullText = message.content || message.text || "";
    }

    if (fullText && markdownBody instanceof HTMLElement) {
        renderMarkdown(markdownBody, fullText);
    } else if (summarySection instanceof HTMLElement) {
        summarySection.classList.add("hidden");
    }

    // Render plan card if available
    if (message.plan) {
        addPlanButtonToHeader(card, message.plan);
        renderPlanCard(message.plan, card);
    }

    // Edits History Section (Top Summary)
    if (message.edits && Array.isArray(message.edits) && message.edits.length > 0) {
        const editsSummary = document.createElement("div");
        editsSummary.className = "task-edits-summary";
        
        message.edits.forEach((/** @type {any} */ edit) => {
            const pill = document.createElement("div");
            pill.className = "file-pill";
            pill.innerHTML = `
                <span>${edit.file.split(/[\\/]/).pop()}</span>
                <span class="stats">
                    ${edit.added ? `<span class="added">+${edit.added}</span>` : ""}
                    ${edit.deleted ? `<span class="deleted">-${edit.deleted}</span>` : ""}
                </span>
            `;
            editsSummary.appendChild(pill);
            
            // Also add as a step for detailed diff access
            const step = addProgressStep(card, `Edited ${edit.file}`);
            if (step) {
                const btn = document.createElement("button");
                btn.className = "step-action";
                btn.textContent = "Open diff";
                btn.onclick = () => vscode.postMessage({ type: "openDiff", file: edit.file });
                step.appendChild(btn);
            }
        });
        
        // Insert edits summary before progress section
        const progressSection = card.querySelector(".progress-section");
        card.insertBefore(editsSummary, progressSection);
    }

    // Render Progress Steps
    if (message.steps && Array.isArray(message.steps)) {
        message.steps.forEach((/** @type {any} */ stepData) => {
            if (stepData.type === "reasoning") return;
            const step = addProgressStep(card, stepData.title);
            if (step) {
                if (stepData.status) updateProgressStep(step, stepData.meta || "", stepData.status);
                if (stepData.type === "thought") step.classList.add("thought");
            }
        });
    }

    // Hide Sections if empty
    if (!reasoningText) card.querySelector(".thought-section")?.classList.add("hidden");
    
    const hasProgress = message.steps && message.steps.some((/** @type {any} */ s) => s.type !== "reasoning");
    if (!hasProgress) card.querySelector(".progress-section")?.classList.add("hidden");

    // Collapse progress by default in history if it's long
    const progressSectionElement = card.querySelector(".progress-section");
    if (list && list.children.length > 5) {
        progressSectionElement?.classList.add("collapsed");
    }

    scrollToBottom();
  }

  function handleStreamEvent(/** @type {any} */ event) {
    if (event.type !== "message.part.updated") {
         console.log("[OpenCode] [StreamEvent]", event.type, event);
    } else {
         // Reduce noise for part updates, maybe log only important parts?
         // User asked to log events, so let's log them but maybe compactly
         console.log("[OpenCode] [StreamEvent]", event.type, JSON.stringify(event.properties || {}));
    }

    // 1. Handle Message Lifecycle (Start/End)
    if (event.type === "message.updated") {
        const info = event.properties?.info;
        if (info && info.role === "assistant") {
            // Start of a new message
                    // COALESCING FIX: Always try to reuse the LAST streaming card if it exists and is not finished.
                    // This prevents multiple cards for the same turn.
                    if (lastStreamingCard && document.body.contains(lastStreamingCard)) {
                            currentStreamingCard = lastStreamingCard;
                            // Update ID if needed, but keep the card
                            if (currentMessageId !== info.id) {
                                currentMessageId = info.id;
                                currentStreamingCard.dataset.messageId = info.id;
                            }
                    } else {
                        // Only create new if we absolutely don't have one
                        const existing = document.querySelector(`.task-card[data-message-id="${info.id}"]`);
                        if (existing) {
                            currentMessageId = info.id;
                            currentStreamingCard = /** @type {HTMLElement} */ (existing);
                            lastStreamingCard = currentStreamingCard;
                        } else {
                            currentMessageId = info.id;
                            currentStreamingCard = renderTaskCard(getFormattedAgentLabel(info), info.id);
                            lastStreamingCard = currentStreamingCard;
                            currentStreamingSteps = [];
                            currentStreamingEdits = [];
                        }
                    }
            
            // End of a message
            if (info.finish) {
                if (currentStreamingCard) {
                    const pendingSteps = Array.from(currentStreamingCard.querySelectorAll(".step-item")).filter(step => {
                        // @ts-expect-error - Check custom state object
                        return step._stateObj && step._stateObj.status === "pending";
                    });

                    pendingSteps.forEach(step => {
                        step.remove();
                    });

                    const progressSection = currentStreamingCard.querySelector(".progress-section");
                    if (progressSection) {
                        const remainingSteps = progressSection.querySelectorAll(".step-item");
                        if (remainingSteps.length === 0) {
                            progressSection.remove();
                        }
                    }
                }

                if (currentStreamingCard && info.tokens) {
                    const usage = {
                        total: (info.tokens.input || 0) + (info.tokens.output || 0),
                        duration: info.duration
                    };
                    updateCardUsage(currentStreamingCard, usage);
                }

                currentMessageId = null;
                currentStreamingCard = null;
                currentStreamingStep = null;
                setProcessing(false);
            }
        }
        return;
    }

    // 2. Handle Message Parts (Content, Steps, Tools)
    if (event.type === "message.part.updated") {
        const part = event.properties?.part;
        const delta = event.properties?.delta;
        
        if (!part) return;

        // Auto-start card if needed (and fallback to last credentials)
        if (!currentStreamingCard || !document.body.contains(currentStreamingCard)) {
             // Try one last time to find by ID
             if (currentMessageId) {
                 const existing = document.querySelector(`.task-card[data-message-id="${currentMessageId}"]`);
                 if (existing) {
                     currentStreamingCard = /** @type {HTMLElement} */ (existing);
                     lastStreamingCard = currentStreamingCard;
                 }
             }
             
             if (!currentStreamingCard) {
                 // Create new if generic part comes in without message.updated
                 currentMessageId = part.messageID || `msg_${Date.now()}`;
                 currentStreamingCard = renderTaskCard(getFormattedAgentLabel(), currentMessageId);
                 lastStreamingCard = currentStreamingCard;
                 currentStreamingSteps = [];
                 currentStreamingEdits = [];
             }
        }

        removeThinkingBubble();

        switch (part.type) {
            case "text":
                if (delta && currentStreamingCard) {
                    updateStreamingTask(currentStreamingCard, delta, "text");
                }
                break;

            case "reasoning":
                if (delta) {
                    if (currentStreamingCard) {
                        updateStreamingTask(currentStreamingCard, delta, "reasoning");
                    }
                }
                break;

            case "step-start": {
                if (!currentStreamingCard) break;
                // Fix: Improved title logic.
                let title = part.title;
                
                // If no title, try to infer from snapshot or type
                if (!title) {
                    if (part.snapshot && !part.snapshot.startsWith("http") && part.snapshot.length < 50 && !/^[a-f0-9]{10,}$/i.test(part.snapshot)) {
                        title = part.snapshot;
                    } else {
                        // Generic fallback that sounds better than "Processing..."
                        title = "Thinking..."; 
                    }
                }
                
                const stepObj = { title, type: "step", status: "pending", id: part.id, startTime: Date.now() };
                currentStreamingSteps.push(stepObj);
                currentStreamingSteps.push(stepObj);
                const step = addProgressStep(currentStreamingCard, title);
                if (step) {
                    // @ts-expect-error - Attach state
                    step._stateObj = stepObj;
                    currentStreamingStep = step;
                }
                break;
            }

            case "step-finish": {
                if (!currentStreamingCard) break;
                const step = /** @type {HTMLElement | null} */ (Array.from(currentStreamingCard.querySelectorAll(".step-item")).find(el => {
                    // @ts-expect-error - Match step by ID
                    return el._stateObj && el._stateObj.id === part.id;
                })) || currentStreamingStep;
                
                if (step) {
                    const usage = part.usage || null;
                    const timing = part.timing || null;
                    const details = { ...timing, tokens: usage }; // Pass usage as tokens to match updateProgressStep
                    updateProgressStep(step, "Done", "done", details);
                    // @ts-expect-error - Update status
                    if (step._stateObj) step._stateObj.status = "done";
                }
                currentStreamingStep = null;
                break;
            }

            case "tool": {
                if (!currentStreamingCard) break;
                const tool = part.tool || "Tool";
                const state = part.state || {};
                const input = state.input || {};
                const file = input.file || input.path || input.filename || input.TargetFile; // Check uppercase too
                // Find existing tool step or create new
        let toolStep = /** @type {HTMLElement | null} */ (Array.from(currentStreamingCard.querySelectorAll(".step-item")).find(el => {
            // @ts-expect-error - Match tool step by callID in custom state
            return el._stateObj && el._stateObj.callID === part.callID;
        }));

                if (!toolStep) {
                    let title = `Running ${tool}...`;
                    
                    if (tool.includes("write") || tool.includes("replace") || tool.includes("edit")) {
                        title = `Editing ${file || 'file'}...`;
                    } else if (tool.includes("command")) {
                        title = `Running command: ${input.CommandLine || '...'}`;
                    }

                    const stepObj = {
                      title,
                      type: "tool",
                      status: "pending",
                      callID: part.callID,
                      filePath: file,
                    };
                    currentStreamingSteps.push(stepObj);
            toolStep = addProgressStep(currentStreamingCard, title, {
              filePath: file,
            });
            if (toolStep) {
                // @ts-expect-error - Attach custom state object to tool step
                toolStep._stateObj = stepObj;
            }
        }


                if (toolStep) {
                    if (state.status === "completed") {
                        const result = state.title || "Completed";
                        // Extract tool stats if available in state
                        const details = { 
                            duration: state.duration, 
                            tokens: state.tokens 
                        };
                        updateProgressStep(toolStep, result, "done", details);
                // @ts-expect-error - Update status on custom tool state object
                if (toolStep._stateObj) {
                    // @ts-expect-error - Set status to done
                    toolStep._stateObj.status = "done";
                    // @ts-expect-error - Set meta text from result
                    toolStep._stateObj.meta = result;
                }
                    } else if (state.status === "error") {
                        updateProgressStep(toolStep, state.error || "Failed", "error");
                  // @ts-expect-error - Update error status on custom state object
                if (toolStep._stateObj) {
                    // @ts-expect-error - Set status to error
                    toolStep._stateObj.status = "error";
                    // @ts-expect-error - Set error message as meta
                    toolStep._stateObj.meta = state.error;
                }
                    }
                }
                break;
            }

            case "patch":
                if (part.files && Array.isArray(part.files)) {
                    part.files.forEach((/** @type {string} */ f) => {
                        if (!currentStreamingEdits.includes(f)) {
                            currentStreamingEdits.push(f);
                            sessionEdits.add(f);
                            updateFooterEdits();
                        }
                    });
                }
                break;
        }
        return;
    }

    // 3. Handle Permission Requests
    if (event.type === "permission.updated") {
        const perm = event.properties;
        if (perm) {
            renderPermissionCard(perm);
        }
        return;
    }

    // 4. Handle Session Errors
    if (event.type === "session.error") {
        const error = event.properties?.error;
        if (error) {
            const errorMsg = error.data?.message || "An unknown error occurred.";
            renderErrorBanner(errorMsg);
        }
        setProcessing(false);
        removeThinkingBubble();
        return;
    }

    // 5. Handle Session Status
    if (event.type === "session.status") {
        // e.g., Update a status indicator if we had one
        const status = event.properties?.status;
        console.log("[OpenCode] [SessionStatus]", status);
        return;
    }
  }

  function renderPermissionCard(/** @type {any} */ perm) {
      const card = document.createElement("div");
      card.className = "task-card permission-card";
      card.innerHTML = `
        <div class="task-header">
            <span class="task-title">Permission Request</span>
        </div>
        <div class="task-summary">
            <div class="markdown-body">
                <p>${perm.title || "The assistant is requesting permission."}</p>
                ${perm.metadata ? `<pre>${JSON.stringify(perm.metadata, null, 2)}</pre>` : ""}
            </div>
        </div>
      `;
      messagesContainer?.appendChild(card);
      scrollToBottom();
  }

  function renderErrorBanner(/** @type {string} */ message) {
      const banner = document.createElement("div");
      banner.className = "error-banner";
      banner.textContent = `Error: ${message}`;
      banner.style.padding = "10px";
      banner.style.margin = "10px 0";
      banner.style.backgroundColor = "var(--input-danger-bg, #5a1e1e)";
      banner.style.color = "var(--input-danger-text, #ffcccc)";
      banner.style.borderRadius = "4px";
      banner.style.border = "1px solid var(--input-danger-border, #ff0000)";
      
      messagesContainer?.appendChild(banner);
      scrollToBottom();
  }

  function updateFooterEdits() {
      if (!filesChangedCount) return;
      const count = sessionEdits.size;
      filesChangedCount.textContent = `${count} File${count === 1 ? '' : 's'} With Changes`;
      if (reviewChangesBtn) {
          reviewChangesBtn.style.display = count > 0 ? "inline-block" : "none";
      }
  }

  // --- Queue Functions ---

  function addToQueue() {
    const text = messageInput?.value.trim();
    if (!text && selectedFiles.length === 0) return;

    vscode.postMessage({
      type: "addToQueue",
      text,
      files: selectedFiles,
      contexts: selectedContexts
    });

    // Clear input after adding
    if (messageInput) {
      messageInput.value = "";
      messageInput.style.height = "auto";
    }
    selectedFiles = [];
    selectedContexts = [];
    updateFileChipsUI();
    
    // Show queue container if hidden
    queueContainer?.classList.remove("hidden");
  }

  function renderQueue() {
    if (!queueList || !queueCount || !queueContainer) return;

    queueCount.textContent = String(promptQueue.length);
    queueList.innerHTML = "";

    if (promptQueue.length === 0) {
        queueContainer.classList.add("hidden");
        return;
    }

    queueContainer.classList.remove("hidden");

    promptQueue.forEach((item, index) => {
        const queueItem = document.createElement("div");
        queueItem.className = "queue-item new";
        
        const info = document.createElement("div");
        info.className = "queue-item-info";
        
        const textArea = document.createElement("div");
        textArea.className = "queue-item-text";
        textArea.textContent = item.text || "(No text)";
        info.appendChild(textArea);
        
        const meta = document.createElement("div");
        meta.className = "queue-item-meta";
        const filesCount = (item.files?.length || 0) + (item.contexts?.length || 0);
        meta.textContent = filesCount > 0 ? `${filesCount} attachments` : "No attachments";
        info.appendChild(meta);

        // Add Pending Status
        const status = document.createElement("div");
        status.className = "queue-item-status";
        status.textContent = "Pending";
        info.appendChild(status);
        
        queueItem.appendChild(info);
        
        const actions = document.createElement("div");
        actions.className = "queue-item-actions";
        
        const removeBtn = document.createElement("button");
        removeBtn.className = "queue-item-remove";
        removeBtn.innerHTML = "×";
        removeBtn.onclick = () => {
            vscode.postMessage({ type: "removeFromQueue", index });
        };
        actions.appendChild(removeBtn);
        
        queueItem.appendChild(actions);
        queueList.appendChild(queueItem);
    });
  }

  function updateQueueUIState() {
    if (!executeQueueBtn || !addToQueueBtn || !clearQueueBtn) return;
    
    if (isExecutingQueue) {
        executeQueueBtn.innerHTML = `
            <div class="spinner" style="width: 12px; height: 12px; border-width: 1.5px; border-top-color: white;"></div>
            Running...
        `;
        executeQueueBtn.classList.add("disabled");
        // @ts-expect-error - disabled property
        executeQueueBtn.disabled = true;
        clearQueueBtn.classList.add("disabled");
        // @ts-expect-error - disabled property
        clearQueueBtn.disabled = true;
    } else {
        executeQueueBtn.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M3 2V14L13 8L3 2Z"/>
            </svg>
            Run
        `;
        executeQueueBtn.classList.remove("disabled");
        // @ts-expect-error - disabled property
        executeQueueBtn.disabled = false;
        clearQueueBtn.classList.remove("disabled");
        // @ts-expect-error - disabled property
        clearQueueBtn.disabled = false;
    }
  }

  function updateHeaderStats() {
      if (!chatHeader) return;
      
      const total = sessionStats.input + sessionStats.output;
      if (total > 0) {
          chatHeader.classList.remove("hidden");
      }

      if (sessionTokensSpan) sessionTokensSpan.textContent = total.toLocaleString();
      if (tokensInSpan) tokensInSpan.textContent = `${sessionStats.input}i`;
      if (tokensOutSpan) tokensOutSpan.textContent = `${sessionStats.output}o`;
      if (tokensReadSpan) tokensReadSpan.textContent = `${sessionStats.read}r`;
      if (tokensWriteSpan) tokensWriteSpan.textContent = `${sessionStats.write}w`;
      if (sessionTimeSpan) sessionTimeSpan.textContent = `${(sessionStats.duration / 1000).toFixed(1)}s`;
  }

  function updateStreamingTask(/** @type {HTMLElement} */ card, /** @type {string} */ text, /** @type {string} */ type = "text") {
      if (type === "reasoning") {
          const thoughtsContainer = card?.querySelector(".thought-section");
          const thoughtsContent = card?.querySelector(".thought-content");
          if (thoughtsContainer && thoughtsContent instanceof HTMLElement) {
              thoughtsContainer.classList.remove("hidden");
              // Append text to the content
              const prevText = thoughtsContent.dataset.rawText || "";
              const nextText = prevText + text;
              thoughtsContent.dataset.rawText = nextText;
              thoughtsContent.textContent = nextText;
              
              // Ensure it's expanded during streaming
              // thoughtsContainer.classList.remove("collapsed");
          }
      } else {
          const summaryDiv = /** @type {HTMLElement | null} */ (card?.querySelector(".task-summary .markdown-body"));
          if (summaryDiv) {
              const prevText = card.dataset.rawText || "";
              const nextText = prevText + text;
              card.dataset.rawText = nextText;
              renderMarkdown(summaryDiv, nextText);
              scrollToBottom();
          }
      }

  }
  
  /**
   * Formats the assistant label with agent, model, and provider names.
   * @param {any} [info] Optional message info object.
   * @returns {string} Formatted label.
   */
  function getFormattedAgentLabel(info) {
    const agentId = info?.agent || selectedAgent || "assistant";
    const agentInfo = availableAgents.find(a => a.id === agentId);
    let agentName = agentInfo ? agentInfo.name : (agentId.charAt(0).toUpperCase() + agentId.slice(1));
    
    // Use agent name as is
    // No mapping needed as per user request to show actual agent name


    // Try to get model and provider from info or current state
    const mId = info?.model?.modelID || info?.modelID || selectedModel?.modelID;
    const pId = info?.model?.providerID || info?.providerID || selectedModel?.providerID;
    
    if (mId && pId) {
        const modelInfo = availableModels.find(m => m.modelID === mId && m.providerID === pId);
        const modelName = modelInfo ? modelInfo.name : mId;
        let providerName = modelInfo ? (modelInfo.providerName || modelInfo.providerID) : pId;
        
        // Clean up provider name if it's "opencode" but we have a better name
        if (providerName === "opencode" && modelInfo?.providerName) {
            providerName = modelInfo.providerName;
        }

        return `${agentName} (${modelName} (${providerName}))`;
    } else if (mId) {
        return `${agentName} (${mId})`;
    }
    
    return agentName;
  }

  /**
   * Updates the usage stats displayed in a task card header.
   * @param {HTMLElement} card The task card element.
   * @param {any} usage Usage data { total, duration }.
   */
  function updateCardUsage(card, usage) {
    const usageContainer = card.querySelector(".task-usage");
    if (!usageContainer || !usage) return;

    usageContainer.innerHTML = "";
    if (usage.total > 0) {
        const tokensSpan = document.createElement("span");
        tokensSpan.className = "usage-stat";
        tokensSpan.textContent = `${usage.total.toLocaleString()} tokens`;
        usageContainer.appendChild(tokensSpan);
    }

    if (usage.duration) {
        const timeSpan = document.createElement("span");
        timeSpan.className = "usage-stat";
        timeSpan.textContent = `${(usage.duration / 1000).toFixed(1)}s`;
        usageContainer.appendChild(timeSpan);
    }
  }

  function renderTaskCard(/** @type {string} */ title, /** @type {string | null} */ messageId = null, /** @type {any} [usage] */ usage = null) {
    const card = document.createElement("div");
    card.className = "task-card";
    if (messageId) {
        card.dataset.messageId = messageId;
    }
    
    const header = document.createElement("div");
    header.className = "task-header";
    
    const displayTitle = title;
    
    const titleContainer = document.createElement("div");
    titleContainer.className = "task-title";
    titleContainer.innerHTML = `<span>${displayTitle}</span>`;
    header.appendChild(titleContainer);

    // Usage Container (Right side)
    const usageContainer = document.createElement("div");
    usageContainer.className = "task-usage";
    header.appendChild(usageContainer);

    if (usage) {
        updateCardUsage(card, usage);
    }

    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-msg-btn";
    copyBtn.title = "Copy message";
    copyBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
    `;
    copyBtn.onclick = (e) => {
        e.stopPropagation();
        const content = card.querySelector(".task-summary .markdown-body")?.textContent || "";
        copyToClipboard(content, copyBtn);
    };
    header.appendChild(copyBtn);
    
    card.appendChild(header);

    // Thoughts Section (Hidden by default)
    const thoughts = document.createElement("div");
    thoughts.className = "thought-section hidden";
    thoughts.innerHTML = `
        <div class="thought-header">
            <span>Thinking Process</span>
            <span class="collapse-icon">▾</span>
        </div>
        <div class="thought-content"></div>
    `;
    thoughts.querySelector(".thought-header")?.addEventListener("click", () => {
        thoughts.classList.toggle("collapsed");
    });
    card.appendChild(thoughts);

    const summary = document.createElement("div");
    summary.className = "task-summary";
    const markdownContainer = document.createElement("div");
    markdownContainer.className = "markdown-body";
    summary.appendChild(markdownContainer);
    card.appendChild(summary);

    const progress = document.createElement("div");
    progress.className = "progress-section collapsed"; // Collapsed by default
    progress.innerHTML = `
        <div class="progress-header">
            <span>Progress Updates</span>
            <span class="collapse-icon">▾</span>
        </div>
        <div class="progress-steps-list"></div>
    `;
    
    progress.querySelector(".progress-header")?.addEventListener("click", () => {
        progress.classList.toggle("collapsed");
        scrollToBottom();
    });

    card.appendChild(progress);
    messagesContainer?.appendChild(card);
    scrollToBottom();
    return card;
  }

  function addProgressStep(
    /** @type {HTMLElement} */ card,
    /** @type {string} */ title,
    /** @type {any} */ details = null,
  ) {
    const list = card.querySelector(".progress-steps-list");
    if (!list) return null;

    const item = document.createElement("div");
    item.className = "step-item";

    // Detect if title contains a file path
    // Matches common path patterns: src\libs\Subscription.ts or src/libs/Subscription.ts
    const fileMatch = title.match(
      /([a-zA-Z0-9_\-.\/\\ +]+?\.[a-zA-Z0-9]+)(?::L\d+(?:-L\d+)?)?/,
    );
    let filePath = fileMatch ? fileMatch[1].trim() : null;

    // Fallback: Check details for file path (passed from tool events)
    if (!filePath && details && details.filePath) {
      filePath = details.filePath;
    }

    if (filePath) {
      item.classList.add("file-step");
      const fileName = filePath.split(/[\\/]/).pop() || filePath;
      const extension = fileName.split(".").pop()?.toLowerCase() || "";

      item.innerHTML = `
        <div class="step-icon">
          ${getFileIconSvg(extension)}
        </div>
        <div class="step-content">
          <div class="step-title">${title}</div>
          <div class="step-meta"></div>
          <div class="step-details"></div>
        </div>
      `;

      item.onclick = (e) => {
        e.stopPropagation();
        vscode.postMessage({ type: "openFile", file: filePath });
      };
      item.title = `Click to open ${filePath}`;
    } else {
      item.innerHTML = `
        <div class="step-icon"><div class="step-icon-dot"></div></div>
        <div class="step-content">
          <div class="step-title">${title}</div>
          <div class="step-meta"></div>
          <div class="step-details"></div>
        </div>
      `;
    }

    list.appendChild(item);

    // Auto-expand progress section when a new step is added
    const section = card.querySelector(".progress-section");
    if (section) section.classList.remove("collapsed");

    // Store localized start time for duration calculation
    // @ts-expect-error - Custom state
    item._stateObj = { startTime: Date.now(), filePath };

    scrollToBottom();
    return item;
  }

  /**
   * Returns an SVG icon based on file extension
   * @param {string} ext 
   * @returns {string}
   */
  function getFileIconSvg(ext) {
    // Simple mapping of extensions to VS Code-like icons (Lucide icons approximation)
    const colorMap = {
      ts: "#3178c6",
      js: "#f1e05a",
      tsx: "#3178c6",
      jsx: "#f1e05a",
      css: "#563d7c",
      html: "#e34c26",
      json: "#f1e05a",
      md: "#083fa1",
      vue: "#41b883",
      py: "#3572A5",
      go: "#00ADD8",
      java: "#b07219",
      rs: "#dea584",
      php: "#4F5D95",
      rb: "#701516",
      swift: "#ffac45",
      kt: "#F18E33",
      c: "#555555",
      cpp: "#f34b7d",
      h: "#a8ff97",
      hpp: "#a8ff97"
    };
    
    const color = colorMap[ext] || "var(--text-secondary)";
    
    // Improved icon: Filled slightly, clearer stroke
    return `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" class="file-icon-svg">
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="${color}" fill-opacity="0.1"></path>
        <polyline points="14 2 14 8 20 8" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline>
      </svg>
    `;
  }

  function updateProgressStep(/** @type {HTMLElement} */ step, /** @type {string} */ meta, /** @type {string} */ status = "done", /** @type {any} */ details = null) {
      const metaDiv = step.querySelector(".step-meta");
      if (metaDiv) {
          metaDiv.textContent = meta;
      }
      if (status === "done") {
          step.querySelector(".step-icon")?.classList.add("done");
          
          // Calculate duration if not provided
          // @ts-expect-error - Custom state object check
          if (!details?.duration && step._stateObj?.startTime) {
              // @ts-expect-error - Custom state object access
              const duration = Date.now() - step._stateObj.startTime;
              if (!details) details = {};
              details.duration = duration;
          }
      } else if (status === "error") {
          step.querySelector(".step-icon")?.classList.add("error");
      }

      // Render details (timing, tokens)
      if (details) {
          const detailsDiv = step.querySelector(".step-details");
          if (detailsDiv) {
              const parts = [];
              if (details.duration) {
                  parts.push(`${(details.duration / 1000).toFixed(1)}s`);
              }
              if (details.tokens) {
                  const t = details.tokens;
                  const parts_tokens = [];
                  if (t.input) parts_tokens.push(`In: ${t.input}`);
                  if (t.output) parts_tokens.push(`Out: ${t.output}`);
                  if (t.cache) {
                      if (t.cache.read) parts_tokens.push(`Read: ${t.cache.read}`);
                      if (t.cache.write) parts_tokens.push(`Write: ${t.cache.write}`);
                  }
                  if (parts_tokens.length > 0) {
                      parts.push(parts_tokens.join(", "));
                  } else {
                      // Fallback
                       const total = (t.input || 0) + (t.output || 0);
                       if (total > 0) parts.push(`${total.toLocaleString()} tokens`);
                  }
              }
              if (details.usage) { // Handle snake_case or specific usage object from SDK
                  const total = (details.usage.input_tokens || 0) + (details.usage.output_tokens || 0);
                   parts.push(`${total.toLocaleString()} tokens`);
              }
              detailsDiv.textContent = parts.join(" • ");
          }

          // Accumulate stats into session totals
          if (details.tokens) {
              sessionStats.input += (details.tokens.input || 0);
              sessionStats.output += (details.tokens.output || 0);
              if (details.tokens.cache) {
                  sessionStats.read += (details.tokens.cache.read || 0);
                  sessionStats.write += (details.tokens.cache.write || 0);
              }
          }
          if (details.duration) {
              sessionStats.duration += details.duration;
          }
          updateHeaderStats();
      }
  }
  /**
   * FORBIDDEN TO REMOVE: This button allows users to view the implementation plan.
   * It is a core feature of the project and must remain accessible in the header.
   */
  function addPlanButtonToHeader(/** @type {HTMLElement} */ card, /** @type {any} */ plan) {
    const header = card.querySelector(".task-header");
    if (!header) return;
    
    // Check if button already exists to avoid duplicates
    if (header.querySelector(".view-plan-header-btn")) return;

    const btn = document.createElement("button");
    btn.className = "view-plan-header-btn";
    btn.innerHTML = `
        <!-- FORBIDDEN TO REMOVE: Core feature. -->
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <polyline points="10 9 9 9 8 9"></polyline>
        </svg>
        <span>View Plan</span>
    `;
    // FORBIDDEN TO REMOVE: Core feature. Do not remove this button.
    btn.title = "Core Feature: View Implementation Plan";
    btn.onclick = (e) => {
        e.stopPropagation();
        vscode.postMessage({ type: "viewPlan", plan });
    };
    
    // Insert before copy button
    const copyBtn = header.querySelector(".copy-msg-btn");
    if (copyBtn) {
        header.insertBefore(btn, copyBtn);
    } else {
        header.appendChild(btn);
    }
  }


  /**
   * FORBIDDEN TO REMOVE: This card renders the implementation plan attachment.
   * It is a core feature of the project and must be rendered when a plan is available.
   */
  function renderPlanCard(/** @type {any} */ plan, /** @type {HTMLElement} */ container) {
    const card = document.createElement("div");
    card.className = "plan-card";
    card.innerHTML = "<!-- FORBIDDEN TO REMOVE: Core feature. -->";
    
    const header = document.createElement("div");
    header.className = "plan-card-header";
    header.innerHTML = "Implementation Plan";
    card.appendChild(header);


    const btn = document.createElement("button");
    btn.className = "view-plan-btn";
    btn.textContent = "View Implementation Plan";
    // FORBIDDEN TO REMOVE: Core feature. Do not remove this button.
    btn.title = "Core Feature: Do not remove";
    btn.onclick = () => {
        vscode.postMessage({ type: "viewPlan", plan });
    };
    card.appendChild(btn);

    container.appendChild(card);
  }

  function scrollToBottom() {
    if (messagesContainer) {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        // Also try a second time just in case of images/complex rendering
        setTimeout(() => {
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }, 50);
      });
    }
  }

  function renderMarkdown(/** @type {HTMLElement} */ container, /** @type {string} */ text) {
    // @ts-expect-error - marked defined in vendor.js
    if (window.marked) {
      // @ts-expect-error - marked defined in vendor.js
      container.innerHTML = window.marked.parse(text);
    } else {
      container.textContent = text;
    }
  }

  function addThinkingBubble() {
    const bubble = document.createElement("div");
    bubble.id = "thinking-bubble";
    bubble.className = "message assistant thinking";
    bubble.innerHTML = `
      <div class="thinking-dots">
        <span></span><span></span><span></span>
      </div>
    `;
    messagesContainer?.appendChild(bubble);
    scrollToBottom();
  }

  function removeThinkingBubble() {
    document.getElementById("thinking-bubble")?.remove();
  }

  function showError(/** @type {string} */ message) {
    const errorDiv = document.createElement("div");
    errorDiv.className = "message error";
    errorDiv.textContent = message;
    messagesContainer?.appendChild(errorDiv);
    scrollToBottom();
  }



  function clearStickyHeader() {
      sessionStats = { input: 0, output: 0, read: 0, write: 0, duration: 0 };
      updateHeaderStats();
      if (chatHeader) chatHeader.classList.remove("hidden");
  }

  /**
   * @param {string} text
   * @param {HTMLElement} btn
   */
  function copyToClipboard(text, btn) {
      navigator.clipboard.writeText(text).then(() => {
          const originalHTML = btn.innerHTML;
          btn.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
          `;
          setTimeout(() => {
              btn.innerHTML = originalHTML;
          }, 2000);
      }).catch(err => {
          console.error('Failed to copy text: ', err);
      });
  }

  init();
})();
