/**
 * app.tabs.js - Tab Management
 * 탭 생성/활성화 관리
 */

function ensureTab(id, title, contentHtml) {
    let tabButton = document.querySelector(`[data-tab="${id}"]`);
    let tabContent = document.getElementById(`tab-${id}`);

    if (!tabButton) {
        tabButton = document.createElement('button');
        tabButton.className = 'tab-button';
        /** @type {HTMLElement} */ (tabButton).dataset.tab = id;
        tabButton.textContent = title;
        tabButton.addEventListener('click', () => activateTab(id));
        domElements.tabs.appendChild(tabButton);
    }

    if (!tabContent) {
        tabContent = document.createElement('section');
        tabContent.id = `tab-${id}`;
        tabContent.className = 'tab-content';
        domElements.workspaceFrame.appendChild(tabContent);
    }

    if (contentHtml !== undefined) {
        tabContent.innerHTML = contentHtml;
    }
}

function activateTab(id) {
    state.activeTab = id;
    domElements.welcomeTab.classList.remove('active');

    document.querySelectorAll('.tab-button').forEach((button) => {
        const tab = /** @type {HTMLElement} */ (button);
        tab.classList.toggle('active', tab.dataset.tab === id);
    });
    document.querySelectorAll('.tab-content').forEach((content) => {
        content.classList.toggle('active', content.id === `tab-${id}`);
    });
}

