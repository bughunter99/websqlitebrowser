---
scope: skill/sample/02
priority: 2
tags: [skill, query-pattern, sample]
source_db: sample.db
---

# Skill 02 - 질의 패턴

## 속성 의미
- sample.db 질문을 SQL로 변환할 때의 실무 패턴을 정의한다.

## 질문 유형
- 전체 요약: 고객 수, 주문 수, 총 매출
- 고객 분석: 도시별 고객 수, 가입 추이
- 주문 분석: 상품별 매출, 고객별 주문 금액

## 쿼리 전략
- 기본적으로 읽기 전용 SQL만 생성한다.
- 조인 필요 시 `customers.id = orders.customer_id`를 사용한다.
- 필요하면 `LIMIT`을 적용하고 정렬 기준을 명시한다.
