/**
 * app.chat.js - Chat panel wiring
 */

function renderChatResponse(data) {
    const parts = [];
    const contextSummary = data.context_summary || null;
    const detailSections = [];
    const traceItems = Array.isArray(data.trace)
        ? data.trace.map((item) => String(item || '').trim()).filter(Boolean)
        : [];

    if (contextSummary) {
        const dbRows = Array.isArray(contextSummary.databases)
            ? contextSummary.databases.map((db) => {
                const name = escapeHtml(String(db.name || ''));
                const tableCount = Number(db.table_count || 0);
                const path = escapeHtml(String(db.path || ''));
                return `<li>${name} (tables: ${tableCount})${path ? ` - ${path}` : ''}</li>`;
            }).join('')
            : '';

        const sourceRows = Array.isArray(contextSummary.metadata_sources)
            ? contextSummary.metadata_sources.map((source) => `<li>${escapeHtml(String(source))}</li>`).join('')
            : '';

        detailSections.push({
            label: 'Context',
            content:
                `<strong>Context</strong>`
                + `<div style="margin-top: 8px;">mode: ${escapeHtml(String(contextSummary.mode || 'unknown'))} / db: ${Number(contextSummary.database_count || 0)}</div>`
                + (dbRows ? `<div style="margin-top: 6px;"><div>Databases:</div><ul style="margin: 4px 0 0 18px; padding: 0;">${dbRows}</ul></div>` : '')
                + (sourceRows ? `<div style="margin-top: 6px;"><div>Metadata Sources:</div><ul style="margin: 4px 0 0 18px; padding: 0;">${sourceRows}</ul></div>` : ''),
        });
    }

    parts.push(`<div class="status-box"><strong>Answer</strong><div style="margin-top: 8px; white-space: pre-wrap;">${escapeHtml(data.answer || '')}</div></div>`);

    if (data.suggested_sql) {
        detailSections.push({
            label: 'SQL',
            content: `<strong>SQL</strong><pre style="margin: 8px 0 0; white-space: pre-wrap;">${escapeHtml(data.suggested_sql)}</pre>`,
        });
    }

    if (traceItems.length) {
        const traceRows = traceItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
        detailSections.push({
            label: 'Trace',
            content:
                `<strong>Trace</strong>`
                + `<div style="margin-top: 6px;">chat이 내부에서 수행한 단계</div>`
                + `<ul style="margin: 6px 0 0 18px; padding: 0;">${traceRows}</ul>`,
        });
    }

    if (detailSections.length) {
        const buttons = detailSections
            .map((section, index) => `<button type="button" data-chat-detail-toggle="${index}" style="padding: 2px 8px; font-size: 11px;">${escapeHtml(section.label)}</button>`)
            .join('');
        const panels = detailSections
            .map((section, index) => `<div class="status-box" data-chat-detail-panel="${index}" style="margin-top: 8px; display: none;">${section.content}</div>`)
            .join('');

        parts.push(`<div style="margin-top: 8px;"><div class="button-row">${buttons}</div>${panels}</div>`);
    }

    if (data.query_result) {
        if (data.query_result.error) {
            parts.push(`<div class="status-box error" style="margin-top: 12px;">${escapeHtml(data.query_result.error)}</div>`);
        } else {
            parts.push(`<div style="margin-top: 12px;">${renderTable(data.query_result.columns || [], data.query_result.rows || [])}</div>`);
        }
    }

    return parts.join('');
}

function attachChatDetailToggles(container) {
    const toggleButtons = container.querySelectorAll('[data-chat-detail-toggle]');
    toggleButtons.forEach((button) => {
        if (!(button instanceof HTMLButtonElement)) {
            return;
        }

        button.addEventListener('click', () => {
            const panelId = button.getAttribute('data-chat-detail-toggle');
            const panel = container.querySelector(`[data-chat-detail-panel="${panelId}"]`);
            if (!(panel instanceof HTMLElement)) {
                return;
            }

            const isHidden = panel.style.display === 'none';
            panel.style.display = isHidden ? '' : 'none';
            button.classList.toggle('button-primary', isHidden);
        });
    });
}

