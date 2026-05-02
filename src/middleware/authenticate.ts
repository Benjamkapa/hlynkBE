import type { FastifyRequest, FastifyReply } from 'fastify'
import { subscriptionGuard } from './subscription'

import { prisma } from '../lib/prisma'

export interface JwtPayload {
  userId: string
  tenantId: string
  role: 'CUSTOMER' | 'PROVIDER' | 'STAFF' | 'SUPER_ADMIN'
  sessionId: string
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
    
    // Remote Logout Check: verify session is still active in DB
    const session = await prisma.session.findUnique({
      where: { id: request.user.sessionId }
    })

    if (!session || !session.isActive) {
      return reply.status(401).send({ 
        success: false, 
        message: 'Session has been terminated or is invalid' 
      })
    }

    // Optional: Update last active timestamp
    prisma.session.update({
      where: { id: session.id },
      data: { lastActive: new Date() }
    }).catch(() => {}) // non-blocking

  } catch {
    reply.status(401).send({ success: false, message: 'Unauthorized' })
  }
}

export { subscriptionGuard }

export async function requireProvider(request: FastifyRequest, reply: FastifyReply) {
  await authenticate(request, reply)
  if (!['PROVIDER', 'STAFF', 'SUPER_ADMIN'].includes(request.user?.role as string)) {
    reply.status(403).send({ success: false, message: 'Forbidden: Access restricted' })
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  await authenticate(request, reply)
  if (request.user?.role !== 'SUPER_ADMIN') {
    reply.status(403).send({ success: false, message: 'Forbidden: Admin access required' })
  }
}
