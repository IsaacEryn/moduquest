import type { EventBus, GameEvent } from '../core/events'
import type { Dir } from '../core/types'
import type { Options } from '../ui/optionsStore'

/** 방향을 좌우·앞뒤 좌표로 — 헤드폰에서 북쪽은 앞, 동쪽은 오른쪽으로 들린다 */
const DIR_VECTOR: Record<Dir, { x: number; z: number }> = {
  north: { x: 0, z: -1 },
  south: { x: 0, z: 1 },
  east: { x: 1, z: 0 },
  west: { x: -1, z: 0 },
}

interface ToneSpec {
  /** 시작 주파수(Hz) */
  from: number
  /** 끝 주파수 — 생략하면 일정하게 유지 */
  to?: number
  duration: number
  type?: OscillatorType
  /** 최대 음량(0~1) */
  gain?: number
  /** 시작을 늦춘다(초) — 음을 이어 붙여 짧은 가락을 만들 때 */
  delay?: number
}

/**
 * 효과음을 Web Audio로 합성한다. 음원 파일을 쓰지 않으므로 라이선스 문제가 없고
 * 용량도 들지 않는다. 자막(`[타격]` 등)과 짝을 이루는 청각 채널이다.
 *
 * 브라우저 정책상 오디오는 사용자 조작 이후에만 시작할 수 있어서,
 * 첫 입력 때 컨텍스트를 깨운다.
 */
