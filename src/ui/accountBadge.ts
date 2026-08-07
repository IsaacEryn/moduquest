/**
 * 타이틀 우측 상단의 계정 배지 — 로그인돼 있는지가 한눈에 보이는 자리.
 *
 * 이 파일은 첫 화면 번들에 실린다. 그래서 서버 코드를 정적으로 당기지 않는다 —
 * 로그인 흔적(localStorage)이 있을 때만 동적 import로 이름을 물어본다.
 * 로그인한 적 없는 사람(솔로)의 브라우저에서는 요청이 한 건도 나가지 않는다.
 */

/**
 * 사람 모양 표식. 배지가 "이름표"가 아니라 "내 정보로 가는 문"이라는 것을
 * 글자 없이도 알아보게 한다 — 게임과 같은 픽셀 결로 그린다.
 * 뜻은 옆의 글자와 읽어 주는 이름이 전부 옮기므로 그림은 숨긴다.
 */
function personMark(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 8 8')
  svg.setAttribute('width', '12')
  svg.setAttribute('height', '12')
  svg.setAttribute('aria-hidden', 'true')
  svg.classList.add('badge-mark')
  const path = document.createElementNS(NS, 'path')
  path.setAttribute('fill', 'currentColor')
  // 머리 한 칸, 어깨 두 줄 — 8×8 격자에서 사람으로 읽히는 최소 형태
  path.setAttribute('d', 'M3 1h2v2H3zM2 4h4v1H2zM1 5h6v2H1z')
  svg.append(path)
  return svg
}

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
  badge.className = 'title-link'
  const label = document.createElement('span')
  label.className = 'badge-name'
  badge.append(personMark(), label)
  badge.addEventListener('click', openAccount)

  if (!hasAuthTrace()) {
    label.textContent = '로그인'
    badge.setAttribute('aria-label', '로그인 — 계정이 있으면 기록이 계정에 남는다')
    titleLinks().prepend(badge)
    return
  }

  // 흔적이 있다 — 이름은 서버가 안다. 이름이 오기 전에도 배지는 서 있어야 한다
  label.textContent = '내 정보'
  badge.classList.add('signed-in')
  badge.setAttribute('aria-label', '내 정보 열기')
  titleLinks().prepend(badge)
  void import('../net/auth').then(async ({ currentProfile }) => {
    try {
      const profile = await currentProfile()
      if (!badge.isConnected) return
      if (profile) {
        // 이름만 두면 이름표로 읽힌다 — 무엇을 하는 버튼인지 글자로도 남긴다
        label.textContent = `${profile.nickname} · 내 정보`
        badge.setAttribute('aria-label', `${profile.nickname}으로 로그인 중 — 내 정보 열기`)
      } else {
        // 토큰이 죽어 있었다 — 로그인 배지로 돌아간다
        label.textContent = '로그인'
        badge.classList.remove('signed-in')
        badge.setAttribute('aria-label', '로그인 — 계정이 있으면 기록이 계정에 남는다')
      }
    } catch {
      // 서버가 안 닿아도 배지는 남는다 — 눌러 보면 그때의 진실이 나온다
    }
  })
}
