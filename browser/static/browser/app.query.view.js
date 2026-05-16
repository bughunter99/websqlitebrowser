/**
 * app.query.view.js - Query result rendering
 */

/**
 * @param {HTMLElement} target
 * @param {QueryResult[]} results
 */
function renderMultiQueryResults(target, results) {
    if (!Array.isArray(results) || !results.length) {
        target.className = 'status-box';
        target.textContent = '조회 결과가 없습니다.';
        return;
    }

    target.className = '';
    target.innerHTML = `
        <div class="query-multi-results">
            <div class="query-multi-panels" id="query-multi-panels"></div>
            <div class="query-multi-tabs" id="query-multi-tabs"></div>
        </div>
    `;

    const tabsHost = target.querySelector('#query-multi-tabs');
    const panelsHost = target.querySelector('#query-multi-panels');
    if (!tabsHost || !panelsHost) {
        return;
    }

    const activate = (index) => {
        tabsHost.querySelectorAll('.query-multi-tab').forEach((button) => {
            const el = /** @type {HTMLElement} */ (button);
            button.classList.toggle('active', Number(el.dataset.index) === index);
        });
        panelsHost.querySelectorAll('.query-multi-panel').forEach((panel) => {
            const el = /** @type {HTMLElement} */ (panel);
            panel.classList.toggle('active', Number(el.dataset.index) === index);
        });
    };

    results.forEach((result, idx) => {
        const index = idx + 1;
        const tab = document.createElement('button');
        tab.className = 'query-multi-tab';
        tab.dataset.index = String(index);
        tab.textContent = `result${index}`;
        tab.addEventListener('click', () => activate(index));
        tabsHost.appendChild(tab);

        const panel = document.createElement('div');
        panel.className = 'query-multi-panel';
        panel.dataset.index = String(index);
        panelsHost.appendChild(panel);

        renderResultContent(panel, result.columns || [], result.rows || []);
        attachGridInteractions(panel);
    });

    activate(1);
}
