# websqlitebrowser 리팩토링 계획

## 현재 코드 구조 분석

### 파일 크기
```
app.core.js:   1,334줄 (60KB)  ⚠️ 매우 큼
app.events.js:   330줄 (16KB)  
app.css:       1,331줄 (36KB)  ⚠️ 매우 큼
─────────────────────────────
합계:          2,995줄 (112KB)
```

### 현재 문제점

#### 1. app.core.js의 책임 과다 (1,334줄)

**포함된 기능:**
- ✗ 상태 관리 (state 객체)
- ✗ DOM 요소 캐싱
- ✗ 유틸리티 함수 (포맷, 이스케이프, 로깅)
- ✗ API 통신 (requestJson)
- ✗ 파일 탐색 (renderExplorer, loadTree)
- ✗ 테이블 렌더링 (HTML 테이블, 가상화)
- ✗ 그리드 렌더링 (initGridSorting, initResultGridColumnResize)
- ✗ 그리드 상호작용 (attachGridInteractions - 매우 큼!)
- ✗ SQL 구문 하이라이팅
- ✗ 패널/탭 관리 (setPanel, ensureTab, activateTab)
- ✗ Query 분할 레이아웃 (initQuerySplit)
- ✗ 데이터베이스 열기/테이블 로드
- ✗ 쿼리 실행 (runQuery)
- ✗ DDL 렌더링
- ✗ Chat 응답 렌더링
- ✗ 설정 로드 및 테스트

**특히 큰 함수들:**
- `attachGridInteractions()`: 선택, 정렬, 컨텍스트 메뉴, 키보드 등이 모두 포함
- `renderTable()`, `renderVirtualizedTable()`: 그리드 렌더링 로직
- `runQuery()`: 쿼리 실행 및 결과 처리

#### 2. app.css의 스타일 분산 (1,331줄)

**포함된 스타일:**
- ✗ 전체 레이아웃 (.app-shell, .sidebar, .main-panel)
- ✗ 색상 정의 (:root, CSS 변수)
- ✗ 그리드/테이블 스타일 (.result-grid, .virtual-grid-*)
- ✗ 패널/탭 스타일
- ✗ 파일 탐색기 스타일
- ✗ Output 창 스타일
- ✗ Chat 패널 스타일
- ✗ 버튼, 공통 요소 스타일

#### 3. 코드 재사용성 부족
- 그리드 관련 로직이 여러 곳에 산재
- 셀 선택 로직, 클립보드 복사 등이 attachGridInteractions 내부에 깊게 중첩
- 상태 관리가 전역 변수와 WeakMap으로 분산

---

## 권장 리팩토링 계획

### Phase 1: JavaScript 모듈화 (우선 순위 높음)

#### 신규 파일 생성

```
browser/static/browser/
├── app.state.js                  [100줄] 상태 관리
├── app.utils.js                  [150줄] 유틸리티 함수
├── app.api.js                    [50줄]  API 통신
├── app.sql.js                    [80줄]  SQL 관련 (구문 하이라이팅)
├── app.grid.js                   [300줄] 그리드 렌더링
├── app.grid-interactions.js       [350줄] 그리드 상호작용 (✨ 큰 개선)
├── app.explorer.js               [150줄] 파일 탐색
├── app.panel.js                  [100줄] 패널/탭 관리
├── app.query.js                  [200줄] 쿼리/테이블 로드
├── app.settings.js               [50줄]  설정 관리
└── app.core.js                   [100줄] → 초기화 및 이벤트 위임만
```

#### 1-1. **app.state.js** (상태 관리)
**현재 app.core.js에서 추출:**
```javascript
// 상태 객체 정의
const state = { ... }

// 상태 초기화 함수
function initializeState()

// 상태 업데이트 헬퍼
function updateActiveCell(row, col)
function updateSelectedCells(...)
function addSelectedCell(row, col)
function clearSelection()
```

**이점:**
- 상태 관리 로직 중앙화
- 다른 모듈에서 쉽게 접근 가능

---

#### 1-2. **app.utils.js** (유틸리티)
**현재 app.core.js에서 추출:**
```javascript
function formatDateTime(value)
function escapeHtml(value)
function escapeRegExp(value)
function copyTextToClipboard(text)
function highlightExplorerName(text, query)
function outputLog(message, level)
function setStatus(leftText, rightText)
function hideGridContextMenu()
```

**이점:**
- 순수 함수로 테스트 용이
- 다른 모듈에서 재사용

---

#### 1-3. **app.api.js** (API 통신)
**현재 app.core.js에서 추출:**
```javascript
async function requestJson(url, options)

// API 래퍼
async function fetchFileTree(path)
async function fetchDatabase(path)
async function fetchQuery(path, sql)
async function fetchChat(path, message)
async function fetchSettings()
async function postSettings(config)
```

**이점:**
- API 레이어 명확화
- 엔드포인트 중앙 관리

---

