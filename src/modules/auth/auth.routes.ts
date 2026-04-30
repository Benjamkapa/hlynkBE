import type { FastifyInstance } from 'fastify'
import {
  registerSchema,
  verifyOtpSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  googleAuthSchema,
} from './auth.schema'
import * as authService from './auth.service'
import { authenticate } from '../../middleware/authenticate'

export async function authRoutes(fastify: FastifyInstance) {
  // POST /api/v1/auth/register
  fastify.post('/register', async (request, reply) => {
    const body = registerSchema.parse(request.body)
    const result = await authService.register(body)
    return reply.status(201).send({ success: true, data: result })
  })

  // POST /api/v1/auth/verify-otp
  fastify.post('/verify-otp', async (request, reply) => {
    const body = verifyOtpSchema.parse(request.body)
    const result = await authService.verifyOtp(fastify, body)
    return reply.send({ success: true, data: result })
  })

  // POST /api/v1/auth/login
  fastify.post('/login', async (request, reply) => {
    const body = loginSchema.parse(request.body)
    const result = await authService.login(fastify, body)
    return reply.send({ success: true, data: result })
  })

  // POST /api/v1/auth/forgot-password
  fastify.post('/forgot-password', async (request, reply) => {
    const body = forgotPasswordSchema.parse(request.body)
    const result = await authService.forgotPassword(body)
    return reply.send({ success: true, data: result })
  })

  // POST /api/v1/auth/reset-password
  fastify.post('/reset-password', async (request, reply) => {
    const body = resetPasswordSchema.parse(request.body)
    const result = await authService.resetPassword(body)
    return reply.send({ success: true, data: result })
  })

  // POST /api/v1/auth/google
  fastify.post('/google', async (request, reply) => {
    const body = googleAuthSchema.parse(request.body)
    const result = await authService.googleAuth(fastify, body)
    return reply.send({ success: true, data: result })
  })

  // POST /api/v1/auth/logout  (protected)
  fastify.post('/logout', { preHandler: authenticate }, async (request, reply) => {
    const result = await authService.logout(request.user.userId)
    return reply.send({ success: true, data: result })
  })

  // GET /api/v1/auth/me  (protected)
  fastify.get('/me', { preHandler: authenticate }, async (request, reply) => {
    const { prisma } = await import('../../lib/prisma')
    const user = await prisma.user.findUnique({
      where: { id: request.user.userId },
      include: { tenant: { include: { subscription: true } } },
    })
    if (!user) return reply.status(404).send({ success: false, message: 'User not found' })

    return reply.send({
      success: true,
      data: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        tenantSlug: user.tenant.slug,
        businessName: user.tenant.businessName,
        subscription: user.tenant.subscription,
      },
    })
  })
}
