import { prisma } from '../../lib/prisma'
import bcrypt from 'bcryptjs'
import { encrypt, decrypt } from '../../lib/encryption'
import { ensureExpiringProductAlerts } from '../inventory/inventory.service'

function decryptOperationalSettings(operationalSettings: any) {
  if (!operationalSettings) return operationalSettings

  const ops = { ...operationalSettings }

  if (ops.mpesa) {
    ops.mpesa = { ...ops.mpesa }
    if (ops.mpesa.consumerKey) ops.mpesa.consumerKey = decrypt(ops.mpesa.consumerKey)
    if (ops.mpesa.consumerSecret) ops.mpesa.consumerSecret = decrypt(ops.mpesa.consumerSecret)
    if (ops.mpesa.passkey) ops.mpesa.passkey = decrypt(ops.mpesa.passkey)
  }

  if (ops.ai) {
    ops.ai = { ...ops.ai }
    if (ops.ai.apiKey) ops.ai.apiKey = decrypt(ops.ai.apiKey)
  }

  return ops
}

function encryptOperationalSettings(operationalSettings: any) {
  if (!operationalSettings) return operationalSettings

  const ops = { ...operationalSettings }

  if (ops.mpesa) {
    ops.mpesa = { ...ops.mpesa }
    if (ops.mpesa.consumerKey && !ops.mpesa.consumerKey.includes(':')) ops.mpesa.consumerKey = encrypt(ops.mpesa.consumerKey)
    if (ops.mpesa.consumerSecret && !ops.mpesa.consumerSecret.includes(':')) ops.mpesa.consumerSecret = encrypt(ops.mpesa.consumerSecret)
    if (ops.mpesa.passkey && !ops.mpesa.passkey.includes(':')) ops.mpesa.passkey = encrypt(ops.mpesa.passkey)
  }

  if (ops.ai) {
    ops.ai = { ...ops.ai }
    if (ops.ai.apiKey && !ops.ai.apiKey.includes(':')) ops.ai.apiKey = encrypt(ops.ai.apiKey)
  }

  return ops
}

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
    profile.operationalSettings = decryptOperationalSettings(profile.operationalSettings) as any
  }
  
  return profile
}

export async function updateProfile(userId: string, tenantId: string, data: any) {
  if (data.operationalSettings) {
    data.operationalSettings = encryptOperationalSettings(data.operationalSettings)
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
  if (data.operationalSettings) {
    data.operationalSettings = encryptOperationalSettings(data.operationalSettings)
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
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)

  const twentySixDaysAgo = new Date()
  twentySixDaysAgo.setDate(twentySixDaysAgo.getDate() - 25)
  twentySixDaysAgo.setHours(0, 0, 0, 0)

  const [salesToday, dailyTransactions, expensesToday, lowStock, totalCustomers, aiSales, aiExpenses, aiTransactionCount] = await Promise.all([
    prisma.sale.aggregate({
      where: {
        tenantId,
        createdAt: { gte: startOfToday }
      },
      _sum: { totalAmount: true }
    }),
    prisma.sale.count({
      where: {
        tenantId,
        createdAt: { gte: startOfToday }
      }
    }),
    prisma.expense.aggregate({
      where: {
        tenantId,
        date: { gte: startOfToday }
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
    }),
    prisma.sale.aggregate({
      where: {
        tenantId,
        createdAt: { gte: twentySixDaysAgo }
      },
      _sum: { totalAmount: true }
    }),
    prisma.expense.aggregate({
      where: {
        tenantId,
        date: { gte: twentySixDaysAgo }
      },
      _sum: { amount: true }
    }),
    prisma.sale.count({
      where: {
        tenantId,
        createdAt: { gte: twentySixDaysAgo }
      }
    })
  ])

  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)
  sevenDaysAgo.setHours(0, 0, 0, 0)

  const [recentSales, recentExpenses] = await Promise.all([
    prisma.sale.findMany({
      where: { tenantId, createdAt: { gte: sevenDaysAgo } },
      select: { totalAmount: true, createdAt: true }
    }),
    prisma.expense.findMany({
      where: { tenantId, date: { gte: sevenDaysAgo } },
      select: { amount: true, date: true }
    })
  ])

  // Group by day in JS
  const salesChart = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    // Adjust for local timezone offset to safely group by day
    const dateStr = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().split('T')[0]
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' })

    const daySales = recentSales
      .filter(s => new Date(s.createdAt.getTime() - (s.createdAt.getTimezoneOffset() * 60000)).toISOString().split('T')[0] === dateStr)
      .reduce((sum, s) => sum + Number(s.totalAmount), 0)
      
    const dayExpenses = recentExpenses
      .filter(e => new Date(e.date.getTime() - (e.date.getTimezoneOffset() * 60000)).toISOString().split('T')[0] === dateStr)
      .reduce((sum, e) => sum + Number(e.amount), 0)

    salesChart.push({
      name: dayName,
      sales: daySales,
      profit: daySales - dayExpenses
    })
  }

  return {
    dailySales: Number(salesToday._sum.totalAmount || 0),
    dailyTransactions,
    newCustomers: totalCustomers,
    outOfStockCount: lowStock,
    profit: Number(salesToday._sum.totalAmount || 0) - Number(expensesToday._sum.amount || 0),
    salesChart,
    rating: 4.8,
    reviewCount: 12,
    recentSales: [],
    aiReportData: {
      totalSales26Days: Number(aiSales._sum.totalAmount || 0),
      totalExpenses26Days: Number(aiExpenses._sum.amount || 0),
      transactionCount26Days: aiTransactionCount
    }
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
    await ensureExpiringProductAlerts(tenantId)
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

export async function generateAiReport(tenantId: string, userId: string, data: { prompt: string }) {
  const provider = await prisma.provider.findFirst({
    where: { tenantId }
  })

  if (!provider) throw { statusCode: 404, message: 'Provider not found' }

  const ops = decryptOperationalSettings(provider.operationalSettings)
  const aiConfig = ops?.ai

  if (!aiConfig || !aiConfig.provider || aiConfig.provider === 'none' || !aiConfig.apiKey) {
    throw { statusCode: 400, message: 'AI configuration is missing or disabled' }
  }

  let reportText = ''

  try {
    if (aiConfig.provider === 'openai') {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aiConfig.apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: data.prompt }]
        })
      })
      const resData: any = await response.json()
      if (resData.error) throw new Error(resData.error.message)
      reportText = resData.choices[0].message.content
    } else if (aiConfig.provider === 'anthropic') {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': aiConfig.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1000,
          messages: [{ role: 'user', content: data.prompt }]
        })
      })
      const resData: any = await response.json()
      if (resData.error) throw new Error(resData.error.message)
      reportText = resData.content[0].text
    } else if (aiConfig.provider === 'gemini') {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${aiConfig.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: data.prompt }] }]
        })
      })
      const resData: any = await response.json()
      if (resData.error) throw new Error(resData.error.message)
      reportText = resData.candidates[0].content.parts[0].text
    } else {
      throw { statusCode: 400, message: 'Unsupported AI provider' }
    }

    // Save to database
    const savedReport = await prisma.aiReport.create({
      data: {
        tenantId,
        providerName: provider.businessName,
        prompt: data.prompt,
        report: reportText
      }
    })

    return savedReport
  } catch (err: any) {
    throw { statusCode: 500, message: 'Failed to generate report: ' + (err.message || 'Unknown error') }
  }
}

export async function getAiReports(tenantId: string) {
  return prisma.aiReport.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: 20
  })
}