export class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null

  constructor(
    bus: EventBus,
    private options: Options,
  ) {
    const wake = () => this.ensureContext()
    document.addEventListener('pointerdown', wake, { once: true })
    document.addEventListener('keydown', wake, { once: true })
    bus.on((e) => this.handle(e))
  }

  private ensureContext(): AudioContext | null {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as any).webkitAudioContext
      if (!Ctor) return null
      this.ctx = new Ctor()
      this.master = this.ctx.createGain()
      this.master.connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    if (this.master) this.master.gain.value = this.options.volume
    return this.ctx
  }

  /**
   * 소리 하나를 낸다. dir을 주면 그 방향에서 들리도록 공간에 배치한다
   * (PannerNode HRTF — 시각 정보를 소리의 방향으로 옮기는 통로).
   */
  private tone(spec: ToneSpec, dir?: Dir): void {
    const ctx = this.ensureContext()
    if (!ctx || !this.master || this.options.volume === 0) return

    const now = ctx.currentTime + (spec.delay ?? 0)
    const osc = ctx.createOscillator()
    osc.type = spec.type ?? 'triangle'
    osc.frequency.setValueAtTime(spec.from, now)
    if (spec.to !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec.to), now + spec.duration)
    }

    const env = ctx.createGain()
    // 저자극 모드에서는 소리도 절반으로 — 감각 과부하 방지
    const peak = (spec.gain ?? 0.25) * (this.options.lowStim ? 0.5 : 1)
    env.gain.setValueAtTime(0, now)
    env.gain.linearRampToValueAtTime(peak, now + 0.012)
    env.gain.exponentialRampToValueAtTime(0.0001, now + spec.duration)

    osc.connect(env)
    if (dir) {
      const panner = ctx.createPanner()
      panner.panningModel = 'HRTF'
      panner.distanceModel = 'linear'
      const v = DIR_VECTOR[dir]
      panner.positionX.value = v.x
      panner.positionY.value = 0
      panner.positionZ.value = v.z
      env.connect(panner)
      panner.connect(this.master)
    } else {
      env.connect(this.master)
    }

    osc.start(now)
    osc.stop(now + spec.duration + 0.02)
  }

  private chord(specs: ToneSpec[]): void {
    for (const s of specs) this.tone(s)
  }

  private handle(e: GameEvent): void {
    switch (e.type) {
      case 'moved':
        this.tone({ from: 210, to: 170, duration: 0.07, type: 'square', gain: 0.08 }, e.dir)
        break
      case 'blocked':
        // 막힌 방향에서 둔탁하게 — 어느 쪽이 벽인지 소리로도 알 수 있다
        this.tone({ from: 90, to: 60, duration: 0.14, type: 'square', gain: 0.16 }, e.dir)
        break
      case 'areaChanged':
        // 문이 열리고 닫히는 낮은 두 음 — 쉼터 화음과 구별되게
        this.chord([
          { from: 300, to: 220, duration: 0.18, type: 'square', gain: 0.12 },
          { from: 150, duration: 0.26, gain: 0.1 },
        ])
        break
      case 'signedIn':
        /*
         * 옛날 모뎀이 회선을 잡던 순간을 0.5초로 줄였다. 거친 협상음이
         * 한 번 훑고, 응답 톤(2100Hz — 실제 모뎀이 쓰던 주파수)이 잠깐
         * 서고, 두 음이 겹치며 연결된다.
         *
         * 진짜 다이얼업은 십수 초를 시끄럽게 우는데 그대로 옮기면
         * 낭독을 덮고 청각이 예민한 사람에게는 통증이 된다. 그래서
         * 마지막 한 순간만 남겼고, 크기도 다른 소리보다 낮게 잡았다.
         */
        this.chord([
          { from: 420, to: 1700, duration: 0.1, type: 'sawtooth', gain: 0.05 },
          { from: 2100, duration: 0.08, type: 'sine', gain: 0.045, delay: 0.1 },
          { from: 660, duration: 0.18, gain: 0.09, delay: 0.22 },
          { from: 990, duration: 0.24, gain: 0.06, delay: 0.26 },
        ])
        break
      case 'equipChanged':
        // 짧은 금속성 딸깍 — 입고 벗는 손맛
        this.chord([
          { from: 520, to: 420, duration: 0.08, type: 'square', gain: 0.1 },
          { from: 1040, duration: 0.1, gain: 0.07 },
        ])
        break
      case 'chestOpened':
        // 삐걱 열리고 반짝 — 낮은 음에서 높은 두 음으로
        this.chord([
          { from: 180, to: 240, duration: 0.16, type: 'square', gain: 0.12 },
          { from: 784, duration: 0.22, gain: 0.1 },
          { from: 1175, duration: 0.34, gain: 0.09 },
        ])
        break
      case 'itemGained':
        this.chord([
          { from: 698, duration: 0.14, gain: 0.12 },
          { from: 1047, duration: 0.26, gain: 0.1 },
        ])
        break
      case 'itemUsed':
        // 치유와 비슷하지만 더 짧게 — 물약 마시는 소리
        this.chord([
          { from: 440, to: 660, duration: 0.14, gain: 0.13 },
          { from: 880, duration: 0.18, gain: 0.08 },
        ])
        break
      // 마을 — 동전은 짤랑, 분해는 부서지는 소리, 강화는 올라가는 차임
      case 'goldGained':
      case 'sold':
        this.chord([
          { from: 988, duration: 0.09, type: 'triangle', gain: 0.1 },
          { from: 1319, duration: 0.16, type: 'triangle', gain: 0.09 },
        ])
        break
      case 'bought':
        this.chord([
          { from: 1319, duration: 0.09, type: 'triangle', gain: 0.1 },
          { from: 988, duration: 0.16, type: 'triangle', gain: 0.09 },
        ])
        break
      case 'dismantled':
        this.chord([
          { from: 320, to: 120, duration: 0.2, type: 'square', gain: 0.11 },
          { from: 160, to: 90, duration: 0.26, type: 'sawtooth', gain: 0.07 },
        ])
        break
      case 'upgraded':
        this.chord([
          { from: 587, duration: 0.14, gain: 0.13 },
          { from: 784, to: 988, duration: 0.36, gain: 0.11 },
        ])
        break
      case 'levelUp':
        // 위로 올라가는 세 음 — 성장의 소리
        this.chord([
          { from: 523, duration: 0.18, gain: 0.14 },
          { from: 659, duration: 0.32, gain: 0.13 },
          { from: 880, duration: 0.5, gain: 0.12 },
        ])
        break
      case 'checkpoint':
        this.chord([
          { from: 523, duration: 0.3, gain: 0.16 },
          { from: 784, duration: 0.4, gain: 0.12 },
        ])
        break
      case 'battleStart':
        this.chord([
          { from: 330, to: 660, duration: 0.28, type: 'sawtooth', gain: 0.14 },
          { from: 110, duration: 0.35, gain: 0.12 },
        ])
        break
      case 'playerTurn':
        this.tone({ from: 660, to: 880, duration: 0.12, gain: 0.14 })
        break
      case 'attacked': {
        // 아군이 때리면 오른쪽(적 진영), 맞으면 왼쪽에서 들린다
        const dir: Dir = e.actor.side === 'ally' ? 'east' : 'west'
        this.tone({ from: 320, to: 90, duration: 0.16, type: 'sawtooth', gain: 0.22 }, dir)
        break
      }
      case 'deflected': {
        // 맞는 소리와 확실히 구분되게 위로 스치는 음
        const dir: Dir = e.actor.side === 'ally' ? 'east' : 'west'
        this.tone({ from: 500, to: 900, duration: 0.12, gain: 0.13 }, dir)
        break
      }
      case 'healed':
        this.chord([
          { from: 587, to: 880, duration: 0.28, gain: 0.14 },
          { from: 880, duration: 0.2, gain: 0.08 },
        ])
        break
      case 'taunted':
        this.tone({ from: 150, to: 300, duration: 0.3, type: 'sawtooth', gain: 0.18 })
        break
      case 'defended':
        this.tone({ from: 400, to: 260, duration: 0.16, gain: 0.14 })
        break
      case 'downed':
        this.tone({
          from: e.target.side === 'enemy' ? 300 : 220,
          to: 60,
          duration: 0.32,
          type: e.target.side === 'enemy' ? 'triangle' : 'sine',
          gain: 0.18,
        })
        break
      case 'victory':
        this.chord([
          { from: 523, duration: 0.5, gain: 0.14 },
          { from: 659, duration: 0.5, gain: 0.12 },
          { from: 784, duration: 0.6, gain: 0.12 },
        ])
        break
      case 'defeat':
        this.chord([
          { from: 330, to: 110, duration: 0.7, gain: 0.16 },
          { from: 220, to: 82, duration: 0.8, gain: 0.12 },
        ])
        break
      case 'stageClear':
        this.chord([
          { from: 523, duration: 0.7, gain: 0.14 },
          { from: 784, duration: 0.7, gain: 0.12 },
          { from: 1047, duration: 0.9, gain: 0.1 },
        ])
        break
      case 'optionsChanged':
        if (this.master) this.master.gain.value = this.options.volume
        break
    }
  }
}
