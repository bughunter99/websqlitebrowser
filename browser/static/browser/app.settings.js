// @ts-nocheck
/**
 * app.settings.js - Settings panel wiring
 */

const CUSTOM_HTTP_EXAMPLE = {
    requestUrl: 'http://intranet-llm.local:8000/v1/chat/completions',
    requestHeaders: JSON.stringify({
        'Content-Type': 'application/json',
        'Authorization': 'Bearer sk-your-private-token',
        'Send-System-Name': 'planground',
    }, null, 2),
    requestJson: JSON.stringify({
        model: 'gpt-4.1-mini',
        messages: [
            { role: 'system', content: '{{system_prompt}}' },
            { role: 'user', content: '{{user_prompt}}' },
        ],
        temperature: 0.2,
    }, null, 2),
    requestTimeout: '30',
};

const GENERIC_CUSTOM_EXAMPLE = {
    requestUrl: 'http://intranet-llm.local:8080/api/chat',
    requestHeaders: JSON.stringify({
        'Content-Type': 'application/json',
        'X-API-Key': 'replace-with-your-key',
    }, null, 2),
    requestJson: JSON.stringify({
        prompt: '{{user_prompt}}',
        context: '{{context_json}}',
        system: '{{system_prompt}}',
    }, null, 2),
    requestTimeout: '45',
};

function applyTemplate(template) {
    const urlEl = /** @type {HTMLInputElement | null} */ (document.getElementById('request-url'));
    const headersEl = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('request-headers'));
    const jsonEl = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('request-json'));
    const timeoutEl = /** @type {HTMLInputElement | null} */ (document.getElementById('request-timeout'));
    if (!urlEl || !headersEl || !jsonEl || !timeoutEl) {
        return;
    }
    urlEl.value = template.requestUrl;
    headersEl.value = template.requestHeaders;
    jsonEl.value = template.requestJson;
    timeoutEl.value = template.requestTimeout;
}

function applyOpenAiCompatExamplesIfEmpty() {
    const urlEl = /** @type {HTMLInputElement | null} */ (document.getElementById('request-url'));
    const headersEl = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('request-headers'));
    const jsonEl = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('request-json'));
    const timeoutEl = /** @type {HTMLInputElement | null} */ (document.getElementById('request-timeout'));
    if (!urlEl || !headersEl || !jsonEl || !timeoutEl) {
        return false;
    }

    let changed = false;
    if (!String(urlEl.value || '').trim()) {
        urlEl.value = CUSTOM_HTTP_EXAMPLE.requestUrl;
        changed = true;
    }
    if (!String(headersEl.value || '').trim()) {
        headersEl.value = CUSTOM_HTTP_EXAMPLE.requestHeaders;
        changed = true;
    }
    if (!String(jsonEl.value || '').trim()) {
        jsonEl.value = CUSTOM_HTTP_EXAMPLE.requestJson;
        changed = true;
    }
    if (!String(timeoutEl.value || '').trim()) {
        timeoutEl.value = CUSTOM_HTTP_EXAMPLE.requestTimeout;
        changed = true;
    }

    return changed;
}

async function loadSettings() {
    try {
        const data = await requestJson('/api/settings/');
        document.getElementById('request-url').value = data.settings.request_url || '';
        document.getElementById('request-headers').value = data.settings.request_headers || '';
        document.getElementById('request-json').value = data.settings.request_json || '';
        document.getElementById('request-timeout').value = data.settings.request_timeout || '30';
        const filledWithExamples = applyOpenAiCompatExamplesIfEmpty();
        document.getElementById('settings-status').textContent = filledWithExamples
            ? '설정을 불러왔습니다. 비어 있는 항목에는 HTTP 요청 예시를 채웠습니다.'
            : '서버 설정을 불러왔습니다.';
    } catch (error) {
        document.getElementById('settings-status').textContent = error.message;
    }
}

