/// <reference types="node" />
import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  // Use environment variables or fallback for safety
  const email = process.env.ADMIN_EMAIL 
  const phone = process.env.ADMIN_PHONE
  const password = process.env.ADMIN_PASSWORD 
  const name = "Hlynk System Administrator"

  if (!email || !phone || !password) {
    console.error('❌ Missing environment variables! Please check your .env file for ADMIN_EMAIL, ADMIN_PHONE, and ADMIN_PASSWORD.')
    process.exit(1)
  }

  console.log('🚀 Creating Super Admin...')

  const passwordHash = await bcrypt.hash(password, 12)

  // 1. Create or get System Tenant
  let tenant = await prisma.tenant.findUnique({ where: { slug: 'system-admin' } })
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        slug: 'system-admin',
        businessName: 'HudumaLynk Systems',
      }
    })
    console.log('🏢 System Tenant created.')
  }

  // 2. Create or promote User to SUPER_ADMIN
  const admin = await prisma.user.upsert({
    where: { phone },
    update: { 
      role: 'SUPER_ADMIN',
      email // Ensure email is set if updating
    },
    create: {
      tenantId: tenant.id,
      name,
      phone,
      email,
      passwordHash,
      role: 'SUPER_ADMIN',
      phoneVerified: true
    }
  })

  // 3. Ensure a subscription exists for the admin tenant (optional but good for safety)
  await prisma.subscription.upsert({
    where: { tenantId: tenant.id },
    update: { status: 'ACTIVE', planName: 'PRO' },
    create: {
      tenantId: tenant.id,
      planName: 'PRO',
      status: 'ACTIVE',
      isTrial: false,
      trialEndDate: new Date(),
      endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 year
    }
  })

  console.log(`\n✅ Super Admin ready!`)
  console.log(`-----------------------------------`)
  console.log(`📱 Identifier: ${phone} OR ${email}`)
  console.log(`🔑 Password:   ${password}`)
  console.log(`-----------------------------------\n`)
}

main()
  .catch(e => {
    console.error('❌ Error creating Super Admin:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
