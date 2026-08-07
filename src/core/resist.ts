import type { DamageType, Resist } from './types'

/**
 * 상성 판정. 낭독·자막·소리·화면이 전부 이 함수 하나를 읽는다 —
 * 기준이 여러 곳에 생기면 "약점이다"라고 말해 놓고 소리는 아닌 일이 생긴다.
 */
export type ResistTag = 'weak' | 'strong' | null

export function resistTagOf(resist: Resist | undefined, type: DamageType): ResistTag {
  if (!resist) return null
  const value = resist[type]
  if (value > 1) return 'weak'
  if (value < 1) return 'strong'
  return null
}
