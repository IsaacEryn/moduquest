import type { MonsterData, ProgressionData } from './types'

/**
 * 사람이 많을수록 몹도 강해진다.
 *
 * 보상은 사람이 앉은 자리마다 한 벌씩 나간다(나눠 갖지 않는다). 그러면 인원이
 * 늘수록 파티의 화력과 전리품은 늘어나는데 몹은 그대로라, 함께 할수록 쉬워지기만
 * 했다. 협동이 유리해야 한다는 것과 협동이 시시해져도 된다는 것은 다른 말이다.
 *
 * **체력 위주로 올린다.** 공격을 크게 올리면 한 방이 치명적이 되어, 낭독으로
 * 상황을 듣고 판단하는 사람에게 한 턴의 무게가 갑자기 커진다. 체력을 올리면
 * 전투가 길어져 역할을 나눌 자리가 생긴다 — 여럿이 하는 재미가 거기 있다.
 *
 * 배율은 곱셈이 아니라 덧셈으로 쌓는다(1 + (인원-1) × 비율). 인원이 늘 때
 * 몇 배씩 뛰지 않아야 세 사람이 여섯 배와 싸우는 일이 없다.
 *
 * **속도·저항·패턴·드랍은 건드리지 않는다.** 속도를 만지면 턴 순서가 바뀌어
 * "행동 순서는 매 라운드 같다"는 약속이 깨지고, 저항과 패턴은 배우는 대상이라
 * 인원에 따라 달라지면 외운 것이 틀린 것이 된다.
 */
export function scaleMonsters(
  monsters: Record<string, MonsterData>,
  humans: number,
  cfg: ProgressionData['multiScaling'],
): Record<string, MonsterData> {
  const extra = Math.max(0, humans - 1)
  if (extra === 0) return monsters

  const hpMul = 1 + extra * cfg.hpPerExtraHuman
  const atkMul = 1 + extra * cfg.atkPerExtraHuman
  const out: Record<string, MonsterData> = {}
  for (const [id, m] of Object.entries(monsters)) {
    out[id] = {
      ...m,
      hp: Math.floor(m.hp * hpMul),
      patk: Math.floor(m.patk * atkMul),
      matk: Math.floor(m.matk * atkMul),
    }
  }
  return out
}
