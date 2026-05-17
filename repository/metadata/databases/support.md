---
scope: database/support
priority: 3
tags: [support, sqlite, domain]
source_db: support.db
---

# support 데이터셋 메타

## 속성 의미
- support.db는 문의/처리/상태 중심 질의를 수행하는 업무 데이터셋으로 해석한다.

## 질문 유형
- 전체 건수/처리 건수
- 기간별 처리 추이
- 상태별/유형별 분포

## 쿼리 전략
- 건수 질문은 COUNT 우선
- 추이 질문은 날짜 버킷 GROUP BY
- 분포 질문은 상태/유형 기준 GROUP BY

## 주의사항
- 상태 코드 의미가 문서에 없으면 단정하지 않고 기준 컬럼을 함께 제시한다.
