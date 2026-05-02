import type { FastifyInstance } from 'fastify'
import { authenticate, requireProvider, subscriptionGuard } from '../../middleware/authenticate'
import { tenantScope } from '../../middleware/tenantScope'
import * as providerService from './providers.service'

export async function providerRoutes(fastify: FastifyInstance) {
  const preHandler = [authenticate, subscriptionGuard, tenantScope]

  // GET /api/v1/providers/me
  fastify.get('/me', { preHandler }, async (request, reply) => {
    const profile = await providerService.getMyProfile(request.user.userId)
    return reply.send({ success: true, data: profile })
  })

  // PUT /api/v1/providers/me
  fastify.put('/me', { preHandler: [requireProvider, tenantScope] }, async (request, reply) => {
    const updated = await providerService.updateProfile(
      request.user.userId,
      request.tenantId!,
      request.body,
    )
    return reply.send({ success: true, data: updated })
  })

  // GET /api/v1/providers/stats
  fastify.get('/stats', { preHandler }, async (request, reply) => {
    const stats = await providerService.getStats(request.tenantId!)
    return reply.send({ success: true, ...stats })
  })

  // POST /api/v1/providers/me/photo
  fastify.post('/me/photo', { preHandler: [requireProvider, tenantScope] }, async (request, reply) => {
    const data = await request.file()
    if (!data) return reply.status(400).send({ success: false, message: 'No file uploaded' })

    const buffer = await data.toBuffer()
    const updated = await providerService.uploadProfilePhoto(
      request.user.userId,
      request.tenantId!,
      buffer,
      data.mimetype,
    )
    return reply.send({ success: true, data: updated })
  })

  // PUT /api/v1/providers/me/settings
  fastify.put('/me/settings', { preHandler: [requireProvider, tenantScope] }, async (request, reply) => {
    const updated = await providerService.updateSettings(request.user.userId, request.body)
    return reply.send({ success: true, data: updated })
  })

  // POST /api/v1/providers/me/security/password
  fastify.post('/me/security/password', { preHandler: [requireProvider, tenantScope] }, async (request, reply) => {
    const result = await providerService.changePassword(request.user.userId, request.body)
    return reply.send(result)
  })

  // POST /api/v1/providers/me/security/deactivate
  fastify.post('/me/security/deactivate', { preHandler: [requireProvider, tenantScope] }, async (request, reply) => {
    const result = await providerService.deactivateAccount(request.user.userId)
    return reply.send(result)
  })

  // GET /api/v1/providers/me/activity
  fastify.get('/me/activity', { preHandler }, async (request, reply) => {
    const logs = await providerService.getActivityLogs(
      request.tenantId!, 
      request.user.userId, 
      request.user.role, 
      request.query as any
    )
    return reply.send({ success: true, ...logs })
  })

  // --- Staff Management ---
  fastify.get('/staff', { preHandler }, async (request, reply) => {
    const staff = await providerService.getStaff(request.tenantId!)
    return reply.send({ success: true, data: staff })
  })

  fastify.post('/staff', { preHandler: [requireProvider, tenantScope] }, async (request, reply) => {
    const staff = await providerService.createStaff(request.tenantId!, request.body)
    return reply.send({ success: true, data: staff })
  })

  fastify.put('/staff/:id', { preHandler: [requireProvider, tenantScope] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const staff = await providerService.updateStaff(request.tenantId!, id, request.body)
    return reply.send({ success: true, data: staff })
  })

  fastify.delete('/staff/:id', { preHandler: [requireProvider, tenantScope] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    await providerService.deleteStaff(request.tenantId!, id)
    return reply.send({ success: true, message: 'Staff deleted' })
  })
}
