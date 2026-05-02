import type { FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../lib/prisma'

export async function subscriptionGuard(request: FastifyRequest, reply: FastifyReply) {
  // Skip check for super admins
  if ((request.user as any)?.role === 'SUPER_ADMIN') return

  const tenantId = (request.user as any)?.tenantId
  if (!tenantId) return reply.status(401).send({ success: false, message: 'Unauthorized' })

  // Skip check for subscription-related routes to allow upgrading
  if (request.url.includes('/subscriptions') || request.url.includes('/payments')) return

  const subscription = await prisma.subscription.findUnique({
    where: { tenantId }
  })

  if (!subscription) {
    return reply.status(403).send({ 
      success: false, 
      message: 'No active subscription found. Please choose a plan.',
      code: 'SUBSCRIPTION_REQUIRED'
    })
  }

  const isExpired = subscription.endDate && new Date(subscription.endDate) < new Date()
  const isTrial = subscription.status === 'TRIAL'
  const isTrialExpired = subscription.trialEndDate && new Date(subscription.trialEndDate) < new Date()

  if (subscription.status === 'EXPIRED' || isExpired || (isTrial && isTrialExpired)) {
    // If expired, auto-update status if not already
    if (subscription.status !== 'EXPIRED') {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: 'EXPIRED' }
      })
    }

    return reply.status(403).send({ 
      success: false, 
      message: 'Your subscription has expired. Please renew to continue.',
      code: 'SUBSCRIPTION_EXPIRED'
    })
  }

  // All good
}
