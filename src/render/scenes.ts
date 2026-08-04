import Phaser from 'phaser'
import type { EventBus } from '../core/events'
import type { Game } from '../core/game'
import type { Combatant, Pos } from '../core/types'
import type { Options } from '../ui/optionsStore'
import { SPRITES, drawSprite, drawTile } from './sprites'

const TILE = 32

interface Palette {
  bg: number
  floor: number
  floorSpeck: number
  wall: number
  wallSpeck: number
  checkpoint: number
}

const NORMAL: Palette = {
  bg: 0x101418,
  floor: 0x2e4d3a,
  floorSpeck: 0x3a5c45,
  wall: 0x1a2620,
  wallSpeck: 0x243229,
  checkpoint: 0xffd166,
}

// 저자극 모드: 채도를 낮춘 같은 구성의 팔레트
const LOW_STIM: Palette = {
  bg: 0x14171a,
  floor: 0x39443e,
  floorSpeck: 0x424d46,
  wall: 0x22282b,
  wallSpeck: 0x2a3134,
  checkpoint: 0xbfae85,
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`

/**
 * 시각 레이어. 게임 상태는 코어가 소유하고, 여기서는 그리기만 한다.
 * 캔버스는 aria-hidden — 의미 전달은 전부 DOM 레이어의 몫.
 */
export function createRenderer(game: Game, bus: EventBus, options: Options): void {
  const palette = () => (options.lowStim ? LOW_STIM : NORMAL)
  const px = (p: Pos) => ({ x: p.x * TILE + TILE / 2, y: p.y * TILE + TILE / 2 })

  /** 스프라이트·타일 텍스처를 만들어 등록한다. 저자극 모드는 팔레트가 달라 키를 나눈다 */
  function loadTextures(scene: Phaser.Scene): void {
    const suffix = options.lowStim ? '-low' : ''
    for (const [name, def] of Object.entries(SPRITES)) {
      const key = name + suffix
      if (scene.textures.exists(key)) continue
      scene.textures.addCanvas(key, drawSprite(def, 2, options.lowStim))
    }
    const pal = palette()
    const tiles: Array<[string, number, number]> = [
      ['tile-floor', pal.floor, pal.floorSpeck],
      ['tile-wall', pal.wall, pal.wallSpeck],
    ]
    for (const [name, base, speck] of tiles) {
      const key = name + suffix
      if (scene.textures.exists(key)) continue
      scene.textures.addCanvas(
        key,
        drawTile(hex(base), hex(speck), TILE, options.lowStim),
      )
    }
  }

  const texKey = (name: string) => name + (options.lowStim ? '-low' : '')
  const spriteOf = (c: { sprite?: string; id: string }) => texKey(c.sprite ?? c.id)

  class FieldScene extends Phaser.Scene {
    private player!: Phaser.GameObjects.Image
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
          if (options.lowStim) {
            this.player.setPosition(to.x, to.y)
          } else {
            this.tweens.add({
              targets: this.player,
              x: to.x,
              y: to.y,
              duration: 110,
            })
          }
        }
        if ((e.type === 'mode' && e.mode === 'field') || e.type === 'optionsChanged') {
          if (this.scene.isActive()) this.redraw()
        }
      })
    }

    private redraw() {
      loadTextures(this)
      const pal = palette()
      this.cameras.main.setBackgroundColor(pal.bg)
      for (const obj of this.statics) obj.destroy()
      this.statics = []
      this.player?.destroy()

      const { width, height, tiles } = game.stage.map
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const key = texKey(tiles[y][x] === 1 ? 'tile-wall' : 'tile-floor')
          const t = this.add
            .image(x * TILE + TILE / 2, y * TILE + TILE / 2, key)
            .setDepth(0)
          this.statics.push(t)
        }
      }

      // 쉼터 — 바닥 위의 표식
      const cp = px(game.stage.checkpoint)
      this.statics.push(
        this.add.rectangle(cp.x, cp.y, TILE - 12, TILE - 12, pal.checkpoint).setDepth(1),
      )

      for (const e of game.field.alive.values()) {
        const p = px(e.pos)
        const first = e.monsters[0]
        const key = texKey(game.spriteOfMonster(first) ?? 'slime')
        const img = this.add.image(p.x, p.y, key).setDepth(1)
        if (game.isBossEncounter(e)) img.setScale(1.15)
        this.statics.push(img)
      }

      const pp = px(game.field.pos)
      this.player = this.add.image(pp.x, pp.y, spriteOf(game.player)).setDepth(2)
    }
  }

  class BattleScene extends Phaser.Scene {
    private figures = new Map<string, Phaser.GameObjects.Image>()

    constructor() {
      super('battle')
    }

    create() {
      bus.on((e) => {
        if (!this.scene.isActive()) return
        if (e.type === 'attacked') this.hit(e.target, e.damage)
        if (e.type === 'healed') this.pop(e.target, `+${e.amount}`, '#9fd8a8')
        if (e.type === 'downed') this.figures.get(e.target.id)?.setAlpha(0.25)
      })
      this.events.on('wake', () => this.build())
      this.build()
    }

    private build() {
      loadTextures(this)
      this.cameras.main.setBackgroundColor(palette().bg)
      for (const r of this.figures.values()) r.destroy()
      this.figures.clear()
      this.children.list
        .filter((c) => c instanceof Phaser.GameObjects.Text)
        .forEach((c) => c.destroy())

      const battle = game.battle
      if (!battle) return

      game.party.forEach((c, i) => this.spawn(c, 96, 72 + i * 68))
      battle.enemies.forEach((c, i) => this.spawn(c, 288, 72 + i * 68))
    }

    private spawn(c: Combatant, x: number, y: number) {
      const img = this.add.image(x, y, spriteOf(c))
      if (c.isBoss) img.setScale(1.3)
      if (c.hp <= 0) img.setAlpha(0.25)
      this.figures.set(c.id, img)
      this.add
        .text(x, y + 20, c.isPlayer ? `${c.name} (나)` : c.name, {
          fontSize: '11px',
          color: '#b7c2cc',
        })
        .setOrigin(0.5, 0)
    }

    private hit(target: Combatant, damage: number) {
      const r = this.figures.get(target.id)
      if (!r) return
      if (!options.lowStim) {
        this.tweens.add({ targets: r, alpha: 0.3, yoyo: true, duration: 90 })
      }
      this.pop(target, `-${damage}`, '#f0a58a')
    }

    /** 피해·회복 숫자. 저자극 모드에서는 움직임 없이 잠깐 표시만 한다 */
    private pop(target: Combatant, text: string, color: string) {
      const r = this.figures.get(target.id)
      if (!r) return
      const t = this.add
        .text(r.x, r.y - 28, text, { fontSize: '14px', color })
        .setOrigin(0.5)
      if (options.lowStim) {
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
