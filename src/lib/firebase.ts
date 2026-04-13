import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject, type FirebaseStorage } from 'firebase/storage'

function getFirebaseConfig() {
  return {
    apiKey: String(import.meta.env.VITE_FIREBASE_API_KEY ?? '').trim(),
    authDomain: String(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '').trim(),
    projectId: String(import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '').trim(),
    storageBucket: String(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? '').trim(),
    messagingSenderId: String(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '').trim(),
    appId: String(import.meta.env.VITE_FIREBASE_APP_ID ?? '').trim(),
  }
}

export function isFirebaseConfigured() {
  const config = getFirebaseConfig()
  return Boolean(config.apiKey && config.storageBucket)
}

let firebaseApp: FirebaseApp | null = null
let firebaseStorage: FirebaseStorage | null = null

function getStorage_() {
  if (firebaseStorage) return firebaseStorage

  if (!firebaseApp) {
    firebaseApp = initializeApp(getFirebaseConfig())
  }

  firebaseStorage = getStorage(firebaseApp)
  return firebaseStorage
}

async function resizeAndCompressImage(
  file: File,
  options: { maxDimension: number; quality: number } = { maxDimension: 1600, quality: 0.82 },
): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, options.maxDimension / Math.max(bitmap.width, bitmap.height))
  const targetWidth = Math.max(1, Math.round(bitmap.width * scale))
  const targetHeight = Math.max(1, Math.round(bitmap.height * scale))

  // OffscreenCanvas (지원되는 브라우저) → 일반 canvas 순서로 사용
  const anyWindow = window as unknown as { OffscreenCanvas?: typeof OffscreenCanvas }
  const OffscreenCanvasCtor = anyWindow.OffscreenCanvas

  if (OffscreenCanvasCtor) {
    const canvas = new OffscreenCanvasCtor(targetWidth, targetHeight)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('이미지 변환을 위한 캔버스를 만들 수 없어요.')
    }
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight)
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: options.quality })
    bitmap.close()
    return blob
  }

  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('이미지 변환을 위한 캔버스를 만들 수 없어요.')
  }
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight)
  bitmap.close()

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (!result) {
          reject(new Error('이미지 변환에 실패했어요.'))
          return
        }
        resolve(result)
      },
      'image/jpeg',
      options.quality,
    )
  })

  return blob
}

export async function uploadImage(file: File): Promise<string> {
  const storage = getStorage_()
  const timestamp = Date.now()
  const random = Math.random().toString(36).slice(2, 9)
  const storageRef = ref(storage, `memo-images/${timestamp}-${random}.jpg`)

  const optimized = await resizeAndCompressImage(file)
  await uploadBytes(storageRef, optimized, { contentType: 'image/jpeg' })
  return getDownloadURL(storageRef)
}

export async function deleteImage(url: string): Promise<void> {
  try {
    const storage = getStorage_()
    const urlObj = new URL(url)
    const pathPart = urlObj.pathname.split('/o/')[1]
    if (!pathPart) return
    const decodedPath = decodeURIComponent(pathPart.split('?')[0])
    const storageRef = ref(storage, decodedPath)
    await deleteObject(storageRef)
  } catch {
    /* ignore — 이미지가 없거나 권한 없을 때 무시 */
  }
}
