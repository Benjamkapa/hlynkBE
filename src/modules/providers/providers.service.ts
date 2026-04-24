import { prisma } from '../../lib/prisma'

export async function getMyProfile(userId: string) {
  return prisma.provider.findUnique({
    where: { userId },
    include: {
      tenant: {
        include: {
          subscription: true
        }
      }
    }
  })
}

export async function updateProfile(userId: string, tenantId: string, data: any) {
  return prisma.provider.update({
    where: { userId },
    data: {
      businessName: data.businessName,
      category: data.category,
      description: data.description,
      county: data.county,
      location: data.location,
      phone: data.phone,
      whatsapp: data.whatsapp,
      workingHours: data.workingHours,
    }
  })
}

export async function getStats(tenantId: string) {
  const [salesToday, expensesToday, lowStock, requests] = await Promise.all([
    prisma.sale.aggregate({
      where: {
        tenantId,
        createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) }
      },
      _sum: { totalAmount: true },
      _count: true
    }),
    prisma.expense.aggregate({
      where: {
        tenantId,
        date: { gte: new Date(new Date().setHours(0, 0, 0, 0)) }
      },
      _sum: { amount: true }
    }),
    prisma.product.count({
      where: {
        tenantId,
        stockLevel: { lte: prisma.product.fields.minLevel as any } // This is tricky in prisma, usually done with a filter or raw query
      }
    }),
    prisma.request.count({
      where: {
        tenantId,
        status: 'PENDING'
      }
    })
  ])

  // Simple trends
  const sales7Days = await prisma.sale.groupBy({
    by: ['createdAt'],
    where: {
      tenantId,
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    },
    _sum: { totalAmount: true }
  })

  const topProducts = await prisma.saleItem.groupBy({
    by: ['productId', 'name'],
    where: { sale: { tenantId } },
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: 'desc' } },
    take: 5
  })

  const atRiskProducts = await prisma.product.findMany({
    where: {
      tenantId,
      stockLevel: { lt: 10 } // Simplified for now
    },
    take: 5,
    orderBy: { stockLevel: 'asc' }
  })

  return {
    snapshot: {
      salesToday: salesToday._sum.totalAmount || 0,
      expensesToday: expensesToday._sum.amount || 0,
      profitToday: Number(salesToday._sum.totalAmount || 0) - Number(expensesToday._sum.amount || 0),
      lowStockCount: lowStock,
      transactionsToday: salesToday._count
    },
    trends: {
      sales7Days: sales7Days.map(s => ({
        name: new Date(s.createdAt).toLocaleDateString('en-US', { weekday: 'short' }),
        value: s._sum.totalAmount || 0
      }))
    },
    topProducts,
    atRiskProducts
  }
}

export async function uploadProfilePhoto(userId: string, tenantId: string, buffer: Buffer, mimetype: string) {
  // In a real app, upload to S3/Cloudinary and get URL
  // For now, we'll use a placeholder or data URI (not recommended for production but works for MVP)
  const photoUrl = `data:${mimetype};base64,${buffer.toString('base64')}`
  
  return prisma.provider.update({
    where: { userId },
    data: { photoUrl }
  })
}
