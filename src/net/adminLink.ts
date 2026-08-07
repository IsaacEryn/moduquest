import { shouldCheckAdmin } from '../admin/format'
import { ADMIN_PATH_KEY } from '../admin/guard'

/**
 * 타이틀 우측 상단의 운영 페이지 진입 링크.
 *
 * 주소는 이 코드 어디에도 없다 — 운영 페이지가 자기 방문 때 localStorage에
 * 남긴 것을 읽을 뿐이다. 그 키와 로그인 흔적이 둘 다 있을 때만 서버에
 * 역할을 물어본다. 비로그인 사용자(솔로)는 이 파일이 불려도 요청 0건으로
 * 끝난다 — 실제로는 main이 게이트를 먼저 보므로 불리지도 않는다.
 */
export async function attachAdminLink(): Promise<void> {
  const path = localStorage.getItem(ADMIN_PATH_KEY)
  if (!shouldCheckAdmin(Object.keys(localStorage), path !== null)) return

  const { supabase } = await import('./supabaseClient')
  const sb = supabase()
  const { data } = await sb.auth.getSession()
  const userId = data.session?.user?.id
  if (!userId) return

  const { data: row } = await sb
    .from('profiles')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle()
  if (row?.role !== 'admin') {
    // 강등됐거나 다른 계정이다 — 키를 지워 다음 부팅부터는 묻지도 않는다
    localStorage.removeItem(ADMIN_PATH_KEY)
    return
  }

  const a = document.createElement('a')
  a.id = 'admin-link'
  a.href = path!
  a.textContent = '운영'
  // #ui는 화면 전환마다 통째로 비워진다 — 밖에 둬야 살아남는다.
  // 보이고 숨는 것은 CSS(body[data-mode='title'])가 맡는다
  document.getElementById('app')?.append(a)
}
