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
        !dropdown.contains(/** @type {Node} */ (e.target)) &&
        !modelSelector?.contains(/** @type {Node} */ (e.target))
      ) {
        dropdown.classList.add("hidden");
      }
    });

    // Request initial state
    vscode.postMessage({ type: "ready" });
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

      case "filesAttached":
        if (message.files) {
          message.files.forEach(
            /** @param {string} file */ (file) => {
              if (!selectedFiles.includes(file)) {
                selectedFiles.push(file);
              }
            },
          );
          updateFileChipsUI();
        }
        break;
    }
  });

  // --- Logic Functions ---

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
    // Reuse existing structure but ensure clean markdown logic
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

      message.parts.forEach((/** @type {any} */ part) => {
        const text =
          part.text || part.content || part.reasoning || part.thought || "";

        // Implementation Plan Check (Simple regex)
        if (/# Implementation Plan/i.test(text)) {
          // Render plan card
          renderPlanCard(messageDiv, text);
          return;
        }

        // Logic for "reasoning" parts (Chain of Thought):
        // Wraps the raw reasoning text in a collapsible accordion to keep the UI clean.
        if (
          part.type === "reasoning" ||
          part.reasoning ||
          part.thought ||
          part.thinking
        ) {
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
          textBuffer += text + "\n\n";
        }

      if (textBuffer.trim()) {
        const contentDiv = document.createElement("div");
        contentDiv.className = "message-content";
        renderMarkdown(contentDiv, textBuffer);
        messageDiv.appendChild(contentDiv);
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
      const properties = event.properties || {};
      const text =
        properties.text ||
        properties.content ||
        properties.reasoning ||
        properties.thought ||
        "";

      // If it's reasoning content, we might want to handle it differently during stream,
      // but for now we append it to rawText to ensure it's at least visible.
      updateStreamingMessage(currentStreamingMessage, text);
    } else if (event.type === "message.end" && currentStreamingMessage) {
      finalizeStreamingMessage(
        /** @type {HTMLElement} */ (currentStreamingMessage),
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

  function updateStreamingMessage(
    /** @type {HTMLElement} */ messageDiv,
    /** @type {string} */ text,
    /** @type {string} */ type = "text",
  ) {
    if (type === "reasoning") {
      let reasoningContainer = messageDiv.querySelector(".reasoning-container");
      if (!reasoningContainer) {
        // Create the reasoning accordion if it doesn't exist yet
        reasoningContainer = document.createElement("div");
        reasoningContainer.className = "reasoning-container collapsed";
        reasoningContainer.innerHTML = `
          <div class="reasoning-toggle">
            <span class="chevron"></span>
            <span class="reasoning-label">Thought</span>
          </div>
          <div class="reasoning-content"></div>
        `;
        // Insert before or after main content? Usually reasoning comes first
        const contentDiv = messageDiv.querySelector(".message-content");
        if (contentDiv) {
          messageDiv.insertBefore(reasoningContainer, contentDiv);
        } else {
          messageDiv.appendChild(reasoningContainer);
        }

        // Add toggle logic
        reasoningContainer
          .querySelector(".reasoning-toggle")
          ?.addEventListener("click", () => {
            const isCollapsed =
              reasoningContainer.classList.toggle("collapsed");
            reasoningContainer.classList.toggle("expanded", !isCollapsed);
            scrollToBottom();
          });
      }

      const reasoningContent =
        reasoningContainer?.querySelector(".reasoning-content");
      if (reasoningContent) {
        // We might want to store raw reasoning text in dataset too if it's long,
        // but for now we append and re-render.
        const existingText = reasoningContainer?.dataset.rawReasoning || "";
        const newReasoningText = existingText + text;
        if (reasoningContainer) {
          reasoningContainer.dataset.rawReasoning = newReasoningText;
          renderMarkdown(reasoningContent, newReasoningText);
        }
      }
    } else {
      const contentDiv = messageDiv.querySelector(".message-content");
      if (contentDiv) {
        const newText = (messageDiv.dataset.rawText || "") + text;
        messageDiv.dataset.rawText = newText;
        renderMarkdown(contentDiv, newText);
      }
    }
    scrollToBottom();
  }

  function finalizeStreamingMessage(/** @type {HTMLElement} */ messageDiv) {
    const contentDiv = messageDiv.querySelector(".message-content");
    if (contentDiv) {
      const text = messageDiv.dataset.rawText || "";
      renderMarkdown(contentDiv, text);

      if (isPlan(text)) {
        const btn = document.createElement("button");
        btn.className = "plan-button"; // style this
        btn.textContent = "View Plan";
        btn.onclick = () =>
          vscode.postMessage({ type: "viewPlan", content: text });
        messageDiv.appendChild(btn);
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
          <button class="view-plan-btn">View Details</button>
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
    return /# Implementation Plan/i.test(text);
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
