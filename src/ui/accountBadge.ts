/**
 * 타이틀 우측 상단의 계정 배지 — 로그인돼 있는지가 한눈에 보이는 자리.
 *
 * 이 파일은 첫 화면 번들에 실린다. 그래서 서버 코드를 정적으로 당기지 않는다 —
 * 로그인 흔적(localStorage)이 있을 때만 동적 import로 이름을 물어본다.
 * 로그인한 적 없는 사람(솔로)의 브라우저에서는 요청이 한 건도 나가지 않는다.
 */

/** 로그인 흔적 — 세션 토큰 키가 남아 있는가. 판정은 이 함수 하나로 통일한다 */
export function hasAuthTrace(): boolean {
  return Object.keys(localStorage).some((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
}

/** 타이틀 링크 묶음(#title-links)을 보장하고 돌려준다 — 배지와 운영 링크가 나란히 선다 */
export function titleLinks(): HTMLElement {
  let wrap = document.getElementById('title-links')
  if (!wrap) {
    wrap = document.createElement('div')
    wrap.id = 'title-links'
    document.getElementById('app')?.append(wrap)
  }
  return wrap
}

/**
 * 배지를 다시 그린다. 로그인·로그아웃 때마다 부른다.
 * 비로그인: "로그인" 버튼. 로그인: 닉네임 배지(누르면 내 정보).
 */
export function refreshAccountBadge(openAccount: () => void): void {
  document.getElementById('account-badge')?.remove()
  const badge = document.createElement('button')
  badge.type = 'button'
  badge.id = 'account-badge'

  if (!hasAuthTrace()) {
    badge.textContent = '로그인'
    badge.setAttribute('aria-label', '로그인 — 계정이 있으면 기록이 계정에 남는다')
    badge.addEventListener('click', openAccount)
    titleLinks().prepend(badge)
    return
  }

  // 흔적이 있다 — 이름은 서버가 안다. 이름이 오기 전에도 배지는 서 있어야 한다
  badge.textContent = '내 계정'
  badge.classList.add('signed-in')
  badge.addEventListener('click', openAccount)
  titleLinks().prepend(badge)
  void import('../net/auth').then(async ({ currentProfile }) => {
    try {
      const profile = await currentProfile()
      if (!badge.isConnected) return
      if (profile) {
        badge.textContent = profile.nickname
        badge.setAttribute('aria-label', `${profile.nickname} — 내 정보 열기`)
      } else {
        // 토큰이 죽어 있었다 — 로그인 배지로 돌아간다
        badge.textContent = '로그인'
        badge.classList.remove('signed-in')
      }
    } catch {
      // 서버가 안 닿아도 배지는 남는다 — 눌러 보면 그때의 진실이 나온다
    }
  })
}
