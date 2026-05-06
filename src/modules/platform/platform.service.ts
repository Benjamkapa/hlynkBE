import { prisma } from '../../lib/prisma'

const PLATFORM_REVIEWS_KEY = 'platform_reviews'

export interface PlatformReviewRecord {
  id: string
  userId: string
  tenantId: string
  name: string
  businessName: string
  role: string
  rating: number
  comment: string
  createdAt: string
  updatedAt: string
}

async function readStoredReviews(): Promise<PlatformReviewRecord[]> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: PLATFORM_REVIEWS_KEY }
  })

  if (!setting?.value) return []

  try {
    const parsed = JSON.parse(setting.value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeStoredReviews(reviews: PlatformReviewRecord[]) {
  await prisma.systemSetting.upsert({
    where: { key: PLATFORM_REVIEWS_KEY },
    update: {
      value: JSON.stringify(reviews),
      dataType: 'JSON'
    },
    create: {
      key: PLATFORM_REVIEWS_KEY,
      value: JSON.stringify(reviews),
      dataType: 'JSON'
    }
  })
}

export async function getPlatformReviews(params: { limit?: number } = {}) {
  const reviews = await readStoredReviews()
  const providerReviews = reviews.filter((review) => review.role === 'PROVIDER')
  const sorted = [...providerReviews].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  const limit = Number(params.limit) || 12
  const items = sorted.slice(0, limit)
  const averageRating = items.length > 0
    ? Number((items.reduce((sum, review) => sum + review.rating, 0) / items.length).toFixed(1))
    : 0

  return {
    items,
    summary: {
      averageRating,
      totalReviews: providerReviews.length
    }
  }
}

export async function getMyPlatformReview(userId: string) {
  const reviews = await readStoredReviews()
  return reviews.find((review) => review.userId === userId) || null
}

export async function submitPlatformReview(userId: string, tenantId: string, data: { rating: number; comment: string }) {
  const [user, tenant] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        role: true,
        tenantId: true
      }
    }),
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        businessName: true
      }
    })
  ])

  if (!user || !tenant) {
    throw { statusCode: 404, message: 'Unable to locate account for review submission.' }
  }

  if (user.role !== 'PROVIDER') {
    throw { statusCode: 403, message: 'Only provider accounts can publish public platform reviews.' }
  }

  const reviews = await readStoredReviews()
  const now = new Date().toISOString()
  const existing = reviews.find((review) => review.userId === userId)

  const nextReview: PlatformReviewRecord = {
    id: existing?.id || `review_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    userId,
    tenantId,
    name: user.name,
    businessName: tenant.businessName,
    role: user.role,
    rating: data.rating,
    comment: data.comment.trim(),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  }

  const nextReviews = existing
    ? reviews.map((review) => review.userId === userId ? nextReview : review)
    : [nextReview, ...reviews]

  await writeStoredReviews(nextReviews)
  return nextReview
}