function setInputCursorToEnd(input) {
    const length = input.value.length;
    input.setSelectionRange(length, length);
}

function appendUserChatMessage(message) {
    const wrapper = document.createElement('div');
    wrapper.className = 'status-box';
    wrapper.innerHTML = `<strong>You</strong><div style="margin-top: 8px; white-space: pre-wrap;">${escapeHtml(message)}</div>`;
    domElements.chatResponse.appendChild(wrapper);
}

function appendAssistantChatMessage(data) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderChatResponse(data);
    domElements.chatResponse.appendChild(wrapper);
    attachChatDetailToggles(wrapper);
    if (data.query_result && !data.query_result.error) {
        attachGridInteractions(wrapper);
    }
}

function appendChatError(message) {
    const wrapper = document.createElement('div');
    wrapper.className = 'status-box error';
    wrapper.textContent = message;
    domElements.chatResponse.appendChild(wrapper);
}

function scrollChatToBottom() {
    domElements.chatResponse.scrollTop = domElements.chatResponse.scrollHeight;
}

function rememberChatInput(message) {
    const history = Array.isArray(state.chatInputHistory) ? state.chatInputHistory : [];
    if (!history.length || history[history.length - 1] !== message) {
        history.push(message);
        // Keep a practical cap to avoid unbounded growth.
        if (history.length > 200) {
            history.shift();
        }
        state.chatInputHistory = history;
    }
    state.chatInputHistoryIndex = -1;
}

function moveChatInputHistory(chatInput, direction) {
    const history = Array.isArray(state.chatInputHistory) ? state.chatInputHistory : [];
    if (!history.length) {
        return;
    }

    if (direction === 'up') {
        if (state.chatInputHistoryIndex < 0) {
            state.chatInputHistoryIndex = history.length - 1;
        } else {
            state.chatInputHistoryIndex = Math.max(0, state.chatInputHistoryIndex - 1);
        }
        chatInput.value = history[state.chatInputHistoryIndex] || '';
        setInputCursorToEnd(chatInput);
        return;
    }

    if (state.chatInputHistoryIndex < 0) {
        return;
    }

    if (state.chatInputHistoryIndex >= history.length - 1) {
        state.chatInputHistoryIndex = -1;
        chatInput.value = '';
        return;
    }

    state.chatInputHistoryIndex += 1;
    chatInput.value = history[state.chatInputHistoryIndex] || '';
    setInputCursorToEnd(chatInput);
}

function setChatPending(isPending) {
    const chatInput = document.getElementById('chat-input');
    const sendButton = document.getElementById('chat-send');

    if (chatInput instanceof HTMLTextAreaElement) {
        chatInput.disabled = isPending;
    }

    if (sendButton instanceof HTMLButtonElement) {
        sendButton.disabled = isPending;
        sendButton.classList.toggle('is-pending', isPending);
        sendButton.textContent = isPending ? '…' : '▶';
    }

    state.chatPending = isPending;
}

