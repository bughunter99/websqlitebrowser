---
scope: skill/sales/02
priority: 2
tags: [skill, query-pattern, sales]
source_db: sales.db
---

# Skill 02 - 질의 패턴

## 속성 의미
- sales 질문을 분석/분포/추이 패턴으로 해석한다.

## 질문 유형
- 상위 N개 항목
- 기간별 증감 추이
- 상태/카테고리별 분포

## 쿼리 전략
- 읽기 전용 SQL만 생성한다.
- 결과가 많으면 LIMIT + ORDER BY를 함께 사용한다.
