import bcrypt from 'bcryptjs'
import { prisma } from '../../lib/prisma'
import { OAuth2Client } from 'google-auth-library'

const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID ||
    '484330190793-ko7gev05shqsfv32u84s3obkjvmuc4j2.apps.googleusercontent.com',
)

import type {
  RegisterInput,
  LoginInput,
  ForgotPasswordInput,
  ResetPasswordInput,
} from './auth.schema'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = slugify(base)
  let exists = await prisma.tenant.findUnique({ where: { slug } })
  let i = 1
  while (exists) {
    slug = `${slugify(base)}-${i++}`
    exists = await prisma.tenant.findUnique({ where: { slug } })
  }
  return slug
}

function normalizePhone(phone: string): string {
  if (phone.startsWith('0')) return '+254' + phone.slice(1)
  if (phone.startsWith('254')) return '+' + phone
  return phone
}

// ─── Register ─────────────────────────────────────────────────────────────────

export async function register(input: RegisterInput) {
  const phone = normalizePhone(input.phone)

  const existing = await prisma.user.findUnique({ where: { phone } })
  if (existing) throw { statusCode: 409, message: 'Phone number already registered' }

  const slug = await uniqueSlug(input.businessName)
  const trialEndDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) // +14 days
  const passwordHash = await bcrypt.hash(input.password, 12)

  try {
    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { slug, businessName: input.businessName },
      })

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          name: input.ownerName,
          phone,
          email: input.email || null,
          passwordHash,
          role: 'PROVIDER',
          phoneVerified: true, // Auto-verify since OTP is removed
        },
      })

      await tx.provider.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          businessName: input.businessName,
          category: input.category,
          county: input.county,
          location: input.location,
          phone,
        },
      })

      await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          planName: 'STARTER',
          status: 'TRIAL',
          isTrial: true,
          hasUsedTrial: true,
          trialEndDate,
          endDate: trialEndDate,
        },
      })

      return { tenant, user }
    })

    // Send welcome email if provided
    // if (input.email) {
    //   sendWelcomeEmail(input.email, input.ownerName, input.businessName).catch(console.error)
    // }

    return {
      message: 'Registration successful.',
      phone,
      tenantSlug: result.tenant.slug,
    }
  } catch (error: any) {
    console.error('[AUTH] Registration error:', error)
    throw error
  }
}

// ─── Login ────────────────────────────────────────────────────────────────────

export async function login(fastify: any, input: LoginInput, ipAddress?: string) {
  const { identifier, password } = input

  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { email: identifier.includes('@') ? identifier.toLowerCase() : undefined },
        { phone: identifier.includes('@') ? undefined : normalizePhone(identifier) },
      ].filter(Boolean) as any,
    },
    include: { tenant: true },
  })

  if (!user) throw { statusCode: 401, message: 'Invalid credentials' }

  if (!user.passwordHash) {
    throw {
      statusCode: 401,
      message: 'This account was created with Google. Please sign in with Google.',
    }
  }

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) throw { statusCode: 401, message: 'Invalid credentials' }

  if (!user.tenant.isActive) {
    throw { statusCode: 403, message: 'Your account has been suspended. Contact support.' }
  }

  const { accessToken, refreshToken } = await issueTokens(fastify, user, input.userAgent, ipAddress)

  try {
    await prisma.activityLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: 'Login Request',
        logName: 'Login Request',
        details: 'User logged in successfully.',
        ipAddress,
        actionId: '#login',
      } as any,
    })
  } catch (e) {
    console.error('Login Audit Log Error:', e)
  }

  return { accessToken, refreshToken, user: safeUser(user) }
}

// ─── Forgot Password ──────────────────────────────────────────────────────────

export async function forgotPassword(fastify: any, input: ForgotPasswordInput) {
  const phone = normalizePhone(input.phone)
  const user = await prisma.user.findUnique({ where: { phone } })

  // Always return success to prevent phone enumeration
  if (!user) return { message: 'If this number is registered, a reset link has been sent.' }

  // Generate a short-lived reset token and store it in the session table
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      token: '',
      userAgent: 'password-reset',
      ipAddress: 'system',
    },
  })

  const resetToken = fastify.jwt.sign(
    { userId: user.id, sessionId: session.id, purpose: 'reset' },
    { expiresIn: '10m', secret: process.env.JWT_REFRESH_SECRET },
  )

  await prisma.session.update({ where: { id: session.id }, data: { token: resetToken } })

  // TODO: deliver resetToken via SMS or email
  console.log(`\x1b[33m[DEBUG] Reset token for ${phone}: ${resetToken}\x1b[0m`)

  return { message: 'If this number is registered, a reset link has been sent.' }
}

// ─── Reset Password ───────────────────────────────────────────────────────────

export async function resetPassword(fastify: any, input: ResetPasswordInput) {
  let decoded: any
  // try {
  //   // decoded = fastify.jwt.verify(input.resetToken, { secret: process.env.JWT_REFRESH_SECRET })
  // } catch {
  //   throw { statusCode: 400, message: 'Invalid or expired reset token' }
  // }

  if (decoded.purpose !== 'reset') {
    throw { statusCode: 400, message: 'Invalid reset token' }
  }

  const session = await prisma.session.findUnique({ where: { id: decoded.sessionId } })
  // if (!session || !session.isActive || session.token !== input.resetToken) {
  //   throw { statusCode: 400, message: 'Reset token already used or invalid' }
  // }

  const passwordHash = await bcrypt.hash(input.newPassword, 12)

  await prisma.$transaction([
    prisma.user.update({ where: { id: decoded.userId }, data: { passwordHash } }),
    // prisma.session.update({ where: { id: session.id }, data: { isActive: false } }),
  ])

  return { message: 'Password reset successful. Please log in.' }
}

