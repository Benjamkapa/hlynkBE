import { prisma } from '../../lib/prisma'
import { Decimal } from '@prisma/client/runtime/library'

export async function listExpenses(tenantId: string, params: { search?: string; category?: string; limit?: number }) {
  const where: any = { tenantId }
  
  if (params.category) {
    where.category = params.category
  }

  if (params.search) {
    where.description = { contains: params.search }
  }

  const expenses = await prisma.expense.findMany({
    where,
    orderBy: { date: 'desc' },
    take: params.limit ? Number(params.limit) : 50
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
