import { PrismaClient, PlanName, SubscriptionStatus } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const args = process.argv.slice(2)
  const identifier = args.find(a => !a.startsWith('--'))
  
  if (!identifier) {
    console.log('Usage: npx ts-node scripts/manage_subscription.ts <phone_or_email> [options]')
    console.log('Options:')
    console.log('  --plan <STARTER|GROWTH|PRO>  Change the subscription plan')
    console.log('  --extend <DAYS>              Add days to the trial/subscription')
    console.log('  --status <STATUS>            Change status (TRIAL, ACTIVE, EXPIRED, SUSPENDED)')
    console.log('  --expire                     Force expire in 5 seconds')
    console.log('  --reset                      Reset to a fresh 14-day STARTER trial')
    process.exit(1)
  }

  const user = await prisma.user.findFirst({
    where: { OR: [{ email: identifier }, { phone: identifier }] },
    include: { tenant: { include: { subscription: true } } }
  })

  if (!user || !user.tenant.subscription) {
    console.error(`User or subscription not found for: ${identifier}`)
    process.exit(1)
  }

  const sub = user.tenant.subscription
  let data: any = {}

  // 1. Plan Change
  const planArg = args.indexOf('--plan')
  if (planArg !== -1) {
    const plan = args[planArg + 1] as PlanName
    if (!['STARTER', 'GROWTH', 'PRO'].includes(plan)) {
      console.error('Invalid plan. Use STARTER, GROWTH, or PRO.')
      process.exit(1)
    }
    data.planName = plan
    console.log(`- Changing plan to: ${plan}`)
  }

  // 2. Status Change
  const statusArg = args.indexOf('--status')
  if (statusArg !== -1) {
    const status = args[statusArg + 1] as SubscriptionStatus
    data.status = status
    console.log(`- Changing status to: ${status}`)
  }

  // 3. Extend
  const extendArg = args.indexOf('--extend')
  if (extendArg !== -1) {
    const days = parseInt(args[extendArg + 1])
    if (isNaN(days)) {
      console.error('Invalid days for extension.')
      process.exit(1)
    }
    const currentEnd = sub.endDate || new Date()
    const newEnd = new Date(currentEnd.getTime() + days * 24 * 60 * 60 * 1000)
    data.trialEndDate = newEnd
    data.endDate = newEnd
    console.log(`- Extending subscription by ${days} days until ${newEnd.toISOString()}`)
  }

  // 4. Force Expire
  if (args.includes('--expire')) {
    const expiryDate = new Date(Date.now() + 20000)
    data.status = 'TRIAL'
    data.trialEndDate = expiryDate
    data.endDate = expiryDate
    console.log(`- Forcing expiration in 20 seconds...`)
  }

  // 5. Reset
  if (args.includes('--reset')) {
    const trialDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    data.status = 'TRIAL'
    data.planName = 'STARTER'
    data.isTrial = true
    data.trialEndDate = trialDate
    data.endDate = trialDate
    console.log(`- Resetting to fresh 14-day trial.`)
  }

  if (Object.keys(data).length === 0) {
    console.log('No changes specified. Current status:')
    console.log(JSON.stringify(sub, null, 2))
    process.exit(0)
  }

  const updated = await prisma.subscription.update({
    where: { id: sub.id },
    data
  })

  console.log('\x1b[32m%s\x1b[0m', 'Update Successful!')
  console.log('New Subscription State:')
  console.table({
    Business: user.tenant.businessName,
    Plan: updated.planName,
    Status: updated.status,
    Expiry: updated.endDate?.toISOString() || 'N/A'
  })
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
