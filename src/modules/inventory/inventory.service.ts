import { prisma } from '../../lib/prisma'
import { Decimal } from '@prisma/client/runtime/library'

function getStartOfDay(date: Date) {
  const normalized = new Date(date)
  normalized.setHours(0, 0, 0, 0)
  return normalized
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function generateProductSku() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase()
    const sku = `HLI-${suffix}`
    const exists = await prisma.product.findFirst({ where: { sku }, select: { id: true } })
    if (!exists) return sku
  }

  return `HLI-${Date.now().toString().slice(-8)}`
}

export async function listProducts(tenantId: string, params: { search?: string; category?: string; limit?: number; page?: number; filter?: 'all' | 'low-stock' | 'expiring-soon'; sortBy?: string; sortOrder?: 'asc' | 'desc' }) {
  const where: any = { tenantId }
  const today = getStartOfDay(new Date())
  const alertStart = addDays(today, 2)
  const alertEnd = addDays(alertStart, 1)
  
  if (params.search) {
    where.OR = [
      { name: { contains: params.search } },
      { sku: { contains: params.search } }
    ]
  }

  if (params.filter === 'low-stock') {
    where.stockLevel = { lte: prisma.product.fields.minLevel }
  }

  if (params.filter === 'expiring-soon') {
    where.isPerishable = true
    where.expiryDate = {
      gte: alertStart,
      lt: alertEnd
    }
  }

  const limit = params.limit ? parseInt(params.limit as any) : 50
  const page = params.page ? parseInt(params.page as any) : 1
  const skip = (Math.max(page, 1) - 1) * limit

  const total = await prisma.product.count({ where })

  const validSortFields = ['name', 'category', 'stockLevel', 'price', 'buyingPrice', 'createdAt']
  const sortBy = params.sortBy && validSortFields.includes(params.sortBy) ? params.sortBy : 'createdAt'
  const sortOrder = params.sortOrder === 'asc' ? 'asc' : 'desc'

  const products = await prisma.product.findMany({
    where,
    orderBy: { [sortBy]: sortOrder },
    skip,
    take: limit
  })

  // Calculate stats
  const totalItems = await prisma.product.count({ where: { tenantId } })
  const lowStock = await prisma.product.count({
    where: {
      tenantId,
      stockLevel: { lte: prisma.product.fields.minLevel }
    }
  })
  
  const totalValueRaw = await prisma.product.aggregate({
    where: { tenantId },
    _sum: {
      price: true,
      stockLevel: true
    }
  })

  const expiringSoon = await prisma.product.count({
    where: {
      tenantId,
      isPerishable: true,
      expiryDate: {
        gte: today,
        lte: addDays(today, 30)
      }
    } 
  })

  return {
    items: products,
    total,
    page: Math.max(page, 1),
    limit,
    pages: Math.ceil(total / limit),
    stats: {
      totalItems,
      lowStock,
      expiringSoon,
      totalValue: Number(totalValueRaw._sum.price || 0) * Number(totalValueRaw._sum.stockLevel || 0) // Simplified
    }
  }
}

export async function createProduct(tenantId: string, data: any) {
  const sku = data.sku?.trim() ? data.sku.trim().toUpperCase() : await generateProductSku()

  const product = await prisma.product.create({
    data: {
      tenantId,
      name: data.name,
      category: data.category || 'Groceries',
      price: new Decimal(data.price),
      buyingPrice: data.buyingPrice ? new Decimal(data.buyingPrice) : null,
      stockLevel: parseInt(data.stock) || 0,
      sku,
      imageUrl: data.imageUrl || null,
      description: data.description,
      minLevel: parseInt(data.minLevel) || 5,
      isPerishable: data.isPerishable === true || data.isPerishable === 'true',
      expiryDate: data.expiryDate ? new Date(data.expiryDate) : null
    }
  })

  await logStockAlertIfNeeded(product, tenantId)
  return product
}

export async function updateProduct(id: string, tenantId: string, data: any) {
  const updateData: any = { ...data }
  
  if (data.price) updateData.price = new Decimal(data.price)
  if (data.buyingPrice) updateData.buyingPrice = new Decimal(data.buyingPrice)
  
  if (data.stock !== undefined) {
    updateData.stockLevel = parseInt(data.stock)
    delete updateData.stock // Remove the field Prisma doesn't know about
  }
  
  if (data.isPerishable !== undefined) updateData.isPerishable = data.isPerishable === true || data.isPerishable === 'true'
  if (data.expiryDate !== undefined) updateData.expiryDate = data.expiryDate ? new Date(data.expiryDate) : null

  const product = await prisma.product.update({
    where: { id, tenantId },
    data: updateData
  })

  await logStockAlertIfNeeded(product, tenantId)
  return product
}

export async function uploadProductImage(id: string, tenantId: string, buffer: Buffer, mimetype: string) {
  const imageUrl = `data:${mimetype};base64,${buffer.toString('base64')}`

  return prisma.product.update({
    where: { id, tenantId },
    data: { imageUrl },
  })
}

export async function deleteProduct(id: string, tenantId: string) {
  return prisma.product.delete({
    where: { id, tenantId }
  })
}

export async function ensureExpiringProductAlerts(tenantId: string) {
  const today = getStartOfDay(new Date())
  const alertStart = addDays(today, 2)
  const alertEnd = addDays(alertStart, 1)
  const alertDateKey = toDateKey(alertStart)

  const expiringProducts = await prisma.product.findMany({
    where: {
      tenantId,
      isActive: true,
      isPerishable: true,
      expiryDate: {
        gte: alertStart,
        lt: alertEnd
      }
    },
    select: {
      id: true,
      name: true,
      stockLevel: true,
      expiryDate: true
    }
  })

  if (expiringProducts.length === 0) return

  const actionIds = expiringProducts.map((product) => `#product-expiry-${product.id}-${alertDateKey}`)
  const existingLogs = await prisma.activityLog.findMany({
    where: {
      tenantId,
      actionId: { in: actionIds }
    },
    select: { actionId: true }
  })

  const existingActionIds = new Set(existingLogs.map((log) => log.actionId))
  const logsToCreate = expiringProducts
    .filter((product) => !existingActionIds.has(`#product-expiry-${product.id}-${alertDateKey}`))
    .map((product) => ({
      tenantId,
      action: `Product expiring soon: ${product.name}`,
      logName: 'Expiry alert',
      details: `${product.name} expires in 2 days on ${product.expiryDate?.toLocaleDateString('en-KE')}. ${product.stockLevel} units remaining.`,
      actionId: `#product-expiry-${product.id}-${alertDateKey}`
    }))

  if (logsToCreate.length > 0) {
    await prisma.activityLog.createMany({ data: logsToCreate })
  }
}

async function logStockAlertIfNeeded(product: { id: string; name: string; stockLevel: number; minLevel: number }, tenantId: string) {
  if (product.stockLevel > product.minLevel) return

  const level = product.stockLevel <= 0 ? 'ERROR' : 'WARN'
  const action = product.stockLevel <= 0 ? 'Product out of stock' : 'Low stock detected'
  const message = `${product.name} has ${product.stockLevel} units left`

  await prisma.activityLog.create({
    data: {
      tenantId,
      action: `${action}: ${product.name}`,
      details: `${message}. Min Level: ${product.minLevel}`,
    },
  })
}
