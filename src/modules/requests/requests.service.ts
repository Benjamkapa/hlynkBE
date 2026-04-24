import { prisma } from '../../lib/prisma'
import { sendSms } from '../../lib/sms'
import { z } from 'zod'

const createRequestSchema = z.object({
  providerId: z.string().min(1),
  serviceId: z.string().optional(),
  customerName: z.string().min(1, 'Name is required'),
  customerPhone: z.string().min(1, 'Phone is required'),
  message: z.string().optional(),
})

const updateStatusSchema = z.object({
  status: z.enum(['PENDING', 'ACCEPTED', 'COMPLETED', 'CANCELLED']),
})

export async function getProviderRequests(
  tenantId: string,
  status?: string,
  page = 1,
  limit = 20,
) {
  const where: any = { tenantId }
  if (status) where.status = status

  const [requests, total] = await Promise.all([
    prisma.request.findMany({
      where,
      include: {
        service: { select: { name: true, price: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.request.count({ where }),
  ])

  return { requests, total, page, limit, pages: Math.ceil(total / limit) }
}

export async function createRequest(tenantId: string, customerId: string, data: unknown) {
  const validated = createRequestSchema.parse(data)

  // Verify provider belongs to tenant
  const provider = await prisma.provider.findUnique({
    where: { id: validated.providerId },
  })
  if (!provider || provider.tenantId !== tenantId) {
    throw { statusCode: 404, message: 'Provider not found' }
  }

  const request = await prisma.request.create({
    data: {
      tenantId,
      customerId,
      providerId: validated.providerId,
      serviceId: validated.serviceId,
      customerName: validated.customerName,
      customerPhone: validated.customerPhone,
      message: validated.message,
    },
    include: { service: true, provider: true },
  })

  // Notify provider via SMS
  sendSms({
    to: provider.phone,
    message: `New request on hlynk from ${validated.customerName} (${validated.customerPhone})${validated.message ? ': ' + validated.message : ''}. Log in to respond.`,
  }).catch(console.error)

  return request
}

export async function updateRequestStatus(
  id: string,
  tenantId: string,
  data: unknown,
) {
  const { status } = updateStatusSchema.parse(data)
  const request = await prisma.request.findUnique({ where: { id } })

  if (!request) throw { statusCode: 404, message: 'Request not found' }
  if (request.tenantId !== tenantId) throw { statusCode: 403, message: 'Forbidden' }

  return prisma.request.update({ where: { id }, data: { status } })
}
