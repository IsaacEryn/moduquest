import { supabase } from '../net/supabaseClient'
import './admin.css'
import { guard } from './guard'
import { mountLayout } from './layout'
import { startRouter } from './router'
import { renderDashboard } from './views/dashboard'
import { renderLogs } from './views/logs'
import { renderResources } from './views/resources'
import { renderUsers } from './views/users'

/**
 * 운영 페이지 입구. 문지기를 통과해야 화면이 생기고,
 * 화면이 생겨도 데이터는 서버의 RLS가 관리자에게만 연다.
 */
async function boot(): Promise<void> {
  const root = document.getElementById('admin-app')!
  let userId: string
  try {
    userId = await guard()
  } catch {
    return // guard가 이미 게임으로 돌려보냈다
  }

  // 상단 바에 지금 누구로 들어와 있는지 보여준다
  const { data: me } = await supabase()
    .from('profiles')
    .select('nickname')
    .eq('user_id', userId)
    .maybeSingle()

  const layout = mountLayout(root, me?.nickname ?? '관리자')
  startRouter((route) => {
    layout.setActive(route)
    if (route.view === 'dashboard') void renderDashboard(layout.content)
    else if (route.view === 'users') void renderUsers(layout.content, userId)
    else if (route.view === 'logs') void renderLogs(layout.content, route.tab)
    else renderResources(layout.content, route.file)
  })
}

void boot()
