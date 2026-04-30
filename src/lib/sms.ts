/**
 * Qorami SMS Adapter
 * Wraps the Qorami API. Swap this file out if the SMS provider changes —
 * the rest of the codebase stays identical.
 *
 * NOTE: Update QORAMI_BASE_URL and request shape once you have their API docs.
 */

interface SendSmsOptions {
  to: string    // E.164 format: +254712345678
  message: string
}

interface QoramiResponse {
  success: boolean
  messageId?: string
  error?: string
}

export async function sendSms({ to, message }: SendSmsOptions): Promise<QoramiResponse> {
  const apiKey = process.env.QORAMI_API_KEY!
  const senderId = process.env.QORAMI_SENDER_ID || 'hlynk'
  const baseUrl = process.env.QORAMI_BASE_URL!

  try {
    const response = await fetch(`${baseUrl}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        to,
        from: senderId,
        message,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('[SMS] Qorami error:', err)
      return { success: false, error: err }
    }

    const data = await response.json() as { id?: string }
    return { success: true, messageId: data.id }
  } catch (error) {
    console.error('[SMS] Network error:', error)
    return { success: false, error: 'SMS delivery failed' }
  }
}

export function formatOtpMessage(otp: string): string {
  return `Your hlynk verification code is: ${otp}. Valid for 10 minutes. Do not share this code.`
}

export function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export function formatReceiptSms(data: { businessName: string, receiptNumber: string, totalAmount: number, paymentMethod: string }): string {
  return `Thank you for your purchase from ${data.businessName}. Receipt ${data.receiptNumber} for KES ${data.totalAmount} paid via ${data.paymentMethod}.`
}
