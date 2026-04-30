const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    await prisma.$executeRawUnsafe('ALTER TABLE Provider MODIFY photoUrl TEXT;');
    console.log('Provider photoUrl altered');
  } catch (e) {
    console.log('Provider error:', e.message);
  }
  try {
    await prisma.$executeRawUnsafe('ALTER TABLE User ADD COLUMN photoUrl TEXT;');
    console.log('User photoUrl added');
  } catch (e) {
    console.log('User error:', e.message);
  }
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
