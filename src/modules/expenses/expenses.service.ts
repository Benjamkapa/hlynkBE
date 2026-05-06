import { prisma } from '../../lib/prisma'
import { Decimal } from '@prisma/client/runtime/library'

export async function listExpenses(tenantId: string, params: { search?: string; category?: string; limit?: number; page?: number; sortBy?: string; sortOrder?: 'asc' | 'desc' }) {
  const where: any = { tenantId }
  
  if (params.category) {
    where.category = params.category
  }

  if (params.search) {
    where.description = { contains: params.search }
  }

  const limit = params.limit ? Number(params.limit) : 50
  const page = params.page ? Number(params.page) : 1
  const skip = (Math.max(page, 1) - 1) * limit

  const total = await prisma.expense.count({ where })
  const validSortFields = ['category', 'description', 'amount', 'date']
  const sortBy = params.sortBy && validSortFields.includes(params.sortBy) ? params.sortBy : 'date'
  const sortOrder = params.sortOrder === 'asc' ? 'asc' : 'desc'

  const expenses = await prisma.expense.findMany({
    where,
    orderBy: { [sortBy]: sortOrder },
    skip,
    take: limit
  })

  // Calculate real stats
  const totalAgg = await prisma.expense.aggregate({
    where: { tenantId },
    _sum: { amount: true }
  })

  const categoryAgg = await prisma.expense.groupBy({
    by: ['category'],
    where: { tenantId },
    _sum: { amount: true },
    orderBy: { _sum: { amount: 'desc' } },
    take: 1
  })

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const burnRateAgg = await prisma.expense.aggregate({
    where: { 
      tenantId,
      date: { gte: thirtyDaysAgo }
    },
    _sum: { amount: true }
  })

  return { 
    items: expenses,
    total,
    page: Math.max(page, 1),
    limit,
    pages: Math.ceil(total / limit),
    stats: {
      totalExpenses: Number(totalAgg._sum.amount || 0),
      highestCategory: categoryAgg[0]?.category || 'N/A',
      burnRate: Math.round(Number(burnRateAgg._sum.amount || 0) / 30)
    }
  }
}

export async function createExpense(tenantId: string, data: any) {
  return prisma.expense.create({
    data: {
      tenantId,
      category: data.category,
      description: data.description,
      amount: new Decimal(data.amount),
      date: data.date ? new Date(data.date) : new Date()
    }
  })
}

export async function deleteExpense(id: string, tenantId: string) {
  return prisma.expense.delete({
    where: { id, tenantId }
  })
}
