#!/usr/bin/env node

/**
 * GitHub PR Activity Fetcher
 *
 * 특정 organization에서 사용자의 PR 활동을 주간별로 정리
 *
 * 사용법:
 * node fetch-github-prs.js --token=ghp-xxx --org=organization --emails=joon@daangn.com,dnjswns0930@gmail.com --year=2025
 *
 * 필요한 scope: repo (private repo 접근 시)
 */

const https = require('https')
const fs = require('fs')

// CLI 인자 파싱
function getArg(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`))
  return arg ? arg.split('=').slice(1).join('=') : undefined
}

const TOKEN = process.env.GITHUB_TOKEN || getArg('token')
const ORG = process.env.GITHUB_ORG || getArg('org')
const EMAILS = (process.env.GITHUB_EMAILS || getArg('emails') || '').split(',').filter(Boolean)
const YEAR = parseInt(process.env.YEAR || getArg('year'), 10)
const CONCURRENCY = parseInt(process.env.CONCURRENCY || getArg('concurrency') || '3', 10)
// GitHub Enterprise Server 지원: 기본값은 github.com
const API_BASE = (process.env.GITHUB_API_URL || getArg('api-url') || 'https://api.github.com').replace(/\/$/, '')

// 입력 검증
if (!TOKEN || !ORG || EMAILS.length === 0 || !YEAR) {
  console.error(`
Usage: node fetch-github-prs.js --token=<github-token> --org=<org-name> --emails=<email1,email2> --year=<year>

Options:
  --token       GitHub Personal Access Token (env: GITHUB_TOKEN)
  --org         GitHub Organization name (env: GITHUB_ORG)
  --emails      Comma-separated email addresses (env: GITHUB_EMAILS)
  --year        Year to search (env: YEAR)
  --concurrency Concurrent requests (default: 3, env: CONCURRENCY)
  --api-url     GitHub API URL (default: https://api.github.com, env: GITHUB_API_URL)
                For Enterprise Server: https://<hostname>/api/v3

Example:
  node fetch-github-prs.js --token=ghp_xxx --org=organization --emails=joon@daangn.com,dnjswns0930@gmail.com --year=2025

  # GitHub Enterprise Server
  node fetch-github-prs.js --api-url=https://github.example.com/api/v3 --token=xxx --org=my-org --emails=user@example.com --year=2025
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

// 동시성 제한 실행기
async function runWithConcurrency(items, concurrency, fn) {
  const results = []
  const executing = new Set()

  for (const item of items) {
    const promise = Promise.resolve().then(() => fn(item))
    results.push(promise)
    executing.add(promise)

    const cleanup = () => executing.delete(promise)
    promise.then(cleanup, cleanup)

    if (executing.size >= concurrency) {
      await Promise.race(executing)
    }
  }

  return Promise.all(results)
}

// GitHub API 호출 헬퍼
const MAX_RETRIES = 3
const RETRY_DELAY = 2000

function githubApiOnce(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = path.startsWith('https://') ? new URL(path) : new URL(`${API_BASE}${path}`)

    const req = https.get(
      url.toString(),
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'fetch-github-prs',
          ...options.headers,
        },
        timeout: 30000,
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          try {
            // Rate limit 체크
            const remaining = res.headers['x-ratelimit-remaining']
            if (remaining && parseInt(remaining, 10) < 100) {
              console.log(`\n⚠️  Rate limit remaining: ${remaining}`)
            }

            const json = JSON.parse(data)

            if (res.statusCode >= 400) {
              reject(new Error(`GitHub API Error (${res.statusCode}): ${json.message || data}`))
            } else {
              // Link 헤더에서 다음 페이지 URL 추출
              const linkHeader = res.headers.link
              let nextUrl = null
              if (linkHeader) {
                const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
                if (nextMatch) nextUrl = nextMatch[1]
              }

              resolve({ data: json, nextUrl })
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
  })
}

async function githubApi(path, options = {}, context = '', skipRetry = false) {
  let lastError

  const maxAttempts = skipRetry ? 1 : MAX_RETRIES

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await githubApiOnce(path, options)
    } catch (e) {
      lastError = e

      if (skipRetry) {
        throw e
      }

      const contextStr = context ? ` [${context}]` : ''

      if (attempt < maxAttempts) {
        console.log(`\n⚠️  ${path}${contextStr} failed (attempt ${attempt}/${maxAttempts}): ${e.message}`)
        console.log(`   Retrying in ${RETRY_DELAY / 1000}s...`)
        await new Promise((r) => setTimeout(r, RETRY_DELAY))
      } else {
        console.log(`\n❌ ${path}${contextStr} failed after ${maxAttempts} attempts: ${e.message}`)
      }
    }
  }

  throw lastError
}

