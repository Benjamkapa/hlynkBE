import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const identifier = process.argv[2]
  if (!identifier) {
    console.error('Please provide a phone number or email of the user to restore.')
    process.exit(1)
  }

  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { email: identifier },
        { phone: identifier }
      ]
    },
    include: { tenant: true }
  })

  if (!user) {
    console.error(`User with identifier ${identifier} not found.`)
    process.exit(1)
  }

  const tenantId = user.tenantId
  const subscription = await prisma.subscription.findUnique({
    where: { tenantId }
  })

  if (!subscription) {
    console.error(`No subscription found for tenant ${user.tenant.businessName}.`)
    process.exit(1)
  }

  // Restore to active trial for 14 days
  const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)

  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      status: 'TRIAL',
      trialEndDate: futureDate,
      endDate: futureDate
    }
  })

  console.log(`Success! Subscription for "${user.tenant.businessName}" has been restored to TRIAL.`)
  console.log(`Target: ${identifier}`)
  console.log(`New Expiry: ${futureDate.toISOString()}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
