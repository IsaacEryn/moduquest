import { supabase } from '../net/supabaseClient'
import type { Route } from './router'

/**
 * CMS풍 뼈대 — 좌측 사이드바에 메뉴, 우측에 내용.
 * 게임과는 다른 문법의 화면이라 스타일도 따로 간다(admin.css).
 */

const MENU: { hash: string; label: string; match: Route['view'] }[] = [
  { hash: '#/dashboard', label: '대시보드', match: 'dashboard' },
  { hash: '#/users', label: '사용자', match: 'users' },
  { hash: '#/logs', label: '로그', match: 'logs' },
  { hash: '#/resources', label: '게임 리소스', match: 'resources' },
]

export interface Layout {
  /** 뷰가 그려 넣는 자리 */
  content: HTMLElement
  /** 현재 경로에 맞춰 사이드바 강조를 갱신한다 */
  setActive: (route: Route) => void
}

export function mountLayout(root: HTMLElement, nickname: string): Layout {
  root.replaceChildren()

  const bar = document.createElement('header')
  bar.className = 'admin-topbar'
  const title = document.createElement('strong')
  title.textContent = '모두의 원정대 — 운영'
  const who = document.createElement('span')
  who.className = 'admin-who'
  who.textContent = nickname
  const toGame = document.createElement('a')
  toGame.href = './'
  toGame.textContent = '게임으로'
  const out = document.createElement('button')
  out.type = 'button'
  out.textContent = '로그아웃'
  out.addEventListener('click', () => {
    void supabase()
      .auth.signOut()
      .then(() => location.replace('./'))
  })
  const right = document.createElement('div')
  right.className = 'admin-topbar-right'
  right.append(who, toGame, out)
  bar.append(title, right)

  const shell = document.createElement('div')
  shell.className = 'admin-shell'

  const nav = document.createElement('nav')
  nav.className = 'admin-nav'
  nav.setAttribute('aria-label', '운영 메뉴')
  const links: HTMLAnchorElement[] = []
  for (const item of MENU) {
    const a = document.createElement('a')
    a.href = item.hash
    a.textContent = item.label
    a.dataset.view = item.match
    links.push(a)
    nav.append(a)
  }

  const content = document.createElement('main')
  content.className = 'admin-content'
  content.id = 'admin-content'

  shell.append(nav, content)
  root.append(bar, shell)

  return {
    content,
    setActive: (route) => {
      for (const a of links) {
        if (a.dataset.view === route.view) a.setAttribute('aria-current', 'page')
        else a.removeAttribute('aria-current')
      }
    },
  }
}

// --- 뷰들이 같이 쓰는 조립 도구 ---

export function heading(text: string): HTMLElement {
  const h = document.createElement('h1')
  h.textContent = text
  return h
}

export function note(text: string): HTMLElement {
  const p = document.createElement('p')
  p.className = 'admin-note'
  p.textContent = text
  return p
}

export function errorLine(text: string): HTMLElement {
  const p = document.createElement('p')
  p.className = 'admin-error'
  p.setAttribute('role', 'alert')
  p.textContent = text
  return p
}

/** 접근성 있는 데이터 표 — 모든 목록 화면이 이 하나로 그린다 */
export function dataTable(
  caption: string,
  headers: string[],
  rows: (string | HTMLElement)[][],
): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'admin-table-wrap'
  const table = document.createElement('table')
  const cap = document.createElement('caption')
  cap.className = 'visually-hidden'
  cap.textContent = caption
  table.append(cap)
  const thead = document.createElement('thead')
  const tr = document.createElement('tr')
  for (const h of headers) {
    const th = document.createElement('th')
    th.scope = 'col'
    th.textContent = h
    tr.append(th)
  }
  thead.append(tr)
  const tbody = document.createElement('tbody')
  for (const row of rows) {
    const trb = document.createElement('tr')
    row.forEach((cell, i) => {
      const td = document.createElement('td')
      // 좁은 화면에서 표가 카드로 펴질 때 머리글 대신 붙는 라벨
      if (headers[i]) td.dataset.label = headers[i]
      if (typeof cell === 'string') td.textContent = cell
      else td.append(cell)
      trb.append(td)
    })
    tbody.append(trb)
  }
  table.append(thead, tbody)
  wrap.append(table)
  return wrap
}

/**
 * 목록 아래의 쪽 이동. 화면과 낭독이 같은 문장을 본다 —
 * 스크린리더 사용자가 "몇 쪽 중 몇 쪽"을 버튼 눌러 가며 알아낼 일이 없어야 한다.
 */
export function pager(
  state: { page: number; pages: number; label: string; hasPrev: boolean; hasNext: boolean },
  go: (page: number) => void,
): HTMLElement {
  const nav = document.createElement('nav')
  nav.className = 'admin-pager'
  nav.setAttribute('aria-label', '쪽 이동')

  const prev = button('← 이전', () => go(state.page - 1))
  prev.disabled = !state.hasPrev
  const next = button('다음 →', () => go(state.page + 1))
  next.disabled = !state.hasNext

  const status = document.createElement('p')
  status.className = 'admin-pager-status'
  status.setAttribute('role', 'status')
  status.textContent =
    state.pages > 1 ? `${state.page + 1} / ${state.pages}쪽 — ${state.label}` : state.label

  nav.append(prev, status, next)

  // 쪽이 여럿이면 번호로도 건너뛴다. 앞뒤 두 칸씩만 보여 줄이 길어지지 않게
  if (state.pages > 1) {
    const nums = document.createElement('div')
    nums.className = 'admin-pager-nums'
    const from = Math.max(0, state.page - 2)
    const to = Math.min(state.pages - 1, state.page + 2)
    if (from > 0) nums.append(numButton(0, state, go), ellipsis())
    for (let i = from; i <= to; i++) nums.append(numButton(i, state, go))
    if (to < state.pages - 1) nums.append(ellipsis(), numButton(state.pages - 1, state, go))
    nav.append(nums)
  }
  return nav
}

function numButton(
  i: number,
  state: { page: number },
  go: (page: number) => void,
): HTMLButtonElement {
  const b = button(String(i + 1), () => go(i))
  if (i === state.page) {
    b.setAttribute('aria-current', 'page')
    b.className = 'admin-pager-now'
    b.disabled = true
  }
  return b
}

function ellipsis(): HTMLElement {
  const s = document.createElement('span')
  s.className = 'admin-pager-gap'
  s.textContent = '…'
  s.setAttribute('aria-hidden', 'true')
  return s
}

export function button(
  label: string,
  onClick: () => void | Promise<void>,
  className = '',
): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = label
  if (className) b.className = className
  b.addEventListener('click', () => {
    b.disabled = true
    void Promise.resolve(onClick()).finally(() => {
      b.disabled = false
    })
  })
  return b
}
