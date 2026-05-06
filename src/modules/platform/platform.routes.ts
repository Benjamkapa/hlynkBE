import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import { tenantScope } from '../../middleware/tenantScope'
import * as platformService from './platform.service'

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().min(12).max(280)
})

export async function platformRoutes(fastify: FastifyInstance) {
  fastify.get('/reviews', async (request, reply) => {
    const reviews = await platformService.getPlatformReviews(request.query as { limit?: number })
    return reply.send({ success: true, ...reviews })
  })

  fastify.get('/reviews/me', { preHandler: [authenticate, tenantScope] }, async (request, reply) => {
    const review = await platformService.getMyPlatformReview(request.user.userId)
    return reply.send({ success: true, data: review })
  })

  fastify.post('/reviews', { preHandler: [authenticate, tenantScope] }, async (request, reply) => {
    const body = reviewSchema.parse(request.body)
    const review = await platformService.submitPlatformReview(request.user.userId, request.tenantId!, body)
    return reply.send({ success: true, data: review })
  })
}
