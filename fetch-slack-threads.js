#!/usr/bin/env node

/**
 * Slack Thread Activity Fetcher
 *
 * search.messages API를 사용하여 특정 사용자의 스레드 메시지만 효율적으로 검색
 *
 * 사용법:
 * SLACK_TOKEN=xoxp-your-token node fetch-slack-threads.js
 *
 * 필요한 scope: search:read, users:read
 */

const https = require('https')
const fs = require('fs')

const TOKEN = process.env.SLACK_TOKEN || process.argv.find((arg) => arg.startsWith('--token='))?.split('=')[1]

const TARGET_USER_NAME =
  process.env.TARGET_USER_NAME || process.argv.find((arg) => arg.startsWith('--user='))?.split('=')[1]
const YEAR = process.env.YEAR || process.argv.find((arg) => arg.startsWith('--year='))?.split('=')[1]
const CONCURRENCY =
  process.env.CONCURRENCY || process.argv.find((arg) => arg.startsWith('--concurrency='))?.split('=')[1] || 1

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

// API 호출 헬퍼 (재시도 포함)
const MAX_RETRIES = 3
const RETRY_DELAY = 2000

function slackApiOnce(method, params = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`https://slack.com/api/${method}`)
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) url.searchParams.append(key, String(value))
    })

    const req = https
      .get(
        url.toString(),
        {
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000, // 30초 타임아웃
        },
        (res) => {
          let data = ''
          res.on('data', (chunk) => (data += chunk))
          res.on('end', () => {
            try {
              const json = JSON.parse(data)
              if (!json.ok) {
                reject(new Error(`Slack API Error: ${json.error}`))
              } else {
                resolve(json)
              }
            } catch (e) {
              reject(new Error(`JSON parse error: ${e.message}`))
            }
          })
        }
      )
      .on('error', (e) => reject(new Error(`Network error: ${e.message}`)))
      .on('timeout', () => {
        req.destroy()
        reject(new Error('Request timeout (30s)'))
      })
  })
}

async function slackApi(method, params = {}, context = '') {
  let lastError

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await slackApiOnce(method, params)
    } catch (e) {
      lastError = e
      const contextStr = context ? ` [${context}]` : ''
      const paramsStr = params.page ? ` (page: ${params.page})` : ''

      if (attempt < MAX_RETRIES) {
        console.log(`\n⚠️  ${method}${paramsStr}${contextStr} failed (attempt ${attempt}/${MAX_RETRIES}): ${e.message}`)
        console.log(`   Retrying in ${RETRY_DELAY / 1000}s...`)
        await new Promise((r) => setTimeout(r, RETRY_DELAY))
      } else {
        console.log(`\n❌ ${method}${paramsStr}${contextStr} failed after ${MAX_RETRIES} attempts: ${e.message}`)
      }
    }
  }

  throw lastError
}

// 사용자 ID 찾기
async function findUser(displayName) {
  console.log(`Finding user: ${displayName}...`)
  const candidates = []
  let cursor

  do {
    const result = await slackApi('users.list', { limit: 200, cursor })

    for (const m of result.members) {
      // 삭제된 사용자, 봇 제외
      if (m.deleted || m.is_bot) continue

      const lower = displayName.toLowerCase()
      const exactMatch =
        m.real_name?.toLowerCase() === lower ||
        m.profile?.display_name?.toLowerCase() === lower ||
        m.name?.toLowerCase() === lower

      // 정확히 일치하면 바로 반환
      if (exactMatch) {
        console.log(`Found (exact): ${m.real_name} (@${m.name}, ${m.id})`)
        return m
      }

      const partialMatch =
        m.real_name?.toLowerCase().includes(lower) ||
        m.profile?.display_name?.toLowerCase().includes(lower) ||
        m.name?.toLowerCase().includes(lower)

      if (partialMatch) {
        candidates.push(m)
      }
    }

    cursor = result.response_metadata?.next_cursor
  } while (cursor)

  if (candidates.length === 0) {
    throw new Error(`User "${displayName}" not found`)
  }

  if (candidates.length === 1) {
    const user = candidates[0]
    console.log(`Found: ${user.real_name} (@${user.name}, ${user.id})`)
    return user
  }

  // 여러 명이면 목록 출력
  console.log(`\nFound ${candidates.length} users matching "${displayName}":\n`)
  candidates.forEach((u, i) => {
    console.log(`  ${i + 1}. ${u.real_name} (@${u.name}) - ${u.profile?.title || 'No title'}`)
  })
  console.log(`\nUsing first match. To specify, set TARGET_USER_ID in the script.\n`)

  const user = candidates[0]
  console.log(`Selected: ${user.real_name} (@${user.name}, ${user.id})`)
  return user
}

// 워크스페이스 URL 가져오기
let workspaceUrl = ''

async function getWorkspaceUrl() {
  if (workspaceUrl) return workspaceUrl
  const result = await slackApi('auth.test')
  workspaceUrl = result.url?.replace(/\/$/, '') || 'https://slack.com'
  console.log(`Workspace: ${workspaceUrl}`)
  return workspaceUrl
}

