import { fetchStats } from '../api'
import { signupsToBars } from '../format'
import { dataTable, errorLine, heading, note } from '../layout'

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
}
