import { prisma } from '../../lib/prisma'
import { Decimal } from '@prisma/client/runtime/library'
import { buildReceiptHtml } from '../../lib/receipt'
import { sendSalesReceiptEmail } from '../../lib/mailer'
import { formatReceiptSms, sendSms } from '../../lib/sms'

export async function listSales(tenantId: string, params: { search?: string; date?: string; limit?: number }) {
  const where: any = { tenantId }
  
  if (params.search) {
    where.OR = [
      { customerName: { contains: params.search } },
      { paymentMethod: { contains: params.search } }
    ]
  }

  if (params.date) {
    const start = new Date(params.date)
    start.setHours(0, 0, 0, 0)
    const end = new Date(params.date)
    end.setHours(23, 59, 59, 999)
    where.createdAt = {
      gte: start,
      lte: end
    }
  }

  const sales = await prisma.sale.findMany({
    where,
    include: { items: true, user: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: params.limit ? Number(params.limit) : 50
  })

  // Aggregate stats for the current filter
  const statsAgg = await prisma.sale.aggregate({
    where,
    _sum: { totalAmount: true },
    _count: { id: true },
    _avg: { totalAmount: true }
  })

  return { 
    items: sales,
    stats: {
      totalToday: Number(statsAgg._sum.totalAmount || 0),
      transactions: statsAgg._count.id || 0,
      avgSale: Math.round(Number(statsAgg._avg.totalAmount || 0))
    }
  }
}

export async function createSale(tenantId: string, data: any, userId?: string, ipAddress?: string) {
  const {
    items,
    customerName,
    customerPhone,
    customerEmail,
    customerId,
    totalAmount,
    paymentMethod,
    sendReceiptChannels = [],
  } = data

  const payload = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      include: { providers: { take: 1, orderBy: { createdAt: 'asc' } } },
    })
    if (!tenant) throw { statusCode: 404, message: 'Tenant not found' }

    const provider = tenant.providers[0]

    // 1. Create Sale
    const sale = await tx.sale.create({
      data: {
        tenantId,
        userId,
        customerId,
        customerName,
        totalAmount: new Decimal(totalAmount),
        paymentMethod: paymentMethod || 'CASH',
        items: {
          create: items.map((item: any) => ({
            productId: item.productId,
            name: item.name,
            quantity: item.quantity,
            price: new Decimal(item.price)
          }))
        }
      }
    })

    const receiptNumber = `RCPT-${sale.id.slice(-8).toUpperCase()}`
    const logoUrl = process.env.RECEIPT_LOGO_URL || `${process.env.FRONTEND_URL || 'http://localhost:5173'}/logo.png`
    const receiptHtml = buildReceiptHtml({
      businessName: provider?.businessName || tenant.businessName,
      receiptNumber,
      date: sale.createdAt,
      customerName,
      customerPhone,
      customerEmail,
      paymentMethod: paymentMethod || 'CASH',
      totalAmount: Number(totalAmount),
      logoUrl,
      items: items.map((item: any) => ({
        name: item.name,
        quantity: item.quantity,
        price: Number(item.price),
      })),
    })

    const receipt = await tx.receipt.create({
      data: {
        tenantId,
        saleId: sale.id,
        receiptNumber,
        customerName,
        customerPhone,
        customerEmail,
        htmlContent: receiptHtml,
      },
    })

    // 2. Check and Update Stock Levels
    for (const item of items) {
      if (item.productId) {
        const product = await tx.product.findUnique({ where: { id: item.productId } })
        if (!product || product.stockLevel < item.quantity) {
          throw { statusCode: 400, message: `Insufficient stock for ${item.name}. Available: ${product?.stockLevel || 0}` }
        }
        await tx.product.update({
          where: { id: item.productId },
          data: {
            stockLevel: {
              decrement: item.quantity
            }
          }
        })
      }
    }

    // 3. Create Activity Log (Non-blocking)
    try {
      await tx.activityLog.create({
        data: {
          tenantId,
          userId,
          action: 'Sale recorded',
          logName: 'Sale recorded',
          details: `Sale of ${items.length} items for KES ${totalAmount}`,
          ipAddress,
          actionId: `#sale-${sale.id.slice(-6).toUpperCase()}`
        } as any
      })
    } catch (e) {
      console.error('Audit Log Error:', e)
    }

    return { sale, receipt, providerBusinessName: provider?.businessName || tenant.businessName }
  })

  if (sendReceiptChannels.includes('email') && customerEmail) {
    try {
      await sendSalesReceiptEmail(customerEmail, payload.providerBusinessName, payload.receipt.receiptNumber, payload.receipt.htmlContent)
      await prisma.receipt.update({
        where: { id: payload.receipt.id },
        data: { sentEmailAt: new Date() },
      })
    } catch (error) {
      console.error('[Receipt][Email] Failed:', error)
    }
  }

  if ((sendReceiptChannels.includes('sms') || sendReceiptChannels.includes('phone')) && customerPhone) {
    try {
      const smsResponse = await sendSms({
        to: customerPhone,
        message: formatReceiptSms({
          businessName: payload.providerBusinessName,
          receiptNumber: payload.receipt.receiptNumber,
          totalAmount: Number(totalAmount),
          paymentMethod: paymentMethod || 'CASH',
        }),
      })

      await prisma.receipt.update({
        where: { id: payload.receipt.id },
        data: smsResponse.success
          ? {
              sentSmsAt: sendReceiptChannels.includes('sms') ? new Date() : null,
              sentPhoneAt: sendReceiptChannels.includes('phone') ? new Date() : null,
            }
          : {},
      })
    } catch (error) {
      console.error('[Receipt][SMS] Failed:', error)
    }
  }

  return {
    ...payload.sale,
    receipt: {
      id: payload.receipt.id,
      receiptNumber: payload.receipt.receiptNumber,
    },
  }
}

