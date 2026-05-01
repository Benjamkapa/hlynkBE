import { prisma } from '../../lib/prisma'

export async function getAllTenants(page = 1, limit = 20, search?: string) {
  const where: any = {}
  if (search) {
    where.OR = [
      { businessName: { contains: search } },
      { slug: { contains: search } },
    ]
  }

  const [tenants, total] = await Promise.all([
    prisma.tenant.findMany({
      where,
      include: {
        subscription: true,
        _count: { select: { services: true, requests: true, users: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.tenant.count({ where }),
  ])

  return { tenants, total, page, limit, pages: Math.ceil(total / limit) }
}

export async function getSystemStats(timeframe: 'HOURLY' | 'DAILY' = 'DAILY') {
  const now = new Date();
  const today = new Date(now.setHours(0, 0, 0, 0));
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const expiringSoon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

  const [
    totalProviders,
    activeToday,
    trialsRunning,
    expiredTrials,
    payingProviders,
    revenueThisMonth,
    newTrialsToday,
    trialsExpiringSoon,
    conversionsToday
  ] = await Promise.all([
    prisma.tenant.count(),
    prisma.user.count({ where: { role: 'PROVIDER', updatedAt: { gte: today } } }),
    prisma.subscription.count({ where: { status: 'TRIAL' } }),
    prisma.subscription.count({ where: { status: 'EXPIRED' } }),
    prisma.subscription.count({ where: { status: 'ACTIVE', planName: { not: 'TRIAL' } } }),
    prisma.sale.aggregate({
      where: { createdAt: { gte: monthStart } },
      _sum: { totalAmount: true }
    }),
    prisma.subscription.count({ where: { status: 'TRIAL', createdAt: { gte: today } } }),
    prisma.subscription.count({ where: { status: 'TRIAL', trialEndDate: { lte: expiringSoon, gte: new Date() } } }),
    prisma.subscription.count({ where: { status: 'ACTIVE', updatedAt: { gte: today }, planName: { not: 'TRIAL' } } })
  ]);

  // At-Risk Businesses (Inactive for 3+ days)
  const atRisk = await prisma.tenant.findMany({
    where: { isActive: true },
    include: { 
      subscription: true, 
      users: { where: { role: 'PROVIDER' }, orderBy: { updatedAt: 'desc' }, take: 1 } 
    },
    take: 5
  });

  // Recent Registrations
  const recentRegistrations = await prisma.tenant.findMany({
    include: { subscription: true, users: { take: 1 } },
    orderBy: { createdAt: 'desc' },
    take: 5
  });

  // Growth Trends: New Providers per Week (Last 8 weeks)
  const weeklyGrowth = [];
  for (let i = 7; i >= 0; i--) {
    const start = new Date(Date.now() - (i + 1) * 7 * 24 * 60 * 60 * 1000);
    const end = new Date(Date.now() - i * 7 * 24 * 60 * 60 * 1000);
    const count = await prisma.tenant.count({ where: { createdAt: { gte: start, lte: end } } });
    weeklyGrowth.push({ name: `W${8-i}`, value: count });
  }

  // Revenue Trend (Hourly or Daily)
  const revenueTrend = [];
  if (timeframe === 'HOURLY') {
    for (let i = 23; i >= 0; i--) {
      const d = new Date();
      d.setHours(d.getHours() - i, 0, 0, 0);
      const end = new Date(d.getTime() + 60 * 60 * 1000 - 1);
      const sum = await prisma.sale.aggregate({
        where: { createdAt: { gte: d, lte: end } },
        _sum: { totalAmount: true }
      });
      revenueTrend.push({ name: `${d.getHours()}:00`, value: Number(sum._sum.totalAmount || 0) });
    }
  } else {
    // DAILY (Last 7 days)
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const start = new Date(d.setHours(0, 0, 0, 0));
      const end = new Date(d.setHours(23, 59, 59, 999));
      const sum = await prisma.sale.aggregate({
        where: { createdAt: { gte: start, lte: end } },
        _sum: { totalAmount: true }
      });
      revenueTrend.push({ name: start.toLocaleString('default', { weekday: 'short' }), value: Number(sum._sum.totalAmount || 0) });
    }
  }

  // Active Users per Day (Last 7 days)
  const dailyActive = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dayName = d.toLocaleString('default', { weekday: 'short' });
    const start = new Date(d.setHours(0, 0, 0, 0));
    const end = new Date(d.setHours(23, 59, 59, 999));
    const count = await prisma.user.count({ where: { updatedAt: { gte: start, lte: end } } });
    dailyActive.push({ name: dayName, value: count });
  }

  return {
    overview: {
      totalProviders,
      activeToday,
      trialsRunning,
      expiredTrials,
      payingProviders,
      revenueThisMonth: Number(revenueThisMonth._sum.totalAmount || 0)
    },
    trials: {
      newToday: newTrialsToday,
      expiringSoon: trialsExpiringSoon,
      conversions: conversionsToday,
      conversionRate: totalProviders > 0 ? (payingProviders / totalProviders) * 100 : 0
    },
    atRisk: atRisk.map(t => ({
      id: t.id,
      name: t.businessName,
      lastLogin: t.users[0]?.updatedAt || t.updatedAt,
      status: t.subscription?.status || 'NONE'
    })),
    recentRegistrations: recentRegistrations.map(t => ({
      id: t.id,
      name: t.businessName,
      owner: t.users[0]?.name || 'N/A',
      location: 'N/A', // Omitted to avoid provider query crash
      plan: t.subscription?.planName || 'TRIAL',
      date: t.createdAt
    })),
    trends: {
      weeklyGrowth,
      revenueTrend,
      dailyActive
    }
  };
}

export async function suspendTenant(tenantId: string) {
  await prisma.tenant.update({ where: { id: tenantId }, data: { isActive: false } })
  await prisma.subscription.update({
    where: { tenantId },
    data: { status: 'SUSPENDED' },
  })
  return { message: 'Tenant suspended' }
}

export async function activateTenant(tenantId: string) {
  await prisma.tenant.update({ where: { id: tenantId }, data: { isActive: true } })
  await prisma.subscription.update({
    where: { tenantId },
    data: { status: 'ACTIVE' },
  })
  return { message: 'Tenant activated' }
}

export async function upgradePlan(tenantId: string, planName: 'BASIC' | 'PRO') {
  const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // +30 days
  return prisma.subscription.update({
    where: { tenantId },
    data: { planName, status: 'ACTIVE', startDate: new Date(), endDate },
  })
}

// --- Users ---
export async function getUsers() {
  return prisma.user.findMany({ select: { id: true, name: true, email: true, phone: true, role: true, photoUrl: true, createdAt: true, tenantId: true } })
}
export async function updateUser(id: string, data: any) {
  return prisma.user.update({ where: { id }, data })
}
export async function deleteUser(id: string) {
  return prisma.user.delete({ where: { id } })
}

// --- Settings ---
export async function getSettings() {
  return prisma.systemSetting.findMany()
}
export async function updateSettings(settings: { key: string, value: string, dataType?: string }[]) {
  const tx = settings.map(s => prisma.systemSetting.upsert({
    where: { key: s.key },
    update: { value: s.value, dataType: s.dataType || 'STRING' },
    create: { key: s.key, value: s.value, dataType: s.dataType || 'STRING' }
  }))
  return prisma.$transaction(tx)
}

// --- Financials ---
export async function exportFinancials(type: 'SALES' | 'SUBSCRIPTIONS') {
  if (type === 'SALES') {
    const sales = await prisma.sale.findMany({ include: { tenant: true } })
    const csv = ['ID,Tenant,Customer,Amount,Method,Date']
    sales.forEach(s => csv.push(`${s.id},"${s.tenant.businessName}","${s.customerName || 'N/A'}",${s.totalAmount},${s.paymentMethod},${s.createdAt.toISOString()}`))
    return csv.join('\n')
  } else {
    const subs = await prisma.subscription.findMany({ include: { tenant: true } })
    const csv = ['ID,Tenant,Plan,Status,StartDate,EndDate']
    subs.forEach(s => csv.push(`${s.id},"${s.tenant.businessName}",${s.planName},${s.status},${s.startDate.toISOString()},${s.endDate?.toISOString() || ''}`))
    return csv.join('\n')
  }
}

// --- Report Schedules ---
export async function getSchedules() {
  return prisma.reportSchedule.findMany()
}
export async function createSchedule(data: any) {
  return prisma.reportSchedule.create({ data })
}
export async function updateSchedule(id: string, data: any) {
  return prisma.reportSchedule.update({ where: { id }, data })
}
export async function deleteSchedule(id: string) {
  return prisma.reportSchedule.delete({ where: { id } })
}

// --- Dynamic Query Builder ---
export async function runDynamicQuery({ table, columns, dateRange }: { table: string, columns: string[], dateRange?: { start: string, end: string } }) {
  // basic robust mapping to avoid raw SQL injection
  const allowedTables = ['User', 'Tenant', 'Sale', 'Subscription']
  if (!allowedTables.includes(table)) throw new Error('Invalid table')
  
  const where: any = {}
  if (dateRange && dateRange.start && dateRange.end) {
    where.createdAt = { gte: new Date(dateRange.start), lte: new Date(dateRange.end) }
  }

  let results: any[] = []
  if (table === 'User') results = await prisma.user.findMany({ where })
  else if (table === 'Tenant') results = await prisma.tenant.findMany({ where })
  else if (table === 'Sale') results = await prisma.sale.findMany({ where })
  else if (table === 'Subscription') results = await prisma.subscription.findMany({ where })

  // Map to requested columns
  if (columns.length > 0) {
    return results.map(row => {
      const filtered: any = {}
      columns.forEach(c => {
        if (row[c] !== undefined) filtered[c] = row[c]
      })
      return filtered
    })
  }
  return results
}

// --- Subscriptions ---
export async function getSubscriptions(status?: string) {
  const where = status ? { status: status as any } : {}
  return prisma.subscription.findMany({ where, include: { tenant: true }, orderBy: { createdAt: 'desc' } })
}

// --- System Health ---
export async function getSystemHealth() {
  const [dbStatus, memory, errorsLast24h] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => 'up').catch(() => 'down'),
    process.memoryUsage(),
    prisma.systemEvent.count({
      where: { level: 'ERROR', createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
    })
  ])
  return {
    database: dbStatus,
    api: 'up',
    errorsLast24h,
    memoryUsage: Math.round(memory.heapUsed / 1024 / 1024) + 'MB'
  }
}
export async function getAllActivityLogs(params: { page?: number; limit?: number }) {
  const page = Number(params.page) || 1
  const limit = Number(params.limit) || 20
  const skip = (page - 1) * limit

  const [items, total] = await Promise.all([
    prisma.activityLog.findMany({
      include: {
        user: { select: { name: true, email: true, photoUrl: true } },
        tenant: { select: { businessName: true } }
      } as any,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    }),
    prisma.activityLog.count()
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
