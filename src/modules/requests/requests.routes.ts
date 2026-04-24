import type { FastifyInstance } from 'fastify'
import { requireProvider } from '../../middleware/authenticate'
import { tenantScope } from '../../middleware/tenantScope'
import * as requestsService from './requests.service'

export async function requestRoutes(fastify: FastifyInstance) {
  const preHandler = [requireProvider, tenantScope]

  // GET /api/v1/requests?status=PENDING&page=1
  fastify.get('/', { preHandler }, async (request, reply) => {
    const { status, page, limit } = request.query as Record<string, string>
    const result = await requestsService.getProviderRequests(
      request.tenantId!,
      status,
      Number(page) || 1,
      Number(limit) || 20,
    )
    return reply.send({ success: true, data: result })
  })

  // POST /api/v1/requests  (customer submitting a request)
  fastify.post('/', { preHandler }, async (request, reply) => {
    const req = await requestsService.createRequest(
      request.tenantId!,
      request.user.userId,
      request.body,
    )
    return reply.status(201).send({ success: true, data: req })
  })

  // PUT /api/v1/requests/:id/status
  fastify.put('/:id/status', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const updated = await requestsService.updateRequestStatus(id, request.tenantId!, request.body)
    return reply.send({ success: true, data: updated })
  })
}