#### 1-4. **app.sql.js** (SQL 구문 하이라이팅)
**현재 app.core.js에서 추출:**
```javascript
const SQL_KEYWORD_PATTERN = ...

function renderSqlHighlight(textarea, highlight)
function initSqlHighlight()
```

**이점:**
- SQL 관련 로직 분리
- 향후 에디터 기능 확장 용이

---

#### 1-5. **app.grid.js** (그리드 렌더링) ✨ 중요
**현재 app.core.js에서 추출:**
```javascript
function sortRowsByColumn(rows, columns, sortState)
function getInitialColumnWidthByHeader(headerText)
function renderTable(columns, rows, sortState)
function renderVirtualizedTable(target, columns, rows, sortState)
function renderResultContent(target, columns, rows)
function initGridSorting(target)
function initResultGridColumnResize(container)
```

**이점:**
- 그리드 렌더링 로직 중앙화
- 렌더링과 상호작용 분리
- 재사용성 향상

**예상 크기:** ~300줄

---

#### 1-6. **app.grid-interactions.js** (그리드 상호작용) ✨ 큰 개선!
**현재 app.core.js의 attachGridInteractions()를 분해:**

```javascript
// 기본 셀 조작
function initCellSelection(grid)      // 클릭, Shift+클릭, Ctrl+클릭 처리
function initCellKeyboard(grid)       // 화살표, Home, End 등
function initCellHoverAndActive(grid) // 활성화, hover 표시

// 컨텍스트 메뉴
function initGridContextMenu(grid)
function showGridContextMenu(event, cell)
function handleContextMenuAction(action, cell)

// 대량 작업
function bringActiveCellIntoView(container)
function copySelectedCells()
function selectEntireRow(row)

// 래퍼 함수
function attachGridInteractions(container)  // 위 함수들을 조합
```

**이점:**
- 매우 큰 함수를 작은 책임으로 분할
- 각 기능을 독립적으로 테스트 가능
- 유지보수성 크게 향상

**예상 크기:** ~350줄 (attachGridInteractions 현재 ~200줄)

---

#### 1-7. **app.explorer.js** (파일 탐색)
**현재 app.core.js에서 추출:**
```javascript
function renderExplorer(treeData)
function setExplorerFilter(value)
async function loadTree(path)
function getSelectedExplorerRow()
```

**이점:**
- Data Explorer 로직 격리
- 파일 탐색 기능 확장 용이

---

#### 1-8. **app.panel.js** (패널/탭 관리)
**현재 app.core.js에서 추출:**
```javascript
function setPanel(target)         // Data Explorer/Chat/Settings 전환
function ensureTab(id, title, contentHtml)
function activateTab(id)
function initQuerySplit()         // Query 에디터/결과 분할
```

**이점:**
- 패널 관리 로직 중앙화
- 탭 시스템 명확화

---

#### 1-9. **app.query.js** (쿼리/테이블 로드)
**현재 app.core.js에서 추출:**
```javascript
async function openDatabase(path)
async function loadTable(tableName, tabId)
async function runQuery()

// 렌더링 함수들
function renderMultiQueryResults(target, results)
function renderMetaTable(headers, rows)
function renderDdlContent(tables)
function renderChatResponse(data)
```

**이점:**
- DB 작업 흐름 명확화
- 쿼리 실행 로직 분리

---

#### 1-10. **app.settings.js** (설정)
**현재 app.core.js에서 추출:**
```javascript
async function loadSettings()
async function testSettingsConnection()
```

**이점:**
- 설정 관리 중앙화

---

#### 1-11. **app.events.js** (유지, 약간 정리)
**현재 내용:**
- 초기 이벤트 리스너 등록
- Chat 입력, Settings 저장 등 이벤트 처리

**정리:**
- Chat 메시지 전송 로직을 app.api.js로 이동 가능
- 나머지는 유지

---

#### 1-12. **app.core.js** (대폭 축소)
**현재: 1,334줄 → 예상: 100줄 정도**

```javascript
// 최소한의 초기화 코드만
// app.state.js 로드
// app.utils.js 로드
// 기타 모듈 로드

// 전역 초기화
function initialize() {
    initializeState();
    loadSettings();
    loadTree();
    initSqlHighlight();
    outputLog('READY');
}

// DOM 준비 시 initialize() 호출
document.addEventListener('DOMContentLoaded', initialize);
```

---

### Phase 2: CSS 모듈화 (우선 순위 중간)

#### 신규 파일 생성
```
browser/static/browser/
├── app-colors.css        [50줄]   색상 팔레트 (:root)
├── app-layout.css        [150줄]  전체 레이아웃
├── app-common.css        [100줄]  공통 요소 (버튼, 상태박스)
├── app-grid.css          [300줄]  그리드/테이블 스타일
├── app-panels.css        [200줄]  패널/탭/Query 에디터
├── app-explorer.css      [150줄]  파일 탐색기
├── app-output.css        [100줄]  Output 창
├── app-chat.css          [100줄]  Chat 패널
└── app.css               [50줄]   → 모든 파일 import (또는 삭제)
```

