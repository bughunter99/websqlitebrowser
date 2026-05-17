---
scope: skill/global/02
priority: 2
tags: [skill, query-pattern, global]
source_db: sample.db
---

# Skill 02 - 질의/SQL 생성 가이드

## 속성 의미
- 본 문서는 전역 SQL 생성/응답 규칙을 정의한다.

## 질문 유형
- 개요: 고객 수, 주문 수, 총 매출
- 분포: 도시별 고객 수, 상품별 매출
- 상세: 고객별 최근 주문 내역

## 쿼리 전략
- 읽기 전용 SQL만 생성한다.
- 대용량 가능성을 고려해 기본적으로 `LIMIT`을 붙인다.
- 조인 시 관계는 `customers.id = orders.customer_id`를 사용한다.

## 응답 스타일
- 먼저 핵심 결론을 한 줄로 제시하고, 필요 시 근거 SQL/집계 기준을 덧붙인다.
