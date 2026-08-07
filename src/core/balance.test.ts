import { describe, expect, it } from 'vitest'
import { Battle } from './battle'
import { EventBus } from './events'
import { allEncounters } from './layout'
import { applyCombat, applyStats, resolveTrait } from './traits'
import type { Combatant, GameData, StageData, TraitsFile } from './types'
import jobs from '../data/jobs.json'
import monstersData from '../data/monsters.json'
import party from '../data/party.json'
import progression from '../data/progression.json'
import stage1 from '../data/stages/stage1.json'
import stage2 from '../data/stages/stage2.json'
import stage3 from '../data/stages/stage3.json'
import traitsFile from '../data/traits.json'

const TRAITS = traitsFile as TraitsFile
const JOBS = jobs as GameData['jobs']
const STAGES = [stage1, stage2, stage3] as StageData[]
const monsters = monstersData as GameData['monsters']

/** 스테이지 진입 시 보장되는 최소 레벨 — 하한만 검증하면 된다. 파밍은 단조 유리하다 */
function entryLevel(stageIndex: number): number {
  const xp = progression.stageEntryXp[stageIndex] ?? 0
  let level = 1
  progression.xpTable.forEach((need, i) => {
    if (i >= 1 && xp >= need) level = i + 1
  })
  return level
}

/**
 * 전투가 결정적이라 시뮬레이션 결과가 항상 같다. 그래서 수치를 만졌을 때
 * 어떤 특성·조합이 보스전을 못 이기게 되는지 즉시 드러난다.
 */
function buildPartyOf(jobIds: string[], traitId: string, level: number): Combatant[] {
  const trait = resolveTrait(TRAITS, traitId)
  return jobIds.map((job, index) => {
    const isPlayer = index === 0
    const j = JOBS[job]
    const grow = progression.growth[job as keyof typeof progression.growth]
    const lv = level - 1
    const base = {
      hp: j.hp + (grow?.hp ?? 0) * lv,
      atk: j.atk + (grow?.atk ?? 0) * lv,
      def: j.def + (grow?.def ?? 0) * lv,
      spd: j.spd + (grow?.spd ?? 0) * lv,
    }
    const maxMp = j.mp + (grow?.mp ?? 0) * lv
    const s = isPlayer ? applyStats(base, trait, TRAITS.limits) : base
    const c: Combatant = {
      id: job,
      name: j.name,
      side: 'ally',
      isPlayer,
      hp: s.hp,
      maxHp: s.hp,
      mp: maxMp,
      maxMp,
      mpRegen: j.mpRegen,
      atk: s.atk,
      def: s.def,
      spd: s.spd,
      skills: j.skills.filter((sk) => (sk.unlockLevel ?? 1) <= level),
      cooldowns: [],
      defending: false,
      frontOrder: j.frontOrder,
    }
    if (isPlayer) applyCombat(c, trait)
    return c
  })
}

/** 플레이어는 스킬이 준비되면 스킬, 아니면 공격 — NPC와 같은 단순하고 일관된 전략 */
function simulate(allies: Combatant[], enemyIds: string[]) {
  const bus = new EventBus()
  const battle = new Battle(allies, enemyIds, monsters, bus)
  const player = allies.find((c) => c.isPlayer)!

  let rounds = 0
  for (let step = 0; step < 2000; step++) {
    const result = battle.step()
    if (result === 'victory') return { outcome: 'victory' as const, rounds }
    if (result === 'defeat') return { outcome: 'defeat' as const, rounds }
    if (result === 'waiting-player') {
      rounds += 1
      const target = battle.enemies.find((e) => e.hp > 0)
      if (!target) break
      // 쓸 수 있는지 판정은 코어와 같은 함수로 — 시뮬만 다른 규칙을 쓰면 검증이 아니다
      const idx = player.skills.findIndex(
        (sk, i) =>
          Battle.canUse(player, i) &&
          (sk.targeting === 'enemy' || sk.targeting === 'enemy-all'),
      )
      const action =
        idx >= 0
          ? ({ kind: 'skill', skillIndex: idx, targetId: target.id } as const)
          : ({ kind: 'attack', targetId: target.id } as const)
      const r = battle.playerAction(action)
      if (r === 'victory') return { outcome: 'victory' as const, rounds }
      if (r === 'defeat') return { outcome: 'defeat' as const, rounds }
    }
  }
  throw new Error(`전투가 끝나지 않음: ${allies.map((a) => a.id).join(',')}`)
}

