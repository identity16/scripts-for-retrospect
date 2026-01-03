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

## Script Development Guidelines

새로운 스크립트 작성 시 참고할 공통 패턴입니다.

### 기본 구조

```javascript
#!/usr/bin/env node

/**
 * Script Title
 *
 * 스크립트 설명
 *
 * 사용법:
 * node script.js --token=xxx --year=2025
 */

const https = require('https')
const fs = require('fs')
```

### CLI 인자 파싱

- 환경변수와 `--arg=value` 형식 모두 지원
- 필수 인자 누락 시 사용법 출력 후 종료

```javascript
function getArg(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`))
  return arg ? arg.split('=').slice(1).join('=') : undefined
}

const TOKEN = process.env.TOKEN || getArg('token')
```

### API 호출 패턴

- **재시도 로직**: 3회 재시도, 2초 딜레이
- **타임아웃**: 30초
- **context 파라미터**: 에러 로깅 시 어떤 호출인지 명확히 표시

```javascript
const MAX_RETRIES = 3
const RETRY_DELAY = 2000

async function apiCall(endpoint, params, context = '') {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await apiCallOnce(endpoint, params)
    } catch (e) {
      if (attempt < MAX_RETRIES) {
        console.log(`\n⚠️  ${context} failed (attempt ${attempt}/${MAX_RETRIES}): ${e.message}`)
        await new Promise((r) => setTimeout(r, RETRY_DELAY))
      } else {
        console.log(`\n❌ ${context} failed after ${MAX_RETRIES} attempts: ${e.message}`)
        throw e
      }
    }
  }
}
```

### 동시성 제어

```javascript
async function runWithConcurrency(items, concurrency, fn) {
  const results = []
  const executing = new Set()

  for (const item of items) {
    const promise = Promise.resolve().then(() => fn(item))
    results.push(promise)
    executing.add(promise)
    promise.finally(() => executing.delete(promise))

    if (executing.size >= concurrency) {
      await Promise.race(executing)
    }
  }
  return Promise.all(results)
}
```

### 타이머 유틸리티

```javascript
const timer = {
  start: null,
  lap(label) {
    const elapsed = this.start ? ((Date.now() - this.start) / 1000).toFixed(2) : '0.00'
    console.log(`[${elapsed}s] ${label}`)
  },
  begin() { this.start = Date.now(); this.lap('Started') },
  end() { this.lap('Completed'); console.log(`\nTotal time: ${((Date.now() - this.start) / 1000).toFixed(2)}s`) },
}
```

### 주간 그룹화

```javascript
function getWeekNumber(date) {
  const d = new Date(date)
  const startOfYear = new Date(d.getFullYear(), 0, 1)
  const days = Math.floor((d - startOfYear) / (24 * 60 * 60 * 1000))
  return Math.ceil((days + startOfYear.getDay() + 1) / 7)
}

// 주차 키 형식: "2025-W01"
const weekKey = `${year}-W${week.toString().padStart(2, '0')}`
```

### 진행 상황 표시

```javascript
// 같은 줄에 업데이트 (카운터 등)
process.stdout.write(`\rProgress: ${current}/${total}`)

// 완료 후 줄바꿈
console.log('')
```

### 출력 파일

- 파일명 패턴: `{type}-{identifier}-{year}.md`
- 날짜 형식: 한국어 로케일 (`ko-KR`)

```javascript
const outputPath = `{script-type}-${identifier}-${year}.md`
fs.writeFileSync(outputPath, markdown, 'utf8')
```

### 에러 처리

```javascript
async function main() {
  try {
    // 로직
  } catch (error) {
    console.error('\nError:', error.message)
    process.exit(1)
  }
}

main()
```
