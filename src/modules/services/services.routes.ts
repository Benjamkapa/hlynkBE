import type { FastifyInstance } from 'fastify'
import { requireProvider, subscriptionGuard } from '../../middleware/authenticate'
import { tenantScope } from '../../middleware/tenantScope'
import * as servicesService from './services.service'

export async function serviceRoutes(fastify: FastifyInstance) {
  const preHandler = [requireProvider, subscriptionGuard, tenantScope]

  // GET /api/v1/services
  fastify.get('/', { preHandler }, async (request, reply) => {
    const services = await servicesService.getMyServices(request.tenantId!)
    return reply.send({ success: true, data: services })
  })

  // POST /api/v1/services
  fastify.post('/', { preHandler }, async (request, reply) => {
    const { prisma } = await import('../../lib/prisma')
    const provider = await prisma.provider.findUnique({ where: { userId: request.user.userId } })
    if (!provider) return reply.status(404).send({ success: false, message: 'Provider not found' })

    const service = await servicesService.createService(request.tenantId!, provider.id, request.body)
    return reply.status(201).send({ success: true, data: service })
  })

  // PUT /api/v1/services/:id
  fastify.put('/:id', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const updated = await servicesService.updateService(id, request.tenantId!, request.body)
    return reply.send({ success: true, data: updated })
  })

  // DELETE /api/v1/services/:id
  fastify.delete('/:id', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    await servicesService.deleteService(id, request.tenantId!)
    return reply.send({ success: true, message: 'Service deleted' })
  })
}