// 페이지네이션 처리하여 모든 결과 가져오기
async function githubApiAll(path, context = '', skipRetry = false, extraHeaders = {}) {
  const allData = []
  let url = path

  while (url) {
    const { data, nextUrl } = await githubApi(url, { headers: extraHeaders }, context, skipRetry)
    if (Array.isArray(data)) {
      allData.push(...data)
    } else if (data.items) {
      allData.push(...data.items)
    }
    url = nextUrl
    if (nextUrl) await new Promise((r) => setTimeout(r, 100)) // Rate limit 방지
  }

  return allData
}

// Organization 또는 User의 모든 레포지토리 조회
async function getRepos(owner) {
  console.log(`\nFetching repositories for ${owner}...`)

  // 먼저 Organization으로 시도 (재시도 없이 한번만)
  try {
    const repos = await githubApiAll(`/orgs/${owner}/repos?per_page=100&type=all`, 'org repos', true)
    console.log(`Found ${repos.length} repositories (organization)`)
    return repos
  } catch (e) {
    if (!e.message.includes('404')) {
      throw e
    }
    // 404면 User로 fallback
  }

  // Organization이 아니면 User로 시도
  try {
    const repos = await githubApiAll(`/users/${owner}/repos?per_page=100&type=all`, 'user repos')
    console.log(`Found ${repos.length} repositories (user)`)
    return repos
  } catch (e) {
    if (e.message.includes('404')) {
      throw new Error(`"${owner}" is not a valid GitHub organization or user`)
    }
    throw e
  }
}

// Search API로 이메일 기반 커밋 검색 (전체 org에서 한번에)
async function searchCommitsByEmail(org, email, year) {
  const query = `author-email:${email} org:${org} committer-date:${year}-01-01..${year}-12-31`

  try {
    const commits = await githubApiAll(
      `/search/commits?q=${encodeURIComponent(query)}&per_page=100`,
      `commits/${email}`,
      false,
      { Accept: 'application/vnd.github.cloak-preview+json' }
    )
    return commits
  } catch (e) {
    // Search API 실패시 빈 배열 반환
    console.log(`\n⚠️  Commit search failed for ${email}: ${e.message}`)
    return []
  }
}

