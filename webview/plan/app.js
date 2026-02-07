// @ts-check
(function () {
    // @ts-expect-error - acquireVsCodeApi is provided by VS Code webview environment
    const vscode = acquireVsCodeApi();

    const approveBtn = document.getElementById('approve-btn');
    const executeBtn = document.getElementById('execute-btn');
    const stepCheckboxes = document.querySelectorAll('.step-item input[type="checkbox"]');

    // Handle checkboxes
    stepCheckboxes.forEach((checkbox, _index) => {
        checkbox.addEventListener('change', (e) => {
            const target = /** @type {HTMLInputElement} */ (e.target);
            const stepItem = target.parentElement;
            if (stepItem) {
                if (target.checked) {
                    stepItem.classList.add('completed');
                } else {
                    stepItem.classList.remove('completed');
                }
            }

            // Optional: send message to extension about progress
        });
    });

    // Handle Approve
    approveBtn?.addEventListener('click', () => {
        vscode.postMessage({
            type: 'alert',
            text: 'Plan approved! You can now start execution.'
        });
        approveBtn.textContent = '✅ Approved';
        approveBtn.style.opacity = '0.7';
        approveBtn.setAttribute('disabled', 'true');
    });

    // Handle Execute
    executeBtn?.addEventListener('click', () => {
        vscode.postMessage({
            type: 'executeStep',
            step: 'all'
        });
    });
}());