/** 스테이지의 모든 전투(조우 + 보스). 진입 최소 레벨의 새 파티로 각각 치른다 */
function winsWholeStage(jobIds: string[], traitId: string, stageIndex: number): string | null {
  const stage = STAGES[stageIndex]
  const level = entryLevel(stageIndex)
  // 좌표를 한 번도 읽지 않는다 — 그래서 지도 변형이 몇 장이든 시뮬 결과가 같다
  for (const e of allEncounters(stage)) {
    const result = simulate(buildPartyOf(jobIds, traitId, level), e.monsters)
    if (result.outcome !== 'victory') return e.id
  }
  return null
}

/** 파티 조합 30가지: 플레이어 직업 5 × 나머지 넷 중 동료 둘 */
function allPartyCombos(): string[][] {
  const ids = Object.keys(JOBS)
  const combos: string[][] = []
  for (const me of ids) {
    const rest = ids.filter((j) => j !== me)
    for (let a = 0; a < rest.length; a++) {
      for (let b = a + 1; b < rest.length; b++) {
        combos.push([me, rest[a], rest[b]])
      }
    }
  }
  return combos
}

const TRAIT_IDS = Object.keys(TRAITS.traits)
const BASE_PARTY = party.map((p) => p.job)

describe('밸런스 — 어떤 파티 조합과 특성으로도 전부 이길 수 있어야 한다', () => {
  // 조합 30 × 특성 7 × 세 스테이지의 조우 18(3+7+8) = 3,780 전투 전수.
  // 결정적이라 늘 같은 답이다 — 수를 늘려도 수십 ms면 끝난다
  // (스테이지를 늘리면 이 수도 따라 늘어난다. 조우 수를 세어 고칠 것)
  for (const [stageIndex, stage] of STAGES.entries()) {
    it(`${stage.id} — 전 조합 × 전 특성 승리 (진입 최소 레벨)`, () => {
      const failures: string[] = []
      for (const combo of allPartyCombos()) {
        for (const traitId of TRAIT_IDS) {
          const lost = winsWholeStage(combo, traitId, stageIndex)
          if (lost) failures.push(`${combo.join('/')} × ${traitId} → ${lost} 패배`)
        }
      }
      expect(failures).toEqual([])
    })
  }

  it('보스전 길이 스냅샷 — 기본 파티 기준. 수치를 만지면 여기서 드러난다', () => {
    const rounds = Object.fromEntries(
      STAGES.map((s, i) => [
        s.id,
        Object.fromEntries(
          TRAIT_IDS.map((id) => [
            id,
            simulate(
              buildPartyOf(BASE_PARTY, id, entryLevel(i)),
              s.areas.find((a) => a.boss)!.boss!.monsters,
            ).rounds,
          ]),
        ),
      ]),
    )
    expect(rounds).toMatchInlineSnapshot(`
      {
        "stage1": {
          "balanced": 7,
          "firm-stance": 9,
          "measured-pace": 6,
          "narrow-focus": 7,
          "quick-turn": 6,
          "steady-hand": 7,
          "swift-step": 9,
        },
        "stage2": {
          "balanced": 7,
          "firm-stance": 8,
          "measured-pace": 7,
          "narrow-focus": 7,
          "quick-turn": 6,
          "steady-hand": 7,
          "swift-step": 8,
        },
        "stage3": {
          "balanced": 6,
          "firm-stance": 6,
          "measured-pace": 6,
          "narrow-focus": 6,
          "quick-turn": 6,
          "steady-hand": 6,
          "swift-step": 6,
        },
      }
    `)
  })
})
