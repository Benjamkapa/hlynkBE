// import { Redis } from '@upstash/redis'

// // In development with placeholder creds, we use an in-memory fallback
// const isPlaceholder = process.env.UPSTASH_REDIS_REST_URL?.includes('placeholder')

// let redisClient: Redis | null = null

// if (!isPlaceholder) {
//   redisClient = new Redis({
//     url: process.env.UPSTASH_REDIS_REST_URL!,
//     // token: process.env.UPSTASH_REDIS_REST_TOKEN!,
//   })
// }

// // ─── In-memory fallback for local dev ────────────────────────
// const memStore = new Map<string, { value: string; expiresAt: number }>()

// function memGet(key: string): string | null {
//   const entry = memStore.get(key)
//   if (!entry) return null
//   if (Date.now() > entry.expiresAt) { memStore.delete(key); return null }
//   return entry.value
// }
// function memSet(key: string, ttlSeconds: number, value: string) {
//   memStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
// }
// function memDel(key: string) { memStore.delete(key) }

// // ─── Exported redis API (same interface either way) ───────────
// export const redis = {
//   get: async (key: string): Promise<string | null> => {
//     if (redisClient) return redisClient.get(key) as Promise<string | null>
//     return memGet(key)
//   },
//   setex: async (key: string, ttl: number, value: string): Promise<void> => {
//     if (redisClient) { await redisClient.setex(key, ttl, value); return }
//     memSet(key, ttl, value)
//   },
//   del: async (key: string): Promise<void> => {
//     if (redisClient) { await redisClient.del(key); return }
//     memDel(key)
//   },
// }

// if (isPlaceholder) {
//   console.warn(' ')
//   // console.warn('⚠️  Redis: using in-memory fallback (dev mode). OTPs will not persist across restarts.')
// }

// // ─── Key helpers ──────────────────────────────────────────────
// export const redisKeys = {
//   otp: (phone: string) => `otp:${phone}`,
//   refreshToken: (userId: string) => `refresh:${userId}`,
//   blacklist: (token: string) => `blacklist:${token}`,
//   rateLimitSms: (phone: string) => `sms_rate:${phone}`,
// }
