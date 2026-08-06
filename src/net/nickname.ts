/**
 * 닉네임 검사 — 길이와 "사칭"을 본다.
 *
 * 닉네임은 로비와 선물함에서 다른 사람에게 그대로 보이는 이름이다. 운영자를
 * 사칭한 이름이 거기 있으면, 그 이름을 믿고 무언가를 건네는 사람이 생긴다.
 * 그래서 표시 전에 막는다.
 *
 * 판정은 겉모양이 아니라 **정규화한 뒤의 속**을 본다 — 전각 문자, 사이에 낀
 * 공백·점("관 리 자"), 숫자로 바꿔 쓴 글자(adm1n, 4dmin), 보이지 않는 글자가
 * 전부 같은 말로 모인다. 서버에도 같은 취지의 제약을 두어 두 겹으로 막는다.
 */

/** 숫자·기호로 흉내 낸 글자를 제자리로 돌린다 */
const LOOKALIKE: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
  '|': 'i',
  '!': 'i',
  // l·1·i는 서로를 흉내 내기 쉬우니 한 글자로 모은다(admln = adm1n = admin)
  l: 'i',
}

/** 보이지 않는 글자 — 사이에 끼워 검사를 피하는 데 쓰인다 */
const INVISIBLE = /[\u00ad\u200b-\u200f\u2060-\u2064\u206a-\u206f\ufeff]/g

/** 흉내 낸 글자를 되돌릴 대상 */
const LOOKALIKE_CHARS = /[013457@$|!l]/g

function normalize(nick: string): string {
  return nick
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .toLowerCase()
    .replace(LOOKALIKE_CHARS, (ch) => LOOKALIKE[ch] ?? ch)
    // 남은 것 중 글자와 숫자만 남긴다 — 공백·점·밑줄로 끊어 쓴 것이 붙는다
    .replace(/[^a-z0-9가-힣]/g, '')
}

/**
 * 어디에 섞여 있어도 사칭으로 보는 말.
 * 짧고 흔한 토막(dev, mod, gm 같은 것)은 여기 두지 않는다 — 평범한 이름을
 * 잘못 막는 쪽이 사칭을 놓치는 쪽보다 나쁘다.
 */
const CONTAINS_RAW = [
  '관리자',
  '관리인',
  '관리팀',
  '운영자',
  '운영진',
  '운영팀',
  '어드민',
  '에드민',
  'admin',
  'administrator',
  'moderator',
  'sysop',
  '스태프',
  '스탭',
  'staff',
  '시스템',
  'system',
  '공식',
  'official',
  '개발자',
  'developer',
  '고객센터',
  '고객지원',
  '헬프데스크',
  'helpdesk',
  'moduquest',
  '모두의원정대',
]

/** 이름 전체가 이것이면 사칭 — 다른 말에 섞이면 평범할 수 있는 짧은 토막들 */
const EXACT_RAW = ['gm', 'mod', 'adm', 'op', 'dev', 'bot', '봇', '운영', '관리', '지엠', '겜마']

// 차단 목록도 같은 정규화를 지난다 — 한쪽만 정규화하면 admln 같은 것이 새어 나간다
const CONTAINS = CONTAINS_RAW.map(normalize)
const EXACT = EXACT_RAW.map(normalize)

export interface NicknameCheck {
  ok: boolean
  reason?: string
}

export const NICKNAME_MAX = 12

/**
 * 쓸 수 있는 닉네임인가. 막을 때는 이유를 함께 준다 —
 * 왜 막혔는지 모르는 채로 다시 시도하게 두지 않는다.
 */
export function checkNickname(raw: string): NicknameCheck {
  const nick = raw.trim()
  if (nick.length === 0) return { ok: false, reason: '닉네임을 적어야 한다.' }
  if (nick.length > NICKNAME_MAX) {
    return { ok: false, reason: `닉네임은 ${NICKNAME_MAX}자까지다.` }
  }
  const normalized = normalize(nick)
  if (normalized.length === 0) {
    return { ok: false, reason: '글자나 숫자가 하나는 있어야 한다.' }
  }
  const impersonation =
    CONTAINS.some((word) => normalized.includes(word)) || EXACT.includes(normalized)
  if (impersonation) {
    return {
      ok: false,
      reason: '운영자로 오해받을 수 있는 이름은 쓸 수 없다. 다른 이름을 골라 보자.',
    }
  }
  return { ok: true }
}

/** 예전 이름을 그대로 둔 곳을 위한 짧은 형태 */
export function validNickname(nick: string): boolean {
  return checkNickname(nick).ok
}