async function sendChatMessage() {
    const chatInput = document.getElementById('chat-input');
    if (!(chatInput instanceof HTMLTextAreaElement)) {
        return;
    }

    if (state.chatPending) {
        outputLog('CHAT SKIP pending=true', 'warn');
        return;
    }

    const message = chatInput.value.trim();
    if (!message) {
        return;
    }

    const hasDatabase = !!state.currentDatabase;
    const explorerPath = state.currentPath || '';
    const hasExplorerContext = !!state.lastTreeData;
    if (!hasDatabase && !hasExplorerContext) {
        outputLog('CHAT SKIP no target database/folder', 'warn');
        return;
    }

    try {
        appendUserChatMessage(message);
        scrollChatToBottom();
        rememberChatInput(message);

        const databasePath = hasDatabase ? state.currentDatabase.path : '';
        const requestId = state.chatRequestSeq + 1;
        state.chatRequestSeq = requestId;
        state.activeChatRequestId = requestId;
        const startedAt = Date.now();

        if (hasDatabase) {
            outputLog(`CHAT START request=${requestId} db=${state.currentDatabase.name}`);
        } else {
            outputLog(`CHAT START request=${requestId} folder=${explorerPath || '/'}`);
        }
        setChatPending(true);

        const isStaleChatResponse = () => {
            if (state.activeChatRequestId !== requestId) {
                return true;
            }

            if (databasePath) {
                return !state.currentDatabase || state.currentDatabase.path !== databasePath;
            }

            return (state.currentPath || '') !== explorerPath;
        };

        try {
            const data = /** @type {any} */ (await requestJson('/api/chat/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: databasePath,
                    explorer_path: explorerPath,
                    message,
                }),
            }));

            if (isStaleChatResponse()) {
                outputLog(`CHAT STALE IGNORED request=${requestId} elapsed=${Date.now() - startedAt}ms`, 'warn');
                return;
            }

            if (data.llm_debug?.request) {
                outputLog(`LLM CHAT OUT request=${requestId} ${data.llm_debug.request}`);
            }
            if (data.llm_debug?.response) {
                outputLog(`LLM CHAT IN request=${requestId} ${data.llm_debug.response}`);
            }
            if (Array.isArray(data.trace)) {
                data.trace.forEach((item, index) => {
                    const text = String(item || '').trim();
                    if (text) {
                        outputLog(`CHAT TRACE request=${requestId} step=${index + 1} ${text}`);
                    }
                });
            }

            appendAssistantChatMessage(data);
            scrollChatToBottom();
            chatInput.value = '';
            if (data.database?.name) {
                setStatus('Chat completed', data.suggested_sql ? 'SQL suggested' : data.database.name);
                outputLog(`CHAT OK request=${requestId} elapsed=${Date.now() - startedAt}ms ${data.database.name}`);
            } else {
                const folderInfo = data.folder?.path || explorerPath || '/';
                const dbCount = Number(data.folder?.database_count || 0);
                setStatus('Chat completed', `Folder context (${dbCount} DB)`);
                outputLog(`CHAT OK request=${requestId} elapsed=${Date.now() - startedAt}ms folder=${folderInfo} db_count=${dbCount}`);
            }
        } catch (error) {
            if (isStaleChatResponse()) {
                outputLog(`CHAT STALE ERROR IGNORED request=${requestId} elapsed=${Date.now() - startedAt}ms`, 'warn');
                return;
            }
            // @ts-ignore - error.message is safe to access
            setStatus('Chat failed', error?.message || String(error));
            // @ts-ignore - error.message is safe to access
            outputLog(`CHAT ERROR request=${requestId} elapsed=${Date.now() - startedAt}ms ${error?.message || String(error)}`, 'error');
            // @ts-ignore - error.message is safe to access
            appendChatError(error?.message || String(error));
            scrollChatToBottom();
        } finally {
            setChatPending(false);
        }
    } catch (outerError) {
        setChatPending(false);
        outputLog(`CHAT UNEXPECTED ERROR ${outerError instanceof Error ? outerError.message : String(outerError)}`, 'error');
    }
}

function wireChatPanel() {
    const sendButton = document.getElementById('chat-send');
    const chatInput = document.getElementById('chat-input');

    if (sendButton) {
        sendButton.addEventListener('click', sendChatMessage);
    }

    if (chatInput) {
        chatInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                sendChatMessage();
                return;
            }

            const noModifier = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
            if (!noModifier) {
                return;
            }

            // Only use history navigation when current input is empty.
            if (event.key === 'ArrowUp' && chatInput.value.length === 0) {
                event.preventDefault();
                moveChatInputHistory(chatInput, 'up');
                return;
            }
            if (event.key === 'ArrowDown' && chatInput.value.length === 0) {
                event.preventDefault();
                moveChatInputHistory(chatInput, 'down');
            }
        });

        chatInput.addEventListener('input', () => {
            // 사용자가 직접 입력을 시작하면 히스토리 탐색 포인터를 해제한다.
            state.chatInputHistoryIndex = -1;
        });
    }
}
