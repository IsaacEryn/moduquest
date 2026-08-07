import items from '../../data/items.json'
import {
  PAGE,
  fetchAudit,
  fetchLog,
  fetchLoginLog,
  fetchProfiles,
  fetchWithdrawals,
  nicknameMap,
} from '../api'
import {
  WITHDRAW_REASON_KO,
  auditTargetName,
  describeAudit,
  fullTime,
  pagerState,
  relativeTime,
} from '../format'
import { dataTable, errorLine, heading, note, pager } from '../layout'

/**
 * 기록 — 서버에 남는 모든 흔적을 탭으로.
 * uuid 대신 닉네임을 보여준다. 표는 dataTable 하나로 통일.
 */

const TABS: { key: string; label: string }[] = [
  { key: 'logins', label: '로그인 현황' },
  { key: 'signups', label: '가입' },
  { key: 'gifts', label: '선물' },
  { key: 'friends', label: '친구' },
  { key: 'invites', label: '초대' },
  { key: 'saves', label: '저장' },
  { key: 'withdrawals', label: '탈퇴' },
  { key: 'audit', label: '운영 조치' },
]

/** 아이템 id를 사람이 아는 이름으로 — 표에 potion_big이라고 적을 이유가 없다 */
function itemName(id: unknown): string {
  const key = String(id ?? '')
  const item = (items as Record<string, { name?: string }>)[key]
  return item?.name ?? key
}

export async function renderLogs(content: HTMLElement, tab: string): Promise<void> {
  let page = 0
  const active = TABS.some((t) => t.key === tab) ? tab : 'logins'

  const rerender = async () => {
    /** 이 탭의 전체 건수 — 쪽 이동이 "몇 쪽 중 몇 쪽"을 말하는 근거 */
    let total = 0
    content.replaceChildren(heading('로그'))

    const tabsNav = document.createElement('nav')
    tabsNav.className = 'admin-tabs'
    tabsNav.setAttribute('aria-label', '로그 종류')
    for (const t of TABS) {
      const a = document.createElement('a')
      a.href = `#/logs/${t.key}`
      a.textContent = t.label
      if (t.key === active) a.setAttribute('aria-current', 'page')
      tabsNav.append(a)
    }
    content.append(tabsNav, note('불러오는 중…'))

    try {
      const names = await nicknameMap()
      const who = (id: unknown) => names.get(id as string) ?? String(id ?? '').slice(0, 8)
      let table: HTMLElement
      let count = 0

      if (active === 'logins') {
        const { rows, total: n } = await fetchLoginLog(page)
        count = rows.length
        total = n
        table = dataTable(
          '계정별 로그인 현황',
          ['닉네임', '계정', '마지막 로그인', '가입', '메일 확인'],
          rows.map((r) => [
            r.nickname,
            r.email,
            r.last_sign_in ? relativeTime(r.last_sign_in) : '한 번도 없음',
            fullTime(r.signed_up),
            r.confirmed_at ? '확인됨' : '아직',
          ]),
        )
      } else if (active === 'signups') {
        const { rows, total: n } = await fetchProfiles(page, '')
        count = rows.length
        total = n
        table = dataTable(
          '가입 기록',
          ['시각', '닉네임', '친구 코드'],
          rows.map((r) => [fullTime(r.created_at), r.nickname, r.friend_code]),
        )
      } else if (active === 'gifts') {
        const { rows, total: n } = await fetchLog('gifts', 'from_user, to_user, item_id, qty, status, created_at', 'created_at', page)
        count = rows.length
        total = n
        table = dataTable(
          '선물 기록',
          ['시각', '보낸 사람', '받는 사람', '물건', '수량', '상태'],
          rows.map((r) => [
            fullTime(r.created_at as string),
            who(r.from_user),
            who(r.to_user),
            itemName(r.item_id),
            `${r.qty}개`,
            r.status === 'claimed' ? '받음' : '대기',
          ]),
        )
      } else if (active === 'friends') {
        const { rows, total: n } = await fetchLog('friendships', 'requester, addressee, status, created_at', 'created_at', page)
        count = rows.length
        total = n
        table = dataTable(
          '친구 기록',
          ['시각', '신청한 사람', '받은 사람', '상태'],
          rows.map((r) => [
            fullTime(r.created_at as string),
            who(r.requester),
            who(r.addressee),
            r.status === 'accepted' ? '친구' : '대기',
          ]),
        )
      } else if (active === 'invites') {
        const { rows, total: n } = await fetchLog('party_invites', 'from_user, to_user, created_at', 'created_at', page)
        count = rows.length
        total = n
        table = dataTable(
          '모험단 초대 기록',
          ['시각', '부른 사람', '불린 사람'],
          rows.map((r) => [fullTime(r.created_at as string), who(r.from_user), who(r.to_user)]),
        )
      } else if (active === 'withdrawals') {
        const { rows, total: n } = await fetchWithdrawals(page)
        count = rows.length
        total = n
        table = dataTable(
          '탈퇴 기록',
          ['시각', '사유', '남긴 말'],
          rows.map((r) => [
            fullTime(r.created_at),
            WITHDRAW_REASON_KO[r.reason] ?? r.reason,
            r.detail?.trim() || '—',
          ]),
        )
      } else if (active === 'saves') {
        // snapshot 컬럼은 안 읽는다 — 행마다 최대 64KB
        const { rows, total: n } = await fetchLog('user_saves', 'user_id, slot, updated_at', 'updated_at', page)
        count = rows.length
        total = n
        table = dataTable(
          '저장 갱신 기록',
          ['시각', '사용자', '자리'],
          rows.map((r) => [
            fullTime(r.updated_at as string),
            who(r.user_id),
            `${Number(r.slot) + 1}번 자리`,
          ]),
        )
      } else {
        const { rows, total: n } = await fetchAudit(page)
        count = rows.length
        total = n
        table = dataTable(
          '운영 조치 기록',
          ['시각', '관리자', '한 일'],
          rows.map((r) => {
            const detail = (r.detail ?? null) as Record<string, unknown> | null
            const target = auditTargetName(detail, names.get(r.target as string), r.target)
            return [
              fullTime(r.created_at as string),
              who(r.actor),
              describeAudit(r.action as string, detail, target),
            ]
          }),
        )
      }

      content.replaceChildren(heading('로그'), tabsNav, table)
      if (count === 0) content.append(note(page === 0 ? '기록이 없다.' : '더 이상 없다.'))

      content.append(
        pager(pagerState(page, total, PAGE), (next) => {
          page = next
          void rerender()
        }),
      )
    } catch (e) {
      content.replaceChildren(heading('로그'), tabsNav, errorLine((e as Error).message))
    }
  }

  await rerender()
}
