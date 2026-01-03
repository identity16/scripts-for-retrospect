# GitHub PR Activity Fetcher

특정 사용자가 GitHub Organization에서 활동한 PR을 검색하여 주간별/레포별로 정리된 Markdown 파일로 출력하는 스크립트입니다.

## 필요한 GitHub Token 권한

[GitHub Personal Access Token](https://github.com/settings/tokens)이 필요합니다.

| Scope | 용도 | 필수 |
|-------|------|:----:|
| `repo` | Private repository 접근 | ⚪ (private repo 필요시) |
| `read:org` | Organization 정보 조회 | ✅ |

### Token 생성 방법

1. [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens)
2. **Generate new token (classic)** 선택
3. 필요한 scope 선택
4. 생성된 토큰 복사

## 사용법

### 기본 사용법

```bash
node fetch-github-prs.js \
  --token=ghp_your_token \
  --org=organization \
  --emails=joon@daangn.com,dnjswns0930@gmail.com \
  --year=2025
```

### 환경변수 사용

```bash
export GITHUB_TOKEN=ghp_your_token
export GITHUB_ORG=organization
export GITHUB_EMAILS=joon@daangn.com,dnjswns0930@gmail.com
export YEAR=2025
export CONCURRENCY=3

node fetch-github-prs.js
```

### 옵션

| 옵션 | 환경변수 | 설명 | 기본값 |
|------|----------|------|--------|
| `--token=` | `GITHUB_TOKEN` | GitHub Personal Access Token | (필수) |
| `--org=` | `GITHUB_ORG` | GitHub Organization 이름 | (필수) |
| `--emails=` | `GITHUB_EMAILS` | 검색할 이메일 (쉼표 구분) | (필수) |
| `--year=` | `YEAR` | 검색 연도 | (필수) |
| `--concurrency=` | `CONCURRENCY` | 동시 요청 수 | `3` |

### 예시

```bash
# 기본 실행
node fetch-github-prs.js --token=ghp_xxx --org=organization --emails=user@example.com --year=2025

# 여러 이메일로 검색
node fetch-github-prs.js --token=ghp_xxx --org=organization --emails=work@company.com,personal@gmail.com --year=2025

# 환경변수와 혼합
GITHUB_TOKEN=ghp_xxx node fetch-github-prs.js --org=organization --emails=user@example.com --year=2025
```

## 출력

### 파일명

```
github-prs-{org}-{year}.md
```

예: `github-prs-organization-2025.md`

### 출력 형식

```markdown
# organization의 2025년 GitHub PR 활동

> 검색 이메일: joon@daangn.com, dnjswns0930@gmail.com
> 생성일: 2025. 1. 3.

---

## 요약

- **총 PR 수**: 42개
- **Merged PR**: 38개
- **활동 레포지토리**: 5개
- **활동 주차**: 24주

---

## 2025-W01 (1/1 - 1/7)

### repo-name

- **[#123](https://github.com/org/repo/pull/123)** PR 제목
  - ✅ Merged | 1월 3일 생성 | 1월 5일 병합
  - > PR 설명 첫 줄...

---
```

## 검색 방식

이 스크립트는 두 가지 방식으로 PR을 검색합니다:

1. **커밋 기반 검색**: 각 레포지토리에서 지정된 이메일로 작성된 커밋을 찾고, 해당 커밋이 속한 PR을 조회
2. **Author 기반 검색**: 발견된 GitHub username으로 Search API를 통해 추가 PR 검색

이 방식으로 동일인이 여러 이메일을 사용해 커밋한 경우도 모두 포착할 수 있습니다.

## 실행 로그

```
=== GitHub PR Activity Fetcher ===

Organization: organization
Emails: joon@daangn.com, dnjswns0930@gmail.com
Year: 2025
Concurrency: 3
[0.00s] Started

Fetching repositories for organization...
Found 15 repositories
[1.23s] Found 15 repositories

Searching commits by email in each repository...

Processed: 15/15 repos | Found 38 PRs
[45.67s] Collected 38 PRs from commits

Searching PRs by author...
Found usernames: joon-shin
[52.34s] Total 42 unique PRs found
[52.35s] Generating markdown...
[52.36s] Saved to: github-prs-organization-2025.md
[52.36s] Completed

Total time: 52.36s
```

## 에러 처리

### 재시도 로직

네트워크 오류 발생 시 최대 3회 재시도합니다:

```
⚠️  /repos/org/repo/commits [repo/email] failed (attempt 1/3): Network error
   Retrying in 2s...
```

### Rate Limit

GitHub API는 시간당 5000회 요청 제한이 있습니다. 남은 요청이 100회 미만이면 경고가 표시됩니다:

```
⚠️  Rate limit remaining: 89
```

### 일반적인 에러

| 에러 | 원인 | 해결 방법 |
|------|------|----------|
| `401 Unauthorized` | 토큰이 잘못됨 | Token 확인 |
| `403 Forbidden` | 권한 부족 또는 Rate limit | Token scope 확인 또는 잠시 대기 |
| `404 Not Found` | Organization이 없거나 접근 불가 | Organization 이름 확인 |

## 주의사항

1. **토큰 보안**: API 토큰을 코드에 하드코딩하지 마세요. 환경변수 사용을 권장합니다.
2. **Rate Limiting**: `CONCURRENCY` 값을 너무 높게 설정하면 Rate limit에 걸릴 수 있습니다. 기본값 `3`을 권장합니다.
3. **Private Repo**: Private repository에 접근하려면 `repo` scope가 필요합니다.
4. **실행 시간**: 레포지토리 수와 커밋 수에 따라 실행 시간이 길어질 수 있습니다.
