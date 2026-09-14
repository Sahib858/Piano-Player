declare module 'demucs-web' {
  export const CONSTANTS: {
    SAMPLE_RATE: number
    DEFAULT_MODEL_URL: string
    TRACKS: string[]
    TRAINING_SAMPLES: number
  }
  export class DemucsProcessor {
    constructor(opts: {
      ort: unknown
      sessionOptions?: Record<string, unknown>
      onProgress?: (p: number | { progress?: number }) => void
      onLog?: (phase: string, msg: string) => void
      onDownloadProgress?: (loaded: number, total: number) => void
    })
    loadModel(pathOrBuffer?: string | ArrayBuffer): Promise<void>
    separate(left: Float32Array, right: Float32Array): Promise<Record<string, { left: Float32Array; right: Float32Array }>>
  }
  export function fft(a: unknown, b: unknown, c: unknown, d: unknown): void
}
