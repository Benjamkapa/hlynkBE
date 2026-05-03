import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const identifier = process.argv[2]
  if (!identifier) {
    console.error('Please provide a phone number or email of the user to expire.')
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

  // Set trial end date to 5 seconds from now
  const expiryDate = new Date(Date.now() + 5000)

  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      status: 'TRIAL',
      trialEndDate: expiryDate,
      endDate: expiryDate
    }
  })

  console.log(`Success! Trial for "${user.tenant.businessName}" will expire in 5 seconds.`)
  console.log(`Target: ${identifier}`)
  console.log(`New Expiry: ${expiryDate.toISOString()}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
