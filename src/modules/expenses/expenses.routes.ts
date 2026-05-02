import type { FastifyInstance } from 'fastify'
import { authenticate, subscriptionGuard } from '../../middleware/authenticate'
import { tenantScope } from '../../middleware/tenantScope'
import * as expensesService from './expenses.service'

export async function expensesRoutes(fastify: FastifyInstance) {
  const preHandler = [authenticate, subscriptionGuard, tenantScope]

  fastify.get('/', { preHandler }, async (request, reply) => {
    const data = await expensesService.listExpenses(request.tenantId!, request.query as any)
    return reply.send({ success: true, ...data })
  })

  fastify.post('/', { preHandler }, async (request, reply) => {
    const expense = await expensesService.createExpense(request.tenantId!, request.body)
    return reply.send({ success: true, data: expense })
  })

  fastify.delete('/:id', { preHandler }, async (request, reply) => {
    const { id } = request.params as any
    await expensesService.deleteExpense(id, request.tenantId!)
    return reply.send({ success: true, message: 'Expense deleted' })
  })
}
