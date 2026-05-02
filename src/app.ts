import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'

import { authRoutes } from './modules/auth/auth.routes'
import { providerRoutes } from './modules/providers/providers.routes'
import { serviceRoutes } from './modules/services/services.routes'
import { requestRoutes } from './modules/requests/requests.routes'
import { adminRoutes } from './modules/admin/admin.routes'
import { inventoryRoutes } from './modules/inventory/inventory.routes'
import { salesRoutes } from './modules/sales/sales.routes'
import { expensesRoutes } from './modules/expenses/expenses.routes'
import { customersRoutes } from './modules/customers/customers.routes'
import { paymentRoutes } from './modules/payments/payments.routes'
import { subscriptionRoutes } from './modules/subscriptions/subscriptions.routes'

const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
    transport:
      process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
})

const PORT = Number(process.env.PORT) || 3000
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'

async function bootstrap() {
  // ─── Plugins ──────────────────────────────────────────────────────────────
  await app.register(cors, {
    origin: [FRONTEND_URL],
    credentials: true,
  })

  await app.register(jwt, {
    secret: process.env.JWT_SECRET!,
  })

  await app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  })

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  })

  // ─── Health Check ─────────────────────────────────────────────────────────
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

  // ─── Routes ───────────────────────────────────────────────────────────────
  await app.register(authRoutes, { prefix: '/api/v1/auth' })
  await app.register(providerRoutes, { prefix: '/api/v1/providers' })
  await app.register(serviceRoutes, { prefix: '/api/v1/services' })
  await app.register(requestRoutes, { prefix: '/api/v1/requests' })
  await app.register(adminRoutes, { prefix: '/api/v1/admin' })
  await app.register(inventoryRoutes, { prefix: '/api/v1/inventory' })
  await app.register(salesRoutes, { prefix: '/api/v1/sales' })
  await app.register(expensesRoutes, { prefix: '/api/v1/expenses' })
  await app.register(customersRoutes, { prefix: '/api/v1/customers' })
  await app.register(paymentRoutes, { prefix: '/api/v1/payments' })
  await app.register(subscriptionRoutes, { prefix: '/api/v1/subscriptions' })

  // ─── Global Error Handler ─────────────────────────────────────────────────
  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error)

    // Handle Zod Validation Errors
    if (error.name === 'ZodError') {
      const messages = (error as any).issues.map((iss: any) => iss.message).join('. ')
      return reply.status(400).send({ 
        success: false, 
        message: messages || 'Validation failed'
      })
    }

    if (error.statusCode) {
      return reply.status(error.statusCode).send({ success: false, message: error.message })
    }

    return reply.status(500).send({ success: false, message: 'Internal server error' })
  })

  // ─── Start ────────────────────────────────────────────────────────────────
  await app.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`🚀 hlynk API running on http://localhost:${PORT}`)
}

bootstrap().catch((err) => {
  console.error(err)
  process.exit(1)
})
