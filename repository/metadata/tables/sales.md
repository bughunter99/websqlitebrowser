---
scope: table/sales
priority: 5
tags: [sales, table, semantics]
source_db: sales.db
---

# sales 테이블 메타

## 속성 의미
- sales 핵심 엔터티의 수치/상태를 담는 기준 테이블로 해석한다.

## 질문 유형
- 총 건수/총합
- 기간별 추이
- 상태별 분포

## 쿼리 전략
- count/sum 질의 우선
- 기간형은 created_at 기준 집계
- 분포형은 status GROUP BY
