---
scope: skill/support/01
priority: 2
tags: [skill, glossary, support]
source_db: support.db
---

# Skill 01 - 용어/지표 사전

## 속성 의미
- support 지표(건수/상태/처리율) 해석 기준을 통일한다.

## 질문 유형
- "전체 문의/처리 건수"
- "상태별 건수"

## 쿼리 전략
- 건수 질문은 COUNT를 기본으로 사용한다.
- 상태 분포는 상태 컬럼 GROUP BY를 우선한다.
