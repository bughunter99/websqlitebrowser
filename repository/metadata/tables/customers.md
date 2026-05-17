---
scope: table/customers
priority: 5
tags: [customers, customer, master]
source_db: sample.db
---

# customers 테이블 메타

## 속성 의미
- 고객 마스터 테이블이다.
- 주문(`orders`)과 `customers.id = orders.customer_id`로 연결된다.

## 컬럼 의미
- id: 고객 식별자(PK)
- name: 고객명
- city: 고객 거주 도시
- joined_at: 가입일시(문자열 날짜/시간)

## 질문 유형
- 전체 고객 수
- 도시별 고객 수
- 최근 가입 고객 목록

## 쿼리 전략
- 고객 수는 기본적으로 `COUNT(DISTINCT id)`로 본다.
- 지역별 분석은 `city` 기준으로 집계한다.
- 기간형 질문은 `joined_at` 기준 필터를 적용한다.
