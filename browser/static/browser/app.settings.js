// @ts-nocheck
/**
 * app.settings.js - Settings panel wiring
 */

async function loadSettings() {
    try {
        const data = await requestJson('/api/settings/');
        document.getElementById('llm-endpoint').value = data.settings.endpoint || '';
        document.getElementById('llm-token').value = data.settings.token || '';
        document.getElementById('llm-model').value = data.settings.model || '';
        document.getElementById('settings-status').textContent = '서버 설정을 불러왔습니다.';
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
        };
        outputLog(`SETTINGS TEST REQUEST endpoint=${payload.endpoint || '(empty)'} model=${payload.model || '(empty)'} token=${payload.token ? '[set]' : '[empty]'}`);
        const data = await requestJson('/api/settings/test/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
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