async function testSettingsConnection() {
    const status = document.getElementById('settings-status');
    status.className = 'status-box';
    status.textContent = '연결을 테스트하는 중...';

    try {
        const payload = {
            request_url: document.getElementById('request-url').value,
            request_headers: document.getElementById('request-headers').value,
            request_json: document.getElementById('request-json').value,
            request_timeout: document.getElementById('request-timeout').value,
        };
        outputLog(`SETTINGS TEST REQUEST request_url=${payload.request_url || '(empty)'} request_timeout=${payload.request_timeout || '(empty)'} request_headers=${payload.request_headers ? '[set]' : '[empty]'} request_json=${payload.request_json ? '[set]' : '[empty]'}`);
        outputLog(`SETTINGS TEST HEADERS ${payload.request_headers || '(empty)'}`);
        const payloadPreview = String(payload.request_json || '').replace(/\s+/g, ' ').trim().slice(0, 220);
        outputLog(`SETTINGS TEST RAW request_json_preview=${payloadPreview || '(empty)'}`);
        const data = await requestJson('/api/settings/test/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        console.log('[LLM TEST RESPONSE OBJECT]', data);
        if (data?.llm_debug?.response) {
            console.log('[LLM TEST RESPONSE RAW]', data.llm_debug.response);
        }
        if (data.llm_debug?.request) {
            outputLog(`LLM TEST OUT ${data.llm_debug.request}`);
        }
        if (data.llm_debug?.response) {
            outputLog(`LLM TEST IN ${data.llm_debug.response}`);
        }
        if (data.llm_debug?.summary) {
            outputLog(`LLM TEST SUMMARY ${data.llm_debug.summary}`);
        }
        outputLog(`SETTINGS TEST RESPONSE ok=true provider=${data.provider || 'custom-http'}`);
        status.textContent = `연결 성공: ${data.provider || 'custom-http'}`;
    } catch (error) {
        status.className = 'status-box error';
        status.textContent = error.message;
        outputLog(`SETTINGS TEST ERROR ${error?.message || String(error)}`, 'error');
    }
}

function wireSettingsPanel() {
    const saveButton = document.getElementById('save-settings');
    const testButton = document.getElementById('test-settings');
    const fillOpenAiTemplateButton = document.getElementById('fill-template-openai');
    const fillCustomTemplateButton = document.getElementById('fill-template-custom');
    if (!saveButton) {
        return;
    }

    if (fillOpenAiTemplateButton) {
        fillOpenAiTemplateButton.addEventListener('click', () => {
            applyTemplate(CUSTOM_HTTP_EXAMPLE);
            const status = document.getElementById('settings-status');
            if (status) {
                status.className = 'status-box';
                status.textContent = 'OpenAI 호환 요청 예시를 채웠습니다.';
            }
        });
    }

    if (fillCustomTemplateButton) {
        fillCustomTemplateButton.addEventListener('click', () => {
            applyTemplate(GENERIC_CUSTOM_EXAMPLE);
            const status = document.getElementById('settings-status');
            if (status) {
                status.className = 'status-box';
                status.textContent = '커스텀 HTTP 요청 예시를 채웠습니다.';
            }
        });
    }

    saveButton.addEventListener('click', async () => {
        const status = document.getElementById('settings-status');
        status.className = 'status-box';
        status.textContent = '저장 중...';

        try {
            await requestJson('/api/settings/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    request_url: /** @type {HTMLInputElement} */ (document.getElementById('request-url')).value,
                    request_headers: /** @type {HTMLTextAreaElement} */ (document.getElementById('request-headers')).value,
                    request_json: /** @type {HTMLTextAreaElement} */ (document.getElementById('request-json')).value,
                    request_timeout: /** @type {HTMLInputElement} */ (document.getElementById('request-timeout')).value,
                }),
            });
            status.textContent = '서버에 설정을 저장했습니다.';
        } catch (error) {
            status.className = 'status-box error';
            status.textContent = error.message;
        }
    });

    if (testButton) {
        testButton.addEventListener('click', testSettingsConnection);
    }
}
