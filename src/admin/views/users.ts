import {
  PAGE,
  deleteUser,
  fetchLastSignin,
  fetchProfiles,
  fetchSaveActivity,
  lookupEmail,
  setBan,
  setNickname,
  type ProfileRow,
} from '../api'
import { banLabel, latestSaveByUser, pagerState, relativeTime } from '../format'
import { button, dataTable, errorLine, heading, note, pager } from '../layout'

/**
 * 사용자 관리 — 목록·검색과 조치 세 가지(닉네임 초기화·정지·삭제).
 * 조치는 전부 감사 로그와 짝으로 움직이고, 삭제는 닉네임을 다시 입력해야 한다.
 */

export async function renderUsers(content: HTMLElement, actor: string): Promise<void> {
  let page = 0
  let search = ''

  const rerender = async () => {
    content.replaceChildren(heading('사용자'), note('불러오는 중…'))
    let rows: ProfileRow[]
    let total = 0
    let saved: Map<string, string>
    let signedIn: Map<string, string>
    try {
      const [profiles, saves, logins] = await Promise.all([
        fetchProfiles(page, search),
        fetchSaveActivity(),
        fetchLastSignin(),
      ])
      rows = profiles.rows
      total = profiles.total
      saved = latestSaveByUser(saves)
      signedIn = logins
    } catch (e) {
      content.replaceChildren(heading('사용자'), errorLine((e as Error).message))
      return
    }

    content.replaceChildren(heading('사용자'))

    // 검색 — 닉네임 일부 또는 친구 코드 8자
    const form = document.createElement('form')
    form.className = 'admin-search'
    const label = document.createElement('label')
    label.htmlFor = 'user-search'
    label.textContent = '닉네임 또는 친구 코드'
    const input = document.createElement('input')
    input.id = 'user-search'
    input.type = 'search'
    input.value = search
    const go = document.createElement('button')
    go.type = 'submit'
    go.textContent = '찾기'
    form.append(label, input, go)
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      search = input.value.trim()
      page = 0
      void rerender()
    })
    content.append(form)

    const status = errorLine('')
    status.textContent = ''
    content.append(status)
    const say = (text: string) => {
      status.textContent = text
    }

    const tableRows = rows.map((row) => {
      const name = document.createElement('div')
      const strong = document.createElement('strong')
      strong.textContent = row.nickname
      name.append(strong)
      if (row.role === 'admin') {
        const badge = document.createElement('span')
        badge.className = 'admin-badge'
        badge.textContent = '관리자'
        name.append(' ', badge)
      }
      const ban = banLabel(row.banned_until)
      if (ban) {
        const b = document.createElement('span')
        b.className = 'admin-badge admin-badge-warn'
        b.textContent = ban
        name.append(' ', b)
      }

      const actions = document.createElement('div')
      actions.className = 'admin-actions'

      actions.append(
        button('닉네임 바꾸기', async () => {
          // 무엇으로 바꿀지 물어보되, 비워서 넘기면 익명 꼴로 되돌린다 —
          // 사칭 정리와 개별 교정이 같은 자리에서 끝난다
          const typed = prompt(
            `"${row.nickname}"의 새 닉네임 (12자까지).\n비워 두고 확인하면 익명 이름으로 되돌린다.`,
            row.nickname,
          )
          if (typed === null) return
          const next = typed.trim()
          try {
            const applied = await setNickname(actor, row, next || undefined)
            say(`${row.nickname} → ${applied}로 바꿨다.`)
            await rerender()
          } catch (e) {
            say((e as Error).message)
          }
        }),
      )

      if (banLabel(row.banned_until)) {
        actions.append(
          button('정지 해제', async () => {
            try {
              await setBan(actor, row, null)
              say(`정지를 해제했다: ${row.nickname}`)
              await rerender()
            } catch (e) {
              say((e as Error).message)
            }
          }),
        )
      } else {
        const sel = document.createElement('select')
        sel.setAttribute('aria-label', `${row.nickname} 정지 기간`)
        for (const [v, t] of [
          ['', '정지…'],
          ['1', '1일'],
          ['7', '7일'],
          ['30', '30일'],
        ]) {
          const o = document.createElement('option')
          o.value = v
          o.textContent = t
          sel.append(o)
        }
        sel.addEventListener('change', () => {
          const days = Number(sel.value)
          if (!days) return
          if (!confirm(`"${row.nickname}"의 멀티 이용을 ${days}일 정지할까?`)) {
            sel.value = ''
            return
          }
          void setBan(actor, row, days)
            .then(async () => {
              say(`${days}일 정지했다: ${row.nickname}`)
              await rerender()
            })
            .catch((e: Error) => say(e.message))
        })
        actions.append(sel)
      }

      actions.append(
        button(
          '삭제',
          async () => {
            // 삭제는 닉네임 재입력 — 목록에서 손이 미끄러진 것과 결심을 구분한다
            const typed = prompt(
              `계정을 지운다. 저장·선물·친구 관계가 함께 사라지고 되돌릴 수 없다.\n확인하려면 닉네임을 그대로 입력: ${row.nickname}`,
            )
            if (typed === null) return
            if (typed !== row.nickname) {
              say('닉네임이 일치하지 않아 그만두었다.')
              return
            }
            try {
              await deleteUser(row.user_id)
              say(`계정을 지웠다: ${row.nickname}`)
              await rerender()
            } catch (e) {
              say((e as Error).message)
            }
          },
          'admin-danger',
        ),
        button('이메일', async () => {
          try {
            const email = await lookupEmail(row.user_id)
            say(`${row.nickname}의 이메일: ${email} (조회 기록이 남았다)`)
          } catch (e) {
            say((e as Error).message)
          }
        }),
      )

      const lastSave = saved.get(row.user_id)
      const lastLogin = signedIn.get(row.user_id)
      return [
        name,
        row.friend_code,
        relativeTime(row.created_at),
        lastLogin ? relativeTime(lastLogin) : '-',
        lastSave ? relativeTime(lastSave) : '-',
        actions,
      ] as (string | HTMLElement)[]
    })

    content.append(
      dataTable(
        '사용자 목록',
        ['닉네임', '친구 코드', '가입', '최근 로그인', '최근 저장', '조치'],
        tableRows,
      ),
    )
    if (rows.length === 0) content.append(note('결과가 없다.'))

    content.append(
      pager(pagerState(page, total, PAGE), (next) => {
        page = next
        void rerender()
      }),
    )
  }

  await rerender()
}
