import jobs from '../../data/jobs.json'
import progression from '../../data/progression.json'
import stagesMeta from '../../data/stages/stage1.json'
import stage2 from '../../data/stages/stage2.json'
import stage3 from '../../data/stages/stage3.json'
import traitsFile from '../../data/traits.json'
import { levelForXp } from '../../core/stats'
import { fetchPlayStats, fetchStats } from '../api'
import { levelSpread, ranked, signupsToBars } from '../format'
import { dataTable, errorLine, heading, note } from '../layout'

const STAGE_NAMES = [stagesMeta, stage2, stage3].map(
  (s) => (s as { name?: string; id: string }).name ?? (s as { id: string }).id,
)

/** 이름표는 게임 데이터에서 가져온다 — 운영 화면에 이름을 따로 적지 않는다 */
function jobName(id: string): string {
  return (jobs as Record<string, { name?: string }>)[id]?.name ?? id
}

function traitName(id: string): string {
  if (id === '(없음)') return '고르지 않음'
  const all = (traitsFile as { traits: Record<string, { name?: string }> }).traits
  return all[id]?.name ?? id
}

/** 가로 막대 하나 — 이름, 길이, 수와 비율. 그림과 글이 같은 것을 말한다 */
function barRow(name: string, n: number, ratio: number, share: number): HTMLElement {
  const row = document.createElement('div')
  row.className = 'admin-hbar'
  const label = document.createElement('span')
  label.className = 'admin-hbar-name'
  label.textContent = name
  const track = document.createElement('span')
  track.className = 'admin-hbar-track'
  const fill = document.createElement('span')
  fill.className = 'admin-hbar-fill'
  fill.style.width = `${Math.max(2, Math.round(ratio * 100))}%`
  track.append(fill)
  const value = document.createElement('span')
  value.className = 'admin-hbar-value'
  value.textContent = `${n}개 (${Math.round(share * 100)}%)`
  row.append(label, track, value)
  return row
}

/** 분포 한 덩어리 — 제목 + 막대들. 비어 있으면 그 사실을 말한다 */
function distribution(
  title: string,
  counts: Record<string, number>,
  label: (key: string) => string,
  empty = '아직 기록이 없다.',
): HTMLElement {
  const box = document.createElement('section')
  const h = document.createElement('h3')
  h.textContent = title
  box.append(h)
  const rows = ranked(counts, label)
  if (rows.length === 0) {
    box.append(note(empty))
    return box
  }
  const list = document.createElement('div')
  list.className = 'admin-hbars'
  list.setAttribute('role', 'img')
  list.setAttribute(
    'aria-label',
    `${title}: ${rows.map((r) => `${r.name} ${r.n}개`).join(', ')}`,
  )
  for (const r of rows) list.append(barRow(r.name, r.n, r.ratio, r.share))
  box.append(list)
  return box
}

/**
 * 대시보드 — 오늘 서비스가 건강한지 한눈에.
 * 숫자는 전부 admin_stats() 한 번의 왕복에서 온다.
 */

function card(label: string, value: string, warn = false): HTMLElement {
  const box = document.createElement('div')
  box.className = warn ? 'admin-card admin-card-warn' : 'admin-card'
  const v = document.createElement('strong')
  v.textContent = value
  const l = document.createElement('span')
  l.textContent = label
  box.append(v, l)
  return box
}