// Slack 링크 생성
function getChannelLink(channelId, channelName) {
  return `[#${channelName}](${workspaceUrl}/archives/${channelId})`
}

function getThreadLink(channelId, threadTs, text = '스레드') {
  // thread_ts: 1234567890.123456 -> p1234567890123456
  const tsForUrl = 'p' + threadTs.replace('.', '')
  return `[${text}](${workspaceUrl}/archives/${channelId}/${tsForUrl})`
}

// 채널 ID -> 이름 매핑 캐시
const channelCache = new Map()

function cacheChannelName(channelId, channelName) {
  if (channelId && channelName && !channelCache.has(channelId)) {
    channelCache.set(channelId, channelName)
  }
}

function getChannelNameFromCache(channelId) {
  return channelCache.get(channelId) || channelId
}

// DM 사용자 ID 캐시
const dmUserCache = new Map()

async function fetchDMUserName(channelId) {
  if (dmUserCache.has(channelId)) {
    return dmUserCache.get(channelId)
  }

  try {
    // conversations.info로 DM 상대방 user ID 가져오기
    const result = await slackApi('conversations.info', { channel: channelId }, 'DM info')
    const userId = result.channel?.user
    if (userId) {
      // users.info로 사용자 이름 가져오기
      const userResult = await slackApi('users.info', { user: userId }, 'user info')
      const name = userResult.user?.real_name || userResult.user?.name || userId
      dmUserCache.set(channelId, name)
      return name
    }
  } catch {
    // 권한 없음 등의 오류
  }

  dmUserCache.set(channelId, null)
  return null
}

