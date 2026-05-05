import Minio from 'minio'
import { randomUUID } from 'crypto'

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'localhost'
const MINIO_PORT = parseInt(process.env.MINIO_PORT || '9000')
const MINIO_USE_SSL = process.env.MINIO_USE_SSL === 'true'

const minioClient = new Minio.Client({
  endPoint: MINIO_ENDPOINT,
  port: MINIO_PORT,
  useSSL: MINIO_USE_SSL,
  accessKey: process.env.MINIO_ACCESS_KEY!,
  secretKey: process.env.MINIO_SECRET_KEY!,
})

const BUCKET = process.env.MINIO_BUCKET || 'hudumalynk'

// Base URL (SAFE — no protected props)
const BASE_URL = `${MINIO_USE_SSL ? 'https' : 'http'}://${MINIO_ENDPOINT}:${MINIO_PORT}`

export async function ensureBucket() {
  const exists = await minioClient.bucketExists(BUCKET)
  if (!exists) {
    await minioClient.makeBucket(BUCKET, 'us-east-1')
  }
}

export async function uploadFile(
  buffer: Buffer,
  mimeType: string,
  folder: string = 'providers',
): Promise<string> {
  await ensureBucket()

  const ext = mimeType.split('/')[1] || 'jpg'
  const key = `${folder}/${randomUUID()}.${ext}`

  await minioClient.putObject(BUCKET, key, buffer, buffer.length, {
    'Content-Type': mimeType,
    'Cache-Control': 'public, max-age=31536000',
  })

  // ✅ FIXED: no protected properties used
  const url = `${BASE_URL}/${BUCKET}/${key}`

  return url
}

export async function deleteFile(fileUrl: string): Promise<void> {
  try {
    // Extract key AFTER bucket
    const parts = fileUrl.split(`/${BUCKET}/`)
    const key = parts[1]

    if (!key) throw new Error('Invalid file URL')

    await minioClient.removeObject(BUCKET, key)
  } catch (error) {
    console.error('Error deleting file:', error)
  }
}