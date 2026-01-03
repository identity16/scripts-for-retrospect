#!/usr/bin/env node

/**
 * Linear Activity Fetcher
 *
 * Linear에서 사용자의 활동을 주간별로 정리
 *
 * 사용법:
 * node fetch-linear-activity.js --token=lin_api_xxx --year=2025
 *
 * Linear API Key 생성: https://linear.app/settings/api
 */

const https = require('https')
const fs = require('fs')

// CLI 인자 파싱
function getArg(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`))
  return arg ? arg.split('=').slice(1).join('=') : undefined
}

const TOKEN = process.env.LINEAR_TOKEN || getArg('token')
const YEAR = parseInt(process.env.YEAR || getArg('year'), 10)

// 입력 검증
if (!TOKEN || !YEAR) {
  console.error(`
Usage: node fetch-linear-activity.js --token=<linear-api-key> --year=<year>

Options:
  --token    Linear API Key (env: LINEAR_TOKEN)
  --year     Year to search (env: YEAR)

API Key 생성: https://linear.app/settings/api

Example:
  node fetch-linear-activity.js --token=lin_api_xxx --year=2025
`)
  process.exit(1)
}

// 타이머
const timer = {
  start: null,
  lap(label) {
    const now = Date.now()
    const elapsed = this.start ? ((now - this.start) / 1000).toFixed(2) : '0.00'
    console.log(`[${elapsed}s] ${label}`)
  },
  begin() {
    this.start = Date.now()
    this.lap('Started')
  },
  end() {
    this.lap('Completed')
    const total = ((Date.now() - this.start) / 1000).toFixed(2)
    console.log(`\nTotal time: ${total}s`)
  },
}

// Linear GraphQL API 호출
const MAX_RETRIES = 3
const RETRY_DELAY = 2000

function linearApiOnce(query, variables = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query, variables })

    const req = https.request(
      'https://api.linear.app/graphql',
      {
        method: 'POST',
        headers: {
          Authorization: TOKEN,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: 30000,
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => {
          try {
            const json = JSON.parse(body)
            if (json.errors) {
              reject(new Error(`Linear API Error: ${json.errors.map((e) => e.message).join(', ')}`))
            } else {
              resolve(json.data)
            }
          } catch (e) {
            reject(new Error(`JSON parse error: ${e.message}`))
          }
        })
      }
    )

    req.on('error', (e) => reject(new Error(`Network error: ${e.message}`)))
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Request timeout (30s)'))
    })

    req.write(data)
    req.end()
  })
}

async function linearApi(query, variables = {}, context = '') {
  let lastError

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await linearApiOnce(query, variables)
    } catch (e) {
      lastError = e
      const contextStr = context ? ` [${context}]` : ''

      if (attempt < MAX_RETRIES) {
        console.log(`\n⚠️  GraphQL${contextStr} failed (attempt ${attempt}/${MAX_RETRIES}): ${e.message}`)
        console.log(`   Retrying in ${RETRY_DELAY / 1000}s...`)
        await new Promise((r) => setTimeout(r, RETRY_DELAY))
      } else {
        console.log(`\n❌ GraphQL${contextStr} failed after ${MAX_RETRIES} attempts: ${e.message}`)
      }
    }
  }

  throw lastError
}

// 현재 사용자 정보 조회
async function getCurrentUser() {
  const data = await linearApi(
    `query { viewer { id name email } }`,
    {},
    'viewer'
  )
  return data.viewer
}

// 내가 생성한 이슈 조회
async function getCreatedIssues(userId, year) {
  const issues = []
  let cursor = null
  const startDate = `${year}-01-01T00:00:00.000Z`
  const endDate = `${year + 1}-01-01T00:00:00.000Z`

  console.log('\nFetching created issues...')

  do {
    const data = await linearApi(
      `query($userId: ID!, $after: String, $startDate: DateTimeOrDuration!, $endDate: DateTimeOrDuration!) {
        issues(
          filter: {
            creator: { id: { eq: $userId } }
            createdAt: { gte: $startDate, lt: $endDate }
          }
          first: 100
          after: $after
          orderBy: createdAt
        ) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id identifier title description state { name }
            createdAt updatedAt completedAt
            team { name key }
            project { name }
            labels { nodes { name } }
            url
          }
        }
      }`,
      { userId, after: cursor, startDate, endDate },
      'created issues'
    )

    issues.push(...data.issues.nodes)
    cursor = data.issues.pageInfo.hasNextPage ? data.issues.pageInfo.endCursor : null
    process.stdout.write(`\rFetched ${issues.length} created issues...`)
  } while (cursor)

  console.log('')
  return issues
}

// 내가 완료한 이슈 조회 (assignee가 나이고 completedAt이 있는 것)
async function getCompletedIssues(userId, year) {
  const issues = []
  let cursor = null
  const startDate = `${year}-01-01T00:00:00.000Z`
  const endDate = `${year + 1}-01-01T00:00:00.000Z`

  console.log('\nFetching completed issues...')

  do {
    const data = await linearApi(
      `query($userId: ID!, $after: String, $startDate: DateTimeOrDuration!, $endDate: DateTimeOrDuration!) {
        issues(
          filter: {
            assignee: { id: { eq: $userId } }
            completedAt: { gte: $startDate, lt: $endDate }
          }
          first: 100
          after: $after
          orderBy: updatedAt
        ) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id identifier title state { name }
            createdAt completedAt
            team { name key }
            project { name }
            labels { nodes { name } }
            url
          }
        }
      }`,
      { userId, after: cursor, startDate, endDate },
      'completed issues'
    )

    issues.push(...data.issues.nodes)
    cursor = data.issues.pageInfo.hasNextPage ? data.issues.pageInfo.endCursor : null
    process.stdout.write(`\rFetched ${issues.length} completed issues...`)
  } while (cursor)

  console.log('')
  return issues
}

// 내가 작성한 댓글 조회
async function getComments(userId, year) {
  const comments = []
  let cursor = null
  const startDate = `${year}-01-01T00:00:00.000Z`
  const endDate = `${year + 1}-01-01T00:00:00.000Z`

  console.log('\nFetching comments...')

  do {
    const data = await linearApi(
      `query($userId: ID!, $after: String, $startDate: DateTimeOrDuration!, $endDate: DateTimeOrDuration!) {
        comments(
          filter: {
            user: { id: { eq: $userId } }
            createdAt: { gte: $startDate, lt: $endDate }
          }
          first: 100
          after: $after
          orderBy: createdAt
        ) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id body createdAt
            issue { identifier title url team { name key } }
            url
          }
        }
      }`,
      { userId, after: cursor, startDate, endDate },
      'comments'
    )

    comments.push(...data.comments.nodes)
    cursor = data.comments.pageInfo.hasNextPage ? data.comments.pageInfo.endCursor : null
    process.stdout.write(`\rFetched ${comments.length} comments...`)
  } while (cursor)

  console.log('')
  return comments
}

// 주차 계산
function getWeekNumber(date) {
  const d = new Date(date)
  const startOfYear = new Date(d.getFullYear(), 0, 1)
  const days = Math.floor((d - startOfYear) / (24 * 60 * 60 * 1000))
  return Math.ceil((days + startOfYear.getDay() + 1) / 7)
}

// 주간 범위 문자열
function getWeekRange(year, week) {
  const startOfYear = new Date(year, 0, 1)
  const daysOffset = (week - 1) * 7 - startOfYear.getDay()
  const weekStart = new Date(year, 0, 1 + daysOffset)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)

  const format = (d) => `${d.getMonth() + 1}/${d.getDate()}`
  return `${format(weekStart)} - ${format(weekEnd)}`
}

// 마크다운 생성
function generateMarkdown(user, createdIssues, completedIssues, comments, year) {
  // 주간별로 그룹화
  const weeklyData = {}

  function getWeekKey(dateStr) {
    const date = new Date(dateStr)
    const week = getWeekNumber(date)
    return `${year}-W${week.toString().padStart(2, '0')}`
  }

  function ensureWeek(weekKey) {
    if (!weeklyData[weekKey]) {
      const week = parseInt(weekKey.split('-W')[1], 10)
      weeklyData[weekKey] = {
        week,
        created: [],
        completed: [],
        comments: [],
      }
    }
  }

  // 생성한 이슈 분류
  for (const issue of createdIssues) {
    const weekKey = getWeekKey(issue.createdAt)
    ensureWeek(weekKey)
    weeklyData[weekKey].created.push(issue)
  }

  // 완료한 이슈 분류
  for (const issue of completedIssues) {
    const weekKey = getWeekKey(issue.completedAt)
    ensureWeek(weekKey)
    weeklyData[weekKey].completed.push(issue)
  }

  // 댓글 분류
  for (const comment of comments) {
    const weekKey = getWeekKey(comment.createdAt)
    ensureWeek(weekKey)
    weeklyData[weekKey].comments.push(comment)
  }

  // 마크다운 생성
  let md = `# ${user.name}의 ${year}년 Linear 활동\n\n`
  md += `> 이메일: ${user.email}\n`
  md += `> 생성일: ${new Date().toLocaleDateString('ko-KR')}\n\n`
  md += `---\n\n`

  // 요약 통계
  const teamSet = new Set()
  createdIssues.forEach((i) => i.team?.name && teamSet.add(i.team.name))
  completedIssues.forEach((i) => i.team?.name && teamSet.add(i.team.name))

  md += `## 요약\n\n`
  md += `- **생성한 이슈**: ${createdIssues.length}개\n`
  md += `- **완료한 이슈**: ${completedIssues.length}개\n`
  md += `- **작성한 댓글**: ${comments.length}개\n`
  md += `- **활동 팀**: ${teamSet.size > 0 ? [...teamSet].join(', ') : '-'}\n`
  md += `- **활동 주차**: ${Object.keys(weeklyData).length}주\n\n`
  md += `---\n\n`

  const sortedWeeks = Object.keys(weeklyData).sort()

  if (sortedWeeks.length === 0) {
    md += `활동 내역이 없습니다.\n`
    return md
  }

  for (const weekKey of sortedWeeks) {
    const { week, created, completed, comments: weekComments } = weeklyData[weekKey]
    const weekRange = getWeekRange(year, week)

    md += `## ${weekKey} (${weekRange})\n\n`

    // 생성한 이슈
    if (created.length > 0) {
      md += `### 📝 생성한 이슈 (${created.length})\n\n`
      for (const issue of created) {
        const labels = issue.labels?.nodes?.map((l) => l.name).join(', ') || ''
        const teamKey = issue.team?.key || ''
        md += `- **[${issue.identifier}](${issue.url})** ${issue.title}\n`
        md += `  - ${teamKey ? `[${teamKey}]` : ''} ${issue.state?.name || ''}`
        if (labels) md += ` | 라벨: ${labels}`
        if (issue.project?.name) md += ` | 프로젝트: ${issue.project.name}`
        md += `\n`
      }
      md += '\n'
    }

    // 완료한 이슈
    if (completed.length > 0) {
      md += `### ✅ 완료한 이슈 (${completed.length})\n\n`
      for (const issue of completed) {
        const teamKey = issue.team?.key || ''
        const completedDate = new Date(issue.completedAt).toLocaleDateString('ko-KR', {
          month: 'short',
          day: 'numeric',
        })
        md += `- **[${issue.identifier}](${issue.url})** ${issue.title}\n`
        md += `  - ${teamKey ? `[${teamKey}]` : ''} ${completedDate} 완료`
        if (issue.project?.name) md += ` | 프로젝트: ${issue.project.name}`
        md += `\n`
      }
      md += '\n'
    }

    // 댓글
    if (weekComments.length > 0) {
      md += `### 💬 댓글 (${weekComments.length})\n\n`
      for (const comment of weekComments) {
        const date = new Date(comment.createdAt).toLocaleDateString('ko-KR', {
          month: 'short',
          day: 'numeric',
        })
        const preview = comment.body?.substring(0, 100).replace(/\n/g, ' ') || ''
        md += `- **[${comment.issue?.identifier}](${comment.issue?.url})** ${comment.issue?.title}\n`
        md += `  - ${date}: ${preview}${comment.body?.length > 100 ? '...' : ''}\n`
      }
      md += '\n'
    }

    md += `---\n\n`
  }

  return md
}