export async function renderDashboard(content: HTMLElement): Promise<void> {
  content.replaceChildren(heading('대시보드'), note('불러오는 중…'))
  let stats: Record<string, unknown>
  try {
    stats = await fetchStats()
  } catch (e) {
    content.replaceChildren(heading('대시보드'), errorLine((e as Error).message))
    return
  }
  content.replaceChildren(heading('대시보드'))

  const n = (key: string) => Number(stats[key] ?? 0)
  const cards = document.createElement('div')
  cards.className = 'admin-cards'
  cards.append(
    card('전체 사용자', String(n('users_total'))),
    card('7일 내 저장 활동', String(n('saves_7d'))),
    card('친구 관계', String(n('friendships_total'))),
    card('안 받은 선물', String(n('gifts_pending')), n('gifts_stale') > 0),
    card('정지 중', String(n('banned_now')), n('banned_now') > 0),
  )
  content.append(cards)

  // 가입 추이 — 그림과 수치를 같이 둔다. 그림만 있으면 낭독이 비고,
  // 수치만 있으면 흐름이 안 보인다
  const signups = (stats.signups_14d ?? []) as { day: string; n: number }[]
  const trend = document.createElement('section')
  const h2 = document.createElement('h2')
  h2.textContent = '가입 추이 (14일)'
  trend.append(h2)
  if (signups.length === 0) {
    trend.append(note('최근 14일 가입이 없다.'))
  } else {
    const bars = document.createElement('div')
    bars.className = 'admin-bars'
    bars.setAttribute('role', 'img')
    bars.setAttribute(
      'aria-label',
      `가입 추이: ${signups.map((s) => `${s.day.slice(5)} ${s.n}명`).join(', ')}`,
    )
    for (const bar of signupsToBars(signups)) {
      const col = document.createElement('div')
      col.className = 'admin-bar'
      const fill = document.createElement('div')
      fill.className = 'admin-bar-fill'
      fill.style.height = `${Math.max(4, Math.round(bar.ratio * 100))}%`
      const day = document.createElement('span')
      day.textContent = bar.day.slice(5)
      col.append(fill, day)
      bars.append(col)
    }
    trend.append(bars)
  }
  content.append(trend)

  // 상한 근접 계정 — 남용의 조기 신호
  const giftNear = (stats.gift_cap_near ?? []) as { user_id: string; n: number }[]
  const inviteNear = (stats.invite_cap_near ?? []) as { user_id: string; n: number }[]
  if (giftNear.length || inviteNear.length) {
    const warn = document.createElement('section')
    const h = document.createElement('h2')
    h.textContent = '하루 상한 근접'
    warn.append(
      h,
      note('선물은 하루 10건, 초대는 30건이 상한이다. 상한 부근을 맴도는 계정은 들여다볼 가치가 있다.'),
      dataTable(
        '상한 근접 계정',
        ['종류', '사용자', '오늘'],
        [
          ...giftNear.map((g) => ['선물', g.user_id, `${g.n}건`]),
          ...inviteNear.map((g) => ['초대', g.user_id, `${g.n}건`]),
        ],
      ),
    )
    content.append(warn)
  }

  content.append(
    note('무료 한도(월간 사용자 5만·실시간 동시 200)와 메일 발송 상태는 서비스 대시보드에서 직접 본다.'),
  )

  await renderPlayStats(content)
}

/**
 * 게임 현황 — 사람들이 실제로 어떻게 놀고 있는가.
 * 대시보드 아래쪽에 따로 붙는다. 위쪽 지표가 못 뜨더라도 이건 보이게.
 */
async function renderPlayStats(content: HTMLElement): Promise<void> {
  const section = document.createElement('section')
  const h = document.createElement('h2')
  h.textContent = '게임 현황'
  section.append(
    h,
    note(
      '함께 하기로 남긴 기록만 보인다 — 혼자 하기는 그 기기에만 저장되므로 서버가 알 수 없다.',
    ),
  )
  content.append(section)

  let play: Record<string, unknown>
  try {
    play = await fetchPlayStats()
  } catch (e) {
    section.append(errorLine((e as Error).message))
    return
  }

  const num = (k: string) => Number(play[k] ?? 0)
  const map = (k: string) => (play[k] ?? {}) as Record<string, number>

  const cards = document.createElement('div')
  cards.className = 'admin-cards'
  cards.append(
    card('모험 기록', String(num('saves_total'))),
    card('모험 중인 사람', String(num('players'))),
    card('하루 안에 걸음', String(num('active_1d'))),
    card('평균 동전', String(num('gold_avg'))),
    card('평균 재료', String(num('materials_avg'))),
  )
  section.append(cards)

  const xps = (play.xp ?? []) as number[]
  const levels = levelSpread(xps, (xp) => levelForXp(progression.xpTable, xp))

  section.append(
    distribution('내가 맡은 직업', map('jobs_self'), jobName),
    distribution('파티에 들어간 직업 (동료 포함)', map('jobs'), jobName),
    distribution(
      '지금 서 있는 스테이지',
      map('stages'),
      (k) => `${Number(k) + 1}. ${STAGE_NAMES[Number(k)] ?? '알 수 없음'}`,
    ),
    distribution('깬 스테이지 수', map('cleared'), (k) =>
      k === '0' ? '아직 없음' : `${k}개 깸`,
    ),
    distribution('고른 특성', map('traits'), traitName),
    distribution('레벨', levels, (k) => `${k}레벨`),
  )
}
