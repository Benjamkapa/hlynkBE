import { prisma } from '../../lib/prisma'
import bcrypt from 'bcryptjs'

export async function getMyProfile(userId: string) {
  return prisma.provider.findUnique({
    where: { userId },
    include: {
      user: true,
      tenant: {
        include: {
          subscription: true
        }
      }
    }
  })
}

export async function updateProfile(userId: string, tenantId: string, data: any) {
  return prisma.$transaction(async (tx) => {
    // 1. Update User record (personal details)
    await tx.user.update({
      where: { id: userId },
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone
      }
    })

    // 2. Update Provider record (business details)
    return tx.provider.update({
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
        notificationSettings: data.notificationSettings,
        operationalSettings: data.operationalSettings
      } as any
    })
  })
}

export async function changePassword(userId: string, data: any) {
  const { currentPassword, newPassword } = data
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user || !user.passwordHash) throw new Error('User not found')

  const valid = await bcrypt.compare(currentPassword, user.passwordHash)
  if (!valid) throw new Error('Invalid current password')

  const passwordHash = await bcrypt.hash(newPassword, 10)
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash }
  })

  return { success: true, message: 'Password updated successfully' }
}

export async function deactivateAccount(userId: string) {
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { isActive: false } as any }),
    prisma.provider.update({ where: { userId }, data: { isActive: false } as any })
  ])
  return { success: true, message: 'Account deactivated' }
}

export async function updateSettings(userId: string, data: any) {
  return prisma.provider.update({
    where: { userId },
    data: {
      notificationSettings: data.notificationSettings,
      operationalSettings: data.operationalSettings
    } as any
  })
}

export async function getStats(tenantId: string) {
  const [salesToday, expensesToday, lowStock, totalCustomers] = await Promise.all([
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
        stockLevel: { lte: 5 } // Simplified alert level
      }
    }),
    prisma.user.count({
      where: {
        tenantId,
        role: 'CUSTOMER'
      }
    })
  ])

  // Get last 7 days of sales and expenses for the chart
  const sales7Days = await prisma.$queryRaw`
    SELECT 
      DATE_FORMAT(date_list.date, '%a') as name,
      COALESCE(SUM(s.totalAmount), 0) as sales,
      COALESCE(SUM(s.totalAmount), 0) - COALESCE((
        SELECT SUM(amount) FROM Expense 
        WHERE DATE(date) = date_list.date AND tenantId = ${tenantId}
      ), 0) as profit
    FROM (
      SELECT CURDATE() - INTERVAL (a.a + (10 * b.a)) DAY as date
      FROM (SELECT 0 as a UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) as a
      CROSS JOIN (SELECT 0 as a UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) as b
    ) as date_list
    LEFT JOIN Sale s ON DATE(s.createdAt) = date_list.date AND s.tenantId = ${tenantId}
    WHERE date_list.date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
    GROUP BY date_list.date
    ORDER BY date_list.date ASC
  `

  return {
    dailySales: Number(salesToday._sum.totalAmount || 0),
    dailyTransactions: salesToday._count || 0,
    newCustomers: totalCustomers,
    outOfStockCount: lowStock,
    profit: Number(salesToday._sum.totalAmount || 0) - Number(expensesToday._sum.amount || 0),
    salesChart: (sales7Days as any[]).map(s => ({
      name: s.name,
      sales: Number(s.sales || 0),
      profit: Number(s.profit || 0)
    })),
    rating: 4.8,
    reviewCount: 12,
    recentSales: [] // Add empty array if not fetched here
  }
}

export async function uploadProfilePhoto(userId: string, tenantId: string, buffer: Buffer, mimetype: string) {
  // In a real app, upload to S3/Cloudinary and get URL
  // For now, we'll use a placeholder or data URI (not recommended for production but works for MVP)
  const photoUrl = `data:${mimetype};base64,${buffer.toString('base64')}`
  
  await prisma.user.update({
    where: { id: userId },
    data: { photoUrl } as any
  })

  const provider = await prisma.provider.findUnique({ where: { userId } })
  if (provider) {
    await prisma.provider.update({
      where: { userId },
      data: { photoUrl } as any
    })
  }

  return { photoUrl }
}
export async function getActivityLogs(tenantId: string, params: { page?: number; limit?: number }) {
  const page = Number(params.page) || 1
  const limit = Number(params.limit) || 10
  const skip = (page - 1) * limit

  const [items, total] = await Promise.all([
    prisma.activityLog.findMany({
      where: { tenantId },
      include: {
        user: {
          select: { name: true, email: true, photoUrl: true }
        }
      } as any,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    }),
    prisma.activityLog.count({ where: { tenantId } })
  ])

  return {
    items,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    }
  }
}

export async function logActivity(tenantId: string, data: { userId?: string, action: string, logName: string, details?: string, ipAddress?: string, actionId?: string }) {
  return prisma.activityLog.create({
    data: {
      tenantId,
      ...data
    }
  })
}
