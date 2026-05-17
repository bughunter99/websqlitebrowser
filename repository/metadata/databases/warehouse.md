---
scope: database/warehouse
priority: 3
tags: [warehouse, sqlite, domain]
source_db: warehouse.db
---

# warehouse 데이터셋 메타

## 속성 의미
- warehouse.db는 재고/입출고/상태 분포 질의를 수행하는 업무 데이터셋으로 해석한다.

## 질문 유형
- 재고 수량 합계/평균
- 기간별 입출고 추이
- 상태/위치별 분포

## 쿼리 전략
- 수량 질문은 SUM/AVG 우선
- 추이 질문은 날짜 버킷 GROUP BY
- 분포 질문은 상태/위치 GROUP BY + 정렬

## 주의사항
- 수량 단위(개/박스 등)가 불명확하면 답변에 가정을 명시한다.
