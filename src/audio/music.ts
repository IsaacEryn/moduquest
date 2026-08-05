import type { EventBus } from '../core/events'
import type { Options } from '../ui/optionsStore'

/**
 * 배경음악. 효과음과 같은 길을 간다 — 음원 파일 없이 Web Audio로 합성한다.
 * 라이선스도 용량도 들지 않고, 무엇보다 **같은 곳에서는 언제나 같은 곡**이다.
 * 이 게임에 무작위가 없다는 규칙이 소리에도 그대로 적용된다.
 *
 * 가락은 전부 손으로 적은 음표 배열이다. 절차적으로 "생성"하지 않는다 —
 * 생성하면 매번 달라지고, 달라지면 이 게임의 전제가 무너진다.
 */

/** 한 음. m은 MIDI 번호(0이면 쉼표), b는 박자 */
export interface Note {
  m: number
  b: number
}

export interface Track {
  name: string
  bpm: number
  /** 가락 — 위 성부 */
  lead: Note[]
  /** 저음 — 아래 성부 */
  bass: Note[]
  leadType: OscillatorType
  bassType: OscillatorType
  /** 가락이 반 박 뒤에 작게 한 번 더 울린다. 굴과 탑의 메아리 */
  echo?: boolean
  /** 전체 음량 배수 */
  gain?: number
}

const n = (m: number, b: number): Note => ({ m, b })

/**
 * 곡들. 모두 4/4이고 마디 수가 딱 떨어진다(테스트가 지킨다).
 * 스테이지마다 조성과 빠르기를 달리해 어디에 있는지가 귀로도 구분된다.
 */
export const TRACKS: Record<string, Track> = {
  // 타이틀 — 다장조. 떠나기 전의 설렘
  title: {
    name: '모두의 원정대',
    bpm: 96,
    leadType: 'triangle',
    bassType: 'sine',
    lead: [
      n(72, 0.5), n(76, 0.5), n(79, 1), n(76, 0.5), n(74, 0.5), n(72, 1),
      n(74, 0.5), n(77, 0.5), n(81, 1), n(79, 0.5), n(77, 0.5), n(76, 1),
      n(76, 0.5), n(79, 0.5), n(84, 1), n(83, 0.5), n(81, 0.5), n(79, 1),
      n(81, 0.5), n(79, 0.5), n(76, 1), n(74, 0.5), n(72, 1.5),
    ],
    bass: [n(48, 4), n(53, 4), n(45, 4), n(43, 4)],
  },

  // 고요한 숲 — 가장 느리고 여백이 많다. 새 소리가 없는 숲
  stage1: {
    name: '고요한 숲',
    bpm: 80,
    leadType: 'triangle',
    bassType: 'sine',
    gain: 0.9,
    lead: [
      n(69, 1), n(72, 1), n(74, 2),
      n(76, 1), n(74, 1), n(72, 2),
      n(72, 1), n(69, 1), n(67, 2),
      n(69, 2), n(0, 2),
    ],
    bass: [n(45, 4), n(41, 4), n(43, 4), n(45, 4)],
  },

  // 울림 굴 — 낮고 어둡다. 메아리가 곡의 일부다
  stage2: {
    name: '울림 굴',
    bpm: 72,
    leadType: 'sine',
    bassType: 'sine',
    echo: true,
    gain: 0.95,
    lead: [
      n(69, 2), n(67, 1), n(65, 1),
      n(62, 2), n(65, 2),
      n(67, 2), n(69, 1), n(72, 1),
      n(69, 3), n(0, 1),
    ],
    bass: [n(38, 4), n(41, 4), n(36, 4), n(38, 4)],
  },

  // 울림 탑 — 화성 단음계. 아르페지오가 계단처럼 올라간다
  stage3: {
    name: '울림 탑',
    bpm: 104,
    leadType: 'triangle',
    bassType: 'square',
    echo: true,
    lead: [
      n(69, 0.5), n(72, 0.5), n(76, 0.5), n(81, 0.5), n(80, 1), n(76, 1),
      n(69, 0.5), n(72, 0.5), n(77, 0.5), n(81, 0.5), n(80, 1), n(77, 1),
      n(71, 0.5), n(74, 0.5), n(77, 0.5), n(83, 0.5), n(81, 1), n(77, 1),
      n(76, 0.5), n(74, 0.5), n(72, 1), n(69, 2),
    ],
    bass: [n(45, 2), n(52, 2), n(41, 2), n(48, 2), n(43, 2), n(50, 2), n(45, 4)],
  },

  // 전투 — 빠르고 단호하게. 짧은 음이 몰아친다
  battle: {
    name: '전투',
    bpm: 132,
    leadType: 'square',
    bassType: 'square',
    gain: 0.85,
    lead: [
      n(69, 0.5), n(69, 0.5), n(72, 0.5), n(71, 0.5), n(69, 1), n(76, 1),
      n(74, 0.5), n(74, 0.5), n(72, 0.5), n(71, 0.5), n(69, 2),
      n(69, 0.5), n(72, 0.5), n(76, 0.5), n(79, 0.5), n(77, 1), n(76, 1),
      n(74, 0.5), n(72, 0.5), n(71, 1), n(69, 2),
    ],
    bass: [
      n(45, 1), n(45, 1), n(45, 1), n(45, 1),
      n(41, 1), n(41, 1), n(43, 1), n(43, 1),
      n(45, 1), n(45, 1), n(48, 1), n(48, 1),
      n(43, 1), n(43, 1), n(45, 2),
    ],
  },

  // 보스 — 전투와 뼈대가 같되 반음 낮고 무겁다. 같은 싸움이 아니라는 신호
  boss: {
    name: '보스',
    bpm: 120,
    leadType: 'sawtooth',
    bassType: 'square',
    gain: 0.8,
    lead: [
      n(65, 1), n(64, 1), n(65, 1), n(68, 1),
      n(70, 1), n(68, 1), n(65, 2),
      n(63, 1), n(65, 1), n(68, 1), n(70, 1),
      n(72, 2), n(65, 2),
    ],
    bass: [
      n(41, 1), n(41, 1), n(41, 1), n(41, 1),
      n(39, 1), n(39, 1), n(41, 1), n(41, 1),
      n(36, 1), n(36, 1), n(36, 1), n(36, 1),
      n(41, 2), n(41, 2),
    ],
  },
}

