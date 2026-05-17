---
scope: skill/global/01
priority: 2
tags: [skill, glossary, global]
source_db: sample.db
---

# Skill 01 - 공통 용어 사전

## 속성 의미
- 고객 수: `customers.id` 기준 고유 고객 수
- 주문 수: `orders.id` 기준 행 개수
- 매출: `orders.amount` 합계
- 신규 고객: `customers.joined_at` 기간 필터에 포함되는 고객

## 질문 유형
- "고객/주문/매출이 몇이야"
- "신규 고객이 몇 명이야"

## 쿼리 전략
- 지표를 말할 때는 계산 기준(예: distinct 여부)을 함께 설명한다.
- 기간 조건이 없으면 "전체 기간" 기준임을 명시한다.
