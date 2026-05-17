/**
 * app.chat.js - Chat panel wiring
 */

let activeChatAbortController = null;

const CHAT_SEND_ICON_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M2 2l12 6-12 6 2-6-2-6z" fill="currentColor"></path></svg>';
const CHAT_STOP_ICON_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><rect x="3" y="3" width="10" height="10" rx="1.2" ry="1.2" fill="currentColor"></rect></svg>';
const CHAT_LIKE_ICON_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M6 6.5 8 2.5c.2-.5.8-.8 1.3-.6.5.2.8.8.6 1.3L9.4 5H13c.6 0 1 .4 1 1 0 .1 0 .3-.1.4l-1.6 5c-.1.4-.5.6-.9.6H6V6.5zM2 6h3v6H2z" fill="currentColor"></path></svg>';
const CHAT_DISLIKE_ICON_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M10 9.5 8 13.5c-.2.5-.8.8-1.3.6-.5-.2-.8-.8-.6-1.3L6.6 11H3c-.6 0-1-.4-1-1 0-.1 0-.3.1-.4l1.6-5c.1-.4.5-.6.9-.6H10v5.5zM14 10h-3V4h3z" fill="currentColor"></path></svg>';
const CHAT_COPY_ICON_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M5 2h7c.6 0 1 .4 1 1v8h-1V3H5zM3 5h7c.6 0 1 .4 1 1v7c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1V6c0-.6.4-1 1-1z" fill="currentColor"></path></svg>';
const CHAT_RETRY_ICON_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M8 2a6 6 0 1 1-5.2 3H1l2.5-2.5L6 5H4A4.5 4.5 0 1 0 8 3.5V2z" fill="currentColor"></path></svg>';