export async function getSaleDetails(id: string, tenantId: string) {
  return prisma.sale.findFirst({
    where: { id, tenantId },
    include: { items: true, receipt: true, user: { select: { name: true } } }
  })
}

export async function sendSaleReceipt(id: string, tenantId: string, body: any) {
  const { channels = [], customerPhone, customerEmail } = body
  const sale = await prisma.sale.findFirst({
    where: { id, tenantId },
    include: { receipt: true, tenant: { include: { providers: { take: 1, orderBy: { createdAt: 'asc' } } } } },
  })

  if (!sale || !sale.receipt) throw { statusCode: 404, message: 'Receipt not found for this sale' }
  const businessName = sale.tenant.providers[0]?.businessName || sale.tenant.businessName
  const nextPhone = customerPhone || sale.receipt.customerPhone
  const nextEmail = customerEmail || sale.receipt.customerEmail

  if (channels.includes('email') && nextEmail) {
    await sendSalesReceiptEmail(nextEmail, businessName, sale.receipt.receiptNumber, sale.receipt.htmlContent)
    await prisma.receipt.update({
      where: { id: sale.receipt.id },
      data: { sentEmailAt: new Date(), customerEmail: nextEmail },
    })
  }

  if ((channels.includes('sms') || channels.includes('phone')) && nextPhone) {
    await sendSms({
      to: nextPhone,
      message: formatReceiptSms({
        businessName,
        receiptNumber: sale.receipt.receiptNumber,
        totalAmount: Number(sale.totalAmount),
        paymentMethod: sale.paymentMethod,
      }),
    })
    await prisma.receipt.update({
      where: { id: sale.receipt.id },
      data: {
        customerPhone: nextPhone,
        sentSmsAt: channels.includes('sms') ? new Date() : sale.receipt.sentSmsAt,
        sentPhoneAt: channels.includes('phone') ? new Date() : sale.receipt.sentPhoneAt,
      },
    })
  }

  return { message: 'Receipt sent', receiptNumber: sale.receipt.receiptNumber }
}
