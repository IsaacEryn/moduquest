import { describe, expect, it } from 'vitest'
import { Battle } from './battle'
import { EventBus } from './events'
import { applyCombat, applyStats, resolveTrait } from './traits'
import type { Combatant, GameData, StageData, TraitsFile } from './types'
import jobs from '../data/jobs.json'
import monsters from '../data/monsters.json'
import party from '../data/party.json'
import stage1 from '../data/stages/stage1.json'
import stage2 from '../data/stages/stage2.json'
import stage3 from '../data/stages/stage3.json'
import traitsFile from '../data/traits.json'

const TRAITS = traitsFile as TraitsFile
const JOBS = jobs as GameData['jobs']

/**
 * 전투가 결정적이라 시뮬레이션 결과가 항상 같다. 그래서 특성 수치를 만졌을 때
 * 어떤 특성이 보스전을 못 이기게 만드는지 즉시 드러난다.
 */
function buildParty(traitId: string): Combatant[] {
  const trait = resolveTrait(TRAITS, traitId)
  return party.map(({ job, isPlayer }) => {
    const j = JOBS[job]
    const base = { hp: j.hp, atk: j.atk, def: j.def, spd: j.spd }
    const s = isPlayer ? applyStats(base, trait, TRAITS.limits) : base
    const c: Combatant = {
      id: job,
      name: j.name,
      side: 'ally',
      isPlayer,
      hp: s.hp,
      maxHp: s.hp,
      atk: s.atk,
      def: s.def,
      spd: s.spd,
      skill: j.skill,
      cooldownLeft: 0,
      defending: false,
    }
    if (isPlayer) applyCombat(c, trait)
    return c
  })
}

/** 플레이어는 스킬이 준비되면 스킬, 아니면 공격 — 단순하지만 일관된 전략 */
function simulate(traitId: string, enemyIds: string[]) {
  const allies = buildParty(traitId)
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
      const action =
        player.skill && player.cooldownLeft === 0 && player.skill.targeting === 'enemy'
          ? ({ kind: 'skill', targetId: target.id } as const)
          : ({ kind: 'attack', targetId: target.id } as const)
      const r = battle.playerAction(action)
      if (r === 'victory') return { outcome: 'victory' as const, rounds }
      if (r === 'defeat') return { outcome: 'defeat' as const, rounds }
    }
  }
  throw new Error(`전투가 끝나지 않음: ${traitId}`)
}

const STAGES = [stage1, stage2, stage3] as StageData[]

describe('밸런스 — 모든 특성으로 모든 스테이지를 끝낼 수 있어야 한다', () => {
  const ids = Object.keys(TRAITS.traits)

  for (const stage of STAGES) {
    describe(stage.id, () => {
      it.each(ids)('%s — 모든 조우에서 승리', (traitId) => {
        for (const e of stage.encounters) {
          expect(simulate(traitId, e.monsters).outcome, e.id).toBe('victory')
        }
      })

      it.each(ids)('%s — 보스전 승리', (traitId) => {
        expect(simulate(traitId, stage.boss.monsters).outcome).toBe('victory')
      })
    })
  }

  it('보스전 길이 스냅샷 — 수치를 만지면 여기서 드러난다', () => {
    const rounds = Object.fromEntries(
      STAGES.map((s) => [
        s.id,
        Object.fromEntries(ids.map((id) => [id, simulate(id, s.boss.monsters).rounds])),
      ]),
    )
    expect(rounds).toMatchInlineSnapshot(`
      {
        "stage1": {
          "balanced": 7,
          "firm-stance": 8,
          "measured-pace": 6,
          "narrow-focus": 7,
          "quick-turn": 6,
          "steady-hand": 6,
          "swift-step": 8,
        },
        "stage2": {
          "balanced": 9,
          "firm-stance": 10,
          "measured-pace": 7,
          "narrow-focus": 8,
          "quick-turn": 7,
          "steady-hand": 7,
          "swift-step": 10,
        },
        "stage3": {
          "balanced": 9,
          "firm-stance": 11,
          "measured-pace": 9,
          "narrow-focus": 9,
          "quick-turn": 9,
          "steady-hand": 9,
          "swift-step": 11,
        },
      }
    `)
  })
})
