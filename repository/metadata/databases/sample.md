---
scope: database/sample
priority: 3
tags: [sample, sqlite, domain]
source_db: sample.db
---

# sample 데이터셋 메타

## 속성 의미
- sample.db는 고객(customers)과 주문(orders) 중심의 예제 데이터셋이다.
- 고객-주문 관계는 `customers.id = orders.customer_id`를 기준으로 해석한다.

## 질문 유형
- "고객이 몇 명이야?", "총 주문/매출 얼마야?"
- "도시별 고객 수", "상품별 매출 순위"
- "최근 가입/최근 주문" 같은 기간형 질문

## 쿼리 전략
- 고객 수: `COUNT(DISTINCT customers.id)`
- 주문 건수: `COUNT(*)` 또는 `COUNT(DISTINCT orders.id)`
- 매출: `SUM(orders.amount)`
- 기간 미지정 시 전체 기간 기준, 기간 지정 시 date 컬럼 문자열 포맷을 명시하고 필터 적용

## 주의사항
- `joined_at`, `created_at`은 문자열 날짜이므로 파싱 가정을 답변에 함께 표기한다.
