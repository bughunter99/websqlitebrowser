// @ts-nocheck
/**
 * app.panel.js - Panel Management
 * 패널 전환 및 관리 기능
 */

/**
 * 활성 패널 설정
 */
function setPanel(target) {
    document.querySelectorAll('.panel').forEach((panel) => {
        panel.classList.toggle('active', panel.dataset.panel === target);
    });
    domElements.railButtons.forEach((button) => {
        button.classList.toggle('active', button.dataset.target === target);
    });
    domElements.panelStack.scrollTop = 0;
}

function wirePanelButtons() {
    domElements.railButtons.forEach((button) => {
        const railButton = /** @type {HTMLElement} */ (button);
        railButton.addEventListener('click', () => setPanel(railButton.dataset.target || 'explorer'));
    });
}
