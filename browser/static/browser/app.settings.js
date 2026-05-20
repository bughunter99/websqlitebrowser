// @ts-nocheck
/**
 * app.settings.js - Settings panel wiring
 */

const OPENAI_COMPAT_EXAMPLE = {
    endpoint: 'http://intranet-llm.local:8000/v1/chat/completions',
    model: 'gpt-4.1-mini',
    additionalHeaders: JSON.stringify({
        'Send-System-Name': 'planground',
        'User-Type': 'AD_ID',
        'X-Tenant': 'internal',
    }, null, 2),
    additionalPayload: JSON.stringify({
        top_p: 0.9,
        max_tokens: 1024,
        response_format: { type: 'json_object' },
    }, null, 2),
};

function applyOpenAiCompatExamplesIfEmpty() {
    const endpointEl = /** @type {HTMLInputElement | null} */ (document.getElementById('llm-endpoint'));
    const modelEl = /** @type {HTMLInputElement | null} */ (document.getElementById('llm-model'));
    const headersEl = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('llm-additional-headers'));
    const payloadEl = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('llm-additional-payload'));
    if (!endpointEl || !modelEl || !headersEl || !payloadEl) {
        return false;
    }

    let changed = false;
    if (!String(endpointEl.value || '').trim()) {
        endpointEl.value = OPENAI_COMPAT_EXAMPLE.endpoint;
        changed = true;
    }
    if (!String(modelEl.value || '').trim()) {
        modelEl.value = OPENAI_COMPAT_EXAMPLE.model;
        changed = true;
    }
    if (!String(headersEl.value || '').trim()) {
        headersEl.value = OPENAI_COMPAT_EXAMPLE.additionalHeaders;
        changed = true;
    }
    if (!String(payloadEl.value || '').trim()) {
        payloadEl.value = OPENAI_COMPAT_EXAMPLE.additionalPayload;
        changed = true;
    }

    return changed;
}

async function loadSettings() {
    try {
        const data = await requestJson('/api/settings/');
        document.getElementById('llm-endpoint').value = data.settings.endpoint || '';
        document.getElementById('llm-token').value = data.settings.token || '';
        document.getElementById('llm-model').value = data.settings.model || '';
        document.getElementById('llm-additional-headers').value = data.settings.additional_headers || '';
        document.getElementById('llm-additional-payload').value = data.settings.additional_payload || '';
        document.getElementById('sqlite-folder-system').value = data.settings.system_folder || 'system';
        document.getElementById('sqlite-folder-current').value = data.settings.current_folder || 'current';
        document.getElementById('sqlite-folder-hist').value = data.settings.hist_folder || 'hist';
        const filledWithExamples = applyOpenAiCompatExamplesIfEmpty();
        document.getElementById('settings-status').textContent = filledWithExamples
            ? '서버 설정을 불러왔습니다. 비어 있는 항목에는 OpenAI 호환 예시를 채웠습니다.'
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
            endpoint: document.getElementById('llm-endpoint').value,
            token: document.getElementById('llm-token').value,
            model: document.getElementById('llm-model').value,
            additional_headers: document.getElementById('llm-additional-headers').value,
            additional_payload: document.getElementById('llm-additional-payload').value,
            system_folder: document.getElementById('sqlite-folder-system').value,
            current_folder: document.getElementById('sqlite-folder-current').value,
            hist_folder: document.getElementById('sqlite-folder-hist').value,
        };
        outputLog(`SETTINGS TEST REQUEST endpoint=${payload.endpoint || '(empty)'} model=${payload.model || '(empty)'} token=${payload.token ? '[set]' : '[empty]'} additional_headers=${payload.additional_headers ? '[set]' : '[empty]'} additional_payload=${payload.additional_payload ? '[set]' : '[empty]'}`);
        const data = await requestJson('/api/settings/test/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (data.llm_debug?.request) {
            outputLog(`LLM TEST OUT ${data.llm_debug.request}`);
        }
        if (data.llm_debug?.response) {
            outputLog(`LLM TEST IN ${data.llm_debug.response}`);
        }
        outputLog(`SETTINGS TEST RESPONSE ok=true provider=${data.provider || 'unknown'}`);
        status.textContent = `연결 성공: ${data.provider}`;
    } catch (error) {
        status.className = 'status-box error';
        status.textContent = error.message;
        outputLog(`SETTINGS TEST ERROR ${error?.message || String(error)}`, 'error');
    }
}

function wireSettingsPanel() {
    const saveButton = document.getElementById('save-settings');
    const testButton = document.getElementById('test-settings');
    if (!saveButton) {
        return;
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
                    endpoint: /** @type {HTMLInputElement} */ (document.getElementById('llm-endpoint')).value,
                    token: /** @type {HTMLInputElement} */ (document.getElementById('llm-token')).value,
                    model: /** @type {HTMLInputElement} */ (document.getElementById('llm-model')).value,
                    additional_headers: /** @type {HTMLTextAreaElement} */ (document.getElementById('llm-additional-headers')).value,
                    additional_payload: /** @type {HTMLTextAreaElement} */ (document.getElementById('llm-additional-payload')).value,
                    system_folder: /** @type {HTMLInputElement} */ (document.getElementById('sqlite-folder-system')).value,
                    current_folder: /** @type {HTMLInputElement} */ (document.getElementById('sqlite-folder-current')).value,
                    hist_folder: /** @type {HTMLInputElement} */ (document.getElementById('sqlite-folder-hist')).value,
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
