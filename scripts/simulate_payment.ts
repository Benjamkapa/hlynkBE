import { PrismaClient } from '@prisma/client'
import axios from 'axios'

const prisma = new PrismaClient()

async function main() {
  const reference = process.argv[2]
  if (!reference) {
    console.error('Please provide the payment reference (e.g. SUB-REN-XXXXXX)')
    process.exit(1)
  }

  const payment = await prisma.payment.findFirst({
    where: { reference },
    orderBy: { createdAt: 'desc' }
  })

  if (!payment) {
    console.error(`Payment record with reference ${reference} not found.`)
    process.exit(1)
  }

  console.log(`Found pending payment for ${payment.plan} (KES ${payment.amount})`)
  console.log('Sending simulated M-Pesa SUCCESS callback...')

  const callbackBody = {
    Body: {
      stkCallback: {
        MerchantRequestID: "sim_" + Math.random().toString(36).slice(2),
        CheckoutRequestID: payment.mpesaReceipt || "sim_chk_" + Math.random().toString(36).slice(2),
        ResultCode: 0,
        ResultDesc: "The service request is processed successfully.",
        CallbackMetadata: {
          Item: [
            { Name: "Amount", Value: Number(payment.amount) },
            { Name: "MpesaReceiptNumber", Value: "SIM" + Math.random().toString(36).toUpperCase().slice(2, 10) },
            { Name: "TransactionDate", Value: 20240101120000 },
            { Name: "PhoneNumber", Value: 254712345678 }
          ]
        }
      }
    }
  }

  try {
    const res = await axios.post(`${process.env.BACKEND_URL}/api/v1/payments/mpesa/callback`, callbackBody)
    console.log('\x1b[32m%s\x1b[0m', 'Simulation Response:', JSON.stringify(res.data))
    console.log('The account should now be credited! Refresh the portal to see the ACTIVE status.')
  } catch (error: any) {
    console.error('Simulation Failed:', error.response?.data || error.message)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
