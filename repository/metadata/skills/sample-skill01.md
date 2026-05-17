---
scope: skill/sample/01
priority: 2
tags: [skill, glossary, sample]
source_db: sample.db
---

# Skill 01 - 용어/지표 사전

## 속성 의미
- 고객 수: `customers.id` 기준 고유 고객 수
- 주문 수: `orders.id` 기준 주문 행 개수
- 매출: `orders.amount` 합계
- 신규 고객: `customers.joined_at` 기간 필터에 포함되는 고객

## 질문 유형
- "전체 고객/주문/매출"
- "기간 내 신규 고객"

## 쿼리 전략
- 분모/분자는 동일한 필터 기준을 사용한다.
- 기간 집계는 UTC 기준인지 로컬 기준인지 명시한다.
- 고객 기준 지표는 `COUNT(DISTINCT customers.id)`를 우선한다.
