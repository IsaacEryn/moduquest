/**
 * 조사 고르기. 낭독 문장이 코어에서도 만들어지므로 여기에 둔다.
 * 화면에 글자로 나가는 것이 아니라 사람이 듣는 문장이라, 어색하면 바로 티가 난다.
 */

/** 받침이 있는지 — "슬라임 1"처럼 숫자로 끝나는 이름도 처리한다 */
export function hasFinalConsonant(word: string): boolean {
  const last = word[word.length - 1]
  if (last === undefined) return false
  if (/[0-9]/.test(last)) {
    // 영·일·삼·육·칠·팔로 읽히는 숫자는 받침이 있다
    return '013678'.includes(last)
  }
  const code = word.charCodeAt(word.length - 1)
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 > 0
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
