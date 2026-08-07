import { supabase } from './supabaseClient'

/**
 * 타이틀 우측 상단의 운영 페이지 진입 링크.
 *
 * 주소는 이 코드에도 저장소에도 없다 — 서버에 관리자로 확인된 뒤, 서버가
 * 알려 준 경로로만 링크를 만든다. 관리자가 슬러그를 외우고 다닐 이유가 없다.
 *
 * 이 파일은 로그인한 사람에게만 동적으로 불려 온다(main.ts의 게이트).
 * 로그인하지 않은 사람의 브라우저에는 이 코드가 내려오지도 않는다.
 */
export async function attachAdminLink(): Promise<void> {
  const sb = supabase()
  const { data } = await sb.auth.getSession()
  const userId = data.session?.user?.id
  if (!userId) return

  const { data: row } = await sb
    .from('profiles')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle()
  if (row?.role !== 'admin') return

  // 주소는 서버가 쥐고 있다. 관리자에게만 응답하는 함수라, 이 호출이 성공했다는
  // 것 자체가 이미 관리자라는 뜻이다
  const { data: path, error } = await sb.rpc('admin_path')
  if (error || typeof path !== 'string' || !path) return

  const a = document.createElement('a')
  a.id = 'admin-link'
  a.className = 'title-link'
  a.href = path
  a.textContent = '운영'
  // #ui는 화면 전환마다 통째로 비워진다 — 밖에 둬야 살아남는다.
  // 계정 배지와 나란히 서도록 타이틀 링크 묶음에 넣는다
  const wrap = document.getElementById('title-links') ?? document.getElementById('app')
  wrap?.append(a)
}

/** 로그아웃·계정 전환 때 링크를 거둔다 — 남아 있으면 남의 화면에 남의 문이 보인다 */
export function removeAdminLink(): void {
  document.getElementById('admin-link')?.remove()
}
