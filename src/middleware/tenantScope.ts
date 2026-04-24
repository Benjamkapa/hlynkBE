import type { FastifyRequest, FastifyReply } from 'fastify'

/**
 * Injects tenantId from JWT into every request.
 * Super admins can pass ?tenantId= to scope to a specific tenant.
 */
export async function tenantScope(request: FastifyRequest, _reply: FastifyReply) {
  if (!request.user) return

  const { tenantId, role } = request.user

  if (role === 'SUPER_ADMIN') {
    const queryTenantId = (request.query as Record<string, string>)?.tenantId
    ;(request as any).tenantId = queryTenantId || tenantId
  } else {
    ;(request as any).tenantId = tenantId
  }
}

// Extend FastifyRequest type
declare module 'fastify' {
  interface FastifyRequest {
    tenantId?: string
  }
}
