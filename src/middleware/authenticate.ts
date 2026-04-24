import type { FastifyRequest, FastifyReply } from 'fastify'

export interface JwtPayload {
  userId: string
  tenantId: string
  role: 'CUSTOMER' | 'PROVIDER' | 'SUPER_ADMIN'
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload
    user: JwtPayload
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify()
  } catch {
    reply.status(401).send({ success: false, message: 'Unauthorized' })
  }
}

export async function requireProvider(request: FastifyRequest, reply: FastifyReply) {
  await authenticate(request, reply)
  if (request.user?.role !== 'PROVIDER' && request.user?.role !== 'SUPER_ADMIN') {
    reply.status(403).send({ success: false, message: 'Forbidden: Provider access required' })
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  await authenticate(request, reply)
  if (request.user?.role !== 'SUPER_ADMIN') {
    reply.status(403).send({ success: false, message: 'Forbidden: Admin access required' })
  }
}
