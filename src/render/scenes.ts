import Phaser from 'phaser'
import type { EventBus } from '../core/events'
import type { Game } from '../core/game'
import type { Combatant, Pos } from '../core/types'

const TILE = 32

interface Palette {
  bg: number
  floor: number
  wall: number
  player: number
  ally: number
  monster: number
  boss: number
  checkpoint: number
}

const NORMAL: Palette = {
  bg: 0x101418,
  floor: 0x2e4d3a,
  wall: 0x1a2620,
  player: 0x7fd08a,
  ally: 0x8ab8d0,
  monster: 0xe8875f,
  boss: 0xd95555,
  checkpoint: 0xffd166,
}

// 저자극 모드: 채도를 낮춘 같은 구성의 팔레트
const LOW_STIM: Palette = {
  bg: 0x14171a,
  floor: 0x39443e,
  wall: 0x22282b,
  player: 0x93ac97,
  ally: 0x93a4ac,
  monster: 0xac9184,
  boss: 0xa87f7f,
  checkpoint: 0xbfae85,
}

/**
 * 시각 레이어. 게임 상태는 코어가 소유하고, 여기서는 그리기만 한다.
 * 캔버스는 aria-hidden — 의미 전달은 전부 DOM 레이어의 몫.
 */
export function createRenderer(game: Game, bus: EventBus): void {
  const palette = () => (game.options.lowStim ? LOW_STIM : NORMAL)
  const px = (p: Pos) => ({ x: p.x * TILE + TILE / 2, y: p.y * TILE + TILE / 2 })

  class FieldScene extends Phaser.Scene {
    private playerRect!: Phaser.GameObjects.Rectangle
    private statics: Phaser.GameObjects.GameObject[] = []

    constructor() {
      super('field')
    }

    create() {
      this.redraw()
      this.events.on('wake', () => this.redraw())
      bus.on((e) => {
        if (e.type === 'moved' && this.scene.isActive()) {
          const to = px(e.pos)
          this.tweens.add({
            targets: this.playerRect,
            x: to.x,
            y: to.y,
            duration: 110,
          })
        }
        if ((e.type === 'mode' && e.mode === 'field') || e.type === 'optionsChanged') {
          if (this.scene.isActive()) this.redraw()
        }
      })
    }

    private redraw() {
      const pal = palette()
      this.cameras.main.setBackgroundColor(pal.bg)
      for (const obj of this.statics) obj.destroy()
      this.statics = []
      this.playerRect?.destroy()

      const { width, height, tiles } = game.stage.map
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const color = tiles[y][x] === 1 ? pal.wall : pal.floor
          const r = this.add
            .rectangle(x * TILE + TILE / 2, y * TILE + TILE / 2, TILE - 2, TILE - 2, color)
            .setDepth(0)
          this.statics.push(r)
        }
      }

      const cp = px(game.stage.checkpoint)
      this.statics.push(
        this.add.rectangle(cp.x, cp.y, TILE - 10, TILE - 10, pal.checkpoint).setDepth(1),
      )

      for (const e of game.field.alive.values()) {
        const isBoss = game.isBossEncounter(e)
        const p = px(e.pos)
        this.statics.push(
          this.add
            .rectangle(p.x, p.y, TILE - 8, TILE - 8, isBoss ? pal.boss : pal.monster)
            .setDepth(1),
        )
      }

      const pp = px(game.field.pos)
      this.playerRect = this.add
        .rectangle(pp.x, pp.y, TILE - 8, TILE - 8, pal.player)
        .setDepth(2)
    }
  }

  class BattleScene extends Phaser.Scene {
    private rects = new Map<string, Phaser.GameObjects.Rectangle>()

    constructor() {
      super('battle')
    }

    create() {
      bus.on((e) => {
        if (!this.scene.isActive()) return
        if (e.type === 'attacked') this.hit(e.target, e.damage)
        if (e.type === 'healed') this.pop(e.target, `+${e.amount}`, '#9fd8a8')
        if (e.type === 'downed') this.rects.get(e.target.id)?.setAlpha(0.25)
      })
      this.events.on('wake', () => this.build())
      this.build()
    }

    private build() {
      const pal = palette()
      this.cameras.main.setBackgroundColor(pal.bg)
      for (const r of this.rects.values()) r.destroy()
      this.rects.clear()
      this.children.list
        .filter((c) => c instanceof Phaser.GameObjects.Text)
        .forEach((c) => c.destroy())

      const battle = game.battle
      if (!battle) return

      game.party.forEach((c, i) => {
        this.spawn(c, 96, 80 + i * 64, c.isPlayer ? pal.player : pal.ally)
      })
      battle.enemies.forEach((c, i) => {
        this.spawn(c, 288, 80 + i * 64, c.isBoss ? pal.boss : pal.monster)
      })
    }

    private spawn(c: Combatant, x: number, y: number, color: number) {
      const r = this.add.rectangle(x, y, 40, 40, color)
      if (c.hp <= 0) r.setAlpha(0.25)
      this.rects.set(c.id, r)
      this.add
        .text(x, y + 30, c.name, { fontSize: '12px', color: '#b7c2cc' })
        .setOrigin(0.5, 0)
    }

    private hit(target: Combatant, damage: number) {
      const r = this.rects.get(target.id)
      if (!r) return
      if (!game.options.lowStim) {
        this.tweens.add({ targets: r, alpha: 0.3, yoyo: true, duration: 90 })
      }
      this.pop(target, `-${damage}`, '#f0a58a')
    }

    /** 피해·회복 숫자. 저자극 모드에서는 움직임 없이 잠깐 표시만 한다 */
    private pop(target: Combatant, text: string, color: string) {
      const r = this.rects.get(target.id)
      if (!r) return
      const t = this.add
        .text(r.x, r.y - 28, text, { fontSize: '14px', color })
        .setOrigin(0.5)
      if (game.options.lowStim) {
        this.time.delayedCall(700, () => t.destroy())
      } else {
        this.tweens.add({
          targets: t,
          y: r.y - 48,
          alpha: 0,
          duration: 700,
          onComplete: () => t.destroy(),
        })
      }
    }
  }

  const phaserGame = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: game.stage.map.width * TILE,
    height: game.stage.map.height * TILE,
    pixelArt: true,
    backgroundColor: NORMAL.bg,
    // 크기는 CSS가 결정한다(반응형·리플로우 대응). 내부 해상도는 384×320 고정
    scale: { mode: Phaser.Scale.NONE },
    scene: [FieldScene, BattleScene],
  })

  bus.on((e) => {
    if (e.type !== 'mode') return
    const sm = phaserGame.scene
    if (e.mode === 'battle') {
      sm.sleep('field')
      if (sm.isSleeping('battle')) sm.wake('battle')
      else sm.run('battle')
    } else if (e.mode === 'field') {
      if (sm.isActive('battle')) sm.sleep('battle')
      if (sm.isSleeping('field')) sm.wake('field')
    }
  })
}
