import type { FastifyInstance } from 'fastify'
import { requireAdmin } from '../../middleware/authenticate'
import * as adminService from './admin.service'

export async function adminRoutes(fastify: FastifyInstance) {
  // All admin routes require SUPER_ADMIN role
  fastify.addHook('preHandler', requireAdmin)

  // GET /api/v1/admin/stats
  fastify.get('/stats', async (_request, reply) => {
    const stats = await adminService.getSystemStats()
    return reply.send({ success: true, data: stats })
  })

  // GET /api/v1/admin/tenants?page=1&search=mama
  fastify.get('/tenants', async (request, reply) => {
    const { page, limit, search } = request.query as Record<string, string>
    const result = await adminService.getAllTenants(
      Number(page) || 1,
      Number(limit) || 20,
      search,
    )
    return reply.send({ success: true, data: result })
  })

  // PUT /api/v1/admin/tenants/:id/suspend
  fastify.put('/tenants/:id/suspend', async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = await adminService.suspendTenant(id)
    return reply.send({ success: true, data: result })
  })

  // PUT /api/v1/admin/tenants/:id/activate
  fastify.put('/tenants/:id/activate', async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = await adminService.activateTenant(id)
    return reply.send({ success: true, data: result })
  })

  // PUT /api/v1/admin/tenants/:id/upgrade
  fastify.put('/tenants/:id/upgrade', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { planName } = request.body as { planName: 'BASIC' | 'PRO' }
    const result = await adminService.upgradePlan(id, planName)
    return reply.send({ success: true, data: result })
  })
}
