---
scope: skill/warehouse/01
priority: 2
tags: [skill, glossary, warehouse]
source_db: warehouse.db
---

# Skill 01 - 용어/지표 사전

## 속성 의미
- warehouse 지표(재고/입출고/상태) 의미를 통일한다.

## 질문 유형
- "재고 합계/평균"
- "입출고 추이"

## 쿼리 전략
- 수량 질문은 SUM/AVG를 우선 사용한다.
- 추이 질문은 날짜 버킷 GROUP BY를 사용한다.
