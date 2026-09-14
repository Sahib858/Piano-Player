// True stem separation via Demucs in the browser (lazy, opt-in).
// Model (~170MB) downloads once from Hugging Face CDN and is cached by the browser.
// Audio never leaves the device.

export type StemMode = 'karaoke' | 'nodrums' | 'instruments'

const MAX_SEC = 5 * 60

function floatTo16Wav(left: Float32Array, right: Float32Array, sampleRate: number): Blob {
  const n = Math.min(left.length, right.length)
  const buf = new ArrayBuffer(44 + n * 4)
  const v = new DataView(buf)
  const wstr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  wstr(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); wstr(8, 'WAVE'); wstr(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true)
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 4, true)
  v.setUint16(32, 4, true); v.setUint16(34, 16, true); wstr(36, 'data')
  v.setUint32(40, n * 4, true)
  let o = 44
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, left[i]))
    const r = Math.max(-1, Math.min(1, right[i]))
    v.setInt16(o, l < 0 ? l * 0x8000 : l * 0x7fff, true); o += 2
    v.setInt16(o, r < 0 ? r * 0x8000 : r * 0x7fff, true); o += 2
  }
  return new Blob([buf], { type: 'audio/wav' })
}

export async function separateStems(
  file: Blob,
  mode: StemMode,
  onProgress: (p: number, stage: string) => void = () => {},
): Promise<{ blob: Blob; url: string; seconds: number; capped: boolean }> {
  onProgress(0.02, 'loading separation engine…')
  const [{ DemucsProcessor, CONSTANTS }, ort] = await Promise.all([
    import('demucs-web'),
    import('onnxruntime-web'),
  ])
  try {
    const threads = navigator.hardwareConcurrency ?? 4
    ort.env.wasm.numThreads = Math.max(1, Math.min(threads, 4))
  } catch { /* ignore */ }
  onProgress(0.05, 'decoding to 44.1kHz stereo…')
  const ab = await file.arrayBuffer()
  const AC = window.AudioContext
  const ctx = new AC()
  let stereo: { left: Float32Array; right: Float32Array; capped: boolean; seconds: number }
  try {
    const decoded = await ctx.decodeAudioData(ab.slice(0))
    const seconds = Math.min(decoded.duration, MAX_SEC)
    const capped = decoded.duration > MAX_SEC
    const off = new OfflineAudioContext(2, Math.max(1, Math.ceil(seconds * 44100)), 44100)
    const src = off.createBufferSource()
    src.buffer = decoded
    src.connect(off.destination)
    src.start(0)
    const rendered = await off.startRendering()
    stereo = {
      left: rendered.getChannelData(0).slice(0),
      right: (rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : rendered.getChannelData(0)).slice(0),
      capped,
      seconds,
    }
  } finally {
    void ctx.close().catch(() => {})
  }
  onProgress(0.12, 'downloading Demucs model (~170MB, once, cached)…')
  const proc = new DemucsProcessor({
    ort,
    onProgress: (p: unknown) => {
      const q = typeof p === 'number' ? p : (p as { progress?: number })?.progress ?? 0
      onProgress(0.15 + Math.max(0, Math.min(1, q)) * 0.75, `separating stems… ${Math.round(Math.max(0, Math.min(1, q)) * 100)}%`)
    },
    onDownloadProgress: (loaded: number, total: number) => {
      if (total > 0) onProgress(0.12, `downloading model… ${Math.round((loaded / total) * 100)}%`)
    },
  })
  await proc.loadModel(CONSTANTS.DEFAULT_MODEL_URL)
  const result = await proc.separate(stereo.left, stereo.right)
  onProgress(0.92, 'mixing stems…')
  const { left: dl, right: dr } = result.drums
  const { left: bl, right: br } = result.bass
  const { left: ol, right: orr } = result.other
  const { left: vl, right: vr } = result.vocals
  const n = stereo.left.length
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    if (mode === 'karaoke') { L[i] = dl[i] + bl[i] + ol[i]; R[i] = dr[i] + br[i] + orr[i] }
    else if (mode === 'nodrums') { L[i] = vl[i] + bl[i] + ol[i]; R[i] = vr[i] + br[i] + orr[i] }
    else { L[i] = ol[i] + bl[i]; R[i] = orr[i] + br[i] }
  }
  const blob = floatTo16Wav(L, R, 44100)
  onProgress(1, 'stems ready')
  return { blob, url: URL.createObjectURL(blob), seconds: stereo.seconds, capped: stereo.capped }
}
