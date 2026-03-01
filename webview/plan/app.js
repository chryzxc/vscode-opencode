// @ts-check
(function () {
    // Safe acquire: VS Code only allows acquireVsCodeApi() once per webview.
    // Reuse stored instance on window to avoid "already acquired" errors.
    function getVsCodeApi() {
        // @ts-expect-error - global on webview
        if (window.__vscode_api) return window.__vscode_api;
        try {
            // @ts-expect-error - acquireVsCodeApi provided by VS Code
            window.__vscode_api = acquireVsCodeApi();
        }
        catch (e) {
            // If a previous script acquired it, it should be on window.__vscode_api
        }
        return window.__vscode_api;
    }

    const vscode = getVsCodeApi();

    const stepCheckboxes = document.querySelectorAll('.step-item input[type="checkbox"]');

    // Handle checkboxes
    // Handle Proceed
    const proceedBtn = document.getElementById('proceed-btn');
    if (proceedBtn) {
        proceedBtn.addEventListener('click', () => {
            const planEl = document.getElementById('plan-content');
            const planContent = planEl ? decodeURIComponent(planEl.getAttribute('data-raw') || '') : '';

            vscode.postMessage({
                type: 'executePlan',
                plan: planContent
            });

            // Visual feedback
            proceedBtn.textContent = '▶ Executing...';
            proceedBtn.setAttribute('disabled', 'true');
        });
    }

    // Handle checkboxes (keep existing logic)
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
        });
    });
}());
