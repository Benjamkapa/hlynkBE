import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate'
import { tenantScope } from '../../middleware/tenantScope'
import * as subService from './subscriptions.service'

export async function subscriptionRoutes(fastify: FastifyInstance) {
  const preHandler = [authenticate, tenantScope]

  // GET /api/v1/subscriptions/me
  fastify.get('/me', { preHandler }, async (request, reply) => {
    const sub = await subService.getMySubscription(request.tenantId!)
    return reply.send({ success: true, data: sub })
  })

  // GET /api/v1/subscriptions/history
  fastify.get('/history', { preHandler }, async (request, reply) => {
    const history = await subService.getBillingHistory(request.tenantId!)
    return reply.send({ success: true, data: history })
  })

  // POST /api/v1/subscriptions/renew
  fastify.post('/renew', { preHandler }, async (request, reply) => {
    const { phone } = request.body as { phone: string }
    const result = await subService.initiateRenewal(request.tenantId!, phone)
    return reply.send(result)
  })

  // POST /api/v1/subscriptions/change-plan
  fastify.post('/change-plan', { preHandler }, async (request, reply) => {
    const { planName, phone } = request.body as { planName: 'STARTER' | 'GROWTH' | 'PRO', phone: string }
    const result = await subService.changePlan(request.tenantId!, planName, phone)
    return reply.send(result)
  })
}
