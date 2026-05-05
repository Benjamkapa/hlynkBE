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
    status,
    mpesaRequestId,
    sendReceiptChannels = [],
  } = data

  const payload = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      include: { providers: { take: 1, orderBy: { createdAt: 'asc' } } },
    })
    if (!tenant) throw { statusCode: 404, message: 'Tenant not found' }

    const provider = tenant.providers[0]
    const opsSettings = (provider as any)?.operationalSettings || { taxInclusive: true, autoPrint: false }

    // Logic: If taxInclusive is false, we might want to ADD 16% VAT to the totalAmount.
    // For now, we'll just log it and mark it in the metadata or audit.
    let finalAmount = Number(totalAmount)
    const taxRate = 0.16
    const isTaxInclusive = opsSettings.taxInclusive
    
    // If not inclusive, we add the tax to the total
    if (!isTaxInclusive) {
      finalAmount = finalAmount * (1 + taxRate)
    }

    // 1. Create Sale
    const sale = await tx.sale.create({
      data: {
        tenantId,
        userId,
        customerId,
        customerName,
        totalAmount: new Decimal(finalAmount),
        paymentMethod: paymentMethod || 'CASH',
        status: status || 'COMPLETED',
        mpesaRequestId,
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
      totalAmount: Number(finalAmount),
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
      const totalItemsQuantity = items.reduce((sum: number, item: any) => sum + Number(item.quantity || 1), 0)
      
      await tx.activityLog.create({
        data: {
          tenantId,
          userId,
          action: 'Sale recorded',
          logName: 'Sale recorded',
          details: `Sale of ${totalItemsQuantity} items for KES ${finalAmount} (Tax ${isTaxInclusive ? 'Incl' : 'Excl'})`,
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

import { initiateVendorStkPush } from '../../lib/mpesa'

export async function triggerVendorStkPush(tenantId: string, params: { phone: string; amount: number; reference: string }) {
  const result = await initiateVendorStkPush(tenantId, params)
  
  await prisma.activityLog.create({
    data: {
      tenantId,
      action: 'M-Pesa STK Push Initiated',
      logName: 'M-Pesa STK Push Initiated',
      details: `STK push of KES ${params.amount} sent to ${params.phone}.`,
      actionId: result.CheckoutRequestID || result.MerchantRequestID
    } as any
  })

  return result
}

export async function handleVendorPaymentCallback(CheckoutRequestID: string, MerchantRequestID: string, success: boolean, resultDesc: string, CallbackMetadata?: any) {
  const sale = await prisma.sale.findFirst({
    where: { mpesaRequestId: CheckoutRequestID }
  })

  if (sale) {
    let customerId = sale.customerId
    let customerName = sale.customerName

    // If success and we have metadata, try to extract phone and create/link customer
    if (success && CallbackMetadata?.Item) {
      const phoneItem = CallbackMetadata.Item.find((i: any) => i.Name === 'PhoneNumber')
      const phone = phoneItem?.Value ? String(phoneItem.Value) : null
      
      if (phone && !customerId) {
        // Find existing globally
        let customer = await prisma.user.findUnique({
          where: { phone }
        })

        // If no customer exists globally, create one in the current tenant
        if (!customer) {
          customer = await prisma.user.create({
            data: {
              tenantId: sale.tenantId,
              name: `Customer ${phone.slice(-6)}`, // Placeholder name since STK push doesn't return names
              phone,
              role: 'CUSTOMER'
            }
          })
        }
        
        customerId = customer.id
        customerName = customer.name
      }
    }

    await prisma.sale.update({
      where: { id: sale.id },
      data: {
        status: success ? 'COMPLETED' : 'FAILED',
        mpesaReceipt: success ? MerchantRequestID : null,
        customerId,
        customerName
      } as any
    })
    
    await prisma.activityLog.create({
      data: {
        tenantId: sale.tenantId,
        action: success ? 'M-Pesa Payment Received' : 'M-Pesa Payment Failed',
        logName: success ? 'M-Pesa Payment Received' : 'M-Pesa Payment Failed',
        details: `Payment status: ${resultDesc}. Sale #${sale.id.slice(-6)}`,
        actionId: CheckoutRequestID
      } as any
    })
  } else {
    // If not found, log a system event
    await prisma.systemEvent.create({
      data: {
        category: 'PAYMENT',
        action: 'Vendor STK Callback',
        level: success ? 'INFO' : 'WARN',
        message: `Vendor payment callback received. Status: ${resultDesc}. Req ID: ${CheckoutRequestID}`,
      }
    })
  }
}
