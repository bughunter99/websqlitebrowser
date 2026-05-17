---
scope: skill/sales/01
priority: 2
tags: [skill, glossary, sales]
source_db: sales.db
---

# Skill 01 - 용어/지표 사전

## 속성 의미
- 핵심 지표의 의미를 sales.db 기준으로 통일한다.

## 질문 유형
- "총 매출/총 건수"
- "기간 내 증가/감소"

## 쿼리 전략
- 수치 질문은 COUNT/SUM을 우선 사용한다.
- 기간형 질문은 동일 기간 버킷으로 집계한다.
