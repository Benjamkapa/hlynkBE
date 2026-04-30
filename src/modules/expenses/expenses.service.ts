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

  return { items: expenses }
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
