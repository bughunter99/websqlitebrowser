---
scope: table/warehouse
priority: 5
tags: [warehouse, table, semantics]
source_db: warehouse.db
---

# warehouse 테이블 메타

## 속성 의미
- warehouse 핵심 엔터티의 재고/상태를 담는 기준 테이블로 해석한다.

## 질문 유형
- 재고 수량 합계/평균
- 기간별 변동 추이
- 상태별 분포

## 쿼리 전략
- 수량 질의는 SUM/AVG 우선
- 기간형은 created_at 기준 집계
- 분포형은 status GROUP BY
