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
  /** 아직 모르는 칸 */
  fog: number
}

const NORMAL: Palette = {
  bg: 0x101418,
  floor: 0x2e4d3a,
  floorSpeck: 0x3a5c45,
  wall: 0x1a2620,
  wallSpeck: 0x243229,
  checkpoint: 0xffd166,
  fog: 0x0c1013,
}

// 저자극 모드: 채도를 낮춘 같은 구성의 팔레트
const LOW_STIM: Palette = {
  bg: 0x14171a,
  floor: 0x39443e,
  floorSpeck: 0x424d46,
  wall: 0x22282b,
  wallSpeck: 0x2a3134,
  checkpoint: 0xbfae85,
  fog: 0x111417,
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
          // 지각 반경이 있으면 움직일 때마다 아는 범위가 바뀐다
          if (game.perceptionRadius !== null) {
            this.redraw()
            return
          }
          const to = px(e.pos)
          if (options.lowStim) {
            this.player.setPosition(to.x, to.y)
          } else {
            // 대기 동작을 멈추고 걸어간 뒤 새 자리에서 다시 숨 쉬게 한다
            this.tweens.killTweensOf(this.player)
            this.tweens.add({
              targets: this.player,
              x: to.x,
              y: to.y,
              duration: 110,
              onComplete: () => this.idle(this.player, to.y),
            })
          }
        }
        // 연 상자는 사라져야 한다 — 이동 트윈 대신 전체를 다시 그린다
        if (e.type === 'chestOpened' && this.scene.isActive()) this.redraw()
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
          // 모르는 칸은 평면 색으로 덮는다. 그라디언트·애니메이션을 쓰지 않는 이유는
          // 대비를 떨어뜨리면 저시력 사용자에게 회귀가 되기 때문이다.
          if (!game.field.isKnown({ x, y })) {
            const f = this.add
              .rectangle(x * TILE + TILE / 2, y * TILE + TILE / 2, TILE, TILE, pal.fog)
              .setDepth(0)
            this.statics.push(f)
            continue
          }
          const key = texKey(tiles[y][x] === 1 ? 'tile-wall' : 'tile-floor')
          const t = this.add
            .image(x * TILE + TILE / 2, y * TILE + TILE / 2, key)
            .setDepth(0)
          this.statics.push(t)
        }
      }

      // 쉼터 — 어떤 특성에서도 항상 보인다. 길을 가리지는 않는다
      const cp = px(game.stage.checkpoint)
      this.statics.push(
        this.add.rectangle(cp.x, cp.y, TILE - 12, TILE - 12, pal.checkpoint).setDepth(1),
      )

      // 안 연 상자 — 몹과 같은 isKnown 판정을 지나야 보인다
      for (const chest of game.field.knownChests()) {
        const p = px(chest.pos)
        this.statics.push(this.add.image(p.x, p.y, texKey('chest')).setDepth(1))
      }

      // 모르는 몹은 어둡게 덮지 않고 아예 그리지 않는다
      for (const e of game.field.knownEncounters()) {
        const p = px(e.pos)
        const first = e.monsters[0]
        const key = texKey(game.spriteOfMonster(first) ?? 'slime')
        const img = this.add.image(p.x, p.y, key).setDepth(1)
        if (game.isBossEncounter(e)) img.setScale(1.15)
        // 몹마다 위상을 어긋나게 해 한 몸처럼 움직이지 않게
        this.idle(img, p.y, (p.x + p.y) % 500)
        this.statics.push(img)
      }

      const pp = px(game.field.pos)
      this.player = this.add.image(pp.x, pp.y, spriteOf(game.player)).setDepth(2)
      this.idle(this.player, pp.y)
    }

    /** 제자리에서 숨 쉬듯 위아래로. 저자극 모드에서는 아무것도 하지 않는다 */
    private idle(target: Phaser.GameObjects.Image, baseY: number, delay = 0) {
      if (options.lowStim) return
      this.tweens.add({
        targets: target,
        y: baseY - 2,
        duration: 800,
        delay,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      })
    }
  }

  class BattleScene extends Phaser.Scene {
    private figures = new Map<string, Phaser.GameObjects.Image>()
    /** 대기 상태의 제자리 높이 — 연출이 끝나면 여기로 돌아온다 */
    private homeY = new Map<string, number>()

    constructor() {
      super('battle')
    }

    create() {
      bus.on((e) => {
        if (!this.scene.isActive()) return
        if (e.type === 'attacked') {
          this.lunge(e.actor, e.target)
          this.hit(e.target, e.damage)
        }
        if (e.type === 'healed') {
          this.cast(e.actor)
          this.pop(e.target, `+${e.amount}`, '#9fd8a8')
        }
        if (e.type === 'taunted') this.cast(e.actor)
        if (e.type === 'defended') this.brace(e.actor)
        if (e.type === 'downed') this.fall(e.target)
        if (e.type === 'victory') for (const c of e.revived) this.rise(c)
      })
      this.events.on('wake', () => this.build())
      this.build()
    }

    private build() {
      loadTextures(this)
      this.cameras.main.setBackgroundColor(palette().bg)
      for (const r of this.figures.values()) r.destroy()
      this.figures.clear()
      this.homeY.clear()
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
      this.figures.set(c.id, img)
      this.homeY.set(c.id, y)
      if (c.hp <= 0) {
        img.setAlpha(0.25).setAngle(90)
      } else if (!options.lowStim) {
        // 대기 중 숨 쉬듯 위아래로 — 개체마다 위상을 어긋나게 해서 기계적으로 보이지 않게
        this.tweens.add({
          targets: img,
          y: y - 2,
          duration: 900,
          delay: (x + y) % 400,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        })
      }
      this.add
        .text(x, y + 20, c.isPlayer ? `${c.name} (나)` : c.name, {
          fontSize: '11px',
          color: '#b7c2cc',
        })
        .setOrigin(0.5, 0)
    }

    /** 공격하는 쪽이 상대를 향해 짧게 파고들었다 돌아온다 */
    private lunge(actor: Combatant, target: Combatant) {
      const a = this.figures.get(actor.id)
      const t = this.figures.get(target.id)
      if (!a || !t || options.lowStim) return
      const dir = Math.sign(t.x - a.x) || 1
      this.tweens.add({
        targets: a,
        x: a.x + dir * 14,
        duration: 90,
        yoyo: true,
        ease: 'Quad.easeOut',
      })
    }

    /** 스킬 시전 — 살짝 솟아오르며 커진다 */
    private cast(actor: Combatant) {
      const a = this.figures.get(actor.id)
      if (!a || options.lowStim) return
      const base = a.scaleX
      this.tweens.add({
        targets: a,
        scaleX: base * 1.15,
        scaleY: base * 1.15,
        duration: 140,
        yoyo: true,
        ease: 'Sine.easeOut',
      })
    }

    /** 방어 — 몸을 낮춘다 */
    private brace(actor: Combatant) {
      const a = this.figures.get(actor.id)
      if (!a || options.lowStim) return
      this.tweens.add({ targets: a, y: a.y + 4, duration: 140, yoyo: true })
    }

    /** 쓰러짐 — 옆으로 넘어가며 흐려진다. 저자극 모드에서는 결과만 즉시 반영 */
    private fall(target: Combatant) {
      const r = this.figures.get(target.id)
      if (!r) return
      this.tweens.killTweensOf(r)
      if (options.lowStim) {
        r.setAlpha(0.25).setAngle(90)
        return
      }
      this.tweens.add({ targets: r, angle: 90, alpha: 0.25, duration: 320, ease: 'Quad.easeIn' })
    }

    /** 승리 시 쓰러졌던 동료가 일어난다 */
    private rise(c: Combatant) {
      const r = this.figures.get(c.id)
      if (!r) return
      if (options.lowStim) {
        r.setAlpha(1).setAngle(0)
        return
      }
      this.tweens.add({ targets: r, angle: 0, alpha: 1, duration: 380, ease: 'Back.easeOut' })
    }

    private hit(target: Combatant, damage: number) {
      const r = this.figures.get(target.id)
      if (!r) return
      if (!options.lowStim) {
        // 맞은 쪽은 뒤로 밀리며 깜빡인다
        const dir = target.side === 'ally' ? -1 : 1
        this.tweens.add({
          targets: r,
          x: r.x + dir * 8,
          alpha: 0.3,
          duration: 80,
          yoyo: true,
        })
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
