import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const logs = await prisma.activityLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10
  })
  
  const sales = await prisma.sale.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  })
  
  console.log("Recent Logs:", JSON.stringify(logs, null, 2))
  console.log("Recent Sales:", JSON.stringify(sales, null, 2))
}

main().catch(console.error).finally(() => prisma.$disconnect())
