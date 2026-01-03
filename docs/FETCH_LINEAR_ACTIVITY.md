# Linear Activity Fetcher

Linear에서 사용자의 활동을 검색하여 주간별로 정리된 Markdown 파일로 출력하는 스크립트입니다.

## 수집 항목

| 항목 | 설명 |
|------|------|
| 생성한 이슈 | 내가 생성한 이슈 목록 |
| 완료한 이슈 | 내가 담당자이고 완료된 이슈 |
| 작성한 댓글 | 이슈에 남긴 댓글 |

## Linear API Key 발급

1. [Linear Settings > API](https://linear.app/settings/api) 접속
2. **Personal API keys** 섹션에서 **Create key** 클릭
3. 이름 입력 후 생성
4. 생성된 키 복사 (`lin_api_...` 형태)

## 사용법

### 기본 사용법

```bash
node fetch-linear-activity.js \
  --token=lin_api_your_token \
  --year=2025
```

### 환경변수 사용

```bash
export LINEAR_TOKEN=lin_api_your_token
export YEAR=2025

node fetch-linear-activity.js
```

### 옵션

| 옵션 | 환경변수 | 설명 | 기본값 |
|------|----------|------|--------|
| `--token=` | `LINEAR_TOKEN` | Linear API Key | (필수) |
| `--year=` | `YEAR` | 검색 연도 | (필수) |

## 출력

### 파일명

```
linear-activity-{username}-{year}.md
```

예: `linear-activity-joon-shin-2025.md`

### 출력 형식

```markdown
# Joon Shin의 2025년 Linear 활동

> 이메일: joon@example.com
> 생성일: 2025. 1. 3.

---

## 요약

- **생성한 이슈**: 45개
- **완료한 이슈**: 38개
- **작성한 댓글**: 120개
- **활동 팀**: Frontend, Backend
- **활동 주차**: 24주

---

## 2025-W01 (1/1 - 1/7)

### 📝 생성한 이슈 (3)

- **[FRONT-123](https://linear.app/...)** 로그인 버그 수정
  - [FRONT] In Progress | 라벨: bug | 프로젝트: Q1 Goals

### ✅ 완료한 이슈 (2)

- **[FRONT-120](https://linear.app/...)** 회원가입 플로우 개선
  - [FRONT] 1월 5일 완료 | 프로젝트: Q1 Goals

### 💬 댓글 (5)

- **[FRONT-118](https://linear.app/...)** API 응답 시간 개선
  - 1월 4일: 테스트 결과 평균 응답 시간이 200ms에서 50ms로 개선되었습니다...

---
```

## 실행 로그

```
=== Linear Activity Fetcher ===

Year: 2025
[0.00s] Started
User: Joon Shin (joon@example.com)
[0.45s] User info fetched

Fetching created issues...
Fetched 45 created issues...
[2.34s] Fetched 45 created issues

Fetching completed issues...
Fetched 38 completed issues...
[4.12s] Fetched 38 completed issues

Fetching comments...
Fetched 120 comments...
[6.78s] Fetched 120 comments
[6.79s] Generating markdown...
[6.80s] Saved to: linear-activity-joon-shin-2025.md
[6.80s] Completed

Total time: 6.80s
```

## 에러 처리

### 재시도 로직

네트워크 오류 발생 시 최대 3회 재시도합니다.

### 일반적인 에러

| 에러 | 원인 | 해결 방법 |
|------|------|----------|
| `Authentication failed` | API Key가 잘못됨 | Key 확인 |
| `Not authorized` | 권한 부족 | API Key 권한 확인 |

## 주의사항

1. **토큰 보안**: API 토큰을 코드에 하드코딩하지 마세요. 환경변수 사용을 권장합니다.
2. **개인 API Key**: 개인 API Key는 본인의 데이터만 조회할 수 있습니다.
