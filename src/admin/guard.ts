import { supabase } from '../net/supabaseClient'

/**
 * 문지기 — 여기서 튕겨내는 것은 예의일 뿐이고, 실질 방어는 서버의 RLS다.
 * 이 파일을 통째로 우회해도 관리자가 아니면 어떤 행도 읽지 못한다.
 */

export type Access = { kind: 'allow'; userId: string } | { kind: 'deny' }

/** 판정만 떼어 낸 순수 함수 — 시험이 세션·역할 조합을 전부 훑는다 */
export function decideAccess(userId: string | null, role: string | null): Access {
  if (!userId) return { kind: 'deny' }
  if (role !== 'admin') return { kind: 'deny' }
  return { kind: 'allow', userId }
}

/** 통과하면 내 userId, 아니면 게임으로 돌려보낸다 */
export async function guard(): Promise<string> {
  const sb = supabase()
  const { data } = await sb.auth.getSession()
  const userId = data.session?.user?.id ?? null
  let role: string | null = null
  if (userId) {
    const { data: row } = await sb
      .from('profiles')
      .select('role')
      .eq('user_id', userId)
      .maybeSingle()
    role = row?.role ?? null
  }
  const access = decideAccess(userId, role)
  if (access.kind !== 'allow') {
    // 로그인 화면을 따로 두지 않는다 — 게임에서 로그인하고 다시 온다.
    // 같은 오리진이라 세션이 공유되므로 그걸로 충분하다
    location.replace('./')
    throw new Error('denied')
  }
  // 주소를 서버에 적어 둔다. 게임 타이틀의 진입 링크가 관리자에게만 이 값을
  // 물어본다 — 관리자가 비밀 주소를 외우거나 기기마다 다시 입력할 일이 없다.
  // 실패해도 운영 페이지 자체는 열린다(링크 편의가 본문을 막지 않는다)
  await sb.rpc('set_admin_path', { path: location.pathname })
  return access.userId
}
