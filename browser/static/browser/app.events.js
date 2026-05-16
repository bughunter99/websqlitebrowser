        document.querySelectorAll('.nav-button').forEach((button) => {
            button.addEventListener('click', () => setPanel(button.dataset.target));
        });

        const explorerFilter = document.getElementById('explorer-filter');
        if (explorerFilter) {
            explorerFilter.addEventListener('input', (event) => {
                setExplorerFilter(event.target.value || '');
            });
        }

        domElements.explorerList.addEventListener('click', (event) => {
            const row = event.target.closest('.explorer-row');
            if (!row) {
                return;
            }
            domElements.explorerList.focus();
            selectedExplorerPath = row.dataset.path || '';
            domElements.explorerList.querySelectorAll('.explorer-row').forEach((item) => item.classList.remove('selected'));
            row.classList.add('selected');

            if (row.dataset.type === 'file' && row.dataset.isSqlite === '1') {
                openDatabase(selectedExplorerPath);
            }
        });

        domElements.explorerList.addEventListener('dblclick', (event) => {
            const row = event.target.closest('.explorer-row');
            if (!row) {
                return;
            }

            const targetPath = row.dataset.path || '';
            if (row.dataset.type === 'parent' || row.dataset.type === 'directory') {
                outputLog(`NAV ${targetPath || '..'}`);
                loadTree(targetPath);
                return;
            }
            if (row.dataset.isSqlite === '1') {
                openDatabase(targetPath);
            }
        });

        domElements.explorerList.addEventListener('keydown', (event) => {
            const handledKeys = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']);
            if (!handledKeys.has(event.key)) {
                return;
            }

            const rows = Array.from(domElements.explorerList.querySelectorAll('.explorer-row'));
            if (!rows.length) {
                return;
            }

            event.preventDefault();

            const currentIndex = rows.findIndex((row) => row.classList.contains('selected'));
            let nextIndex = currentIndex;
            const rowHeight = rows[0] ? Math.max(1, Math.round(rows[0].getBoundingClientRect().height)) : 1;
            const pageStep = Math.max(1, Math.floor(domElements.explorerList.clientHeight / rowHeight) - 1);
            if (nextIndex < 0) {
                nextIndex = 0;
            } else if (event.key === 'Home') {
                nextIndex = 0;
            } else if (event.key === 'End') {
                nextIndex = rows.length - 1;
            } else if (event.key === 'ArrowUp') {
                nextIndex = Math.max(0, nextIndex - 1);
            } else if (event.key === 'PageUp') {
                nextIndex = Math.max(0, nextIndex - pageStep);
            } else if (event.key === 'PageDown') {
                nextIndex = Math.min(rows.length - 1, nextIndex + pageStep);
            } else {
                nextIndex = Math.min(rows.length - 1, nextIndex + 1);
            }

            const nextRow = rows[nextIndex];
            if (!nextRow) {
                return;
            }

            domElements.explorerList.querySelectorAll('.explorer-row').forEach((row) => row.classList.remove('selected'));
            nextRow.classList.add('selected');
            nextRow.scrollIntoView({ block: 'nearest' });
            selectedExplorerPath = nextRow.dataset.path || '';

            if (nextRow.dataset.type === 'file' && nextRow.dataset.isSqlite === '1') {
                openDatabase(selectedExplorerPath);
            }
        });

        document.getElementById('save-settings').addEventListener('click', async () => {
            const status = document.getElementById('settings-status');
            status.className = 'status-box';
            status.textContent = '저장 중...';

            try {
                await requestJson('/api/settings/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        endpoint: document.getElementById('llm-endpoint').value,
                        token: document.getElementById('llm-token').value,
                        model: document.getElementById('llm-model').value,
                    }),
                });
                status.textContent = '서버에 설정을 저장했습니다.';
            } catch (error) {
                status.className = 'status-box error';
                status.textContent = error.message;
            }
        });

        async function sendChatMessage() {
            const chatInput = document.getElementById('chat-input');
            const message = chatInput.value.trim();
            domElements.chatResponse.innerHTML = '';

            if (!message) {
                return;
            }

            if (!state.currentDatabase) {
                return;
            }

            try {
                const data = await requestJson('/api/chat/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        path: state.currentDatabase.path,
                        message,
                    }),
                });

                domElements.chatResponse.innerHTML = renderChatResponse(data);
                if (data.query_result && !data.query_result.error) {
                    attachGridInteractions(domElements.chatResponse);
                }
                chatInput.value = '';
                setStatus('Chat completed', data.suggested_sql ? 'SQL suggested' : data.database.name);
                outputLog(`CHAT OK ${data.database.name}`);
            } catch (error) {
                setStatus('Chat failed', error.message);
                outputLog(`CHAT ERROR ${error.message}`, 'error');
            }
        }

        document.getElementById('chat-send').addEventListener('click', sendChatMessage);
        document.getElementById('chat-input').addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                sendChatMessage();
            }
        });

        domElements.railButtons.forEach((button) => {
            button.addEventListener('click', () => setPanel(button.dataset.target));
        });

        document.getElementById('output-clear').addEventListener('click', () => {
            domElements.outputBody.innerHTML = '';
            outputLog('OUTPUT CLEARED', 'warn');
        });

        const outputPanel = document.querySelector('.workspace-output');
        const outputAutoHideButton = document.getElementById('output-autohide');

        function setOutputAutoHide(collapsed) {
            if (!outputPanel || !outputAutoHideButton) {
                return;
            }

            outputPanel.classList.toggle('is-collapsed', collapsed);
            outputAutoHideButton.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
            outputAutoHideButton.textContent = collapsed ? '▲' : '▼';

            try {
                localStorage.setItem('websqlitebrowser.output.autoHide', collapsed ? '1' : '0');
            } catch {
                // Ignore storage write failures.
            }
        }

        if (outputPanel && outputAutoHideButton) {
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

        const appShell = document.querySelector('.app-shell');
        const sidebarResizer = document.getElementById('sidebar-resizer');
        const SIDEBAR_WIDTH_STORAGE_KEY = 'websqlitebrowser.sidebar.width';
        if (appShell && sidebarResizer) {
            let dragging = false;
            let startX = 0;
            let startWidth = 0;
            const resizerWidth = 8;
            const minSidebar = 240;
            const minMain = 420;

            const applySidebarWidth = (widthPx) => {
                if (window.matchMedia('(max-width: 960px)').matches) {
                    appShell.style.gridTemplateColumns = '';
                    return;
                }

                const rect = appShell.getBoundingClientRect();
                const maxSidebar = Math.max(minSidebar, rect.width - resizerWidth - minMain);
                const safeWidth = Math.max(minSidebar, Math.min(maxSidebar, widthPx));
                appShell.style.gridTemplateColumns = `${safeWidth}px ${resizerWidth}px minmax(0, 1fr)`;
            };

            try {
                const storedWidth = Number(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY) || 0);
                if (storedWidth > 0) {
                    applySidebarWidth(storedWidth);
                }
            } catch {
                // Ignore storage read failures.
            }

            const stopDragging = () => {
                if (!dragging) {
                    return;
                }
                dragging = false;
                sidebarResizer.classList.remove('is-dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            };

            sidebarResizer.addEventListener('pointerdown', (event) => {
                if (event.button !== 0) {
                    return;
                }
                event.preventDefault();
                dragging = true;
                startX = event.clientX;
                startWidth = document.querySelector('.sidebar')?.getBoundingClientRect().width || minSidebar;
                sidebarResizer.classList.add('is-dragging');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
                sidebarResizer.setPointerCapture(event.pointerId);
            });

            window.addEventListener('pointermove', (event) => {
                if (!dragging) {
                    return;
                }
                const nextWidth = startWidth + (event.clientX - startX);
                applySidebarWidth(nextWidth);
                try {
                    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(nextWidth)));
                } catch {
                    // Ignore storage write failures.
                }
            });

            window.addEventListener('pointerup', stopDragging);
            window.addEventListener('pointercancel', stopDragging);
            window.addEventListener('resize', () => {
                if (window.matchMedia('(max-width: 960px)').matches) {
                    appShell.style.gridTemplateColumns = '';
                    return;
                }
                const sidebar = document.querySelector('.sidebar');
                const width = sidebar ? sidebar.getBoundingClientRect().width : minSidebar;
                applySidebarWidth(width);
            });
        }

        if (workspaceReload) {
            workspaceReload.addEventListener('click', () => {
                outputLog('NAV reload');
                loadTree(state.currentPath);
            });
        }

        function isEditableCopyContext(target) {
            const element = target instanceof Element ? target : document.activeElement;
            if (!element) {
                return false;
            }

            const editable = element.closest('textarea, input, [contenteditable="true"]');
            if (!editable) {
                return false;
            }

            if (editable.matches('textarea, input')) {
                const start = Number(editable.selectionStart ?? 0);
                const end = Number(editable.selectionEnd ?? 0);
                return end > start;
            }

            const selection = window.getSelection();
            return !!(selection && String(selection).length > 0);
        }

        document.addEventListener('keydown', (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
                if (isEditableCopyContext(event.target)) {
                    return;
                }
                if (copySelectedCells()) {
                    event.preventDefault();
                    return;
                }
            }

            if (event.key === 'F9' && document.activeElement && document.activeElement.id === 'sql-editor') {
                event.preventDefault();
                runQuery();
            }
        });

        loadSettings();
        loadTree();
        outputLog('READY');
