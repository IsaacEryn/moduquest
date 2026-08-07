import { PAGE, fetchAudit, fetchLog, fetchProfiles, nicknameMap } from '../api'
import { fullTime } from '../format'
import { button, dataTable, errorLine, heading, note } from '../layout'

/**
 * 기록 — 서버에 남는 모든 흔적을 탭으로.
 * uuid 대신 닉네임을 보여준다. 표는 dataTable 하나로 통일.
 */

const TABS: { key: string; label: string }[] = [
  { key: 'signups', label: '가입' },
  { key: 'gifts', label: '선물' },
  { key: 'friends', label: '친구' },
  { key: 'invites', label: '초대' },
  { key: 'saves', label: '저장 갱신' },
  { key: 'audit', label: '운영 조치' },
]

export async function renderLogs(content: HTMLElement, tab: string): Promise<void> {
  let page = 0
  const active = TABS.some((t) => t.key === tab) ? tab : 'signups'

  const rerender = async () => {
    content.replaceChildren(heading('기록'))

    const tabsNav = document.createElement('nav')
    tabsNav.className = 'admin-tabs'
    tabsNav.setAttribute('aria-label', '기록 종류')
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

      if (active === 'signups') {
        const rows = await fetchProfiles(page, '')
        count = rows.length
        table = dataTable(
          '가입 기록',
          ['시각', '닉네임', '친구 코드'],
          rows.map((r) => [fullTime(r.created_at), r.nickname, r.friend_code]),
        )
      } else if (active === 'gifts') {
        const rows = await fetchLog('gifts', 'from_user, to_user, item_id, qty, status, created_at', 'created_at', page)
        count = rows.length
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
        const rows = await fetchLog('friendships', 'requester, addressee, status, created_at', 'created_at', page)
        count = rows.length
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
        const rows = await fetchLog('party_invites', 'from_user, to_user, created_at', 'created_at', page)
        count = rows.length
        table = dataTable(
          '모험단 초대 기록',
          ['시각', '부른 사람', '불린 사람'],
          rows.map((r) => [fullTime(r.created_at as string), who(r.from_user), who(r.to_user)]),
        )
      } else if (active === 'saves') {
        // snapshot 컬럼은 안 읽는다 — 행마다 최대 64KB
        const rows = await fetchLog('user_saves', 'user_id, slot, updated_at', 'updated_at', page)
        count = rows.length
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
        const rows = await fetchAudit(page)
        count = rows.length
        const ACTION_KO: Record<string, string> = {
          nickname_reset: '닉네임 초기화',
          ban: '정지',
          unban: '정지 해제',
          delete_user: '계정 삭제',
          email_lookup: '이메일 조회',
        }
        table = dataTable(
          '운영 조치 기록',
          ['시각', '관리자', '조치', '대상', '내용'],
          rows.map((r) => [
            fullTime(r.created_at as string),
            who(r.actor),
            ACTION_KO[r.action as string] ?? String(r.action),
            who(r.target),
            r.detail ? JSON.stringify(r.detail) : '',
          ]),
        )
      }

      content.replaceChildren(heading('기록'), tabsNav, table)
      if (count === 0) content.append(note(page === 0 ? '기록이 없다.' : '더 이상 없다.'))

      const pager = document.createElement('div')
      pager.className = 'admin-pager'
      if (page > 0)
        pager.append(
          button('이전', () => {
            page -= 1
            void rerender()
          }),
        )
      if (count === PAGE)
        pager.append(
          button('다음', () => {
            page += 1
            void rerender()
          }),
        )
      content.append(pager)
    } catch (e) {
      content.replaceChildren(heading('기록'), tabsNav, errorLine((e as Error).message))
    }
  }

  await rerender()
}