function renderChatResponse(data) {
    const parts = [];
    const contextSummary = data.context_summary || null;
    const clarificationOptions = Array.isArray(data.clarification_options)
        ? data.clarification_options
            .filter((item) => item && typeof item === 'object')
            .map((item) => ({
                label: String(item.label || '').trim(),
                prompt: String(item.prompt || '').trim(),
            }))
            .filter((item) => item.label && item.prompt)
        : [];
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
                const alias = escapeHtml(String(db.alias || ''));
                const aliasText = alias ? ` [alias: ${alias}]` : '';
                const slot = escapeHtml(String(db.folder_slot || ''));
                const slotText = slot ? ` [${slot}]` : '';
                return `<li>${name}${slotText}${aliasText} (tables: ${tableCount})${path ? ` - ${path}` : ''}</li>`;
            }).join('')
            : '';

        const sourceRows = Array.isArray(contextSummary.metadata_sources)
            ? contextSummary.metadata_sources.map((item) => {
                const isObj = typeof item === 'object' && item !== null;
                const src = escapeHtml(String(isObj ? (item.source || '') : item));
                const reason = isObj && item.reason
                    ? `<span class="chat-meta-reason">- ${escapeHtml(String(item.reason))}</span>`
                    : '';
                const excerpt = isObj && item.excerpt
                    ? `<div class="chat-meta-excerpt">${escapeHtml(String(item.excerpt))}</div>`
                    : '';
                return `<li class="chat-meta-item">${src}${reason}${excerpt}</li>`;
            }).join('')
            : '';

        detailSections.push({
            label: 'Context',
            content:
                `<strong>Context</strong>`
                + `<div class="chat-detail-line">mode: ${escapeHtml(String(contextSummary.mode || 'unknown'))} / db: ${Number(contextSummary.database_count || 0)}</div>`
                + (dbRows ? `<div class="chat-detail-block"><div>Databases:</div><ul class="chat-detail-list">${dbRows}</ul></div>` : '')
                + (sourceRows ? `<div class="chat-detail-block"><div>Metadata Sources:</div><ul class="chat-detail-list">${sourceRows}</ul></div>` : ''),
        });
    }

    parts.push(
        `<div class="status-box chat-message chat-message-assistant">`
        + `<div class="chat-message-title">Answer</div>`
        + `<div class="chat-message-body">${escapeHtml(data.answer || '')}</div>`
        + `<div class="chat-answer-actions" data-chat-question="${escapeHtml(String(data.question || ''))}">`
        + `<button type="button" class="chat-action-btn" data-chat-action="like" title="좋아요">${CHAT_LIKE_ICON_SVG}</button>`
        + `<button type="button" class="chat-action-btn" data-chat-action="dislike" title="싫어요">${CHAT_DISLIKE_ICON_SVG}</button>`
        + `<button type="button" class="chat-action-btn" data-chat-action="copy" title="복사">${CHAT_COPY_ICON_SVG}</button>`
        + `<button type="button" class="chat-action-btn" data-chat-action="retry" title="다시">${CHAT_RETRY_ICON_SVG}</button>`
        + `</div>`
        + `</div>`
    );

    if (clarificationOptions.length) {
        const optionButtons = clarificationOptions
            .map((item, index) => (
                `<button type="button" class="chat-choice-button" data-chat-choice-index="${index}" data-chat-choice-prompt="${escapeHtml(item.prompt)}">${escapeHtml(item.label)}</button>`
            ))
            .join('');

        parts.push(
            `<div class="status-box chat-choice-wrap">`
            + `<div class="chat-message-title">기준 선택</div>`
            + `<div class="chat-choice-timeout">자동 선택까지 <strong data-chat-choice-countdown>60s</strong> (만료 시 맨 위 기준 자동 실행)</div>`
            + `<div class="chat-detail-line">아래 기준 중 하나를 선택하면 해당 기준으로 다시 분석합니다.</div>`
            + `<div class="chat-choice-list">${optionButtons}</div>`
            + `</div>`
        );
    }

    if (data.suggested_sql) {
        detailSections.push({
            label: 'SQL',
            content: `<strong>SQL</strong><pre class="chat-sql-block">${escapeHtml(data.suggested_sql)}</pre>`,
        });
    }

    if (traceItems.length) {
        const traceRows = traceItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
        detailSections.push({
            label: 'Trace',
            content:
                `<strong>Trace</strong>`
                + `<div class="chat-detail-line">chat이 내부에서 수행한 단계</div>`
                + `<ul class="chat-detail-list">${traceRows}</ul>`,
        });
    }

    if (detailSections.length) {
        const buttons = detailSections
            .map((section, index) => `<button type="button" class="chat-detail-toggle" data-chat-detail-toggle="${index}">${escapeHtml(section.label)}</button>`)
            .join('');
        const panels = detailSections
            .map((section, index) => `<div class="status-box chat-detail-panel" data-chat-detail-panel="${index}" style="display: none;">${section.content}</div>`)
            .join('');

        parts.push(`<div class="chat-detail-wrap"><div class="button-row">${buttons}</div>${panels}</div>`);
    }

    if (data.query_result) {
        if (data.query_result.error) {
            parts.push(`<div class="status-box error chat-query-error">${escapeHtml(data.query_result.error)}</div>`);
        } else {
            parts.push(`<div class="chat-query-result">${renderTable(data.query_result.columns || [], data.query_result.rows || [])}</div>`);
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
    wrapper.className = 'status-box chat-message chat-message-user';
    wrapper.innerHTML = `<div class="chat-message-title">You</div><div class="chat-message-body">${escapeHtml(message)}</div>`;
    domElements.chatResponse.appendChild(wrapper);
}

function appendAssistantChatMessage(data) {
    const wrapper = document.createElement('div');
    wrapper.className = 'chat-assistant-wrap';
    wrapper.innerHTML = renderChatResponse(data);
    domElements.chatResponse.appendChild(wrapper);
    attachChatDetailToggles(wrapper);
    attachChatActionHandlers(wrapper);
    attachChatChoiceHandlers(wrapper);
    if (data.query_result && !data.query_result.error) {
        attachGridInteractions(wrapper);
    }
}

async function copyChatTextToClipboard(value) {
    const text = String(value || '');
    if (!text) {
        return false;
    }

    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // Fallback below.
    }

    try {
        const temp = document.createElement('textarea');
        temp.value = text;
        temp.setAttribute('readonly', 'readonly');
        temp.style.position = 'fixed';
        temp.style.left = '-9999px';
        document.body.appendChild(temp);
        temp.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(temp);
        return copied;
    } catch {
        return false;
    }
}

function attachChatActionHandlers(container) {
    const actionButtons = container.querySelectorAll('[data-chat-action]');
    if (!actionButtons.length) {
        return;
    }

    actionButtons.forEach((node) => {
        if (!(node instanceof HTMLButtonElement)) {
            return;
        }

        node.addEventListener('click', async () => {
            const action = String(node.getAttribute('data-chat-action') || '');
            const actionWrap = node.closest('.chat-answer-actions');
            const messageBody = actionWrap?.closest('.chat-message-assistant')?.querySelector('.chat-message-body');
            const question = actionWrap ? String(actionWrap.getAttribute('data-chat-question') || '').trim() : '';

            if (action === 'like' || action === 'dislike') {
                const isActive = node.classList.contains('is-active');
                if (actionWrap instanceof HTMLElement) {
                    actionWrap.querySelectorAll('[data-chat-action="like"], [data-chat-action="dislike"]').forEach((btn) => {
                        btn.classList.remove('is-active');
                    });
                }
                if (!isActive) {
                    node.classList.add('is-active');
                }
                outputLog(`CHAT FEEDBACK action=${action} active=${!isActive}`);
                return;
            }

            if (action === 'copy') {
                const text = messageBody instanceof HTMLElement ? messageBody.innerText : '';
                const copied = await copyChatTextToClipboard(text);
                outputLog(copied ? 'CHAT COPY answer copied' : 'CHAT COPY failed', copied ? 'info' : 'warn');
                return;
            }

            if (action === 'retry') {
                if (!question) {
                    outputLog('CHAT RETRY skipped (missing question)', 'warn');
                    return;
                }
                sendChatMessage(question);
            }
        });
    });
}

