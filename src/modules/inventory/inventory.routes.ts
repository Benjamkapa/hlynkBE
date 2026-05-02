import type { FastifyInstance } from 'fastify'
import { authenticate, subscriptionGuard } from '../../middleware/authenticate'
import { tenantScope } from '../../middleware/tenantScope'
import * as inventoryService from './inventory.service'

export async function inventoryRoutes(fastify: FastifyInstance) {
  const preHandler = [authenticate, subscriptionGuard, tenantScope]

  fastify.get('/', { preHandler }, async (request, reply) => {
    const data = await inventoryService.listProducts(request.tenantId!, request.query as any)
    return reply.send({ success: true, ...data })
  })

  fastify.post('/', { preHandler }, async (request, reply) => {
    const product = await inventoryService.createProduct(request.tenantId!, request.body)
    return reply.send({ success: true, data: product })
  })

  fastify.post('/:id/image', { preHandler }, async (request, reply) => {
    const { id } = request.params as any
    const data = await request.file()
    if (!data) return reply.status(400).send({ success: false, message: 'No file uploaded' })

    const buffer = await data.toBuffer()
    const product = await inventoryService.uploadProductImage(id, request.tenantId!, buffer, data.mimetype)
    return reply.send({ success: true, data: product })
  })

  fastify.put('/:id', { preHandler }, async (request, reply) => {
    const { id } = request.params as any
    const product = await inventoryService.updateProduct(id, request.tenantId!, request.body)
    return reply.send({ success: true, data: product })
  })

  fastify.delete('/:id', { preHandler }, async (request, reply) => {
    const { id } = request.params as any
    await inventoryService.deleteProduct(id, request.tenantId!)
    return reply.send({ success: true, message: 'Product deleted' })
  })
}
