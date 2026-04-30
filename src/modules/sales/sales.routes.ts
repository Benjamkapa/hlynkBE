import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate'
import { tenantScope } from '../../middleware/tenantScope'
import * as salesService from './sales.service'

export async function salesRoutes(fastify: FastifyInstance) {
  const preHandler = [authenticate, tenantScope]

  fastify.get('/', { preHandler }, async (request, reply) => {
    const data = await salesService.listSales(request.tenantId!, request.query as any)
    return reply.send({ success: true, ...data })
  })

  fastify.post('/', { preHandler }, async (request, reply) => {
    const sale = await salesService.createSale(request.tenantId!, request.body)
    return reply.send({ success: true, data: sale })
  })

  fastify.get('/:id', { preHandler }, async (request, reply) => {
    const { id } = request.params as any
    const sale = await salesService.getSaleDetails(id, request.tenantId!)
    return reply.send({ success: true, data: sale })
  })

  fastify.post('/:id/receipt/send', { preHandler }, async (request, reply) => {
    const { id } = request.params as any
    const result = await salesService.sendSaleReceipt(id, request.tenantId!, request.body)
    return reply.send({ success: true, data: result })
  })
}
