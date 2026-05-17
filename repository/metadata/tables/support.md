---
scope: table/support
priority: 5
tags: [support, table, semantics]
source_db: support.db
---

# support 테이블 메타

## 속성 의미
- support 핵심 엔터티의 접수/처리 상태를 담는 기준 테이블로 해석한다.

## 질문 유형
- 문의 건수/처리 건수
- 기간별 접수 추이
- 상태별 분포

## 쿼리 전략
- 건수는 COUNT 우선
- 기간형은 created_at 기준 집계
- 분포형은 status GROUP BY
