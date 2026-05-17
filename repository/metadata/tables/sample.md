---
scope: table/sample
priority: 3
tags: [sample, example]
source_db: sample.db
---

# sample 테이블 메타

## 속성 의미
- 기능 테스트 및 UI 데모를 위한 샘플 엔터티 테이블이다.

## 컬럼 의미
- id: 식별자(PK)
- name: 이름/레이블
- created_at: 생성일시(문자열 날짜/시간)

## 질문 유형
- 샘플 데이터 건수
- 이름/생성일 기준 조회

## 쿼리 전략
- 운영 지표 산출보다는 조회/검색 동작 확인용으로 사용한다.