// 메인
async function main() {
  console.log('=== Linear Activity Fetcher ===\n')
  console.log(`Year: ${YEAR}`)

  timer.begin()

  try {
    // 1. 현재 사용자 정보 조회
    const user = await getCurrentUser()
    console.log(`User: ${user.name} (${user.email})`)
    timer.lap('User info fetched')

    // 2. 생성한 이슈 조회
    const createdIssues = await getCreatedIssues(user.id, YEAR)
    timer.lap(`Fetched ${createdIssues.length} created issues`)

    // 3. 완료한 이슈 조회
    const completedIssues = await getCompletedIssues(user.id, YEAR)
    timer.lap(`Fetched ${completedIssues.length} completed issues`)

    // 4. 댓글 조회
    const comments = await getComments(user.id, YEAR)
    timer.lap(`Fetched ${comments.length} comments`)

    // 5. 마크다운 생성 및 저장
    timer.lap('Generating markdown...')
    const markdown = generateMarkdown(user, createdIssues, completedIssues, comments, YEAR)

    const safeName = user.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const outputPath = `linear-activity-${safeName}-${YEAR}.md`

    fs.writeFileSync(outputPath, markdown, 'utf8')
    timer.lap(`Saved to: ${outputPath}`)
    timer.end()
  } catch (error) {
    console.error('\nError:', error.message)
    process.exit(1)
  }
}

main()
