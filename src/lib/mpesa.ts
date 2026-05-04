import axios from 'axios'
import { prisma } from './prisma'
import { decrypt } from './encryption'
import { redis } from './redis'

/**
 * M-Pesa Daraja API Integration
 * Supports both Sandbox and Production environments
 */

const MPESA_ENV = process.env.MPESA_ENV || 'sandbox'
const BASE_URL = MPESA_ENV === 'production' 
  ? 'https://api.safaricom.co.ke' 
  : 'https://sandbox.safaricom.co.ke'

const CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY || ''
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET || ''
const BUSINESS_SHORT_CODE = process.env.MPESA_SHORTCODE || '174379'
const PASSKEY = process.env.MPESA_PASSKEY || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919'

// CRITICAL: CALLBACK_URL must be a PUBLICLY accessible URL (not localhost)
// Use ngrok for local testing: e.g. https://xyz.ngrok-free.app
const CALLBACK_URL = `${process.env.BACKEND_URL}/api/v1/payments/mpesa/callback`
const VENDOR_CALLBACK_URL = `${process.env.BACKEND_URL}/api/v1/sales/mpesa-callback`

async function getAccessToken() {
  const cacheKey = 'mpesa:global_token'
  const cached = await redis.get(cacheKey)
  if (cached) return cached

  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64')
  try {
    const res = await axios.get(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${auth}` }
    })
    const token = res.data.access_token
    await redis.setex(cacheKey, 3300, token)
    return token
  } catch (error: any) {
    console.error('[MPESA] Auth Error:', error.response?.data || error.message)
    throw new Error('Failed to authenticate with M-Pesa. Check your Consumer Key/Secret.')
  }
}

export async function initiateStkPush(params: { phone: string; amount: number; reference: string }) {
  // Only throw if in production. In sandbox/dev, we can fall back to simulation.
  if (MPESA_ENV === 'production' && (!CONSUMER_KEY || !CONSUMER_SECRET)) {
    throw new Error('M-Pesa PRODUCTION credentials missing in .env (MPESA_CONSUMER_KEY / MPESA_CONSUMER_SECRET)')
  }

  // If we are in development/sandbox and keys are missing, simulate immediately
  if (process.env.NODE_ENV === 'development' && MPESA_ENV === 'sandbox' && (!CONSUMER_KEY || CONSUMER_KEY.includes('placeholder') || !CONSUMER_KEY)) {
    console.warn('[MPESA] SIMULATING SUCCESS FOR DEVELOPMENT MODE (NO KEYS)')
    return { MerchantRequestID: 'sim_123', CheckoutRequestID: 'sim_chk_123', ResponseDescription: 'Success' }
  }

  const token = await getAccessToken()
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)
  const password = Buffer.from(`${BUSINESS_SHORT_CODE}${PASSKEY}${timestamp}`).toString('base64')

  // Normalize phone to 254XXXXXXXXX
  let phone = params.phone.replace(/[^0-9]/g, '')
  if (phone.startsWith('0')) phone = '254' + phone.slice(1)
  if (phone.startsWith('7') || phone.startsWith('1')) phone = '254' + phone

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

  console.log(`[MPESA] Initiating STK Push to ${phone} for ${params.amount} KES...`)

  try {
    const res = await axios.post(`${BASE_URL}/mpesa/stkpush/v1/processrequest`, body, {
      headers: { Authorization: `Bearer ${token}` }
    })
    
    console.log('[MPESA] STK Push Response:', res.data)
    return res.data
  } catch (error: any) {
    const errorData = error.response?.data
    console.error('[MPESA] STK Push Error:', errorData || error.message)

    // Fallback for development if no real keys are present
    if (process.env.NODE_ENV === 'development' && MPESA_ENV === 'sandbox' && (!CONSUMER_KEY || CONSUMER_KEY.includes('placeholder'))) {
       console.warn('[MPESA] SIMULATING SUCCESS FOR DEVELOPMENT MODE')
       return { MerchantRequestID: 'sim_123', CheckoutRequestID: 'sim_chk_123', ResponseDescription: 'Success' }
    }

    throw new Error(errorData?.errorMessage || 'M-Pesa STK Push failed. Check your Shortcode/Passkey.')
  }
}

async function getVendorAccessToken(tenantId: string, keys: any) {
  const cacheKey = `mpesa:vendor_token:${tenantId}`
  const cached = await redis.get(cacheKey)
  if (cached) return cached

  const consumerKey = keys.consumerKey.includes(':') ? decrypt(keys.consumerKey) : keys.consumerKey
  const consumerSecret = keys.consumerSecret.includes(':') ? decrypt(keys.consumerSecret) : keys.consumerSecret

  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')
  const baseUrl = keys.env === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke'
  try {
    const res = await axios.get(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${auth}` }
    })
    const token = res.data.access_token
    await redis.setex(cacheKey, 3300, token)
    return token
  } catch (error: any) {
    console.error('[MPESA VENDOR] Auth Error:', error.response?.data || error.message)
    throw new Error('Failed to authenticate with Vendor M-Pesa. Check Consumer Key/Secret.')
  }
}

export async function initiateVendorStkPush(tenantId: string, params: { phone: string; amount: number; reference: string }) {
  const provider = await prisma.provider.findFirst({ where: { tenantId } })
  if (!provider) throw new Error('Provider not found')

  const opsSettings: any = provider.operationalSettings || {}
  const mpesaSettings = opsSettings.mpesa

  if (!mpesaSettings || !mpesaSettings.consumerKey || !mpesaSettings.consumerSecret || !mpesaSettings.shortcode || !mpesaSettings.passkey) {
    throw new Error('M-Pesa API credentials are not fully configured for this vendor.')
  }

  const token = await getVendorAccessToken(tenantId, mpesaSettings)
  const baseUrl = mpesaSettings.env === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke'
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)
  const passkey = mpesaSettings.passkey.includes(':') ? decrypt(mpesaSettings.passkey) : mpesaSettings.passkey
  const password = Buffer.from(`${mpesaSettings.shortcode}${passkey}${timestamp}`).toString('base64')

  let phone = params.phone.replace(/[^0-9]/g, '')
  if (phone.startsWith('0')) phone = '254' + phone.slice(1)
  if (phone.startsWith('7') || phone.startsWith('1')) phone = '254' + phone

  const body = {
    BusinessShortCode: mpesaSettings.shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.round(params.amount),
    PartyA: phone,
    PartyB: mpesaSettings.shortcode,
    PhoneNumber: phone,
    CallBackURL: VENDOR_CALLBACK_URL,
    AccountReference: params.reference,
    TransactionDesc: `Payment for ${params.reference}`
  }

  console.log(`[MPESA VENDOR] Initiating STK Push to ${phone} for ${params.amount} KES...`)

  try {
    const res = await axios.post(`${baseUrl}/mpesa/stkpush/v1/processrequest`, body, {
      headers: { Authorization: `Bearer ${token}` }
    })
    console.log('[MPESA VENDOR] STK Push Response:', res.data)
    return res.data
  } catch (error: any) {
    const errorData = error.response?.data
    console.error('[MPESA VENDOR] STK Push Error:', errorData || error.message)
    throw new Error(errorData?.errorMessage || 'Vendor M-Pesa STK Push failed. Check credentials.')
  }
}
