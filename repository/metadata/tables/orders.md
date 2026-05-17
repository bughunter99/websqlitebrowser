---
scope: table/orders
priority: 5
tags: [orders, order, transaction]
source_db: sample.db
---

# orders 테이블 메타

## 속성 의미
- 고객 주문 트랜잭션 테이블이다.
- `customer_id`로 고객 마스터(`customers`)를 참조한다.

## 컬럼 의미
- id: 주문 식별자(PK)
- customer_id: 고객 식별자(FK -> customers.id)
- product_name: 상품명
- amount: 주문 금액(정수)
- created_at: 주문 생성일시(문자열 날짜/시간)

## 질문 유형
- 총 주문 건수/총 매출
- 고객별 주문 금액 합계
- 상품별 판매 금액 순위

## 쿼리 전략
- 매출 합계는 기본적으로 `SUM(amount)`를 사용한다.
- 고객별 주문 분석 시 `customers` 조인을 권장한다.
- 기간형 질문은 `created_at` 기준 필터를 적용한다.