// 단일 월 검색
async function searchMessagesForMonth(userName, year, month) {
  const messages = []
  let page = 1
  let totalPages = 1

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const endMonth = month === 12 ? 1 : month + 1
  const endYear = month === 12 ? year + 1 : year
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`

  const query = `from:@${userName} after:${startDate} before:${endDate}`

  do {
    const result = await slackApi(
      'search.messages',
      {
        query,
        sort: 'timestamp',
        sort_dir: 'asc',
        count: 100,
        page,
      },
      `${month}월 page ${page}`
    )

    const matches = result.messages?.matches || []
    for (const msg of matches) {
      const channelId = msg.channel?.id
      // DM 채널 ID는 "D"로 시작
      const isDM = channelId?.startsWith('D')
      let channelName = msg.channel?.name

      if (!channelName && isDM) {
        // DM 상대방 정보 찾기: permalink에서 추출 또는 channel 정보 사용
        const dmUser = msg.channel?.user || msg.channel?.username
        channelName = dmUser ? `DM: ${dmUser}` : `DM: ${channelId}`
      }

      cacheChannelName(channelId, channelName || channelId)
    }
    messages.push(...matches)

    totalPages = result.messages?.paging?.pages || 1
    page++

    await new Promise((resolve) => setTimeout(resolve, 100))
  } while (page <= totalPages)

  return messages
}

// search.messages로 사용자의 메시지 검색 (월별 병렬 실행)
async function searchUserThreadMessages(userName, year) {
  console.log(`\nSearching messages for ${year} (concurrency: ${CONCURRENCY})...\n`)

  const months = Array.from({ length: 12 }, (_, i) => i + 1)
  const progress = { completed: 0, total: 12, messages: 0 }

  const results = await runWithConcurrency(months, CONCURRENCY, async (month) => {
    const msgs = await searchMessagesForMonth(userName, year, month)
    progress.completed++
    progress.messages += msgs.length
    process.stdout.write(`\rProgress: ${progress.completed}/12 months | ${progress.messages} messages`)
    return msgs
  })

  const messages = results.flat().sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts))
  console.log(`\nFound ${messages.length} messages`)
  return messages
}

// 메시지를 스레드 단위로 그룹화
async function groupByThreads(messages) {
  timer.lap('Grouping by threads...')

  const threads = new Map()

  for (const msg of messages) {
    const channelId = msg.channel?.id
    const threadTs = msg.thread_ts || msg.ts
    const key = `${channelId}:${threadTs}`

    if (!threads.has(key)) {
      threads.set(key, {
        channelId,
        channelName: getChannelNameFromCache(channelId),
        threadTs,
        parentText: msg.thread_ts ? null : msg.text?.substring(0, 200),
        userMessages: [],
        isAuthor: !msg.thread_ts,
      })
    }

    const thread = threads.get(key)
    thread.userMessages.push({
      ts: msg.ts,
      text: msg.text?.substring(0, 500) || '(no text)',
      date: new Date(parseFloat(msg.ts) * 1000),
    })

    if (!msg.thread_ts && !thread.parentText) {
      thread.parentText = msg.text?.substring(0, 200)
    }
  }

  // DM 채널들의 사용자 이름 조회
  const dmChannelIds = [
    ...new Set([...threads.values()].filter((t) => t.channelId?.startsWith('D')).map((t) => t.channelId)),
  ]

  if (dmChannelIds.length > 0) {
    timer.lap(`Fetching ${dmChannelIds.length} DM user names...`)
    let fetched = 0

    await runWithConcurrency(dmChannelIds, CONCURRENCY, async (channelId) => {
      const userName = await fetchDMUserName(channelId)
      if (userName) {
        channelCache.set(channelId, `DM: ${userName}`)
      }
      fetched++
      process.stdout.write(`\rFetching DM info: ${fetched}/${dmChannelIds.length}`)
    })
    console.log('')

    // 스레드에 채널 이름 업데이트
    for (const thread of threads.values()) {
      if (thread.channelId?.startsWith('D')) {
        thread.channelName = getChannelNameFromCache(thread.channelId)
      }
    }
  }

  timer.lap(`Grouped into ${threads.size} threads (${channelCache.size} channels)`)
  return Array.from(threads.values())
}

// 주차 계산
function getWeekNumber(date) {
  const startOfYear = new Date(date.getFullYear(), 0, 1)
  const days = Math.floor((date - startOfYear) / (24 * 60 * 60 * 1000))
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
function generateMarkdown(threads, userName, year) {
  const weeklyData = {}

  for (const thread of threads) {
    for (const msg of thread.userMessages) {
      const week = getWeekNumber(msg.date)
      const key = `${year}-W${week.toString().padStart(2, '0')}`

      if (!weeklyData[key]) {
        weeklyData[key] = { week, channels: {} }
      }

      const channelKey = thread.channelName
      if (!weeklyData[key].channels[channelKey]) {
        weeklyData[key].channels[channelKey] = { channelId: thread.channelId, threads: [] }
      }

      const existing = weeklyData[key].channels[channelKey].threads.find((t) => t.threadTs === thread.threadTs)

      if (!existing) {
        weeklyData[key].channels[channelKey].threads.push({
          threadTs: thread.threadTs,
          channelId: thread.channelId,
          parentMessage: thread.parentText || '(parent message)',
          messages: [msg],
          isAuthor: thread.isAuthor,
        })
      } else {
        existing.messages.push(msg)
      }
    }
  }

  let md = `# ${userName}의 ${year}년 Slack 스레드 활동\n\n`
  md += `> 생성일: ${new Date().toLocaleDateString('ko-KR')}\n\n`
  md += `---\n\n`

  const sortedWeeks = Object.keys(weeklyData).sort()

  if (sortedWeeks.length === 0) {
    md += `활동 내역이 없습니다.\n`
    return md
  }

  for (const weekKey of sortedWeeks) {
    const { week, channels } = weeklyData[weekKey]
    const weekRange = getWeekRange(year, week)

    md += `## ${weekKey} (${weekRange})\n\n`

    for (const channelName of Object.keys(channels).sort()) {
      const { channelId, threads: channelThreads } = channels[channelName]
      const channelLink = getChannelLink(channelId, channelName)
      md += `### ${channelLink}\n\n`

      for (const thread of channelThreads) {
        const authorBadge = thread.isAuthor ? ' `[작성자]`' : ''
        const threadLink = getThreadLink(thread.channelId, thread.threadTs, '스레드 링크')
        md += `#### 스레드${authorBadge} (${threadLink})\n`
        md += `> ${thread.parentMessage.replace(/\n/g, '\n> ')}\n\n`

        for (const msg of thread.messages) {
          const dateStr = msg.date.toLocaleDateString('ko-KR', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
          md += `- **${dateStr}**: ${msg.text.replace(/\n/g, ' ')}\n`
        }
        md += '\n'
      }
    }

    md += `---\n\n`
  }

  return md
}

// 메인
async function main() {
  console.log('=== Slack Thread Activity Fetcher (Optimized) ===\n')
  timer.begin()

  try {
    // 0. 워크스페이스 정보 가져오기
    await getWorkspaceUrl()
    timer.lap('Workspace info fetched')

    // 1. 사용자 찾기
    const user = await findUser(TARGET_USER_NAME)
    timer.lap(`User found: ${user.name}`)

    // 2. search.messages로 스레드 메시지 검색
    const messages = await searchUserThreadMessages(user.name, YEAR)
    timer.lap(`Found ${messages.length} messages`)

    if (messages.length === 0) {
      console.log('\nNo messages found.')
      return
    }

    // 3. 스레드 단위로 그룹화
    const threads = await groupByThreads(messages)

    // 4. 마크다운 생성 및 저장
    timer.lap('Generating markdown...')
    const markdown = generateMarkdown(threads, TARGET_USER_NAME, YEAR)
    const outputPath = `slack-threads-${TARGET_USER_NAME.toLowerCase()}-${YEAR}.md`

    fs.writeFileSync(outputPath, markdown, 'utf8')
    timer.lap(`Saved to: ${outputPath}`)
    timer.end()
  } catch (error) {
    console.error('\nError:', error.message)
    process.exit(1)
  }
}

main()
