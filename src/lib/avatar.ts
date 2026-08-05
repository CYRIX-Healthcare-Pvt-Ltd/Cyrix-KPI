/**
 * Turning a phone photo into a 5 KB face.
 *
 * The picture is only ever drawn at 40px or so, so it is squared off,
 * scaled to 128 and saved as a middling-quality JPEG. That is about
 * 5 KB of base64, which is small enough to live on the employee row and
 * arrive with the team list rather than costing a signed URL per face.
 *
 * On judging the picture: this asks the browser whether it can see a
 * face, and nothing else. No colour rules, no texture rules, no
 * guessing at sunglasses — the reporting manager can take a photo down
 * with a reason, so the only job here is catching somebody who has
 * plainly picked the wrong file.
 *
 * And it never refuses on that basis. Face detection is not available in
 * every browser, and no detector finds every face — turbans, beards,
 * head coverings, a three-quarter angle, poor light. A hard block would
 * lock real people out of their own profile to save a manager one
 * click, so a picture with no face found is a warning somebody can
 * override, and the manager remains the actual gate.
 */

/** Drawn small everywhere; 128 covers a 2× display at 64px. */
export const AVATAR_SIZE = 128
export const AVATAR_QUALITY = 0.7
/** Matches the constraint on employees.avatar. */
export const AVATAR_MAX_CHARS = 65536
/** Smaller than this and there is nothing to recognise. */
export const AVATAR_MIN_SOURCE = 64

/**
 * What the browser made of it.
 *
 * 'unknown' is not a failure — it is most browsers. Firefox and Safari
 * have no FaceDetector at all, and desktop Chrome keeps it behind a
 * flag; it is Chrome on Android, which is most of this team's phones,
 * where the answer actually arrives.
 */
export type FaceVerdict = 'face' | 'no-face' | 'unknown'

interface FaceDetectorLike {
  detect(source: CanvasImageSource): Promise<unknown[]>
}
type FaceDetectorCtor = new (opts?: {
  fastMode?: boolean
  maxDetectedFaces?: number
}) => FaceDetectorLike

/** Only 'no-face' is worth saying anything about. */
export const shouldWarnAboutFace = (v: FaceVerdict) => v === 'no-face'

export const faceWarning =
  'We could not see a face in that picture. Use a clear photo of yourself — ' +
  'or carry on if you are sure, and your manager will see it either way.'

/**
 * Asks the browser whether there is a face here.
 *
 * Every failure path returns 'unknown' on purpose. The constructor can
 * exist and then throw on use, the model can be unavailable, the call
 * can reject — and every one of those means "we do not know", which is
 * not the same as "there is no face" and must never be treated as it.
 */
export async function detectFace(source: CanvasImageSource): Promise<FaceVerdict> {
  const Ctor = (globalThis as { FaceDetector?: FaceDetectorCtor }).FaceDetector
  if (typeof Ctor !== 'function') return 'unknown'
  try {
    const detector = new Ctor({ fastMode: true, maxDetectedFaces: 3 })
    const faces = await detector.detect(source)
    return faces.length > 0 ? 'face' : 'no-face'
  } catch {
    return 'unknown'
  }
}

/** Reads a File into an <img> the canvas can draw. */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('That file could not be opened as an image.'))
    }
    img.src = url
  })
}

export interface AvatarResult {
  dataUrl: string
  face: FaceVerdict
  /** Bytes of the original, for the "we shrank it from X" line. */
  originalBytes: number
}

/**
 * File in, data URL out.
 *
 * Cropped from the centre before scaling, so a portrait photo becomes a
 * square face rather than a squashed one. Quality steps down if the
 * first pass comes out over the column's cap — which a busy 128px
 * photograph occasionally does at 0.7.
 *
 * The face check runs against the full-size image rather than the 128px
 * square: a detector has more to work with, and the crop may well have
 * taken the top of somebody's head off.
 */
export async function fileToAvatar(file: File): Promise<AvatarResult> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Pick an image file — a JPEG or a PNG.')
  }

  const img = await loadImage(file)
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  if (side === 0) throw new Error('That file could not be opened as an image.')
  if (img.naturalWidth < AVATAR_MIN_SOURCE || img.naturalHeight < AVATAR_MIN_SOURCE) {
    throw new Error(
      `That picture is too small — use one at least ${AVATAR_MIN_SOURCE} pixels across.`,
    )
  }

  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_SIZE
  canvas.height = AVATAR_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot resize the picture.')

  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(
    img,
    (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side,
    0, 0, AVATAR_SIZE, AVATAR_SIZE,
  )

  const face = await detectFace(img)

  let quality = AVATAR_QUALITY
  let dataUrl = canvas.toDataURL('image/jpeg', quality)
  while (dataUrl.length > AVATAR_MAX_CHARS && quality > 0.3) {
    quality -= 0.1
    dataUrl = canvas.toDataURL('image/jpeg', quality)
  }
  if (dataUrl.length > AVATAR_MAX_CHARS) {
    throw new Error('That picture will not compress small enough. Try a simpler one.')
  }

  return { dataUrl, face, originalBytes: file.size }
}

/** "1.8 MB" / "6 KB" — for telling somebody what just happened to their photo. */
export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** Roughly how many bytes a base64 data URL decodes to. */
export const dataUrlBytes = (dataUrl: string) =>
  Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75)
