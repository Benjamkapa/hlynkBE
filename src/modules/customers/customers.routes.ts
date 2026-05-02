import type { FastifyInstance } from 'fastify'
import { authenticate, subscriptionGuard } from '../../middleware/authenticate'
import { tenantScope } from '../../middleware/tenantScope'
import * as customersService from './customers.service'

export async function customersRoutes(fastify: FastifyInstance) {
  const preHandler = [authenticate, subscriptionGuard, tenantScope]

  // GET /api/v1/customers
  fastify.get('/', { preHandler }, async (request, reply) => {
    const params = request.query as any
    const result = await customersService.listCustomers(request.tenantId!, params)
    return reply.send({ success: true, ...result })
  })

  // POST /api/v1/customers
  fastify.post('/', { preHandler }, async (request, reply) => {
    const data = request.body as any
    const customer = await customersService.createCustomer(request.tenantId!, data)
    return reply.status(201).send({ success: true, data: customer })
  })

  // PUT /api/v1/customers/:id
  fastify.put('/:id', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const data = request.body as any
    const customer = await customersService.updateCustomer(id, request.tenantId!, data)
    return reply.send({ success: true, data: customer })
  })

  // DELETE /api/v1/customers/:id
  fastify.delete('/:id', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string }
    await customersService.deleteCustomer(id, request.tenantId!)
    return reply.send({ success: true, message: 'Customer removed' })
  })
}
