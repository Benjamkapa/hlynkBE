import { prisma } from '../../lib/prisma'
import { z } from 'zod'

const serviceSchema = z.object({
  name: z.string().min(1, 'Service name is required'),
  description: z.string().optional(),
  price: z.number().positive().optional(),
  duration: z.number().int().positive().optional(),
})

export async function getMyServices(tenantId: string) {
  return prisma.service.findMany({
    where: { tenantId, isActive: true },
    orderBy: { createdAt: 'desc' },
  })
}

export async function createService(tenantId: string, providerId: string, data: unknown) {
  const validated = serviceSchema.parse(data)
  return prisma.service.create({
    data: { tenantId, providerId, ...validated },
  })
}

export async function updateService(
  id: string,
  tenantId: string,
  data: unknown,
) {
  const service = await prisma.service.findUnique({ where: { id } })
  if (!service) throw { statusCode: 404, message: 'Service not found' }
  if (service.tenantId !== tenantId) throw { statusCode: 403, message: 'Forbidden' }

  const validated = serviceSchema.partial().parse(data)
  return prisma.service.update({ where: { id }, data: validated })
}

export async function deleteService(id: string, tenantId: string) {
  const service = await prisma.service.findUnique({ where: { id } })
  if (!service) throw { statusCode: 404, message: 'Service not found' }
  if (service.tenantId !== tenantId) throw { statusCode: 403, message: 'Forbidden' }

  // Soft delete
  return prisma.service.update({ where: { id }, data: { isActive: false } })
}
