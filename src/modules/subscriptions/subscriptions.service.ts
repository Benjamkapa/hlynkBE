import { prisma } from '../../lib/prisma'
import { Decimal } from '@prisma/client/runtime/library'
import { initiateStkPush } from '../../lib/mpesa'

export const PLAN_PRICES = {
  STARTER: 1,
  GROWTH: 1,
  PRO: 1
}

export async function getMySubscription(tenantId: string) {
  return prisma.subscription.findUnique({
    where: { tenantId }
  })
}

export async function getBillingHistory(tenantId: string) {
  return prisma.payment.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' }
  })
}

export async function initiateRenewal(tenantId: string, phone: string) {
  const sub = await prisma.subscription.findUnique({ where: { tenantId } })
  if (!sub) throw new Error('Subscription not found')

  if (sub.endDate) {
    const daysRemaining = Math.ceil((new Date(sub.endDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
    if (daysRemaining > 10) {
      throw new Error(`You cannot renew right now. Your current plan has ${daysRemaining} days remaining. Renewals are only allowed 10 days or fewer before expiry to prevent stacking.`)
    }
  }

  const amount = PLAN_PRICES[sub.planName as keyof typeof PLAN_PRICES]
  const reference = `SUB-REN-${tenantId.slice(-6).toUpperCase()}`
  
  // Create a pending payment
  const payment = await prisma.payment.create({
    data: {
      tenantId,
      amount: new Decimal(amount),
      plan: sub.planName,
      status: 'PENDING',
      reference
    }
  })

  // Trigger M-Pesa STK Push
  const result = await initiateStkPush({
    phone,
    amount,
    reference
  })

  if (result.CheckoutRequestID) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { mpesaReceipt: result.CheckoutRequestID }
    })
  }

  return { success: true, paymentId: payment.id, message: 'STK Push sent to your phone' }
}

export async function changePlan(tenantId: string, planName: 'GROWTH' | 'PRO' | 'STARTER', phone: string) {
  const sub = await prisma.subscription.findUnique({ where: { tenantId } })
  if (!sub) throw new Error('Subscription not found')

  const amount = PLAN_PRICES[planName]
  const reference = `SUB-UPG-${tenantId.slice(-6).toUpperCase()}`

  // Create a pending payment for the new plan
  const payment = await prisma.payment.create({
    data: {
      tenantId,
      amount: new Decimal(amount),
      plan: planName,
      status: 'PENDING',
      reference
    }
  })

  // Trigger M-Pesa STK Push
  const result = await initiateStkPush({
    phone,
    amount,
    reference
  })

  if (result.CheckoutRequestID) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { mpesaReceipt: result.CheckoutRequestID }
    })
  }

  return { success: true, paymentId: payment.id, message: 'Payment initiated for plan upgrade' }
}

export async function handlePaymentCallback(reference: string, transactionId: string, success: boolean) {
  const payment = await prisma.payment.findFirst({
    where: { reference }
  })

  if (!payment) return

  if (success) {
    await prisma.$transaction(async (tx) => {
      // 1. Update payment
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'PAID', mpesaReceipt: transactionId, reference: transactionId }
      })

      // 2. Update subscription
      const sub = await tx.subscription.findUnique({ where: { tenantId: payment.tenantId } })
      if (!sub) return

      // If changing plans, start fresh from today (forfeiting remaining days) to prevent stacking.
      // If renewing the same plan, extend the current end date.
      let baseDate = sub.endDate && sub.endDate > new Date() ? sub.endDate : new Date()
      
      if (sub.planName !== payment.plan) {
        baseDate = new Date()
      }

      const newEnd = new Date(baseDate)
      newEnd.setDate(newEnd.getDate() + 28)

      await tx.subscription.update({
        where: { id: sub.id },
        data: {
          planName: payment.plan,
          status: 'ACTIVE',
          endDate: newEnd,
          startDate: new Date(),
          isTrial: false // Once they pay, it's no longer a trial
        }
      })
    })
  } else {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED', mpesaReceipt: transactionId }
    })
  }
}
