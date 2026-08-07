/**
 * 조사 고르기. 낭독 문장이 코어에서도 만들어지므로 여기에 둔다.
 * 화면에 글자로 나가는 것이 아니라 사람이 듣는 문장이라, 어색하면 바로 티가 난다.
 */

/**
 * 로마자로 끝나는 이름을 우리말로 읽었을 때 받침이 남는 글자들.
 * eryn은 "에린"이라 ㄴ, Isaac은 "아이작"이라 ㄱ이 남는다. 반대로 Chris는
 * "크리스", David는 "데이비드"처럼 받침 없이 끝난다.
 * 완벽한 표는 없다 — 사람마다 읽는 법이 다르므로, 흔한 쪽을 고른다.
 */
const ROMAN_FINAL = new Set(['b', 'c', 'k', 'l', 'm', 'n', 'p'])

/**
 * 받침이 있는지 — "슬라임 1"처럼 숫자로 끝나는 이름도, eryn처럼
 * 로마자로 끝나는 이름도 처리한다. 닉네임은 사람이 짓는 것이라
 * 한글만 온다고 가정할 수 없다.
 */
export function hasFinalConsonant(word: string): boolean {
  const last = word[word.length - 1]
  if (last === undefined) return false
  if (/[0-9]/.test(last)) {
    // 영·일·삼·육·칠·팔로 읽히는 숫자는 받침이 있다
    return '013678'.includes(last)
  }
  const code = word.charCodeAt(word.length - 1)
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 > 0
  const lower = last.toLowerCase()
  if (lower >= 'a' && lower <= 'z') {
    // -ng는 "킹"처럼 ㅇ 받침으로 읽힌다 — 낱자 g와 다르다
    if (word.length >= 2 && word.slice(-2).toLowerCase() === 'ng') return true
    return ROMAN_FINAL.has(lower)
  }
  // 그 밖의 글자는 어떻게 읽힐지 알 수 없다 — 받침 없는 쪽이 덜 어색하다
  return false
}

/**
 * 우리말 수사는 홀로 설 때와 단위 앞에 설 때가 다르다 — "넷"이지만 "네 가지"다.
 * 열까지만 적고 그 밖은 숫자 그대로 읽는 편이 덜 어색하다.
 */
const NATIVE = ['영', '하나', '둘', '셋', '넷', '다섯', '여섯', '일곱', '여덟', '아홉', '열']
/** 단위 앞에 서는 꼴 — 하나→한, 셋→세, 넷→네 */
const ATTR = ['영', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열']

/** 홀로 서는 수 — "물약은 넷이다" */
export function countWord(n: number): string {
  return NATIVE[n] ?? String(n)
}

/** 단위 앞에 서는 수 — "네 가지", "열 개" */
export function attrWord(n: number): string {
  return ATTR[n] ?? String(n)
}

/** 차례를 세는 말 — "첫 번째", "세 번째". 첫만 예외다 */
export function ordinalWord(n: number): string {
  return n === 1 ? '첫' : attrWord(n)
}

/** 을/를, 이/가, 은/는처럼 받침만 보면 되는 조사 */
export function josa(word: string, withFinal: string, withoutFinal: string): string {
  return `${word}${hasFinalConsonant(word) ? withFinal : withoutFinal}`
}

/**
 * 으로/로. 받침이 없거나 ㄹ받침이면 '로'다 —
 * "굴으로"가 아니라 "굴로", "북쪽으로"는 그대로.
 */
export function toward(word: string): string {
  const last = word.charCodeAt(word.length - 1)
  const isHangul = last >= 0xac00 && last <= 0xd7a3
  const final = isHangul ? (last - 0xac00) % 28 : -1
  const rieul = 8 // ㄹ
  if (!hasFinalConsonant(word) || final === rieul) return `${word}로`
  return `${word}으로`
}
