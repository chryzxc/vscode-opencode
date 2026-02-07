// @ts-check
(function () {
    // @ts-expect-error - acquireVsCodeApi is provided by VS Code webview environment
    const vscode = acquireVsCodeApi();

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
