/**
 * app.output.js - Output panel wiring
 */

function wireOutputPanel() {
    const clearButton = document.getElementById('output-clear');
    const outputPanel = document.querySelector('.workspace-output');
    const outputAutoHideButton = document.getElementById('output-autohide');

    if (clearButton) {
        clearButton.addEventListener('click', () => {
            domElements.outputBody.innerHTML = '';
            outputLog('OUTPUT CLEARED', 'warn');
        });
    }

    if (!outputPanel || !outputAutoHideButton) {
        return;
    }

    const setOutputAutoHide = (collapsed) => {
        outputPanel.classList.toggle('is-collapsed', collapsed);
        outputAutoHideButton.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
        outputAutoHideButton.textContent = collapsed ? '▲' : '▼';

        try {
            localStorage.setItem('websqlitebrowser.output.autoHide', collapsed ? '1' : '0');
        } catch {
            // Ignore storage write failures.
        }
    };

    let initialCollapsed = false;
    try {
        initialCollapsed = localStorage.getItem('websqlitebrowser.output.autoHide') === '1';
    } catch {
        initialCollapsed = false;
    }
    setOutputAutoHide(initialCollapsed);

    outputAutoHideButton.addEventListener('click', () => {
        const collapsed = outputPanel.classList.contains('is-collapsed');
        setOutputAutoHide(!collapsed);
    });
}
