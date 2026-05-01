import { prisma } from '../../lib/prisma'
import { Decimal } from '@prisma/client/runtime/library'
import { initiateStkPush } from '../../lib/mpesa'

export const PLAN_PRICES = {
  TRIAL: 0,
  BASIC: 1000,
  PRO: 2500
}

export async function getMySubscription(tenantId: string) {
  return prisma.subscription.findUnique({
    where: { tenantId }
  })
}

export async function getBillingHistory(tenantId: string) {
  return prisma.billingInvoice.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' }
  })
}

export async function initiateRenewal(tenantId: string, phone: string) {
  const sub = await prisma.subscription.findUnique({ where: { tenantId } })
  if (!sub) throw new Error('Subscription not found')

  const amount = PLAN_PRICES[sub.planName as keyof typeof PLAN_PRICES]
  if (amount <= 0) throw new Error('Cannot renew a free trial')

  const reference = `SUB-REN-${tenantId.slice(-6).toUpperCase()}`
  
  // Create a pending invoice
  const invoice = await prisma.billingInvoice.create({
    data: {
      tenantId,
      subscriptionId: sub.id,
      amount: new Decimal(amount),
      status: 'PENDING',
      paymentMethod: 'MPESA',
      reference
    }
  })

  // Trigger M-Pesa STK Push
  await initiateStkPush({
    phone,
    amount,
    reference
  })

  return { success: true, invoiceId: invoice.id, message: 'STK Push sent to your phone' }
}

export async function changePlan(tenantId: string, planName: 'BASIC' | 'PRO', phone: string) {
  const sub = await prisma.subscription.findUnique({ where: { tenantId } })
  if (!sub) throw new Error('Subscription not found')

  const amount = PLAN_PRICES[planName]
  const reference = `SUB-UPG-${tenantId.slice(-6).toUpperCase()}`

  // Create a pending invoice for the new plan
  const invoice = await prisma.billingInvoice.create({
    data: {
      tenantId,
      subscriptionId: sub.id,
      amount: new Decimal(amount),
      status: 'PENDING',
      paymentMethod: 'MPESA',
      reference
    }
  })

  // Trigger M-Pesa STK Push
  await initiateStkPush({
    phone,
    amount,
    reference
  })

  return { success: true, invoiceId: invoice.id, message: 'Payment initiated for new plan' }
}

export async function handlePaymentCallback(reference: string, transactionId: string, success: boolean) {
  const invoice = await prisma.billingInvoice.findFirst({
    where: { reference }
  })

  if (!invoice) return

  if (success) {
    await prisma.$transaction(async (tx) => {
      // 1. Update invoice
      await tx.billingInvoice.update({
        where: { id: invoice.id },
        data: { status: 'PAID', reference: transactionId }
      })

      // 2. Update subscription
      const sub = await tx.subscription.findUnique({ where: { id: invoice.subscriptionId } })
      if (!sub) return

      // Extend subscription by 30 days
      const currentEnd = sub.endDate && sub.endDate > new Date() ? sub.endDate : new Date()
      const newEnd = new Date(currentEnd)
      newEnd.setDate(newEnd.getDate() + 30)

      await tx.subscription.update({
        where: { id: sub.id },
        data: {
          status: 'ACTIVE',
          endDate: newEnd,
          startDate: new Date()
        }
      })
    })
  } else {
    await prisma.billingInvoice.update({
      where: { id: invoice.id },
      data: { status: 'FAILED', reference: transactionId }
    })
  }
}
