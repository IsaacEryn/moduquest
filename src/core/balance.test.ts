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
      patk: j.patk + (grow?.patk ?? 0) * lv,
      matk: j.matk + (grow?.matk ?? 0) * lv,
      pdef: j.pdef + (grow?.pdef ?? 0) * lv,
      mdef: j.mdef + (grow?.mdef ?? 0) * lv,
      spd: j.spd + (grow?.spd ?? 0) * lv,
    }
    const maxMp = j.mp + (grow?.mp ?? 0) * lv
    const s = isPlayer ? applyStats(base, trait, TRAITS.limits, j.mainType) : base
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
      mainType: j.mainType,
      patk: s.patk,
      matk: s.matk,
      pdef: s.pdef,
      mdef: s.mdef,
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
          "quick-turn": 7,
          "steady-hand": 7,
          "swift-step": 9,
        },
        "stage2": {
          "balanced": 8,
          "firm-stance": 9,
          "measured-pace": 8,
          "narrow-focus": 8,
          "quick-turn": 7,
          "steady-hand": 7,
          "swift-step": 9,
        },
        "stage3": {
          "balanced": 7,
          "firm-stance": 7,
          "measured-pace": 7,
          "narrow-focus": 7,
          "quick-turn": 7,
          "steady-hand": 7,
          "swift-step": 7,
        },
      }
    `)
  })
})

/**
 * 한 판을 이어서 걸었을 때의 소모.
 *
 * 위 검사는 전투마다 체력이 가득 찬 새 파티로 시작한다 — 전투 하나가 이길 만한지는
 * 보지만, 스테이지를 걸으며 쌓이는 소모는 아무도 보지 않았다. 그래서 승리 회복이
 * 전투 비용보다 크다는 사실이 오래 숨어 있었고, 물약은 마시는 것이 아니라 파는 것이 됐다.
 *
 * 여기서 검사하는 것은 난이도가 아니라 **곡선의 모양**이다. 뒤로 갈수록 소모가 커지고,
 * 그래도 아무도 막히지 않는다.
 */
describe('스테이지를 이어서 걸으면 소모가 쌓인다', () => {
  /** 물약 없이 스테이지 전체를 이어서 걷는다. 체력은 전투 사이에 이어진다 */
  function walkStage(jobIds: string[], traitId: string, stageIndex: number) {
    const party = buildPartyOf(jobIds, traitId, entryLevel(stageIndex))
    const heal = progression.victoryHealRatio[stageIndex] ?? 0.3
    for (const e of allEncounters(STAGES[stageIndex])) {
      const battle = new Battle(party, e.monsters, monsters, new EventBus(), heal)
      const player = party.find((c) => c.isPlayer)!
      let done: 'victory' | 'defeat' | null = null
      for (let step = 0; step < 3000 && !done; step++) {
        const r = battle.step()
        if (r === 'victory' || r === 'defeat') { done = r; break }
        if (r !== 'waiting-player') continue
        const target = battle.enemies.find((x) => x.hp > 0)
        if (!target) break
        const idx = player.skills.findIndex(
          (sk, i) =>
            Battle.canUse(player, i) &&
            (sk.targeting === 'enemy' || sk.targeting === 'enemy-all'),
        )
        const rr = battle.playerAction(
          idx >= 0
            ? { kind: 'skill', skillIndex: idx, targetId: target.id }
            : { kind: 'attack', targetId: target.id },
        )
        if (rr === 'victory' || rr === 'defeat') done = rr
      }
      if (done !== 'victory') return { wiped: true, left: 0 }
    }
    const max = party.reduce((s, c) => s + c.maxHp, 0)
    const now = party.reduce((s, c) => s + Math.max(0, c.hp), 0)
    return { wiped: false, left: now / max }
  }

  /** 조합·특성 전수를 걸어 보고 남은 체력의 분포를 낸다 */
  function walkAll(stageIndex: number) {
    let wiped = 0
    let sum = 0
    let worst = 1
    let n = 0
    for (const combo of allPartyCombos()) {
      for (const traitId of TRAIT_IDS) {
        const r = walkStage(combo, traitId, stageIndex)
        if (r.wiped) wiped++
        else {
          sum += r.left
          worst = Math.min(worst, r.left)
          n++
        }
      }
    }
    return { wiped, avg: sum / Math.max(1, n), worst }
  }

  const walked = STAGES.map((_, i) => walkAll(i))

  it('물약 없이도 어떤 조합이든 완주할 수 있다 — 관대함은 그대로다', () => {
    for (const [i, w] of walked.entries()) {
      expect(w.wiped, `${STAGES[i].id}에서 전멸한 조합`).toBe(0)
    }
  })

  it('뒤 스테이지일수록 더 많이 깎인다 — 곡선이 뒤집히지 않는다', () => {
    // 예전에는 스테이지 3이 가장 쉬웠다. 몹이 파티 성장을 따라가지 못해
    // 최소 피해 1만 들어갔기 때문이다
    expect(walked[1].avg).toBeLessThan(walked[0].avg)
    expect(walked[2].avg).toBeLessThan(walked[1].avg)
  })

  it('마지막 스테이지는 물약을 쓸 만큼 깎이되 과하지는 않다', () => {
    // 남는 체력이 너무 많으면 물약이 재화가 되고, 너무 적으면 관대함이 무너진다
    expect(walked[2].avg).toBeGreaterThan(0.6)
    expect(walked[2].avg).toBeLessThan(0.9)
    expect(walked[2].worst).toBeGreaterThan(0.25)
  })

  it('첫 스테이지는 넉넉하다 — 배우는 자리에서 물약을 강요하지 않는다', () => {
    expect(walked[0].avg).toBeGreaterThan(0.9)
  })
})
