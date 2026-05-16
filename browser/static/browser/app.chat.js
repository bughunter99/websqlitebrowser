/**
 * app.chat.js - Chat panel wiring
 */

function renderChatResponse(data) {
    const parts = [];
    parts.push(`<div class="status-box"><strong>Answer</strong><div style="margin-top: 8px; white-space: pre-wrap;">${escapeHtml(data.answer || '')}</div></div>`);

    if (data.suggested_sql) {
        parts.push(`<div class="status-box" style="margin-top: 12px;"><strong>SQL</strong><pre style="margin: 8px 0 0; white-space: pre-wrap;">${escapeHtml(data.suggested_sql)}</pre></div>`);
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
    if (!message || !state.currentDatabase) {
        return;
    }

    try {
        domElements.chatResponse.innerHTML = '';

        const databasePath = state.currentDatabase.path;
        const requestId = state.chatRequestSeq + 1;
        state.chatRequestSeq = requestId;
        state.activeChatRequestId = requestId;
        const startedAt = Date.now();

        outputLog(`CHAT START request=${requestId} db=${state.currentDatabase.name}`);
        setChatPending(true);

        const isStaleChatResponse = () => {
            return state.activeChatRequestId !== requestId
                || !state.currentDatabase
                || state.currentDatabase.path !== databasePath;
        };

        try {
            const data = /** @type {any} */ (await requestJson('/api/chat/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: databasePath,
                    message,
                }),
            }));

            if (isStaleChatResponse()) {
                outputLog(`CHAT STALE IGNORED request=${requestId} elapsed=${Date.now() - startedAt}ms`, 'warn');
                return;
            }

            domElements.chatResponse.innerHTML = renderChatResponse(data);
            if (data.query_result && !data.query_result.error) {
                attachGridInteractions(domElements.chatResponse);
            }
            chatInput.value = '';
            setStatus('Chat completed', data.suggested_sql ? 'SQL suggested' : data.database.name);
            outputLog(`CHAT OK request=${requestId} elapsed=${Date.now() - startedAt}ms ${data.database.name}`);
        } catch (error) {
            if (isStaleChatResponse()) {
                outputLog(`CHAT STALE ERROR IGNORED request=${requestId} elapsed=${Date.now() - startedAt}ms`, 'warn');
                return;
            }
            // @ts-ignore - error.message is safe to access
            setStatus('Chat failed', error?.message || String(error));
            // @ts-ignore - error.message is safe to access
            outputLog(`CHAT ERROR request=${requestId} elapsed=${Date.now() - startedAt}ms ${error?.message || String(error)}`, 'error');
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
            }
        });
    }
}
