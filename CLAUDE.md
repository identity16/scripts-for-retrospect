# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

회고(retrospective)를 위해 과거 데이터를 수집/가공하는 스크립트 모음입니다. AI Agent와 함께 작성된 유틸리티 스크립트들을 보관합니다.

## Running Scripts

### Fetch Slack Threads (`fetch-slack-threads.js`)

```bash
node fetch-slack-threads.js --token=xoxp-your-token --user=사용자명 --year=2025
node fetch-slack-threads.js --token=xoxp-xxx --user=사용자명 --year=2025 --concurrency=5
```

출력: `slack-threads-{username}-{year}.md`

### Fetch GitHub PRs (`fetch-github-prs.js`)

```bash
node fetch-github-prs.js --token=ghp_xxx --org=org-name --emails=email1,email2 --year=2025
```

출력: `github-prs-{org}-{year}.md`

### Fetch Linear Activity (`fetch-linear-activity.js`)

```bash
node fetch-linear-activity.js --token=lin_api_xxx --year=2025
```

출력: `linear-activity-{username}-{year}.md`

## Architecture Notes

- 스크립트들은 외부 패키지 의존성 없이 Node.js 내장 모듈만 사용합니다
- Slack 스크립트는 User OAuth Token (`xoxp-...`)이 필요합니다 (Bot Token 아님)
- 필요 Slack scope: `search:read`, `users:read`, (선택) `im:read`
- GitHub 스크립트는 Personal Access Token이 필요합니다
- 필요 GitHub scope: `read:org`, (private repo 시) `repo`
- Linear 스크립트는 Personal API Key가 필요합니다 (https://linear.app/settings/api)
