import type { Theme } from '../ui/optionsStore'
import { THEMES } from '../ui/optionsStore'
import { supabase } from './supabaseClient'

/**
 * 개인 설정의 기기 간 동기화 — 지금은 테마 하나.
 *
 * 볼륨·자막은 일부러 동기화하지 않는다. 그건 기기의 사정(스피커가 있는지,
 * 화면이 작은지)에 붙는 값이라 계정을 따라다니면 오히려 어긋난다.
 *
 * 충돌 규칙은 하나다: 서버가 이긴다 — 마지막으로 저장한 기기의 값이
 * 다음 기기로 온다. 이 모듈은 로그인한 사람에게만 동적으로 불려 온다.
 */

export async function pullTheme(): Promise<Theme | null> {
  const sb = supabase()
  const { data: session } = await sb.auth.getSession()
  const uid = session.session?.user?.id
  if (!uid) return null
  const { data } = await sb
    .from('user_settings')
    .select('theme')
    .eq('user_id', uid)
    .maybeSingle()
  const t = data?.theme
  return typeof t === 'string' && (THEMES as readonly string[]).includes(t) ? (t as Theme) : null
}

export async function pushTheme(theme: Theme): Promise<void> {
  const sb = supabase()
  const { data: session } = await sb.auth.getSession()
  const uid = session.session?.user?.id
  if (!uid) return
  await sb
    .from('user_settings')
    .upsert({ user_id: uid, theme, updated_at: new Date().toISOString() })
}
