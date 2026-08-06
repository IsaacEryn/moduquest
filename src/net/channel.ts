import { supabase } from './supabaseClient'

/**
 * 세션이 채널에게 바라는 것 전부. Supabase의 RealtimeChannel이 이보다 훨씬 많은
 * 일을 하지만, 세션은 이만큼만 알면 된다 — 그래서 테스트가 전선 없이 두 세션을
 * 이을 수 있고, 언젠가 다른 실시간 서비스로 옮겨도 세션은 그대로다.
 */
export interface PartyChannel {
  onBroadcast(event: string, cb: (payload: unknown) => void): void
  onPresence(event: 'join' | 'leave', cb: (userId: string) => void): void
  /** 구독한다. 실패하면 던진다 — 대기가 영원해지는 길을 남기지 않는다 */
  subscribe(): Promise<void>
  send(event: string, payload: unknown): void
  /** presence에 내 표를 올린다 */
  track(payload: Record<string, unknown>): void
  /** userId → presence 항목 */
  presenceOf(userId: string): Record<string, unknown> | null
  close(): void
}

export type OpenChannel = (topic: string, userId: string) => PartyChannel

/** 실제 채널 — 함께 하기를 열 때에만 이 길을 지난다 */
export const openSupabaseChannel: OpenChannel = (topic, userId) => {
  const ch = supabase().channel(topic, {
    config: {
      private: true,
      broadcast: { self: false },
      presence: { key: userId },
    },
  })
  return {
    onBroadcast(event, cb) {
      ch.on('broadcast', { event }, ({ payload }) => cb(payload))
    },
    onPresence(event, cb) {
      // join과 leave를 따로 적는다 — 타입이 이벤트마다 다른 콜백 모양을 요구한다
      if (event === 'join') ch.on('presence', { event: 'join' }, ({ key }) => cb(key))
      else ch.on('presence', { event: 'leave' }, ({ key }) => cb(key))
    },
    subscribe() {
      return new Promise<void>((resolve, reject) => {
        let settled = false
        ch.subscribe((status) => {
          if (settled) return
          if (status === 'SUBSCRIBED') {
            settled = true
            resolve()
            return
          }
          // CLOSED도 반드시 매듭짓는다 — 예전에는 이 경우 약속이 영원히 열려 있어
          // 로비가 "여는 중" 상태로 굳었다
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            settled = true
            void ch.unsubscribe()
            reject(new Error('모험단 채널에 들어가지 못했다. 연결을 확인하자.'))
          }
        })
      })
    },
    send(event, payload) {
      void ch.send({ type: 'broadcast', event, payload }).then((res) => {
        // 확정 명령이 나가지 못하면 남은 화면이 구멍에 빠진다 — 조용히 지나가지 않는다
        if (res !== 'ok') console.warn('함께 하기 전송 실패:', event, res)
      })
    },
    track(payload) {
      void ch.track(payload)
    },
    presenceOf(userId) {
      const state = ch.presenceState<Record<string, unknown>>()
      return state[userId]?.[0] ?? null
    },
    close() {
      void ch.unsubscribe()
    },
  }
}