function attachChatChoiceHandlers(container) {
    const buttons = Array.from(container.querySelectorAll('[data-chat-choice-prompt]')).filter(
        (button) => button instanceof HTMLButtonElement
    );
    if (!buttons.length) {
        return;
    }

    const countdown = container.querySelector('[data-chat-choice-countdown]');
    let remainingSeconds = 60;
    let choiceResolved = false;
    let intervalId = null;

    const setButtonsDisabled = (disabled) => {
        buttons.forEach((button) => {
            button.disabled = disabled;
        });
    };

    const updateCountdown = () => {
        if (countdown instanceof HTMLElement) {
            countdown.textContent = `${remainingSeconds}s`;
        }
    };

    const stopCountdown = () => {
        if (intervalId !== null) {
            clearInterval(intervalId);
            intervalId = null;
        }
    };

    const resolveChoice = (prompt, source) => {
        if (choiceResolved || !prompt) {
            return;
        }
        choiceResolved = true;
        stopCountdown();
        setButtonsDisabled(true);
        if (source === 'timeout') {
            outputLog('CHAT CHOICE TIMEOUT auto-select first option', 'warn');
        }
        sendChatMessage(prompt);
    };

    const triggerTimeoutChoice = () => {
        if (choiceResolved || state.chatPending || !buttons.length) {
            return;
        }
        const firstButton = buttons[0];
        const prompt = String(firstButton.getAttribute('data-chat-choice-prompt') || '').trim();
        resolveChoice(prompt, 'timeout');
    };

    updateCountdown();
    intervalId = setInterval(() => {
        if (choiceResolved) {
            stopCountdown();
            return;
        }
        remainingSeconds = Math.max(0, remainingSeconds - 1);
        updateCountdown();
        if (remainingSeconds <= 0) {
            triggerTimeoutChoice();
        }
    }, 1000);

    buttons.forEach((button) => {
        if (!(button instanceof HTMLButtonElement)) {
            return;
        }

        button.addEventListener('click', () => {
            if (state.chatPending || choiceResolved) {
                return;
            }
            const prompt = String(button.getAttribute('data-chat-choice-prompt') || '').trim();
            resolveChoice(prompt, 'click');
        });
    });
}

function appendChatError(message) {
    const wrapper = document.createElement('div');
    wrapper.className = 'status-box error chat-message';
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
    const composer = document.querySelector('.chat-composer');

    if (chatInput instanceof HTMLTextAreaElement) {
        chatInput.disabled = isPending;
    }

    if (composer instanceof HTMLElement) {
        composer.classList.toggle('is-pending', isPending);
    }

    if (sendButton instanceof HTMLButtonElement) {
        sendButton.classList.toggle('is-pending', isPending);
        sendButton.innerHTML = isPending ? CHAT_STOP_ICON_SVG : CHAT_SEND_ICON_SVG;
        sendButton.title = isPending ? '중지' : '전송';
        sendButton.setAttribute('aria-label', isPending ? '중지' : '전송');
    }

    state.chatPending = isPending;
}

function cancelActiveChatRequest() {
    if (activeChatAbortController) {
        activeChatAbortController.abort();
        activeChatAbortController = null;
        outputLog('CHAT CANCEL requested by user', 'warn');
    }
}

async function sendChatMessage(forcedMessage = '') {
    const chatInput = document.getElementById('chat-input');
    if (!(chatInput instanceof HTMLTextAreaElement)) {
        return;
    }

    if (state.chatPending) {
        cancelActiveChatRequest();
        return;
    }

    const normalizedForcedMessage = typeof forcedMessage === 'string' ? forcedMessage : '';
    const message = String(normalizedForcedMessage || chatInput.value).trim();
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
        activeChatAbortController = new AbortController();

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
                signal: activeChatAbortController.signal,
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
            if (!normalizedForcedMessage) {
                chatInput.value = '';
            }
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
            // @ts-ignore - code may exist on custom error object
            if (error?.code === 'ABORTED') {
                setStatus('Chat cancelled', '요청을 중지했습니다.');
                outputLog(`CHAT CANCELLED request=${requestId} elapsed=${Date.now() - startedAt}ms`, 'warn');
                appendChatError('요청을 중지했습니다.');
                scrollChatToBottom();
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
            activeChatAbortController = null;
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

    if (sendButton instanceof HTMLButtonElement) {
        sendButton.innerHTML = CHAT_SEND_ICON_SVG;
        sendButton.setAttribute('aria-label', '전송');
    }

    if (sendButton) {
        sendButton.addEventListener('click', () => {
            sendChatMessage('');
        });
    }

    if (chatInput instanceof HTMLTextAreaElement) {
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