export function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12)
}

/** 한 성부의 재생 위치 — 곡은 끝나면 처음으로 돌아간다 */
interface Voice {
  notes: Note[]
  index: number
  /** 다음 음을 울릴 시각(AudioContext 기준) */
  at: number
}

const LOOKAHEAD_MS = 100
const SCHEDULE_AHEAD = 0.35

export class Music {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private timer: number | null = null
  private current: string | null = null
  private track: Track | null = null
  private lead: Voice | null = null
  private bass: Voice | null = null
  /** 전투 전에 흐르던 곡 — 전투가 끝나면 여기로 돌아온다 */
  private fieldTrack = 'title'

  constructor(
    bus: EventBus,
    private options: Options,
  ) {
    // 첫 화면은 mode 이벤트 없이 그려진다 — 무엇을 틀지만 정해 두고,
    // 소리를 낼 수 있게 되는 순간(첫 조작) 그때 시작한다
    this.current = 'title'
    this.track = TRACKS.title

    const wake = async () => {
      const ctx = this.ensureContext()
      if (ctx?.state === 'suspended') await ctx.resume()
      if (this.current) this.play(this.current)
    }
    document.addEventListener('pointerdown', () => void wake(), { once: true })
    document.addEventListener('keydown', () => void wake(), { once: true })

    // 보이지 않는 탭에서 계속 울릴 이유가 없다
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return
      if (document.hidden) void this.ctx.suspend()
      else if (this.current) void this.ctx.resume()
    })

    bus.on((e) => {
      switch (e.type) {
        case 'stageStart':
          this.fieldTrack = `stage${e.index + 1}` in TRACKS ? `stage${e.index + 1}` : 'stage1'
          this.play(this.fieldTrack)
          break
        case 'battleStart':
          this.play(e.enemies.some((c) => c.isBoss) ? 'boss' : 'battle')
          break
        case 'battleEnd':
          this.play(this.fieldTrack)
          break
        case 'mode':
          // 대화·필드는 곡을 바꾸지 않는다 — 한 걸음마다 음악이 끊기면 그게 소음이다
          if (e.mode === 'title') {
            this.fieldTrack = 'title'
            this.play('title')
          }
          break
        case 'optionsChanged':
          this.applyVolume()
          // 껐다 다시 켰으면 곡을 처음부터 건다
          if (this.options.music && this.options.volume > 0 && this.current) {
            this.play(this.current)
          }
          break
      }
    })
  }

  private ensureContext(): AudioContext | null {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      this.ctx = new Ctor()
      this.master = this.ctx.createGain()
      this.master.connect(this.ctx.destination)
      // 브라우저가 늦게 깨워 주는 경우도 있다 — 깨어나면 그때 곡을 건다
      this.ctx.addEventListener('statechange', () => {
        if (this.ctx?.state === 'running' && this.current && this.timer === null) {
          this.play(this.current)
        }
      })
    }
    if (this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume()
    this.applyVolume()
    return this.ctx
  }

  /** 배경음악은 낭독과 효과음을 덮으면 안 된다 — 늘 한참 아래에 깔린다 */
  private applyVolume(): void {
    if (!this.master) return
    const on = this.options.music && this.options.volume > 0
    const base = on ? this.options.volume * 0.16 : 0
    // 저자극 모드에서는 더 조용히 — 감각 과부하를 만들지 않는다
    this.master.gain.value = base * (this.options.lowStim ? 0.5 : 1) * (this.track?.gain ?? 1)
    // 켜는 일은 여기서 하지 않는다 — 성부가 준비되기 전에 루프를 돌리면
    // 예약할 음이 없어 빈 타이머만 남고, 그 타이머 때문에 play가 되돌아 나간다
    if (!on) this.stopLoop()
  }

  play(id: string): void {
    const track = TRACKS[id]
    if (!track) return
    // 같은 곡이 이미 흐르고 있으면 처음부터 다시 걸지 않는다
    if (this.current === id && this.timer !== null && this.lead) return
    this.current = id
    this.track = track
    const ctx = this.ensureContext()
    // 아직 잠들어 있으면 예약해 봐야 시계가 멈춰 있다. 깨어날 때 다시 부른다
    if (!ctx || ctx.state !== 'running') return
    const start = ctx.currentTime + 0.05
    this.lead = { notes: track.lead, index: 0, at: start }
    this.bass = { notes: track.bass, index: 0, at: start }
    this.startLoop()
  }

  private startLoop(): void {
    this.stopLoop()
    if (!this.options.music || this.options.volume === 0) return
    this.timer = window.setInterval(() => this.schedule(), LOOKAHEAD_MS)
    this.schedule()
  }

  private stopLoop(): void {
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
  }

  /**
   * 앞당겨 예약한다. setInterval만으로 음을 울리면 타이머 흔들림이 그대로 박자가
   * 되므로, 오디오 시계에 미리 못을 박아 두고 타이머는 예약만 맡는다.
   */
  private schedule(): void {
    const ctx = this.ctx
    const track = this.track
    if (!ctx || !track || !this.lead || !this.bass) return
    const beat = 60 / track.bpm
    const until = ctx.currentTime + SCHEDULE_AHEAD

    for (const [voice, type, gain, echo] of [
      [this.lead, track.leadType, 0.5, track.echo] as const,
      [this.bass, track.bassType, 0.34, false] as const,
    ]) {
      while (voice.at < until) {
        const note = voice.notes[voice.index]
        const dur = note.b * beat
        if (note.m > 0) {
          this.note(midiToFreq(note.m), voice.at, dur, type, gain)
          if (echo) this.note(midiToFreq(note.m), voice.at + beat * 0.5, dur * 0.6, type, gain * 0.3)
        }
        voice.at += dur
        voice.index = (voice.index + 1) % voice.notes.length
      }
    }
  }

  private note(
    freq: number,
    at: number,
    dur: number,
    type: OscillatorType,
    gain: number,
  ): void {
    const ctx = this.ctx
    if (!ctx || !this.master) return
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(freq, at)
    const env = ctx.createGain()
    // 부드럽게 들고 천천히 내린다 — 딱딱한 시작음은 오래 들으면 피로하다
    env.gain.setValueAtTime(0, at)
    env.gain.linearRampToValueAtTime(gain, at + Math.min(0.06, dur * 0.3))
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur * 0.95)
    osc.connect(env)
    env.connect(this.master)
    osc.start(at)
    osc.stop(at + dur)
  }
}