#### 로드 순서 (index.html)
```html
<link rel="stylesheet" href="app-colors.css">    <!-- 색상 변수 먼저 -->
<link rel="stylesheet" href="app-layout.css">
<link rel="stylesheet" href="app-common.css">
<link rel="stylesheet" href="app-grid.css">
<link rel="stylesheet" href="app-panels.css">
<link rel="stylesheet" href="app-explorer.css">
<link rel="stylesheet" href="app-output.css">
<link rel="stylesheet" href="app-chat.css">
```

**이점:**
- 스타일 찾기 용이
- CSS 유지보수 간소화
- 특정 패널만 로드 가능 (향후 번들링)

---

## 구현 로드맵

### Step 1: 기초 모듈 분리 (1-2주)
1. app.state.js 생성
2. app.utils.js 생성
3. app.api.js 생성
4. app.core.js에서 위 모듈 로드

### Step 2: 그리드 모듈 분리 (2-3주) ⭐ 우선순위 높음
1. app.grid.js 생성 (렌더링)
2. app.grid-interactions.js 생성 (상호작용) - 가장 복잡
3. attachGridInteractions() 함수를 작은 함수들로 분해

### Step 3: 기능별 모듈 분리 (1-2주)
1. app.explorer.js 생성
2. app.panel.js 생성
3. app.query.js 생성
4. app.settings.js 생성

### Step 4: CSS 분리 (1주)
1. CSS 파일 8개 생성
2. index.html 수정
3. 캐시 버전 업데이트

### Step 5: 통합 테스트 (1주)
1. 기능별 테스트
2. 브라우저 호환성 확인
3. 성능 측정 (로드 시간)

---

## 예상 효과

### 코드 품질
| 항목 | 현재 | 개선 후 |
|------|------|--------|
| 최대 파일 크기 | 1,334줄 | 350줄 이하 |
| 함수당 평균 줄 수 | ~80줄 | ~30줄 |
| 모듈 결합도 | 높음 | 낮음 |
| 단일 책임 원칙 | ✗ | ✓ |

### 유지보수성
- **버그 추적**: 책임이 명확하면 수정 위치 파악 용이
- **기능 추가**: 관련 모듈에만 수정하면 됨
- **테스트**: 작은 모듈은 단위 테스트 용이
- **팀 협업**: 파일별로 분담 가능

### 성능
- **로드 시간**: 약간 증가 (네트워크 요청 수 증가)
  → 번들러 사용 시 다시 최소화 가능
- **런타임**: 변화 없음 (로직 변경 없음)

---

## 현재 권장사항

### 지금 바로 시작할 수 있는 작업

1. **app.state.js** 분리 (쉬움)
   ```javascript
   // 기존 state 객체와 상태 관련 함수 모두 이동
   const state = { ... }
   function updateActiveCell(row, col) { ... }
   ```

2. **app.utils.js** 분리 (쉬움)
   ```javascript
   // 순수 함수들만 이동
   function formatDateTime(value) { ... }
   function escapeHtml(value) { ... }
   // ...
   ```

3. **app.grid-interactions.js** 분리 (어려움, 이득 큼)
   ```javascript
   // attachGridInteractions()를 작은 함수들로 분해
   function initCellSelection(grid) { ... }
   function initCellKeyboard(grid) { ... }
   function initContextMenu(grid) { ... }
   // ...
   ```

### 단계별 체크리스트

- [ ] app.state.js 생성 및 테스트
- [ ] app.utils.js 생성 및 테스트
- [ ] app.api.js 생성 및 테스트
- [ ] app.sql.js 생성 및 테스트
- [ ] app.grid.js 생성 및 테스트
- [ ] app.grid-interactions.js 생성 및 테스트 (⭐ 가장 중요)
- [ ] 나머지 모듈 생성
- [ ] CSS 분리 (선택)
- [ ] 전체 통합 테스트

---

## 주의사항

1. **변경 중 기능 보존**
   - 각 모듈 분리 후 기능이 정확히 동일한지 확인
   - 캐시 버전을 자주 업데이트

2. **모듈 의존성**
   - 로드 순서 중요 (app.state → app.utils → app.api → ...)
   - 순환 의존성 주의

3. **점진적 적용**
   - 모든 모듈을 한 번에 분리하지 말 것
   - 각 단계마다 완전히 테스트

4. **성능 모니터링**
   - 네트워크 요청 수 증가 (HTTP/2에서는 무시할 수준)
   - 파일 합치기 고려 (향후 번들러 도입)

---

## 다음 단계

이 계획에 동의하면 다음 중 선택:

1. **지금 바로 시작**: app.state.js부터 분리 시작
2. **세부 계획 수립**: 각 모듈의 정확한 인터페이스 정의
3. **일부만 개선**: 현재는 유지하고 나중에 진행

어떤 방식으로 진행하기를 원하시나요?
