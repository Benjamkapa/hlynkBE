// import { Resend } from 'resend'

// // const resend = new Resend(process.env.RESEND_API_KEY!)
// const FROM = process.env.RESEND_FROM || 'noreply@hlynk.co.ke'

// export async function sendPasswordResetEmail(to: string, name: string, resetUrl: string) {
//   return resend.emails.send({
//     from: FROM,
//     to,
//     subject: 'Reset your hlynk password',
//     html: `
//       <div style="font-family: Inter, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
//         <div style="background: linear-gradient(135deg,#0B5ED7,#20C997); padding: 4px; border-radius: 12px;">
//           <div style="background:#fff; border-radius: 10px; padding: 32px;">
//             <h1 style="color:#0B5ED7; font-size:24px; margin:0 0 8px;">hlynk</h1>
//             <p style="color:#6c757d; margin:0 0 24px;">Password Reset</p>
//             <p>Hi ${name},</p>
//             <p>You requested a password reset. Click the button below to set a new password.</p>
//             <a href="${resetUrl}"
//                style="display:inline-block; background:#0B5ED7; color:#fff; padding:12px 28px;
//                       border-radius:8px; text-decoration:none; font-weight:600; margin:16px 0;">
//               Reset Password
//             </a>
//             <p style="color:#6c757d; font-size:13px; margin-top:24px;">
//               This link expires in 1 hour. If you did not request this, ignore this email.
//             </p>
//           </div>
//         </div>
//       </div>
//     `,
//   })
// }

// export async function sendWelcomeEmail(to: string, name: string, businessName: string) {
//   return resend.emails.send({
//     from: FROM,
//     to,
//     subject: `Welcome to hlynk, ${name}!`,
//     html: `
//       <div style="font-family: Inter, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
//         <h1 style="color:#0B5ED7;">Welcome to hlynk! 🎉</h1>
//         <p>Hi ${name}, your business <strong>${businessName}</strong> is now live.</p>
//         <p>Your 14-day free trial has started. Explore your dashboard and start adding your services.</p>
//         <p style="color:#6c757d; font-size:13px;">— The hlynk Team</p>
//       </div>
//     `,
//   })
// }

// export async function sendSalesReceiptEmail(to: string, businessName: string, receiptNumber: string, htmlContent: string) {
//   return resend.emails.send({
//     from: FROM,
//     to,
//     subject: `Receipt ${receiptNumber} from ${businessName}`,
//     html: htmlContent,
//   })
// }
