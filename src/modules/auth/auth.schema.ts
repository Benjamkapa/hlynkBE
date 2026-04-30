import { z } from 'zod'

export const registerSchema = z.object({
  businessName: z.string().min(2, 'Business name must be at least 2 characters'),
  ownerName: z.string().min(2, 'Owner name must be at least 2 characters'),
  phone: z
    .string()
    .regex(/^\+?254[17]\d{8}$|^0[17]\d{8}$/, 'Enter a valid Kenyan phone number'),
  email: z.string().email().optional().or(z.literal('')),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  category: z.string().min(1, 'Category is required'),
  county: z.string().min(1, 'County is required'),
  location: z.string().min(2, 'Location is required'),
  planName: z.enum(['TRIAL', 'BASIC']).default('TRIAL'),
})

export const verifyOtpSchema = z.object({
  phone: z.string(),
  otp: z.string().length(6, 'OTP must be 6 digits'),
})

export const loginSchema = z.object({
  phone: z.string().min(1, 'Phone is required'),
  password: z.string().min(1, 'Password is required'),
})

export const forgotPasswordSchema = z.object({
  phone: z.string().min(1, 'Phone is required'),
})

export const resetPasswordSchema = z.object({
  phone: z.string(),
  otp: z.string().length(6),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
})

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
})

export type RegisterInput = z.infer<typeof registerSchema>
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>

export const googleAuthSchema = z.object({
  credential: z.string().min(1, 'Google credential is required'),
  registration: z.object({
    businessName: z.string().min(2, 'Business name must be at least 2 characters'),
    ownerName: z.string().min(2, 'Owner name must be at least 2 characters'),
    phone: z.string().regex(/^\+?254[17]\d{8}$|^0[17]\d{8}$/, 'Enter a valid Kenyan phone number'),
    category: z.string().min(1, 'Category is required'),
    county: z.string().min(1, 'County is required'),
    location: z.string().min(2, 'Location is required'),
    planName: z.enum(['TRIAL', 'BASIC']).default('TRIAL'),
  }).optional(),
})

export type GoogleAuthInput = z.infer<typeof googleAuthSchema>
