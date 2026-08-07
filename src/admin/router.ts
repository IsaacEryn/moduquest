/**
 * 해시 라우팅 — 파일명이 배포 때 비밀 이름으로 바뀌므로 경로 라우팅은 못 쓴다.
 * 해시는 파일명과 무관하고, 뒤로 가기가 공짜로 따라온다.
 */

export type Route =
  | { view: 'dashboard' }
  | { view: 'users' }
  | { view: 'logs'; tab: string }
  | { view: 'resources'; file: string }

/** 모르는 해시는 대시보드로 — 관리자 페이지에서 404는 만들 것이 없다 */
export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  switch (parts[0]) {
    case 'users':
      return { view: 'users' }
    case 'logs':
      return { view: 'logs', tab: parts[1] ?? 'signups' }
    case 'resources':
      return { view: 'resources', file: parts[1] ?? 'items' }
    default:
      return { view: 'dashboard' }
  }
}

export function startRouter(render: (route: Route) => void): void {
  const go = () => render(parseRoute(location.hash))
  window.addEventListener('hashchange', go)
  go()
}
