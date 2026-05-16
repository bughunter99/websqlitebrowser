# Typecheck Scope (Incremental)

현재는 checkJs를 점진 도입하기 위해 아래 파일만 타입체크 대상으로 포함합니다.

- browser/static/browser/app.api.js
- browser/static/browser/app.query.js
- browser/static/browser/app.state.js

다음 확장 순서 권장:
1. app.db.js
2. app.explorer.js
3. app.events.js
4. app.grid.js
5. app.grid-interactions.js

원칙:
- 매 단계마다 `npm run typecheck` 0 오류 유지
- 함수 경계(API 응답, DOM 접근)부터 JSDoc 계약 추가
- 전역 의존성 축소와 동시에 범위 확장
