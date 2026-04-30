import { prisma } from '../../lib/prisma'
import { Decimal } from '@prisma/client/runtime/library'

async function generateProductSku() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase()
    const sku = `HLI-${suffix}`
    const exists = await prisma.product.findFirst({ where: { sku }, select: { id: true } })
    if (!exists) return sku
  }

  return `HLI-${Date.now().toString().slice(-8)}`
}

export async function listProducts(tenantId: string, params: { search?: string; category?: string; limit?: number; page?: number }) {
  const where: any = { tenantId }
  
  if (params.search) {
    where.OR = [
      { name: { contains: params.search } },
      { sku: { contains: params.search } }
    ]
  }

  const limit = params.limit ? parseInt(params.limit as any) : 50
  const page = params.page ? parseInt(params.page as any) : 1
  const skip = (Math.max(page, 1) - 1) * limit

  const total = await prisma.product.count({ where })

  const products = await prisma.product.findMany({
    where,
    orderBy: { createdAt: 'desc' },
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

  return {
    items: products,
    total,
    page: Math.max(page, 1),
    limit,
    stats: {
      totalItems,
      lowStock,
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
      minLevel: parseInt(data.minLevel) || 5
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

async function logStockAlertIfNeeded(product: { id: string; name: string; stockLevel: number; minLevel: number }, tenantId: string) {
  if (product.stockLevel > product.minLevel) return

  const level = product.stockLevel <= 0 ? 'ERROR' : 'WARN'
  const action = product.stockLevel <= 0 ? 'Product out of stock' : 'Low stock detected'
  const message = `${product.name} has ${product.stockLevel} units left`

  await prisma.systemEvent.create({
    data: {
      tenantId,
      level,
      category: 'BUSINESS',
      action,
      message,
      metadata: {
        productId: product.id,
        productName: product.name,
        stockLevel: product.stockLevel,
        minLevel: product.minLevel,
      },
    },
  })
}
