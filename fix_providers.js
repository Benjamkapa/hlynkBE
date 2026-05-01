const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const providers = await prisma.provider.findMany();
  for (const p of providers) {
    const user = await prisma.user.findUnique({ where: { id: p.userId } });
    if (!user) {
      console.log('Orphaned provider found!', p.id, p.userId);
      await prisma.provider.delete({ where: { id: p.id } });
      console.log('Deleted orphaned provider');
    }
  }
}
run().finally(() => prisma.$disconnect());
