import { PAGE, fetchAudit, fetchLog, fetchLoginLog, fetchProfiles, nicknameMap } from '../api'
import { LOGIN_ACTION_KO, auditTargetName, describeAudit, fullTime, pagerState } from '../format'
import { dataTable, errorLine, heading, note, pager } from '../layout'

/**
 * 기록 — 서버에 남는 모든 흔적을 탭으로.
 * uuid 대신 닉네임을 보여준다. 표는 dataTable 하나로 통일.
 */

const TABS: { key: string; label: string }[] = [
  { key: 'logins', label: '로그인' },
  { key: 'signups', label: '가입' },
  { key: 'gifts', label: '선물' },
  { key: 'friends', label: '친구' },
  { key: 'invites', label: '초대' },
  { key: 'saves', label: '저장' },
  { key: 'audit', label: '운영 조치' },
]

export async function renderLogs(content: HTMLElement, tab: string): Promise<void> {
  let page = 0
  const active = TABS.some((t) => t.key === tab) ? tab : 'logins'

  const rerender = async () => {
    /** 이 탭의 전체 건수. 로그인 기록만은 서버가 총계를 주지 않아 -1로 둔다 */
    let total = -1
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
        const rows = await fetchLoginLog(page)
        count = rows.length
        table = dataTable(
          '로그인 기록',
          ['시각', '사건', '계정', '접속 주소'],
          rows.map((r) => [
            fullTime(r.at),
            LOGIN_ACTION_KO[r.action] ?? r.action,
            r.email ?? '-',
            r.ip ?? '-',
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
            String(r.item_id),
            String(r.qty),
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
            `${Number(r.slot) + 1}번`,
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

      // 총계를 아는 탭은 "몇 쪽 중 몇 쪽"까지 말한다. 로그인 기록만은 총계를
      // 못 받으므로 한 쪽 가득 찼는지로 다음 쪽 유무를 짐작한다
      const state =
        total >= 0
          ? pagerState(page, total, PAGE)
          : {
              page,
              pages: count === PAGE ? page + 2 : page + 1,
              label: count === 0 ? '기록 없음' : `${page * PAGE + 1}–${page * PAGE + count}번째`,
              hasPrev: page > 0,
              hasNext: count === PAGE,
            }
      content.append(
        pager(state, (next) => {
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
