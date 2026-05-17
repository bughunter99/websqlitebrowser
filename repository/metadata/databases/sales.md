---
scope: database/sales
priority: 3
tags: [sales, sqlite, domain]
source_db: sales.db
---

# sales 데이터셋 메타

## 속성 의미
- sales.db는 매출/건수/분포 질의를 수행하는 업무 데이터셋으로 해석한다.

## 질문 유형
- 총 매출/총 건수
- 기간별 추이(일/월)
- 상태/카테고리별 분포

## 쿼리 전략
- 총량 질문은 COUNT/SUM 우선
- 추이 질문은 동일 기간 버킷으로 GROUP BY
- 분포 질문은 상태/카테고리 기준 GROUP BY + ORDER BY DESC

## 주의사항
- 컬럼 의미가 불분명하면 추정으로 답하고, 기준 컬럼을 명시한다.