// ─── Logout ───────────────────────────────────────────────────────────────────

export async function logout(sessionId: string) {
  await prisma.session.update({
    where: { id: sessionId },
    data: { isActive: false },
  }).catch(() => null)

  return { message: 'Logged out successfully' }
}

// ─── Refresh Token ────────────────────────────────────────────────────────────

export async function refresh(fastify: any, refreshToken: string) {
  try {
    const decoded: any = fastify.jwt.verify(refreshToken, {
      secret: process.env.JWT_REFRESH_SECRET,
    })

    const session = await prisma.session.findUnique({ where: { id: decoded.sessionId } })
    if (!session || !session.isActive || session.token !== refreshToken) {
      throw new Error('Invalid session')
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { tenant: { include: { subscription: true } } },
    })

    if (!user || !user.tenant.isActive) throw new Error('Invalid user or suspended')

    const payload = {
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
      sessionId: session.id,
    }
    const accessToken = fastify.jwt.sign(payload, {
      expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    })

    return { accessToken }
  } catch {
    throw { statusCode: 401, message: 'Invalid or expired refresh token' }
  }
}

// ─── Google Auth ──────────────────────────────────────────────────────────────

export async function googleAuth(fastify: any, input: any, ipAddress?: string) {
  const ticket = await googleClient.verifyIdToken({
    idToken: input.credential,
    audience:
      process.env.GOOGLE_CLIENT_ID ||
      '484330190793-ko7gev05shqsfv32u84s3obkjvmuc4j2.apps.googleusercontent.com',
  })

  const payload = ticket.getPayload()
  if (!payload || !payload.email) {
    throw { statusCode: 400, message: 'Invalid Google credential' }
  }

  const email = payload.email

  let user = await prisma.user.findUnique({
    where: { email },
    include: { tenant: { include: { subscription: true } } },
  })

  if (user && payload.picture) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        photoUrl: payload.picture,
        provider:
          user.role === 'PROVIDER'
            ? { update: { photoUrl: payload.picture } }
            : undefined,
      } as any,
      include: { tenant: { include: { subscription: true } } },
    }) as any
  }

  if (!user) {
    if (!input.registration) {
      throw {
        statusCode: 404,
        message: 'No account found for this Google email. Please sign up first.',
      }
    }

    const phone = normalizePhone(input.registration.phone)
    const existingPhone = await prisma.user.findUnique({ where: { phone } })
    if (existingPhone)
      throw { statusCode: 409, message: 'Phone number already registered to another account' }

    const slug = await uniqueSlug(input.registration.businessName)
    const trialEndDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)

    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { slug, businessName: input.registration.businessName },
      })

      const newUser = await tx.user.create({
        data: {
          tenantId: tenant.id,
          name: input.registration.ownerName || payload.name || 'Provider',
          phone,
          email,
          passwordHash: '',
          role: 'PROVIDER',
          phoneVerified: true,
          photoUrl: payload.picture,
        } as any,
        include: { tenant: { include: { subscription: true } } },
      }) as any

      await tx.provider.create({
        data: {
          tenantId: tenant.id,
          userId: newUser.id,
          businessName: input.registration.businessName,
          category: input.registration.category,
          county: input.registration.county,
          location: input.registration.location,
          phone,
          photoUrl: payload.picture,
        },
      })

      await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          planName: 'STARTER',
          status: 'TRIAL',
          isTrial: true,
          hasUsedTrial: true,
          trialEndDate,
          endDate: trialEndDate,
        },
      })

      return newUser
    })

    user = result as any

    // if (user) {
    //   sendWelcomeEmail(email, (user as any).name, input.registration.businessName).catch(console.error)
    // }
  }

  if (!user) {
    throw { statusCode: 500, message: 'Authentication failed: User not found after process.' }
  }

  if (!user.tenant.isActive) {
    throw { statusCode: 403, message: 'Your account has been suspended. Contact support.' }
  }

  const { accessToken, refreshToken } = await issueTokens(fastify, user, input.userAgent, ipAddress)
  return { accessToken, refreshToken, user: safeUser(user) }
}

// ─── Token helpers ────────────────────────────────────────────────────────────

async function issueTokens(fastify: any, user: any, userAgent?: string, ipAddress?: string) {
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      token: '',
      userAgent: userAgent || 'Unknown Device',
      ipAddress: ipAddress || 'Unknown IP',
    },
  })

  const payload = {
    userId: user.id,
    tenantId: user.tenantId,
    role: user.role,
    sessionId: session.id,
  }

  const accessToken = fastify.jwt.sign(payload, {
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
  })
  const refreshToken = fastify.jwt.sign(payload, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    secret: process.env.JWT_REFRESH_SECRET,
  })

  await prisma.session.update({
    where: { id: session.id },
    data: { token: refreshToken },
  })

  return { accessToken, refreshToken }
}

function safeUser(user: any) {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
    tenantSlug: user.tenant?.slug,
    businessName: user.tenant?.businessName,
    phoneVerified: user.phoneVerified,
    photoUrl: user.photoUrl,
    subscription: user.subscription || user.tenant?.subscription || null,
  }
}