// 커밋이 속한 PR 조회
async function getPRsForCommit(repo, sha) {
  try {
    const { data } = await githubApi(
      `/repos/${ORG}/${repo}/commits/${sha}/pulls`,
      { headers: { Accept: 'application/vnd.github.v3+json' } },
      `${repo}/${sha.substring(0, 7)}`
    )
    return data
  } catch (e) {
    return []
  }
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
function generateMarkdown(prs, org, year) {
  // 주간별로 그룹화
  const weeklyData = {}

  for (const pr of prs) {
    const createdAt = new Date(pr.created_at)
    const week = getWeekNumber(createdAt)
    const weekKey = `${year}-W${week.toString().padStart(2, '0')}`

    if (!weeklyData[weekKey]) {
      weeklyData[weekKey] = { week, repos: {} }
    }

    const repoName = pr.base.repo.name
    if (!weeklyData[weekKey].repos[repoName]) {
      weeklyData[weekKey].repos[repoName] = []
    }

    weeklyData[weekKey].repos[repoName].push(pr)
  }

  let md = `# ${org}의 ${year}년 GitHub PR 활동\n\n`
  md += `> 검색 이메일: ${EMAILS.join(', ')}\n`
  md += `> 생성일: ${new Date().toLocaleDateString('ko-KR')}\n\n`
  md += `---\n\n`

  const sortedWeeks = Object.keys(weeklyData).sort()

  if (sortedWeeks.length === 0) {
    md += `활동 내역이 없습니다.\n`
    return md
  }

  // 요약 통계
  const totalPRs = prs.length
  const mergedPRs = prs.filter((pr) => pr.merged_at).length
  const repoSet = new Set(prs.map((pr) => pr.base.repo.name))

  md += `## 요약\n\n`
  md += `- **총 PR 수**: ${totalPRs}개\n`
  md += `- **Merged PR**: ${mergedPRs}개\n`
  md += `- **활동 레포지토리**: ${repoSet.size}개\n`
  md += `- **활동 주차**: ${sortedWeeks.length}주\n\n`
  md += `---\n\n`

  for (const weekKey of sortedWeeks) {
    const { week, repos } = weeklyData[weekKey]
    const weekRange = getWeekRange(year, week)

    md += `## ${weekKey} (${weekRange})\n\n`

    for (const repoName of Object.keys(repos).sort()) {
      const repoPRs = repos[repoName]
      md += `### ${repoName}\n\n`

      for (const pr of repoPRs) {
        const status = pr.merged_at ? '✅ Merged' : pr.state === 'closed' ? '❌ Closed' : '🟡 Open'
        const createdDate = new Date(pr.created_at).toLocaleDateString('ko-KR', {
          month: 'short',
          day: 'numeric',
        })

        md += `- **[#${pr.number}](${pr.html_url})** ${pr.title}\n`
        md += `  - ${status} | ${createdDate} 생성`

        if (pr.merged_at) {
          const mergedDate = new Date(pr.merged_at).toLocaleDateString('ko-KR', {
            month: 'short',
            day: 'numeric',
          })
          md += ` | ${mergedDate} 병합`
        }

        md += `\n`

        // PR body가 있으면 첫 줄만 표시
        if (pr.body) {
          const firstLine = pr.body.split('\n')[0].trim().substring(0, 100)
          if (firstLine) {
            md += `  - > ${firstLine}${pr.body.length > 100 ? '...' : ''}\n`
          }
        }
      }

      md += '\n'
    }

    md += `---\n\n`
  }

  return md
}

// 메인
async function main() {
  console.log('=== GitHub PR Activity Fetcher ===\n')
  if (API_BASE !== 'https://api.github.com') {
    console.log(`API URL: ${API_BASE}`)
  }
  console.log(`Organization: ${ORG}`)
  console.log(`Emails: ${EMAILS.join(', ')}`)
  console.log(`Year: ${YEAR}`)
  console.log(`Concurrency: ${CONCURRENCY}`)

  timer.begin()

  try {
    const prMap = new Map() // PR 중복 제거용
    const usernames = new Set()

    // 1. Search Commits API로 이메일 기반 커밋 검색 (전체 org 한번에)
    console.log(`\nSearching commits by email using Search API...`)

    for (const email of EMAILS) {
      console.log(`\nSearching: ${email}`)
      const commits = await searchCommitsByEmail(ORG, email, YEAR)
      console.log(`Found ${commits.length} commits`)

      // 커밋에서 username 수집
      for (const commit of commits) {
        if (commit.author?.login) {
          usernames.add(commit.author.login)
        }
      }

      // 각 커밋이 속한 PR 조회
      let processed = 0
      await runWithConcurrency(commits, CONCURRENCY, async (commit) => {
        const repoName = commit.repository?.name || commit.url?.match(/repos\/[^/]+\/([^/]+)/)?.[1]
        if (repoName) {
          const prs = await getPRsForCommit(repoName, commit.sha)
          for (const pr of prs) {
            const createdAt = new Date(pr.created_at)
            if (createdAt.getFullYear() === YEAR) {
              prMap.set(pr.id, pr)
              // pr.user는 PR 작성자이므로 username 수집에서 제외
              // (다른 사람 PR에 내 커밋이 포함된 경우 잘못된 username이 추가됨)
            }
          }
        }
        processed++
        process.stdout.write(`\rFetching PRs: ${processed}/${commits.length} commits | Found ${prMap.size} PRs`)
      })
      console.log('')
    }

    timer.lap(`Collected ${prMap.size} PRs from commits`)

    // 2. author로도 직접 PR 검색 (커밋 기반 검색을 보완)
    console.log(`\nSearching PRs by author...`)

    if (usernames.size > 0) {
      console.log(`Found usernames: ${[...usernames].join(', ')}`)

      // Search API로 해당 사용자의 PR 검색
      for (const username of usernames) {
        try {
          const searchQuery = `type:pr author:${username} org:${ORG} created:${YEAR}-01-01..${YEAR}-12-31`
          const searchResults = await githubApiAll(
            `/search/issues?q=${encodeURIComponent(searchQuery)}&per_page=100`,
            `search/${username}`
          )

          const newPRs = searchResults.filter((item) => item.pull_request && !prMap.has(item.id))
          console.log(`\n@${username}: ${searchResults.length} PRs found, ${newPRs.length} new`)

          let fetched = 0
          for (const item of newPRs) {
            try {
              const { data: pr } = await githubApi(item.pull_request.url, {}, `PR #${item.number}`)
              prMap.set(pr.id, pr)
            } catch (e) {
              // PR 상세 조회 실패시 기본 정보 사용
              prMap.set(item.id, {
                ...item,
                base: { repo: { name: item.repository_url.split('/').pop() } },
              })
            }
            fetched++
            process.stdout.write(`\rFetching PR details: ${fetched}/${newPRs.length}`)
          }
          if (newPRs.length > 0) console.log('')
        } catch (e) {
          console.log(`\n⚠️  Search for ${username} failed: ${e.message}`)
        }
      }
    } else {
      console.log('No usernames found from commits')
    }

    timer.lap(`Total ${prMap.size} unique PRs found`)

    // 4. PR 정렬 (생성일 기준)
    const prs = Array.from(prMap.values()).sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at)
    )

    if (prs.length === 0) {
      console.log('\nNo PRs found.')
      timer.end()
      return
    }

    // 5. 마크다운 생성 및 저장
    timer.lap('Generating markdown...')
    const markdown = generateMarkdown(prs, ORG, YEAR)
    const outputPath = `github-prs-${ORG}-${YEAR}.md`

    fs.writeFileSync(outputPath, markdown, 'utf8')
    timer.lap(`Saved to: ${outputPath}`)
    timer.end()
  } catch (error) {
    console.error('\nError:', error.message)
    process.exit(1)
  }
}

main()
