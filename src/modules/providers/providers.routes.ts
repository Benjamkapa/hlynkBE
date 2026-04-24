import type { FastifyInstance } from 'fastify'
import { authenticate, requireProvider } from '../../middleware/authenticate'
import { tenantScope } from '../../middleware/tenantScope'
import * as providerService from './providers.service'

export async function providerRoutes(fastify: FastifyInstance) {
  const preHandler = [authenticate, tenantScope]

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
    return reply.send({ success: true, data: stats })
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
}
