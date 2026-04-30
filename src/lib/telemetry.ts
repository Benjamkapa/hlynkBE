import { Prisma } from '@prisma/client'
import { prisma } from './prisma'

type TelemetryLevel = 'INFO' | 'WARN' | 'ERROR'
type TelemetryCategory = 'REQUEST' | 'BUSINESS' | 'AUTH' | 'PAYMENT' | 'SYSTEM'

interface TrackEventInput {
  tenantId?: string
  userId?: string
  level?: TelemetryLevel
  category: TelemetryCategory
  action: string
  message?: string
  method?: string
  path?: string
  statusCode?: number
  durationMs?: number
  metadata?: Record<string, unknown>
}

const TELEMETRY_ENABLED = (process.env.TELEMETRY_ENABLED || 'true') === 'true'
const SAMPLE_RATE = Number(process.env.TELEMETRY_SAMPLE_RATE || '0.2')

export async function trackEvent(input: TrackEventInput) {
  if (!TELEMETRY_ENABLED) return
  try {
    await prisma.systemEvent.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        level: input.level || 'INFO',
        category: input.category,
        action: input.action,
        message: input.message,
        method: input.method,
        path: input.path,
        statusCode: input.statusCode,
        durationMs: input.durationMs,
        metadata: sanitizeMetadata(input.metadata),
      },
    })
  } catch (error) {
    console.error('[telemetry] failed to persist event', error)
  }
}

export function shouldSampleRequest(method: string, statusCode: number) {
  if (statusCode >= 400) return true
  if (method !== 'GET') return true
  return Math.random() < SAMPLE_RATE
}

const SENSITIVE_KEYS = ['password', 'passwordhash', 'token', 'authorization', 'secret', 'otp', 'refreshToken']

function sanitizeMetadata(metadata?: Record<string, unknown>): Prisma.InputJsonValue | undefined {
  if (!metadata) return undefined
  return sanitizeValue(metadata) as Prisma.InputJsonValue
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue)
  }

  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const next: Record<string, unknown> = {}
    for (const [key, raw] of Object.entries(obj)) {
      const normalized = key.toLowerCase()
      if (SENSITIVE_KEYS.some((s) => normalized.includes(s.toLowerCase()))) {
        next[key] = '[REDACTED]'
      } else {
        next[key] = sanitizeValue(raw)
      }
    }
    return next
  }

  return value
}
