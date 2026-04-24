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

export async function getSystemStats() {
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
    include: { subscription: true, providers: { include: { user: true }, take: 1 } },
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

  // Monthly Revenue (Last 6 months)
  const monthlyRevenue = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const monthName = d.toLocaleString('default', { month: 'short' });
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const sum = await prisma.sale.aggregate({
      where: { createdAt: { gte: start, lte: end } },
      _sum: { totalAmount: true }
    });
    monthlyRevenue.push({ name: monthName, value: Number(sum._sum.totalAmount || 0) });
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
      owner: t.providers[0]?.user.name || 'N/A',
      location: t.providers[0]?.county || 'N/A',
      plan: t.subscription?.planName || 'TRIAL',
      date: t.createdAt
    })),
    trends: {
      weeklyGrowth,
      monthlyRevenue,
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
