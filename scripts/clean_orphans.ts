import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function cleanOrphans() {
  const providers = await prisma.provider.findMany()
  const users = await prisma.user.findMany()
  const userIds = new Set(users.map(u => u.id))
  
  const orphanedProviders = providers.filter(p => !userIds.has(p.userId))
  
  if (orphanedProviders.length > 0) {
    console.log(`Found ${orphanedProviders.length} orphaned providers. Deleting...`)
    for (const p of orphanedProviders) {
      await prisma.provider.delete({ where: { id: p.id } })
    }
    console.log('Cleanup complete.')
  } else {
    console.log('No orphaned providers found.')
  }
}

cleanOrphans().catch(console.error).finally(() => prisma.$disconnect())
