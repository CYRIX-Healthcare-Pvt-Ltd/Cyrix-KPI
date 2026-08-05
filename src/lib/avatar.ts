/**
 * Turning a phone photo into a 5 KB face.
 *
 * The picture is only ever drawn at 40px or so, so it is squared off,
 * scaled to 128 and saved as a middling-quality JPEG. That is about
 * 5 KB of base64, which is small enough to live on the employee row and
 * arrive with the team list rather than costing a signed URL per face.
 *
 * On what this checks, and what it deliberately does not:
 *
 * It rejects things that are plainly not photographs — a solid colour, a
 * logo, a screenshot of text, something too small to be a face. Those
 * are cheap to spot and nobody argues with the result.
 *
 * It does NOT try to decide whether the picture shows a person, or
 * whether they are wearing sunglasses. Face detection in a browser means
 * either a multi-megabyte model on a mobile connection, or the native
 * FaceDetector API, which most browsers here do not have. And every
 * cheap trick for "are the eyes covered" comes down to how dark a region
 * is, which produces different answers for different skin and hair
 * colours. A check that fails more often for some people than others has
 * no place in an appraisal system, so that judgement belongs to the
 * reporting manager, who is looking at these faces anyway.
 */

/** Drawn small everywhere; 128 covers a 2× display at 64px. */
export const AVATAR_SIZE = 128
export const AVATAR_QUALITY = 0.7
/** Matches the constraint on employees.avatar. */
export const AVATAR_MAX_CHARS = 65536

export interface ImageStats {
  width: number
  height: number
  /** Distinct quantised colours found. A logo has very few. */
  colours: number
  /** Mean absolute difference between neighbouring pixels, 0–255. */
  detail: number
}

export interface AvatarCheck {
  ok: boolean
  problem?: string
}

/**
 * Is this plausibly a photograph?
 *
 * Two signals, both about texture rather than content. A photograph of
 * anything has thousands of slightly different colours and a lot of
 * small local variation. A logo, a solid colour, a screenshot of a
 * document or a blank frame has neither.
 *
 * The thresholds are deliberately loose. This is here to catch somebody
 * uploading their company logo, not to grade photography — and a check
 * that rejects a real photo is worse than one that lets a bad photo
 * through, because the manager can remove a bad photo and nobody can
 * argue with a refusal.
 */
export function checkImageStats(s: ImageStats): AvatarCheck {
  if (s.width < 64 || s.height < 64) {
    return { ok: false, problem: 'That picture is too small — use one at least 64 pixels across.' }
  }
  // Eight, not twenty-four. Quantising to 5 bits a channel leaves a
  // greyscale photograph a maximum of 32 distinct values and often far
  // fewer, so a higher bar here refuses black-and-white portraits — which
  // the test below caught, and which is exactly the kind of refusal
  // nobody could have argued with because it would have looked like a
  // rule rather than a mistake.
  if (s.colours < 8) {
    return { ok: false, problem: 'That looks like a graphic or a solid colour rather than a photo.' }
  }
  // Texture carries the weight instead. A flat two-tone logo has only
  // its one edge; any photograph has variation everywhere.
  if (s.detail < 4) {
    return { ok: false, problem: 'That picture is almost blank. Use a clear photo of your face.' }
  }
  return { ok: true }
}

/**
 * Colour count and local detail, from raw RGBA pixels.
 *
 * Colours are quantised to 5 bits a channel before counting, so camera
 * noise across a plain wall does not read as thousands of colours. The
 * detail figure is the mean absolute luma difference to the pixel on the
 * right, which is a cheap stand-in for "how much is going on here".
 */
export function statsFromPixels(
  data: Uint8ClampedArray, width: number, height: number,
): ImageStats {
  const seen = new Set<number>()
  let diff = 0
  let n = 0

  const luma = (i: number) =>
    0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      seen.add(
        ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3),
      )
      if (x + 1 < width) {
        diff += Math.abs(luma(i) - luma(i + 4))
        n++
      }
    }
  }

  return {
    width,
    height,
    colours: seen.size,
    detail: n === 0 ? 0 : diff / n,
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
  stats: ImageStats
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
 */
export async function fileToAvatar(file: File): Promise<AvatarResult> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Pick an image file — a JPEG or a PNG.')
  }

  const img = await loadImage(file)
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  if (side === 0) throw new Error('That file could not be opened as an image.')

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

  const pixels = ctx.getImageData(0, 0, AVATAR_SIZE, AVATAR_SIZE)
  const stats = {
    ...statsFromPixels(pixels.data, AVATAR_SIZE, AVATAR_SIZE),
    // Report the original dimensions: "too small" is about what they
    // picked, not about the square this just drew.
    width: img.naturalWidth,
    height: img.naturalHeight,
  }

  const check = checkImageStats(stats)
  if (!check.ok) throw new Error(check.problem)

  let quality = AVATAR_QUALITY
  let dataUrl = canvas.toDataURL('image/jpeg', quality)
  while (dataUrl.length > AVATAR_MAX_CHARS && quality > 0.3) {
    quality -= 0.1
    dataUrl = canvas.toDataURL('image/jpeg', quality)
  }
  if (dataUrl.length > AVATAR_MAX_CHARS) {
    throw new Error('That picture will not compress small enough. Try a simpler one.')
  }

  return { dataUrl, stats, originalBytes: file.size }
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
