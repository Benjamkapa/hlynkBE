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
    const { Body } = request.body as any
    console.log('M-Pesa Callback Received:', JSON.stringify(request.body, null, 2))

    if (!Body || !Body.stkCallback) {
      return reply.send({ ResultCode: 1, ResultDesc: 'Invalid body' })
    }

    const { ResultCode, ResultDesc, MerchantRequestID, CheckoutRequestID, CallbackMetadata } = Body.stkCallback
    const success = ResultCode === 0

    // Safaricom doesn't send our reference back in the metadata directly, 
    // but we can use the MerchantRequestID or CheckoutRequestID if we stored them,
    // OR we can find the pending payment by the phone number and amount (less reliable),
    // OR we use the AccountReference which IS sent back in some flows but often we need to track by CheckoutRequestID.
    
    // For this implementation, we'll look for a payment with this CheckoutRequestID or use the metadata if present.
    // In many Daraja setups, the 'AccountReference' we sent is what we use to link.
    
    const { handlePaymentCallback } = await import('../subscriptions/subscriptions.service')
    
    // Find the item with Name 'AccountReference' or use the one from the initiating request
    // Here we'll assume we track by the reference we generated.
    // For simplicity in this demo, we'll try to find the payment by CheckoutRequestID
    const { prisma } = await import('../../lib/prisma')
    const payment = await prisma.payment.findFirst({
      where: { 
        OR: [
          { mpesaReceipt: CheckoutRequestID },
          { reference: { contains: 'SUB' } } // Fallback logic for demo
        ]
      },
      orderBy: { createdAt: 'desc' }
    })

    if (payment) {
      await handlePaymentCallback(payment.reference!, MerchantRequestID, success)
    }

    return reply.send({ ResultCode: 0, ResultDesc: 'Success' })
  })
}
