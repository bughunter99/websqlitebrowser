        // SQL, API, Grid, Panel, Explorer 모듈은 각각의 .js 파일에서 로드됨

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


        // Query/DB/Tabs 모듈은 app.query.js, app.db.js, app.tabs.js에서 로드됨

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
                const data = await requestJson('/api/settings/test/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                status.textContent = `연결 성공: ${data.provider}`;
            } catch (error) {
                status.className = 'status-box error';
                status.textContent = error.message;
            }
        }
