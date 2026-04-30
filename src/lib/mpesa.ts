import axios from 'axios'

/**
 * M-Pesa Daraja API Integration
 * Handles STK Push (LipanaM-Pesa Online)
 */

const CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY || ''
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET || ''
const BUSINESS_SHORT_CODE = process.env.MPESA_SHORTCODE || '174379' // Sandbox default
const PASSKEY = process.env.MPESA_PASSKEY || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919'
const CALLBACK_URL = `${process.env.BACKEND_URL}/api/v1/payments/mpesa/callback`

async function getAccessToken() {
  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64')
  try {
    const res = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
      headers: { Authorization: `Basic ${auth}` }
    })
    return res.data.access_token
  } catch (error: any) {
    console.error('M-Pesa Auth Error:', error.response?.data || error.message)
    throw new Error('Failed to authenticate with M-Pesa')
  }
}

export async function initiateStkPush(params: { phone: string; amount: number; reference: string }) {
  const token = await getAccessToken()
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)
  const password = Buffer.from(`${BUSINESS_SHORT_CODE}${PASSKEY}${timestamp}`).toString('base64')

  const phone = params.phone.startsWith('0') ? '254' + params.phone.slice(1) : params.phone.replace('+', '')

  const body = {
    BusinessShortCode: BUSINESS_SHORT_CODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.round(params.amount),
    PartyA: phone,
    PartyB: BUSINESS_SHORT_CODE,
    PhoneNumber: phone,
    CallBackURL: CALLBACK_URL,
    AccountReference: params.reference,
    TransactionDesc: `Payment for ${params.reference}`
  }

  try {
    const res = await axios.post('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/query', body, {
      headers: { Authorization: `Bearer ${token}` }
    })
    return res.data
  } catch (error: any) {
    console.error('STK Push Error:', error.response?.data || error.message)
    // If it's sandbox and we don't have real keys, we might want to simulate success for dev
    if (process.env.NODE_ENV === 'development') {
      console.log('--- SIMULATING MPESA SUCCESS (DEV MODE) ---')
      return { MerchantRequestID: 'sim_123', CheckoutRequestID: 'sim_chk_123', ResponseDescription: 'Success' }
    }
    throw new Error(error.response?.data?.errorMessage || 'M-Pesa STK Push failed')
  }
}
