// @ts-check
(function () {
  /* @ts-expect-error - VS Code API provided by environment */
  const vscode = acquireVsCodeApi();

  // State
  let currentMode = "build";
  /** @type {string[]} */
  let selectedFiles = [];
  let isSearchingFiles = false;
  let selectedSuggestionIndex = -1;
  let suggestionResults = [];
  /** @type {any[]} */
  let availableModels = [];
  /** @type {any} */
  let selectedModel = null;
  let modelSearchQuery = "";
  /** @type {HTMLElement | null} */
  let currentStreamingMessage = null;

  // DOM Elements
  const messagesContainer = document.getElementById("messages");
  /** @type {HTMLTextAreaElement | null} */
  const messageInput = /** @type {HTMLTextAreaElement | null} */ (
    document.getElementById("message-input")
  );
  const sendButton = document.getElementById("send-button");
  const contextButton = document.getElementById("add-context-btn");
  const modeToggle = document.getElementById("mode-toggle");
  const modelSelector = document.getElementById("model-selector");
  // const reviewChangesButton = document.getElementById("review-changes-btn"); // Future use
  const filesPreviewContainer = document.getElementById("files-preview");

  // History Sidebar Elements - Injected dynamically or assumed present
  const historyToggle = document.getElementById("history-toggle");
  const historySidebar = document.getElementById("history-sidebar");
  const closeHistoryBtn = document.getElementById("close-history-btn");
  const sessionListContainer = document.getElementById("session-list");
  const newChatSidebarBtn = document.getElementById("new-chat-sidebar-btn");

  let currentSessions = [];
  let currentSessionId = null;

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
    sendButton?.addEventListener("click", sendMessage);
    messageInput?.addEventListener("keydown", handleKeyDown);
    messageInput?.addEventListener("input", handleInput);

    // Bind History Events
    historyToggle?.addEventListener("click", () => {
      if (historySidebar) historySidebar.classList.add("visible");
      vscode.postMessage({ type: "getSessions" });
    });

    closeHistoryBtn?.addEventListener("click", () => {
      if (historySidebar) historySidebar.classList.remove("visible");
    });

    newChatSidebarBtn?.addEventListener("click", () => {
      vscode.postMessage({ type: "newSession" });
      if (historySidebar) historySidebar.classList.remove("visible");
    });

    // Close sidebar when clicking outside
    document.addEventListener("click", (e) => {
      if (
        historySidebar &&
        historySidebar.classList.contains("visible") &&
        !historySidebar.contains(e.target) &&
        historyToggle &&
        !historyToggle.contains(e.target)
      ) {
        historySidebar.classList.remove("visible");
      }
    });

    contextButton?.addEventListener("click", () => {
      vscode.postMessage({ type: "attachFiles" });
    });

    modeToggle?.addEventListener("click", () => {
      vscode.postMessage({ type: "toggleMode" });
    });

    modelSelector?.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleModelDropdown();
    });

    // Close dropdowns on click outside
    document.addEventListener("click", (e) => {
      const dropdown = document.getElementById("model-dropdown");
      if (
        dropdown &&
        !dropdown.classList.contains("hidden") &&
        !dropdown.contains(/** @type {Node} */(e.target)) &&
        !modelSelector?.contains(/** @type {Node} */(e.target))
      ) {
        dropdown.classList.add("hidden");
      }
    });

    // Request initial state with retry
    console.log("[app.js] Sending ready message...");
    vscode.postMessage({ type: "ready" });

    // Retry every 1s until we get a response (mode or status)
    const readyInterval = setInterval(() => {
      if (
        document
          .getElementById("loading-overlay")
          ?.classList.contains("visible")
      ) {
        console.log("[app.js] Retrying ready message...");
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
        if (message.mode) {
          currentMode = message.mode;
          updateModeUI();
        }
        if (message.selectedModel) {
          selectedModel = message.selectedModel;
          updateSelectedModelUI();
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

      case "modeChanged":
        currentMode = message.mode;
        updateModeUI();
        break;

      case "statusUpdate":
        updateStatusUI(message.status);
        break;

      case "messageResponse":
        addAssistantMessage(message.message);
        currentStreamingMessage = null;
        break;

      case "chatHistory":
        console.log(
          "[app.js] Received chat history:",
          message.messages.length,
          "messages",
        );
        renderChatHistory(message.messages);
        break;

      case "streamEvent":
        handleStreamEvent(message.event);
        break;

      case "error":
        showError(message.message);
        removeThinkingBubble();
        if (currentStreamingMessage) {
          currentStreamingMessage.remove();
          currentStreamingMessage = null;
        }
        break;

      case "appendPrompt":
        if (messageInput) {
          messageInput.value += (messageInput.value ? "\n" : "") + message.text;
          messageInput.focus();
        }
        break;

      case "fileSearchResults":
        showFileSuggestions(message.results);
        break;

      case "sessionsList":
        renderSessionsList(message.sessions, message.currentSessionId);
        break;

      case "executePlan":
        // Auto-fill with a concise message and send automatically
        if (messageInput) {
          messageInput.value = "Proceed";
          sendMessage();
        }
        break;
    }
  });

  // --- Logic Functions ---

  function renderSessionsList(sessions, activeId) {
    if (!sessionListContainer) return;

    sessionListContainer.innerHTML = "";
    currentSessions = sessions;
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

    sessions.forEach((session) => {
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
    addUserMessage(text || "(Selected files)");

    // Send to extension
    vscode.postMessage({
      type: "sendMessage",
      text,
      files: selectedFiles,
    });

    // Clear and Reset
    if (messageInput) {
      messageInput.value = "";
      messageInput.style.height = "auto"; // Reset height
    }
    selectedFiles = [];
    updateFileChipsUI();
    hideSuggestions();

    // Show Thinking Bubble
    addThinkingBubble();
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
      const name = modelInfo ? modelInfo.name : selectedModel.modelID;
      currentModelNameSpan.textContent = name;
    }
  }

  function updateModeUI() {
    const modeText = modeToggle?.querySelector(".mode-text");
    const modeIcon = modeToggle?.querySelector(".pill-icon"); // pill-icon in new UI

    if (currentMode === "plan") {
      if (modeText) modeText.textContent = "Planning";
      if (modeIcon) modeIcon.textContent = "📋";
    } else {
      if (modeText) modeText.textContent = "Building";
      if (modeIcon) modeIcon.textContent = "🔨";
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

  function showFileSuggestions(results) {
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
    console.log("[app.js] Rendering chat history:", messages);

    // Clear existing messages
    messagesContainer.innerHTML = "";

    messages.forEach((message) => {
      if (message.role === "user") {
        // Extract text from parts if it's an object, otherwise use as is
        let text = "";
        if (message.parts && Array.isArray(message.parts)) {
          text = message.parts
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("\n");
        } else if (typeof message === "string") {
          text = message;
        } else if (message.text) {
          text = message.text;
        }
        addUserMessage(text);
      } else if (message.role === "assistant" || message.role === "model") {
        addAssistantMessage(message);
      }
    });

    scrollToBottom();
  }

  function addUserMessage(/** @type {string} */ text) {
    const messageDiv = document.createElement("div");
    messageDiv.className = "message user";
    const contentDiv = document.createElement("div");
    contentDiv.className = "message-content";

    // User messages as plain text for now, or minimal markdown
    contentDiv.textContent = text;

    messageDiv.appendChild(contentDiv);
    messagesContainer?.appendChild(messageDiv);
    scrollToBottom();
  }

  function addAssistantMessage(message) {
    // Remove thinking bubble
    removeThinkingBubble();

    // Logic for adding assistant message with markdown, plans, etc.
    const messageDiv = document.createElement("div");
    messageDiv.className = "message assistant";

    // Header
    const headerDiv = document.createElement("div");
    headerDiv.className = "message-header";
    const nameSpan = document.createElement("span");
    nameSpan.className = "agent-name";
    nameSpan.textContent = message.info?.agent || "Assistant";
    headerDiv.appendChild(nameSpan);

    if (message.info?.modelID) {
      const modelSpan = document.createElement("span");
      modelSpan.style.opacity = "0.7";
      modelSpan.textContent = ` (${message.info.modelID})`;
      headerDiv.appendChild(modelSpan);
    }
    messageDiv.appendChild(headerDiv);

    // Content Parts
    if (message.parts && Array.isArray(message.parts)) {
      let textBuffer = "";
      let fullText = ""; // Collect ALL text content for plan parsing

      const flushTextBuffer = () => {
        if (textBuffer.trim()) {
          const contentDiv = document.createElement("div");
          contentDiv.className = "message-content";
          renderMarkdown(contentDiv, textBuffer);
          messageDiv.appendChild(contentDiv);
          textBuffer = "";
        }
      };

      message.parts.forEach((/** @type {any} */ part) => {
        const text =
          part.text ||
          part.content ||
          part.reasoning ||
          part.thought ||
          part.thinking ||
          "";

        // Collect all text/thinking parts for the aggregate plan parsing
        fullText += text + "\n";

        // Reasoning Check
        if (
          part.type === "reasoning" ||
          part.reasoning ||
          part.thought ||
          part.thinking
        ) {
          flushTextBuffer();

          const reasoningContainer = document.createElement("div");
          reasoningContainer.className = "reasoning-container collapsed";

          const toggleDiv = document.createElement("div");
          toggleDiv.className = "reasoning-toggle";
          toggleDiv.innerHTML = `
            <span class="chevron"></span>
            <span class="reasoning-label">Thought</span>
          `;

          const reasoningContent = document.createElement("div");
          reasoningContent.className = "reasoning-content";

          if (text) {
            renderMarkdown(reasoningContent, text);
          } else {
            reasoningContent.textContent = "Processing...";
          }

          toggleDiv.addEventListener("click", () => {
            const isCollapsed =
              reasoningContainer.classList.toggle("collapsed");
            reasoningContainer.classList.toggle("expanded", !isCollapsed);
            scrollToBottom();
          });

          reasoningContainer.appendChild(toggleDiv);
          reasoningContainer.appendChild(reasoningContent);
          messageDiv.appendChild(reasoningContainer);
        } else {
          // Regular text
          textBuffer += text + "\n\n";
        }
      });

      // Flush remaining text
      flushTextBuffer();

      // Check for Implementation Plan in the ENTIRE message content
      if (isPlan(fullText)) {
        renderPlanCard(messageDiv, fullText);
      }
    }

    // Footer
    if (message.info?.tokens || message.timing?.duration) {
      const footerDiv = document.createElement("div");
      footerDiv.className = "message-footer";

      let footerText = "";
      if (message.info?.tokens) {
        const { input, output } = message.info.tokens;
        footerText += `${input + output} tokens`;
      }

      if (message.timing?.duration) {
        if (footerText) footerText += " • ";
        footerText += `${message.timing.duration.toFixed(1)}s`;
      }

      footerDiv.textContent = footerText;
      messageDiv.appendChild(footerDiv);
    }

    messagesContainer?.appendChild(messageDiv);
    scrollToBottom();
  }

  function handleStreamEvent(/** @type {any} */ event) {
    if (event.type === "message.start") {
      currentStreamingMessage = createStreamingMessage();
    } else if (event.type === "message.delta" && currentStreamingMessage) {
      removeThinkingBubble(); // Ensure indicator is gone when real data arrives
      const properties = event.properties || {};

      // Determine content type and text
      let text = "";
      let type = "text";

      if (properties.reasoning || properties.thought) {
        text = properties.reasoning || properties.thought;
        type = "reasoning";
      } else if (properties.content || properties.text) {
        text = properties.content || properties.text;
        type = "text";
      }

      if (text) {
        updateStreamingMessage(currentStreamingMessage, text, type);
      }
    } else if (event.type === "message.end" && currentStreamingMessage) {
      finalizeStreamingMessage(
        /** @type {HTMLElement} */(currentStreamingMessage),
      );
      currentStreamingMessage = null;
    }
  }

  function createStreamingMessage() {
    const messageDiv = document.createElement("div");
    messageDiv.className = "message assistant";
    messageDiv.dataset.rawText = "";

    const headerDiv = document.createElement("div");
    headerDiv.className = "message-header";
    headerDiv.innerHTML = '<span class="agent-name">Assistant</span>';
    messageDiv.appendChild(headerDiv);

    const contentDiv = document.createElement("div");
    contentDiv.className = "message-content";
    messageDiv.appendChild(contentDiv);

    messagesContainer?.appendChild(messageDiv);
    scrollToBottom();
    return messageDiv;
  }

  // Throttle state
  let renderBuffer = {
    text: "",
    messageDiv: null,
    contentDiv: null,
    type: "text",
  };
  let renderTimeout = null;

  function scheduleRender() {
    if (renderTimeout) return;

    renderTimeout = setTimeout(() => {
      if (renderBuffer.messageDiv && renderBuffer.contentDiv) {
        renderMarkdown(renderBuffer.contentDiv, renderBuffer.text);
        scrollToBottom();
      }
      renderTimeout = null;
    }, 50);
  }

  function updateStreamingMessage(
    /** @type {HTMLElement} */ messageDiv,
    /** @type {string} */ text,
    /** @type {string} */ type = "text",
  ) {
    if (type === "reasoning") {
      let reasoningContainer = messageDiv.querySelector(".reasoning-container");
      let reasoningContent = messageDiv.querySelector(".reasoning-content");

      if (!reasoningContainer) {
        // Create the reasoning accordion if it doesn't exist yet
        reasoningContainer = document.createElement("div");
        // Start expanded to show real-time thoughts immediately
        reasoningContainer.className = "reasoning-container expanded";
        reasoningContainer.innerHTML = `
          <div class="reasoning-toggle">
            <span class="chevron"></span>
            <span class="reasoning-label">Thought</span>
          </div>
        `;

        reasoningContent = document.createElement("div");
        reasoningContent.className = "reasoning-content";
        reasoningContent.textContent = "";

        reasoningContainer.appendChild(reasoningContent);

        // Insert before the main content div
        const contentDiv = messageDiv.querySelector(".message-content");
        messageDiv.insertBefore(reasoningContainer, contentDiv);

        // Bind toggle
        const toggleBtn = reasoningContainer.querySelector(".reasoning-toggle");
        toggleBtn?.addEventListener("click", () => {
          const isCollapsed = reasoningContainer.classList.toggle("collapsed");
          reasoningContainer.classList.toggle("expanded", !isCollapsed);
        });
      }

      if (reasoningContent) {
        const currentText = reasoningContent.dataset.fullText || "";
        const newText = currentText + text;
        reasoningContent.dataset.fullText = newText;
        renderMarkdown(reasoningContent, newText);
      }
    } else {
      // Regular content
      const contentDiv = messageDiv.querySelector(".message-content");
      if (contentDiv) {
        const currentText = messageDiv.dataset.rawText || "";
        const newText = currentText + text;
        messageDiv.dataset.rawText = newText;

        renderBuffer = {
          text: newText,
          messageDiv,
          contentDiv,
          type,
        };
        scheduleRender();
      }
    }
  }

  function finalizeStreamingMessage(/** @type {HTMLElement} */ messageDiv) {
    // Force final render
    if (renderTimeout) {
      clearTimeout(renderTimeout);
      renderTimeout = null;
    }
    const contentDiv = messageDiv.querySelector(".message-content");
    if (contentDiv) {
      const text = messageDiv.dataset.rawText || "";
      renderMarkdown(contentDiv, text);

      if (isPlan(text)) {
        renderPlanCard(messageDiv, text);
      }
    }
  }

  function renderPlanCard(
    /** @type {HTMLElement} */ container,
    /** @type {string} */ content,
  ) {
    const card = document.createElement("div");
    card.className = "plan-card";
    card.innerHTML = `
          <div class="plan-card-header">
              <span class="plan-icon">📋</span>
              <span class="plan-title">Implementation Plan</span>
          </div>
          <button class="view-plan-btn">View Implementation Plan</button>
      `;
    card.querySelector("button")?.addEventListener("click", () => {
      vscode.postMessage({ type: "viewPlan", content });
    });
    container.appendChild(card);
  }

  function renderMarkdown(
    /** @type {HTMLElement} */ element,
    /** @type {string} */ text,
  ) {
    // @ts-expect-error - marked defined in vendor.js
    if (window.marked) {
      try {
        // @ts-expect-error - marked defined in vendor.js
        element.innerHTML = window.marked.parse(text);
      } catch (e) {
        element.textContent = text;
      }
    } else {
      element.textContent = text;
    }
  }

  function isPlan(text) {
    // Matches # Implementation Plan, ## Implementation Plan, etc. at start of lines
    return /^#+\s*Implementation Plan/im.test(text);
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function showError(/** @type {string} */ msg) {
    const div = document.createElement("div");
    div.className = "message error";
    div.innerHTML = `<span>⚠️ ${escapeHtml(msg)}</span>`;
    messagesContainer?.appendChild(div);
    scrollToBottom();
  }

  function scrollToBottom() {
    if (messagesContainer)
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  /**
   * Appends a "Thinking..." indicator to the message stream.
   * This provides immediate visual feedback while the AI is processing.
   */
  function addThinkingBubble() {
    removeThinkingBubble(); // Ensure no duplicates
    const messageDiv = document.createElement("div");
    messageDiv.id = "thinking-bubble";
    messageDiv.className = "message assistant thinking";
    messageDiv.innerHTML = `
      <div class="message-header">
        <span class="agent-name">Assistant</span>
      </div>
      <div class="message-content">
        <div class="thinking-dots">
          <span></span><span></span><span></span>
        </div>
      </div>
    `;
    messagesContainer?.appendChild(messageDiv);
    scrollToBottom();
  }

  /**
   * Removes the "Thinking..." indicator.
   * Called when a response begins streaming or an error occurs.
   */
  function removeThinkingBubble() {
    const bubble = document.getElementById("thinking-bubble");
    if (bubble) {
      bubble.remove();
    }
  }

  // Start initialization
  init();
})();
