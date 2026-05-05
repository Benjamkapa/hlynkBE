import Minio from 'minio'
import { randomUUID } from 'crypto'

const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: parseInt(process.env.MINIO_PORT || '9000'),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY!,
  secretKey: process.env.MINIO_SECRET_KEY!,
})

const BUCKET = process.env.MINIO_BUCKET || 'hudumalynk'

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

  const url = minioClient.protocol + '//' + minioClient.host + ':' + minioClient.port + '/' + BUCKET + '/' + key
  return url
}

export async function deleteFile(url: string): Promise<void> {
  const key = decodeURIComponent(url.split('/').slice(-1)[0])
  await minioClient.removeObject(BUCKET, key)
}
