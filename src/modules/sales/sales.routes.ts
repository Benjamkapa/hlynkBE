import type { FastifyInstance } from 'fastify'
import { authenticate, subscriptionGuard } from '../../middleware/authenticate'
import { tenantScope } from '../../middleware/tenantScope'
import * as salesService from './sales.service'
import { z } from 'zod'

const stkPushSchema = z.object({
  phone: z.string().min(10),
  amount: z.number().positive(),
  reference: z.string()
})

export async function salesRoutes(fastify: FastifyInstance) {
  const preHandler = [authenticate, subscriptionGuard, tenantScope]

  fastify.get('/', { preHandler }, async (request, reply) => {
    const data = await salesService.listSales(request.tenantId!, request.query as any)
    return reply.send({ success: true, ...data })
  })

  fastify.post('/', { preHandler }, async (request, reply) => {
    const sale = await salesService.createSale(request.tenantId!, request.body, request.user.userId, request.ip)
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

  fastify.post('/mpesa-push', { preHandler }, async (request, reply) => {
    const body = stkPushSchema.parse(request.body)
    try {
      const result = await salesService.triggerVendorStkPush(request.tenantId!, body)
      return reply.send({ success: true, data: result })
    } catch (error: any) {
      return reply.status(400).send({ success: false, message: error.message })
    }
  })

  fastify.post('/mpesa-callback', async (request, reply) => {
    const { Body } = request.body as any
    console.log('Vendor M-Pesa Callback Received:', JSON.stringify(request.body, null, 2))

    if (!Body || !Body.stkCallback) {
      return reply.send({ ResultCode: 1, ResultDesc: 'Invalid body' })
    }

    const { ResultCode, ResultDesc, MerchantRequestID, CheckoutRequestID, CallbackMetadata } = Body.stkCallback
    const success = ResultCode === 0

    await salesService.handleVendorPaymentCallback(CheckoutRequestID, MerchantRequestID, success, ResultDesc)

    return reply.send({ ResultCode: 0, ResultDesc: 'Success' })
  })
}
