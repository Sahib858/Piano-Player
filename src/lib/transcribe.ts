import '@tensorflow/tfjs'
import { BasicPitch, addPitchBendsToNoteEvents, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch'

export type TranscribedNote = { midi: number; time: number; duration: number; hand: 'L' | 'R' }

let cached: BasicPitch | null = null
async function getModel(): Promise<BasicPitch> {
  if (!cached) cached = new BasicPitch(`${import.meta.env.BASE_URL}model/model.json`)
  // warm up load errors early with a clear message
  try { await cached.model } catch {
    cached = null
    throw new Error('Could not load AI model (/model/model.json). Run dev server and keep public/model files.')
  }
  return cached
}

async function decodeToMono22050(file: Blob): Promise<Float32Array> {
  const ab = await file.arrayBuffer()
  const AC: typeof AudioContext | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) throw new Error('Web Audio not supported in this browser')
  const ctx = new AC()
  try {
    const decoded = await ctx.decodeAudioData(ab.slice(0))
    const dur = decoded.duration
    const targetLen = Math.min(Math.ceil(dur * 22050), 22050 * 600)
    const off = new OfflineAudioContext(1, targetLen, 22050)
    const src = off.createBufferSource()
    src.buffer = decoded
    src.connect(off.destination)
    src.start(0)
    const rendered = await off.startRendering()
    return rendered.getChannelData(0).slice(0)
  } finally {
    void ctx.close().catch(() => {})
  }
}

export async function transcribeAudioFile(
  file: Blob,
  onProgress: (p: number, stage: string) => void = () => {},
  opts: { onsetThresh?: number; frameThresh?: number; minNoteLen?: number } = {},
): Promise<TranscribedNote[]> {
  const { onsetThresh = 0.5, frameThresh = 0.3, minNoteLen = 5 } = opts
  onProgress(0.02, 'decoding + resampling to 22050Hz mono…')
  const mono = await decodeToMono22050(file)
  // Cap to first 8 minutes to keep mobile memory sane; note offset for full-length later
  const cap = 22050 * 60 * 8
  const clipped = mono.length > cap ? mono.slice(0, cap) : mono
  onProgress(0.08, 'loading Basic Pitch model…')
  const bp = await getModel()
  const frames: number[][] = []
  const onsets: number[][] = []
  const contours: number[][] = []
  await bp.evaluateModel(
    clipped,
    (f, o, c) => { frames.push(...f); onsets.push(...o); contours.push(...c) },
    (p: number) => onProgress(0.08 + p * 0.84, `transcribing… ${Math.round(p * 100)}%`),
  )
  onProgress(0.94, 'converting to notes…')
  const events = noteFramesToTime(
    addPitchBendsToNoteEvents(contours, outputToNotesPoly(frames, onsets, onsetThresh, frameThresh, minNoteLen)),
  )
  const notes: TranscribedNote[] = events
    .filter(e => e.pitchMidi >= 21 && e.pitchMidi <= 108 && e.durationSeconds > 0.08)
    .map(e => ({
      midi: Math.round(e.pitchMidi),
      time: Math.max(0, e.startTimeSeconds),
      duration: Math.min(4, Math.max(0.12, e.durationSeconds)),
      hand: (e.pitchMidi < 60 ? 'L' : 'R') as 'L' | 'R',
    }))
    .sort((a, b) => a.time - b.time)
  onProgress(1, `done — ${notes.length} notes`)
  return notes
}
