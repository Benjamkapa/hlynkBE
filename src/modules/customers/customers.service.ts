import { prisma } from '../../lib/prisma'

export async function listCustomers(
  tenantId: string,
  params: { search?: string; page?: number; limit?: number; sortBy?: string; sortOrder?: 'asc' | 'desc' },
) {
  const page = params.page ? Number(params.page) : 1
  const limit = params.limit ? Number(params.limit) : 50
  const skip = (page - 1) * limit

  const where: any = {
    role: 'CUSTOMER',
    OR: [
      { tenantId },
      { sales: { some: { tenantId } } }
    ]
  }

  if (params.search) {
    where.AND = [
      {
        OR: [
          { name: { contains: params.search, mode: 'insensitive' } },
          { phone: { contains: params.search } },
          { email: { contains: params.search } },
        ]
      }
    ]
  }

  const validSortFields = ['name', 'phone', 'email', 'createdAt']
  const sortBy = params.sortBy && validSortFields.includes(params.sortBy) ? params.sortBy : 'createdAt'
  const sortOrder = params.sortOrder === 'asc' ? 'asc' : 'desc'

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
    }),
    prisma.user.count({ where }),
  ])

  const userIds = users.map((u) => u.id)

  // Aggregate sales stats for these customers in one query
  const salesAgg = await prisma.sale.groupBy({
    by: ['customerId'],
    where: { tenantId, customerId: { in: userIds } },
    _sum: { totalAmount: true },
    _max: { createdAt: true },
  })

  const statsMap = new Map(salesAgg.map((s) => [s.customerId, s]))

  const items = users.map((u) => {
    const stats = statsMap.get(u.id)
    return {
      id: u.id,
      name: u.name,
      phone: u.phone,
      email: u.email,
      lastVisit: stats?._max?.createdAt ?? null,
      totalSpend: Number(stats?._sum?.totalAmount ?? 0),
      createdAt: u.createdAt,
    }
  })

  const [totalCount, activeToday, topSpenderAgg] = await Promise.all([
    prisma.user.count({ where: { role: 'CUSTOMER', OR: [{ tenantId }, { sales: { some: { tenantId } } }] } }),
    prisma.sale.groupBy({
      by: ['customerId'],
      where: { 
        tenantId, 
        createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        customerId: { not: null }
      },
      _count: true
    }),
    prisma.sale.groupBy({
      by: ['customerId'],
      where: { tenantId, customerId: { not: null } },
      _sum: { totalAmount: true },
      orderBy: { _sum: { totalAmount: 'desc' } },
      take: 1
    })
  ])

  let topSpenderName = 'N/A'
  if (topSpenderAgg.length > 0) {
    const topUser = await prisma.user.findUnique({
      where: { id: topSpenderAgg[0].customerId as string }
    })
    topSpenderName = topUser?.name || 'N/A'
  }

  return { 
    items, 
    total, 
    page, 
    limit,
    pages: Math.ceil(total / limit),
    stats: {
      total: totalCount,
      activeToday: activeToday.length,
      topSpender: topSpenderName
    }
  }
}

export async function createCustomer(
  tenantId: string,
  data: { name: string; phone: string; email?: string },
) {
  const existing = await prisma.user.findFirst({
    where: { phone: data.phone, role: 'CUSTOMER' },
  })
  
  if (existing) {
    // If exists globally, just update with the new details and return it
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        name: data.name,
        email: data.email || existing.email
      }
    })
  }

  return prisma.user.create({
    data: {
      tenantId,
      name: data.name,
      phone: data.phone,
      email: data.email || null,
      role: 'CUSTOMER',
    },
  })
}

export async function updateCustomer(
  id: string,
  tenantId: string,
  data: { name?: string; phone?: string; email?: string },
) {
  const customer = await prisma.user.findFirst({ 
    where: { 
      id, 
      role: 'CUSTOMER',
      OR: [{ tenantId }, { sales: { some: { tenantId } } }]
    } 
  })
  if (!customer) throw { statusCode: 404, message: 'Customer not found' }

  return prisma.user.update({
    where: { id },
    data: {
      ...(data.name && { name: data.name }),
      ...(data.phone && { phone: data.phone }),
      ...(data.email !== undefined && { email: data.email }),
    },
  })
}

export async function deleteCustomer(id: string, tenantId: string) {
  const customer = await prisma.user.findFirst({ 
    where: { 
      id, 
      role: 'CUSTOMER',
      OR: [{ tenantId }, { sales: { some: { tenantId } } }]
    } 
  })
  if (!customer) throw { statusCode: 404, message: 'Customer not found' }

  // Detach from sales before deletion so history is preserved
  await prisma.sale.updateMany({
    where: { customerId: id, tenantId },
    data: { customerId: null },
  })

  // Only delete the actual user record if they belong to this tenant AND have no other sales globally
  const otherSalesCount = await prisma.sale.count({ where: { customerId: id } })
  if (customer.tenantId === tenantId && otherSalesCount === 0) {
    return prisma.user.delete({ where: { id } })
  }
  
  return { message: 'Customer successfully unlinked from your sales history' }
}
