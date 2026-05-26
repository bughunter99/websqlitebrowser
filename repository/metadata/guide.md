# metadata 작성 가이드

Chat 응답 품질은 `metadata/` 아래 `.md` 파일을 얼마나 잘 작성했느냐에 달려 있습니다.  
질문을 입력하면 아래 파일들이 자동으로 LLM 컨텍스트에 주입됩니다.

---

## 파일 종류와 경로

| 파일 | 경로 | 효과 |
|------|------|------|
| **시스템 프롬프트** | `system/prompt.md` | LLM 역할·지침 전체 교체 |
| 테이블 설명 | `tables/{테이블명}.md` | ★★★ 가장 효과 큼 |
| DB 전체 설명 | `databases/{DB파일명(확장자 제외)}.md` | ★★ |
| 복잡한 쿼리·업무 규칙 | `skills/{DB명}-skill01.md` | ★★ |
| 전역 공통 규칙 | `skills/skill01.md` | ★ |

> **파일명 예시:** `sample.db` → `databases/sample.md`, `skills/sample-skill01.md`

---

## 시스템 프롬프트 커스터마이징

`repository/system/prompt.md` 파일을 만들면 LLM에게 보내는 **역할 지침(system prompt)을 완전히 교체**할 수 있습니다.  
파일이 없으면 내장 기본값을 사용합니다.

**파일 경로:** `repository/system/prompt.md`

**기본값 (참고용):**
```
You are a Korean assistant for SQLite database exploration.
Answer using only the provided schema and sample rows.
If metadata_docs are provided in context, treat them as authoritative business semantics.
Prioritize metadata sections for field meaning, question patterns, and query strategy when they are present.
If you are unsure, say so clearly.
Return exactly one JSON object with keys "answer" and "sql".
The "answer" value must be Korean plain text.
The "sql" value must be either an empty string or a read-only SQLite SQL statement.
When context.mode is "folder", use explicit database aliases from context.databases[].alias and table notation alias.table_name for cross-database joins.
Do not include markdown, code fences, or additional keys.
```

> 응답 형식(`"answer"`, `"sql"` JSON 키)은 프론트엔드가 파싱하므로 반드시 유지해야 합니다.

---

## 로드 우선순위

질문이 들어오면 다음 순서로 파일을 읽어 컨텍스트에 추가합니다.

1. `databases/{db명}.md`
2. `skills/{db명}-skill01.md` (DB 전용 스킬)
3. `skills/skill01.md` (전역 스킬)
4. `tables/{테이블명}.md` (질문에 언급된 테이블 우선)

---

## 빠른 시작 — 어디서부터 작성할까?

**자주 질문하는 테이블의 `tables/` 파일부터 작성하는 것이 가장 빠릅니다.**

특히 아래 내용을 적어두면 LLM이 훨씬 정확하게 SQL을 생성합니다.

- 코드값 의미: `status 01=대기, 02=완료, 03=취소`
- 날짜 포맷: `order_date는 YYYY-MM-DD 문자열`
- 금액 단위: `amount는 KRW, 소수점 없음`

---

## 템플릿 A — `tables/{테이블명}.md`

```markdown
# 테이블: orders

## 한 줄 정의
- 주문 헤더 정보. 한 행 = 주문 1건.

## 컬럼 의미
- id: 주문 PK
- customer_id: customers.id 외래키
- status: 주문 상태 코드 (01=대기, 02=완료, 03=취소)
- amount: 주문 금액(KRW, 소수점 없음)
- order_date: 주문일 (YYYY-MM-DD 문자열)

## 질문 유형
- "이번 달 주문 건수", "완료된 주문 금액 합계"
- "고객별 주문 횟수", "최근 7일 주문"

## 쿼리 전략
- 건수: COUNT(*) 또는 COUNT(DISTINCT id)
- 금액 합계: SUM(amount)
- 기간 필터: order_date BETWEEN '2024-01-01' AND '2024-01-31'
- 상태 필터: WHERE status = '02'

## 주의사항
- status가 문자열 코드이므로 WHERE status = 2 (숫자)로 쓰면 안 됨
- 취소(03) 건은 매출 집계에서 제외할 것
```

---

## 템플릿 B — `databases/{DB명}.md`

```markdown
# 데이터베이스: mydb

## 용도
- 사내 판매 관리 시스템 데이터.

## 핵심 테이블
- orders: 주문 헤더
- order_items: 주문 상세(품목·수량·단가)
- customers: 고객 마스터
- products: 상품 마스터

## 공통 정책
- 금액 단위: KRW
- 날짜 포맷: YYYY-MM-DD 문자열
- 삭제 방식: is_deleted = 1 소프트 삭제 (조회 시 WHERE is_deleted = 0 필수)
```

---

## 템플릿 C — `skills/{DB명}-skill01.md`

```markdown
# mydb 스킬 01: 매출 집계 규칙

## 규칙
- "매출"은 orders.amount 합계 (취소 제외: status != '03')
- "주문 건수"는 COUNT(DISTINCT orders.id)

## 질문 유형
- "이번 달 매출", "전월 대비 매출 증감"
- "상품별 매출 순위"

## SQL 힌트
- 월별 집계: strftime('%Y-%m', order_date) GROUP BY
- 전월 비교: 동일 집계식에 기간 필터만 변경
```

---

## 작성 체크리스트

- [ ] 파일명이 규칙에 맞는가? (`tables/테이블명.md`, `databases/DB명.md`)
- [ ] 코드값(01=대기 등) 의미를 적었는가?
- [ ] 날짜·금액 단위·포맷을 명시했는가?
- [ ] 자주 받는 질문 유형을 "질문 유형" 섹션에 적었는가?
- [ ] SQL은 읽기 전용(SELECT)만 포함했는가?
- [ ] 한 파일이 너무 길지 않은가? (권장 300~1500자)
