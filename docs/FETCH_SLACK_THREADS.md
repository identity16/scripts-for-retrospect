# Slack Thread Activity Fetcher

특정 사용자가 Slack에서 활동한 스레드를 검색하여 주간별/채널별로 정리된 Markdown 파일로 출력하는 스크립트입니다.

## 필요한 Slack 권한 (OAuth Scopes)

Slack App에서 다음 권한을 추가해야 합니다:

| Scope | 용도 | 필수 |
|-------|------|:----:|
| `search:read` | 메시지 검색 | ✅ |
| `users:read` | 사용자 정보 조회 | ✅ |
| `im:read` | DM 채널 정보 조회 (상대방 이름 표시) | ⚪ |

### 권한 설정 방법

1. [Slack API Apps](https://api.slack.com/apps)에서 앱 선택
2. **OAuth & Permissions** 메뉴로 이동
3. **Scopes** 섹션에서 위 권한 추가
4. **Install to Workspace** 버튼으로 앱 재설치
5. **User OAuth Token** (`xoxp-...`로 시작) 복사

> ⚠️ Bot Token (`xoxb-...`)이 아닌 **User OAuth Token** (`xoxp-...`)을 사용해야 합니다.

## 사용법

### 기본 사용법

```bash
node fetch-slack-threads.js \
  --token=xoxp-your-token \
  --user=Joon \
  --year=2025
```

### 환경변수 사용

```bash
export SLACK_TOKEN=xoxp-your-token
export TARGET_USER_NAME=Joon
export YEAR=2025
export CONCURRENCY=5

node fetch-slack-threads.js
```

### 옵션

| 옵션 | 환경변수 | 설명 | 기본값 |
|------|----------|------|--------|
| `--token=` | `SLACK_TOKEN` | Slack User OAuth Token | (필수) |
| `--user=` | `TARGET_USER_NAME` | 검색할 사용자 이름 | (필수) |
| `--year=` | `YEAR` | 검색 연도 | (필수) |
| `--concurrency=` | `CONCURRENCY` | 동시 요청 수 | `1` |

### 예시

```bash
# 기본 실행
node fetch-slack-threads.js --token=xoxp-xxx --user=Joon --year=2025

# 병렬 처리로 빠르게 실행
node fetch-slack-threads.js --token=xoxp-xxx --user=Joon --year=2025 --concurrency=5

# 환경변수와 혼합
SLACK_TOKEN=xoxp-xxx node fetch-slack-threads.js --user=Joon --year=2025
```

## 출력

### 파일명

```
slack-threads-{username}-{year}.md
```

예: `slack-threads-joon-2025.md`

### 출력 형식

```markdown
# Joon의 2025년 Slack 스레드 활동

> 생성일: 2025. 1. 3.

---

## 2025-W01 (1/1 - 1/7)

### [#channel-name](https://workspace.slack.com/archives/C123456)

#### 스레드 `[작성자]` ([스레드 링크](https://workspace.slack.com/archives/C123456/p1234567890))
> 스레드 원문 메시지...

- **1월 3일 오후 2:30**: 답글 내용...
- **1월 4일 오전 10:15**: 답글 내용...

---
```

## 실행 로그

```
=== Slack Thread Activity Fetcher (Optimized) ===

[0.00s] Started
Workspace: https://daangn.slack.com
[0.35s] Workspace info fetched
Finding user: Joon...
Found (exact): Joon Shin (@joon, U03QCC31CHL)
[5.27s] User found: joon

Searching messages for 2025 (concurrency: 5)...

Progress: 12/12 months | 4523 messages
Found 4523 messages
[45.23s] Grouping by threads...
[45.24s] Fetching 3 DM user names...
Fetching DM info: 3/3
[46.12s] Grouped into 892 threads (156 channels)
[46.12s] Generating markdown...
[46.15s] Saved to: slack-threads-joon-2025.md
[46.15s] Completed

Total time: 46.15s
```

## 에러 처리

### 재시도 로직

네트워크 오류 발생 시 최대 3회 재시도합니다:

```
⚠️  search.messages (page: 44) [searching 44/56] failed (attempt 1/3): Network error: read ETIMEDOUT
   Retrying in 2s...
```

### 일반적인 에러

| 에러 | 원인 | 해결 방법 |
|------|------|----------|
| `missing_scope` | 필요한 권한 없음 | Slack App에 권한 추가 후 재설치 |
| `invalid_auth` | 토큰이 잘못됨 | User OAuth Token 확인 |
| `user_not_found` | 사용자 이름 불일치 | 정확한 이름 또는 Slack username 사용 |
| `read ETIMEDOUT` | 네트워크 타임아웃 | 자동 재시도 (최대 3회) |

## 주의사항

1. **토큰 보안**: API 토큰을 코드에 하드코딩하지 마세요. 환경변수 사용을 권장합니다.
2. **Rate Limiting**: `CONCURRENCY` 값을 너무 높게 설정하면 Slack API rate limit에 걸릴 수 있습니다. 기본값 `1` 또는 `5` 이하를 권장합니다.
3. **DM 권한**: DM 상대방 이름을 표시하려면 `im:read` 권한이 필요합니다. 권한이 없으면 채널 ID가 표시됩니다.
