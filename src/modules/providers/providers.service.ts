import { prisma } from '../../lib/prisma'
import bcrypt from 'bcryptjs'
import { encrypt, decrypt } from '../../lib/encryption'

export async function getMyProfile(userId: string) {
  const profile = await prisma.provider.findUnique({
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
  
  if (profile?.operationalSettings) {
    const ops = profile.operationalSettings as any
    if (ops.mpesa) {
      if (ops.mpesa.consumerKey) ops.mpesa.consumerKey = decrypt(ops.mpesa.consumerKey)
      if (ops.mpesa.consumerSecret) ops.mpesa.consumerSecret = decrypt(ops.mpesa.consumerSecret)
      if (ops.mpesa.passkey) ops.mpesa.passkey = decrypt(ops.mpesa.passkey)
    }
    profile.operationalSettings = ops as any
  }
  
  return profile
}

export async function updateProfile(userId: string, tenantId: string, data: any) {
  if (data.operationalSettings?.mpesa) {
    const mpesa = data.operationalSettings.mpesa
    if (mpesa.consumerKey && !mpesa.consumerKey.includes(':')) mpesa.consumerKey = encrypt(mpesa.consumerKey)
    if (mpesa.consumerSecret && !mpesa.consumerSecret.includes(':')) mpesa.consumerSecret = encrypt(mpesa.consumerSecret)
    if (mpesa.passkey && !mpesa.passkey.includes(':')) mpesa.passkey = encrypt(mpesa.passkey)
  }

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
  if (data.operationalSettings?.mpesa) {
    const mpesa = data.operationalSettings.mpesa
    if (mpesa.consumerKey && !mpesa.consumerKey.includes(':')) mpesa.consumerKey = encrypt(mpesa.consumerKey)
    if (mpesa.consumerSecret && !mpesa.consumerSecret.includes(':')) mpesa.consumerSecret = encrypt(mpesa.consumerSecret)
    if (mpesa.passkey && !mpesa.passkey.includes(':')) mpesa.passkey = encrypt(mpesa.passkey)
  }

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
export async function getActivityLogs(tenantId: string, userId: string, role: string, params: { page?: number; limit?: number }) {
  const page = Number(params.page) || 1
  const limit = Number(params.limit) || 10
  const skip = (page - 1) * limit

  // Visibility logic:
  // 1. Staff: No access to logs
  if (role === 'STAFF') {
    throw { statusCode: 403, message: 'Access Restricted: You do not have permission to view activity logs.' }
  }

  const where: any = {}
  
  // 2. Provider: See all for their tenant
  if (role === 'PROVIDER') {
    where.tenantId = tenantId
  }
  
  // 3. Super Admin: See everything globally
  // (where remains empty or we can filter by tenantId if specifically requested)

  const [items, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      include: {
        user: {
          select: { name: true, email: true, photoUrl: true }
        }
      } as any,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    }),
    prisma.activityLog.count({ where })
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

// --- Staff Management ---
export async function getStaff(tenantId: string) {
  return prisma.user.findMany({
    where: { tenantId, role: 'STAFF' },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      permissions: true,
      isActive: true,
      createdAt: true,
      photoUrl: true
    }
  })
}

export async function createStaff(tenantId: string, data: any) {
  const { name, phone, email, password, permissions } = data
  
  // Check if user already exists
  const existing = await prisma.user.findFirst({
    where: { OR: [{ phone }, { email: email || undefined }] }
  })
  if (existing) throw new Error('Phone or email already registered')

  const passwordHash = await bcrypt.hash(password, 10)

  return prisma.user.create({
    data: {
      tenantId,
      name,
      phone,
      email,
      passwordHash,
      role: 'STAFF',
      permissions: permissions || [],
      phoneVerified: true // Assume owner verified them
    }
  })
}

export async function updateStaff(tenantId: string, staffId: string, data: any) {
  const updateData: any = {
    name: data.name,
    email: data.email,
    phone: data.phone,
    permissions: data.permissions,
    isActive: data.isActive
  }

  if (data.password) {
    updateData.passwordHash = await bcrypt.hash(data.password, 10)
  }

  return prisma.user.update({
    where: { id: staffId, tenantId },
    data: updateData
  })
}

export async function deleteStaff(tenantId: string, staffId: string) {
  return prisma.user.delete({
    where: { id: staffId, tenantId }
  })
}
