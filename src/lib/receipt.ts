export interface ReceiptLineItem {
  name: string
  quantity: number
  price: number
}

export interface ReceiptTemplateInput {
  businessName: string
  receiptNumber: string
  date: Date
  customerName?: string | null
  customerPhone?: string | null
  customerEmail?: string | null
  paymentMethod: string
  items: ReceiptLineItem[]
  totalAmount: number
  logoUrl?: string
}

export function buildReceiptHtml(input: ReceiptTemplateInput) {
  const lines = input.items
    .map((item) => {
      const lineTotal = item.quantity * item.price
      return `
        <tr>
          <td style="padding:8px 0; font-size:13px; color:#111827;">${escapeHtml(item.name)}</td>
          <td style="padding:8px 0; font-size:13px; color:#374151; text-align:center;">${item.quantity}</td>
          <td style="padding:8px 0; font-size:13px; color:#374151; text-align:right;">KES ${item.price.toLocaleString()}</td>
          <td style="padding:8px 0; font-size:13px; color:#111827; text-align:right; font-weight:700;">KES ${lineTotal.toLocaleString()}</td>
        </tr>
      `
    })
    .join('')

  const logoSection = input.logoUrl
    ? `<img src="${input.logoUrl}" alt="Business logo" style="height:48px; max-width:140px; object-fit:contain;" />`
    : `<div style="height:48px; width:140px; display:flex; align-items:center; justify-content:center; border:1px dashed #cbd5e1; border-radius:8px; font-size:11px; color:#64748b;">HL Logo</div>`

  return `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 760px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:12px; overflow:hidden;">
      <div style="padding:24px; border-bottom:1px solid #f1f5f9; display:flex; justify-content:space-between; align-items:center;">
        <div>${logoSection}</div>
        <div style="text-align:right;">
          <div style="font-size:11px; letter-spacing:0.12em; color:#64748b; font-weight:800;">SALES RECEIPT</div>
          <h2 style="margin:6px 0 0; font-size:24px; color:#0f172a;">${escapeHtml(input.businessName)}</h2>
        </div>
      </div>
      <div style="padding:24px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:18px;">
          <div>
            <div style="font-size:11px; color:#64748b; font-weight:700; text-transform:uppercase;">Receipt No</div>
            <div style="font-size:14px; color:#111827; font-weight:800;">${escapeHtml(input.receiptNumber)}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:11px; color:#64748b; font-weight:700; text-transform:uppercase;">Date</div>
            <div style="font-size:14px; color:#111827; font-weight:700;">${input.date.toLocaleString()}</div>
          </div>
        </div>
        <div style="margin-bottom:18px; padding:14px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px;">
          <div style="font-size:12px; color:#334155; margin-bottom:4px;"><strong>Customer:</strong> ${escapeHtml(input.customerName || 'Walk-in Customer')}</div>
          <div style="font-size:12px; color:#334155; margin-bottom:4px;"><strong>Phone:</strong> ${escapeHtml(input.customerPhone || 'N/A')}</div>
          <div style="font-size:12px; color:#334155;"><strong>Email:</strong> ${escapeHtml(input.customerEmail || 'N/A')}</div>
        </div>
        <table style="width:100%; border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid #e2e8f0;">
              <th style="padding:8px 0; text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:0.08em; color:#64748b;">Item</th>
              <th style="padding:8px 0; text-align:center; font-size:11px; text-transform:uppercase; letter-spacing:0.08em; color:#64748b;">Qty</th>
              <th style="padding:8px 0; text-align:right; font-size:11px; text-transform:uppercase; letter-spacing:0.08em; color:#64748b;">Unit</th>
              <th style="padding:8px 0; text-align:right; font-size:11px; text-transform:uppercase; letter-spacing:0.08em; color:#64748b;">Total</th>
            </tr>
          </thead>
          <tbody>${lines}</tbody>
        </table>
        <div style="margin-top:20px; display:flex; justify-content:flex-end;">
          <div style="width:260px;">
            <div style="display:flex; justify-content:space-between; font-size:13px; color:#334155; margin-bottom:6px;">
              <span>Payment Method</span>
              <strong>${escapeHtml(input.paymentMethod)}</strong>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:18px; color:#0f172a; border-top:1px solid #e2e8f0; padding-top:8px;">
              <span style="font-weight:800;">Grand Total</span>
              <span style="font-weight:900;">KES ${input.totalAmount.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
