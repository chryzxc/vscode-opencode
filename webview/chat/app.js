// @ts-check
(function () {
  /* @ts-expect-error - VS Code API provided by environment */
  const vscode = acquireVsCodeApi();

  let currentMode = 'build';
  const messagesContainer = document.getElementById('messages');
  /** @type {HTMLTextAreaElement | null} */
  const messageInput = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('message-input'));
  const sendButton = document.getElementById('send-button');
  const modeToggle = document.getElementById('mode-toggle');
  const newSessionButton = document.getElementById('new-session');

  // File reference state
  /** @type {string[]} */
  let selectedFiles = [];
  let isSearchingFiles = false;
  let selectedSuggestionIndex = -1;
  let suggestionResults = [];

  // Model state
  /** @type {any[]} */
  let availableModels = [];
  /** @type {any} */
  let selectedModel = null;

  // Create suggestions container
  const suggestionsContainer = document.createElement('div');
  suggestionsContainer.className = 'suggestions-container';
  const inputContainer = document.querySelector('.input-container');
  inputContainer?.parentElement?.insertBefore(suggestionsContainer, inputContainer);

  // Create file chips container
  const fileChipsContainer = document.createElement('div');
  fileChipsContainer.className = 'file-chips-container';
  fileChipsContainer.style.display = 'none';
  inputContainer?.parentElement?.insertBefore(fileChipsContainer, inputContainer);

  // Configure marked if available
  // @ts-ignore
  if (window.marked && window.hljs) {
    // @ts-ignore
    window.marked.setOptions({
      highlight: function(code, lang) {
        // @ts-ignore
        if (lang && window.hljs.getLanguage(lang)) {
          // @ts-ignore
          return window.hljs.highlight(code, { language: lang }).value;
        }
        // @ts-ignore
        return window.hljs.highlightAuto(code).value;
      },
      breaks: true,
      gfm: true
    });
  }

  // Initialize
  function init() {
    // Request initial state
    vscode.postMessage({ type: 'ready' });

    // Ensure DOM references are fresh
    const attachButton = document.getElementById('attach-button');
    const settingsButton = document.getElementById('settings-button');
    const modelSelector = document.getElementById('model-selector');
    const messageInputEl = /** @type {HTMLTextAreaElement} */ (document.getElementById('message-input'));

    // Setup event listeners
    sendButton?.addEventListener('click', sendMessage);
    messageInputEl?.addEventListener('keydown', handleKeyDown);
    modeToggle?.addEventListener('click', toggleMode);
    newSessionButton?.addEventListener('click', createNewSession);
    messageInputEl?.addEventListener('input', handleInput);
    
    // Attach button
    attachButton?.addEventListener('click', () => {
        vscode.postMessage({ type: 'attachFiles' });
    });

    // Settings button
    settingsButton?.addEventListener('click', () => {
        vscode.postMessage({ type: 'openSettings' });
    });

    // Model selector
    modelSelector?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleModelDropdown();
    });

    // Close dropdown on click outside
    document.addEventListener('click', (e) => {
      const dropdown = document.getElementById('model-dropdown');
      const selector = document.getElementById('model-selector');
      if (dropdown && !dropdown.classList.contains('hidden') && 
          !dropdown.contains(/** @type {Node} */ (e.target)) && 
          !selector?.contains(/** @type {Node} */ (e.target))) {
        dropdown.classList.add('hidden');
      }
    });
  }

  let currentStreamingMessage = null;

  // Handle messages from extension
  window.addEventListener('message', (event) => {
    const message = event.data;

    switch (message.type) {
      case 'initState':
        currentMode = message.mode || 'build';
        updateModeUI();
        updateStatusUI(message.serverStatus);
        if (message.selectedModel) {
            selectedModel = message.selectedModel;
            updateSelectedModelUI();
        }
        break;

      case 'modelsList':
        availableModels = message.models;
        if (message.selectedModel) {
            selectedModel = message.selectedModel;
        }
        renderModels();
        updateSelectedModelUI();
        break;

      case 'modeChanged':
        currentMode = message.mode;
        updateModeUI();
        break;

      case 'statusUpdate':
        updateStatusUI(message.status);
        break;

      case 'messageResponse':
        addAssistantMessage(message.message);
        currentStreamingMessage = null;
        break;

      case 'streamEvent':
        handleStreamEvent(message.event);
        break;

      case 'error':
        showError(message.message);
        break;

      case 'appendPrompt':
        if (messageInput) {
          messageInput.value += (messageInput.value ? '\n' : '') + message.text;
          messageInput.focus();
        }
        break;
      
      case 'viewPlan': // Should not happen in webview, but for completeness
        break;

      case 'fileSearchResults':
        showFileSuggestions(message.results);
        break;

      case 'filesAttached':
        if (message.files) {
            message.files.forEach(/** @param {string} file */ (file) => {
                if (!selectedFiles.includes(file)) {
                    selectedFiles.push(file);
                }
            });
            updateFileChipsUI();
        }
        break;
    }
  });

  /** @param {any} event */
  function handleStreamEvent(event) {
    if (!event || !event.type) return;

    // Handle different event types
    switch (event.type) {
      case 'message.start':
        // Start a new streaming message
        currentStreamingMessage = createStreamingMessage();
        break;

      case 'message.delta':
        // Update streaming message with new content
        if (currentStreamingMessage && event.properties?.text) {
          updateStreamingMessage(currentStreamingMessage, event.properties.text);
        }
        break;

      case 'message.end':
        // Finalize streaming message
        if (currentStreamingMessage) {
          finalizeStreamingMessage(currentStreamingMessage);
          currentStreamingMessage = null;
        }
        break;
    }
  }

  // Create a new streaming message element
  function createStreamingMessage() {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant streaming';
    // Store raw text for streaming accumulation
    messageDiv.dataset.rawText = '';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.innerHTML = '<span class="cursor"></span>';

    messageDiv.appendChild(contentDiv);
    messagesContainer?.appendChild(messageDiv);
    scrollToBottom();

    return messageDiv;
  }

  /** 
   * @param {HTMLElement} messageDiv 
   * @param {string} text 
   */
  function updateStreamingMessage(messageDiv, text) {
    const contentDiv = messageDiv.querySelector('.message-content');
    if (contentDiv) {
      // Accumulate text
      const currentRaw = messageDiv.dataset.rawText || '';
      const newRaw = currentRaw + text;
      messageDiv.dataset.rawText = newRaw;
      
      // Render markdown
      if (window.marked) {
        try {
          contentDiv.innerHTML = window.marked.parse(newRaw);
        } catch (e) {
          contentDiv.textContent = newRaw;
        }
      } else {
         contentDiv.textContent = newRaw;
      }
      scrollToBottom();
    }
  }

  /** @param {HTMLElement} messageDiv */
  function finalizeStreamingMessage(messageDiv) {
    messageDiv.classList.remove('streaming');
    const contentDiv = messageDiv.querySelector('.message-content');
    const rawText = messageDiv.dataset.rawText || contentDiv.textContent || '';
    
    // Ensure final render is clean
    if (window.marked) {
      try {
        contentDiv.innerHTML = window.marked.parse(rawText);
      } catch (e) {
        contentDiv.textContent = rawText;
      }
    }
    
    if (contentDiv && isPlan(rawText)) {
      const planButton = document.createElement('button');
      planButton.className = 'plan-button';
      planButton.textContent = '📋 View Implementation Plan';
      planButton.onclick = () => {
        vscode.postMessage({
          type: 'viewPlan',
          content: rawText,
        });
      };
      messageDiv.appendChild(planButton);
    }
  }

  // Send message
  function sendMessage() {
    const text = messageInput?.value.trim();
    if (!text && selectedFiles.length === 0) return;

    // Add user message to UI
    addUserMessage(text || '(Selected files)');

    // Send to extension
    vscode.postMessage({
      type: 'sendMessage',
      text,
      files: selectedFiles
    });

    // Clear input and files
    if (messageInput) {
      messageInput.value = '';
      messageInput.style.height = 'auto';
    }
    selectedFiles = [];
    updateFileChipsUI();
    hideSuggestions();
  }

  // Handle keyboard shortcuts
  function handleKeyDown(event) {
    if (isSearchingFiles && suggestionsContainer.style.display === 'block') {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        updateSelectedSuggestion(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        updateSelectedSuggestion(-1);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        selectSuggestion(selectedSuggestionIndex);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        hideSuggestions();
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  // Toggle mode
  function toggleMode() {
    vscode.postMessage({ type: 'toggleMode' });
  }

  // Create new session
  function createNewSession() {
    if (messagesContainer) {
      messagesContainer.innerHTML = `
        <div id="empty-state" class="empty-state">
          <div class="empty-state-logo">
            <span>✴️</span> OpenCode
          </div>
          <div class="empty-state-icon">
            👾
          </div>
          <p class="empty-state-hint">
            Use OpenCode in the terminal to configure MCP servers.<br>
            They'll work here, too!
          </p>
        </div>
      `;
    }
    vscode.postMessage({ type: 'newSession' });
  }

  // Update mode UI
  function updateModeUI() {
    const modeText = modeToggle?.querySelector('.mode-text');
    const modeIcon = modeToggle?.querySelector('.mode-icon');

    if (currentMode === 'plan') {
      modeToggle?.classList.add('plan-mode');
      if (modeText) modeText.textContent = 'PLAN';
      if (modeIcon) modeIcon.textContent = '📋';
    } else {
      modeToggle?.classList.remove('plan-mode');
      if (modeText) modeText.textContent = 'BUILD';
      if (modeIcon) modeIcon.textContent = '🔨';
    }
  }

  // Update server status UI
  function updateStatusUI(status) {
    const overlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');

    if (!overlay) return;

    switch (status) {
      case 'starting':
        overlay.classList.add('visible');
        if (loadingText) loadingText.textContent = 'Initializing OpenCode...';
        break;
      case 'running':
        overlay.classList.remove('visible');
        break;
      case 'error':
        overlay.classList.add('visible');
        if (loadingText) loadingText.textContent = '❌ Failed to connect to OpenCode';
        break;
      case 'idle':
        overlay.classList.add('visible');
        if (loadingText) loadingText.textContent = 'OpenCode is idle';
        break;
    }
  }

  // Add user message to UI
  function addUserMessage(text) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message user';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    // User message generally plain text, but could be markdown? 
    // Let's keep plain text for simplicity or consistent? 
    // Claude code treats user input as text usually. 
    // But rendering markdown is nice.
    if (window.marked) {
        try {
            contentDiv.innerHTML = window.marked.parse(text);
        } catch(e) {
            contentDiv.textContent = text;
        }
    } else {
        contentDiv.textContent = text;
    }

    messageDiv.appendChild(contentDiv);
    messagesContainer?.appendChild(messageDiv);
    scrollToBottom();
  }

  // Add assistant message to UI
  function addAssistantMessage(message) {
    console.log('Adding assistant message:', JSON.stringify(message, null, 2));
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';

    // 1. Header (Agent Info)
    const headerDiv = document.createElement('div');
    headerDiv.className = 'message-header';
    
    // Agent Name
    const agentNameSpan = document.createElement('span');
    agentNameSpan.className = 'agent-name';
    agentNameSpan.textContent = message.info?.agent || 'Assistant';
    headerDiv.appendChild(agentNameSpan);

    // Model Name (optional, from info)
    if (message.info?.modelID) {
      const modelSpan = document.createElement('span');
      modelSpan.className = 'model-name';
      modelSpan.textContent = `(${message.info.modelID})`;
      headerDiv.appendChild(modelSpan);
    }
    
    messageDiv.appendChild(headerDiv);

    // 2. Content (Parts)
    if (message.parts && Array.isArray(message.parts)) {
      const textParts = [];

      message.parts.forEach(part => {
        // Handle both SDK v2 and potentially v1 or flattened formats
        const partType = part.type || (part.content ? 'text' : 'unknown');
        const partText = part.text || part.content || '';

        if (partType === 'reasoning') {
          // Render reasoning block immediately
          const reasoningDiv = document.createElement('div');
          reasoningDiv.className = 'reasoning-part';
          
          const labelSpan = document.createElement('span');
          labelSpan.className = 'reasoning-label';
          labelSpan.textContent = 'Thinking Process';
          reasoningDiv.appendChild(labelSpan);
          
          // Reasoning is specifically text-heavy/log-like, maybe keep as textContent or render minimal md?
          // Usually better as text to preserve structure if it's raw thought.
          const textNode = document.createTextNode(partText);
          reasoningDiv.appendChild(textNode);
          
          messageDiv.appendChild(reasoningDiv);
        } else if (partType === 'text') {
          textParts.push(partText);
        }
      });

      // Render accumulated text
      if (textParts.length > 0) {
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        const fullText = textParts.join('\n\n');
        
        if (window.marked) {
             try {
                contentDiv.innerHTML = window.marked.parse(fullText);
            } catch(e) {
                 contentDiv.textContent = fullText;
            }
        } else {
            contentDiv.textContent = fullText;
        }
        
        messageDiv.appendChild(contentDiv);

        // Check for plan
        if (isPlan(fullText)) {
          const planButton = document.createElement('button');
          planButton.className = 'plan-button';
          planButton.textContent = '📋 View Implementation Plan';
          planButton.onclick = () => {
            vscode.postMessage({
              type: 'viewPlan',
              content: fullText,
            });
          };
          messageDiv.appendChild(planButton);
        }
      }
    } else {
      // Fallback for simple message
      const contentDiv = document.createElement('div');
      contentDiv.className = 'message-content';
      contentDiv.textContent = 'Received response';
      messageDiv.appendChild(contentDiv);
    }

    // 3. Footer (Token Usage)
    if (message.info?.tokens) {
      const footerDiv = document.createElement('div');
      footerDiv.className = 'message-footer';
      
      const { input, output } = message.info.tokens;
      const total = (input || 0) + (output || 0);
      
      const tokenInfo = document.createElement('span');
      tokenInfo.className = 'token-info';
      tokenInfo.textContent = `${total} tokens (${input} in / ${output} out)`;
      
      footerDiv.appendChild(tokenInfo);
      messageDiv.appendChild(footerDiv);
    }

    messagesContainer?.appendChild(messageDiv);
    scrollToBottom();
  }

  // Simple plan detection
  function isPlan(text) {
    const planIndicators = [
      /implementation plan/i,
      /proposed changes/i,
      /phase \d+:/i,
      /step \d+:/i,
      /\d+\.\s+\[.*\]/,
    ];

    return planIndicators.some((pattern) => pattern.test(text));
  }

  // Show error message
  function showError(errorMessage) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'message error';
    errorDiv.style.background = 'var(--vscode-inputValidation-errorBackground)';
    errorDiv.style.border = '1px solid var(--vscode-inputValidation-errorBorder)';
    errorDiv.style.color = 'var(--vscode-errorForeground)';
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.textContent = `❌ Error: ${errorMessage}`;
    
    errorDiv.appendChild(contentDiv);
    messagesContainer?.appendChild(errorDiv);
    scrollToBottom();
  }

  // Scroll to bottom
  function scrollToBottom() {
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }

  /** @param {any} _e */
  function handleInput(_e) {
    const value = messageInput?.value || '';
    const cursorPosition = messageInput?.selectionStart || 0;
    
    // Find if we are typing after @
    const lastAt = value.lastIndexOf('@', cursorPosition - 1);
    
    if (lastAt !== -1 && (lastAt === 0 || value[lastAt - 1] === ' ' || value[lastAt - 1] === '\n')) {
      const query = value.substring(lastAt + 1, cursorPosition);
      if (!query.includes(' ')) {
        isSearchingFiles = true;
        vscode.postMessage({ type: 'searchFiles', query });
        return;
      }
    }
    
    hideSuggestions();
  }

  function hideSuggestions() {
    isSearchingFiles = false;
    suggestionsContainer.style.display = 'none';
    selectedSuggestionIndex = -1;
  }

  function showFileSuggestions(results) {
    if (!isSearchingFiles || results.length === 0) {
      hideSuggestions();
      return;
    }

    suggestionResults = results;
    suggestionsContainer.innerHTML = '';
    suggestionsContainer.style.display = 'block';
    selectedSuggestionIndex = 0;

    results.forEach((result, index) => {
      const item = document.createElement('div');
      item.className = 'suggestion-item' + (index === 0 ? ' selected' : '');
      item.innerHTML = `
        <span class="suggestion-name">${result.name}</span>
        <span class="suggestion-path">${result.path}</span>
      `;
      item.onclick = () => selectSuggestion(index);
      suggestionsContainer.appendChild(item);
    });
  }

  function selectSuggestion(index) {
    const result = suggestionResults[index];
    if (!result) return;

    // Add to selected files
    if (!selectedFiles.includes(result.path)) {
      selectedFiles.push(result.path);
      updateFileChipsUI();
    }

    // Replace @query in input
    if (messageInput) {
      const value = messageInput.value;
      const cursorPosition = messageInput.selectionStart;
      const lastAt = value.lastIndexOf('@', cursorPosition - 1);
      const beforeAt = value.substring(0, lastAt);
      const afterCursor = value.substring(cursorPosition);
      
      messageInput.value = beforeAt + afterCursor;
      messageInput.focus();
    }

    hideSuggestions();
  }

  function updateFileChipsUI() {
    if (selectedFiles.length === 0) {
      fileChipsContainer.style.display = 'none';
      return;
    }

    fileChipsContainer.style.display = 'flex';
    fileChipsContainer.innerHTML = '';
    
    selectedFiles.forEach((path, index) => {
      const chip = document.createElement('div');
      chip.className = 'file-chip';
      const name = path.split(/[\\/]/).pop() || path;
      chip.innerHTML = `
        <span>${name}</span>
        <span class="file-chip-remove" title="Remove">&times;</span>
      `;
      chip.querySelector('.file-chip-remove')?.addEventListener('click', () => {
        selectedFiles.splice(index, 1);
        updateFileChipsUI();
      });
      fileChipsContainer.appendChild(chip);
    });
  }

  function updateSelectedSuggestion(delta) {
    const items = suggestionsContainer.querySelectorAll('.suggestion-item');
    if (items.length === 0) return;

    items[selectedSuggestionIndex]?.classList.remove('selected');
    selectedSuggestionIndex = (selectedSuggestionIndex + delta + items.length) % items.length;
    items[selectedSuggestionIndex]?.classList.add('selected');
    items[selectedSuggestionIndex]?.scrollIntoView({ block: 'nearest' });
  }

  function toggleModelDropdown() {
    const dropdown = document.getElementById('model-dropdown');
    dropdown?.classList.toggle('hidden');
    if (dropdown && !dropdown.classList.contains('hidden')) {
        vscode.postMessage({ type: 'getModels' });
    }
  }

  function renderModels() {
    const dropdown = document.getElementById('model-dropdown');
    if (!dropdown) return;

    dropdown.innerHTML = '';
    availableModels.forEach(model => {
        const isSelected = selectedModel && 
            selectedModel.providerID === model.providerID && 
            selectedModel.modelID === model.modelID;

        const item = document.createElement('div');
        item.className = `model-item ${isSelected ? 'selected' : ''}`;
        item.innerHTML = `
            <span class="model-name">${model.name}</span>
            <span class="model-provider">${model.providerName} / ${model.modelID}</span>
        `;
        item.onclick = () => selectModel(model);
        dropdown.appendChild(item);
    });
  }

  /** @param {any} model */
  function selectModel(model) {
    selectedModel = { providerID: model.providerID, modelID: model.modelID };
    updateSelectedModelUI();
    renderModels(); // Update checkmarks/selection
    
    // Hide dropdown
    document.getElementById('model-dropdown')?.classList.add('hidden');

    // Notify extension
    vscode.postMessage({
        type: 'selectModel',
        model: selectedModel
    });
  }

  function updateSelectedModelUI() {
    const currentModelSpan = document.getElementById('current-model');
    if (currentModelSpan && selectedModel) {
        // Find the model name in available models if possible
        const modelInfo = availableModels.find(m => 
            m.providerID === selectedModel.providerID && 
            m.modelID === selectedModel.modelID
        );
        const name = modelInfo ? modelInfo.name : selectedModel.modelID;
        const provider = modelInfo ? modelInfo.providerName : selectedModel.providerID;
        currentModelSpan.textContent = `${provider} / ${name}`;
    }
  }

  // Start
  init();
})();
