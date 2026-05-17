---
scope: skill/warehouse/02
priority: 2
tags: [skill, query-pattern, warehouse]
source_db: warehouse.db
---

# Skill 02 - 질의 패턴

## 속성 의미
- warehouse 질문을 수량/추이/분포 질의로 분류한다.

## 질문 유형
- 상위 N개 항목
- 기간별 증감 추이
- 상태/카테고리별 분포

## 쿼리 전략
- 읽기 전용 SQL만 생성한다.
- 결과가 많으면 LIMIT + ORDER BY를 사용한다.
