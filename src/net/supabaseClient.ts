import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * 함께 하기의 서버 연결. 게으르게 만든다 — 이 모듈 자체가 동적 import로만
 * 불리므로, 솔로 플레이는 서버로 요청 한 번 보내지 않는다.
 * 키는 환경변수로만 온다. 코드와 저장소에는 키가 없다.
 */
let client: SupabaseClient | null = null

export function hasSupabaseConfig(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
}

export function supabase(): SupabaseClient {
  if (!client) {
    const url = import.meta.env.VITE_SUPABASE_URL
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY
    if (!url || !key) {
      throw new Error('함께 하기 서버가 아직 연결되지 않았다.')
    }
    client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  }
  return client
}
