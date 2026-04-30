import type { FastifyInstance } from 'fastify'
import { requireAdmin } from '../../middleware/authenticate'
import * as adminService from './admin.service'

export async function adminRoutes(fastify: FastifyInstance) {
  // All admin routes require SUPER_ADMIN role
  fastify.addHook('preHandler', requireAdmin)

  // GET /api/v1/admin/stats
  fastify.get('/stats', async (request, reply) => {
    const { timeframe } = request.query as { timeframe?: 'HOURLY' | 'DAILY' }
    const stats = await adminService.getSystemStats(timeframe)
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
  // --- Users ---
  fastify.get('/users', async (_request, reply) => {
    const data = await adminService.getUsers()
    return reply.send({ success: true, data })
  })
  fastify.put('/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const data = await adminService.updateUser(id, request.body as any)
    return reply.send({ success: true, data })
  })
  fastify.delete('/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const data = await adminService.deleteUser(id)
    return reply.send({ success: true, data })
  })

  // --- Settings ---
  fastify.get('/settings', async (_request, reply) => {
    const data = await adminService.getSettings()
    return reply.send({ success: true, data })
  })
  fastify.put('/settings', async (request, reply) => {
    const data = await adminService.updateSettings(request.body as any)
    return reply.send({ success: true, data })
  })

  // --- Financials Export ---
  fastify.get('/financials/export', async (request, reply) => {
    const { type } = request.query as { type: 'SALES' | 'SUBSCRIPTIONS' }
    const csv = await adminService.exportFinancials(type || 'SALES')
    reply.header('Content-Type', 'text/csv')
    reply.header('Content-Disposition', `attachment; filename="${type}-export-${Date.now()}.csv"`)
    return reply.send(csv)
  })

  // --- Report Schedules ---
  fastify.get('/schedules', async (_request, reply) => {
    const data = await adminService.getSchedules()
    return reply.send({ success: true, data })
  })
  fastify.post('/schedules', async (request, reply) => {
    const data = await adminService.createSchedule(request.body as any)
    return reply.send({ success: true, data })
  })
  fastify.put('/schedules/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const data = await adminService.updateSchedule(id, request.body as any)
    return reply.send({ success: true, data })
  })
  fastify.delete('/schedules/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const data = await adminService.deleteSchedule(id)
    return reply.send({ success: true, data })
  })

  // --- Dynamic Query Builder ---
  fastify.post('/reports/query', async (request, reply) => {
    const result = await adminService.runDynamicQuery(request.body as { table: string, columns: string[], dateRange?: { start: string, end: string } })
    return reply.send({ success: true, data: result })
  })
}
