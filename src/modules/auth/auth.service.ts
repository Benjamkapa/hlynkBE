import bcrypt from 'bcryptjs'
import { prisma } from '../../lib/prisma'
import { redis, redisKeys } from '../../lib/redis'
import { sendSms, generateOtp, formatOtpMessage } from '../../lib/sms'
import { sendWelcomeEmail } from '../../lib/mailer'
import type {
  RegisterInput,
  VerifyOtpInput,
  LoginInput,
  ForgotPasswordInput,
  ResetPasswordInput,
} from './auth.schema'

const OTP_TTL = (Number(process.env.OTP_EXPIRES_MINUTES) || 10) * 60

// ─── Helpers ─────────────────────────────────────────────────────────────────
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

// ─── Register ────────────────────────────────────────────────────────────────
export async function register(input: RegisterInput) {
  const phone = normalizePhone(input.phone)

  const existing = await prisma.user.findUnique({ where: { phone } })
  if (existing) throw { statusCode: 409, message: 'Phone number already registered' }

  const slug = await uniqueSlug(input.businessName)
  const trialEndDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) // +14 days
  const passwordHash = await bcrypt.hash(input.password, 12)

  // Create tenant + user + provider + subscription in one transaction
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
        planName: 'TRIAL',
        status: 'TRIAL',
        trialEndDate,
      },
    })

    return { tenant, user }
  })

  // Send OTP
  const otp = generateOtp()
  console.log(`\x1b[33m[DEBUG] OTP for ${phone}: ${otp}\x1b[0m`)
  await redis.setex(redisKeys.otp(phone), OTP_TTL, otp)
  await sendSms({ to: phone, message: formatOtpMessage(otp) })

  // Send welcome email if provided
  if (input.email) {
    sendWelcomeEmail(input.email, input.ownerName, input.businessName).catch(console.error)
  }

  return {
    message: 'Registration successful. Please verify your phone number.',
    phone,
    tenantSlug: result.tenant.slug,
  }
}

// ─── Verify OTP ──────────────────────────────────────────────────────────────
export async function verifyOtp(fastify: any, input: VerifyOtpInput) {
  const phone = normalizePhone(input.phone)
  const stored = await redis.get(redisKeys.otp(phone))

  if (!stored || stored !== input.otp) {
    throw { statusCode: 400, message: 'Invalid or expired OTP' }
  }

  await redis.del(redisKeys.otp(phone))

  const user = await prisma.user.update({
    where: { phone },
    data: { phoneVerified: true },
    include: { tenant: true },
  })

  const { accessToken, refreshToken } = await issueTokens(fastify, user)
  return { accessToken, refreshToken, user: safeUser(user) }
}

// ─── Login ───────────────────────────────────────────────────────────────────
export async function login(fastify: any, input: LoginInput) {
  const phone = normalizePhone(input.phone)
  const user = await prisma.user.findUnique({
    where: { phone },
    include: { tenant: true },
  })

  if (!user) throw { statusCode: 401, message: 'Invalid credentials' }
  if (!user.phoneVerified) throw { statusCode: 403, message: 'Please verify your phone number first' }

  const valid = await bcrypt.compare(input.password, user.passwordHash)
  if (!valid) throw { statusCode: 401, message: 'Invalid credentials' }

  if (!user.tenant.isActive) {
    throw { statusCode: 403, message: 'Your account has been suspended. Contact support.' }
  }

  const { accessToken, refreshToken } = await issueTokens(fastify, user)
  return { accessToken, refreshToken, user: safeUser(user) }
}

// ─── Forgot Password ─────────────────────────────────────────────────────────
export async function forgotPassword(input: ForgotPasswordInput) {
  const phone = normalizePhone(input.phone)
  const user = await prisma.user.findUnique({ where: { phone } })

  // Always return success to prevent phone enumeration
  if (!user) return { message: 'If this number is registered, an OTP has been sent.' }

  const otp = generateOtp()
  console.log(`\x1b[33m[DEBUG] Reset OTP for ${phone}: ${otp}\x1b[0m`)
  await redis.setex(redisKeys.otp(`reset:${phone}`), OTP_TTL, otp)
  await sendSms({ to: phone, message: `Your hlynk password reset code: ${otp}. Valid 10 mins.` })

  return { message: 'If this number is registered, an OTP has been sent.' }
}

// ─── Reset Password ───────────────────────────────────────────────────────────
export async function resetPassword(input: ResetPasswordInput) {
  const phone = normalizePhone(input.phone)
  const stored = await redis.get(redisKeys.otp(`reset:${phone}`))

  if (!stored || stored !== input.otp) {
    throw { statusCode: 400, message: 'Invalid or expired reset code' }
  }

  await redis.del(redisKeys.otp(`reset:${phone}`))
  const passwordHash = await bcrypt.hash(input.newPassword, 12)
  await prisma.user.update({ where: { phone }, data: { passwordHash } })

  return { message: 'Password reset successful. Please log in.' }
}

// ─── Logout ───────────────────────────────────────────────────────────────────
export async function logout(userId: string) {
  await redis.del(redisKeys.refreshToken(userId))
  return { message: 'Logged out successfully' }
}

// ─── Token helpers ────────────────────────────────────────────────────────────
async function issueTokens(fastify: any, user: any) {
  const payload = { userId: user.id, tenantId: user.tenantId, role: user.role }

  const accessToken = fastify.jwt.sign(payload, { expiresIn: process.env.JWT_EXPIRES_IN || '15m' })
  const refreshToken = fastify.jwt.sign(payload, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    secret: process.env.JWT_REFRESH_SECRET,
  })

  // Store refresh token in Redis
  await redis.setex(redisKeys.refreshToken(user.id), 30 * 24 * 60 * 60, refreshToken)

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
  }
}
