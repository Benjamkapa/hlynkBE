import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate'
import { initiateStkPush } from '../../lib/mpesa'
import { z } from 'zod'

const stkPushSchema = z.object({
  phone: z.string().min(10),
  amount: z.number().positive(),
  reference: z.string()
})

export async function paymentRoutes(fastify: FastifyInstance) {
  // POST /api/v1/payments/mpesa/stk-push
  fastify.post('/mpesa/stk-push', { preHandler: [authenticate] }, async (request, reply) => {
    const body = stkPushSchema.parse(request.body)
    
    try {
      const result = await initiateStkPush(body)
      return reply.send({ success: true, data: result })
    } catch (error: any) {
      return reply.status(400).send({ success: false, message: error.message })
    }
  })

  // POST /api/v1/payments/mpesa/callback
  fastify.post('/mpesa/callback', async (request, reply) => {
    // M-Pesa callback logic (Async)
    console.log('M-Pesa Callback Received:', JSON.stringify(request.body, null, 2))
    return reply.send({ ResultCode: 0, ResultDesc: 'Success' })
  })
}
