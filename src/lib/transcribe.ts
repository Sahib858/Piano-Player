import '@tensorflow/tfjs'
import { BasicPitch, addPitchBendsToNoteEvents, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch'

export type TranscribedNote = { midi: number; time: number; duration: number; hand: 'L' | 'R'; vel: number }

export type TxOpts = {
  onsetThresh?: number
  frameThresh?: number
  minNoteLen?: number
  melodiaTrick?: boolean
  normalize?: boolean
  minDurationSec?: number
  mergeGapSec?: number
  melodyFocus?: boolean
  leadLow?: number
  leadHigh?: number
  maxPoly?: number
  percGate?: boolean
  bandpass?: boolean
}

export const PRESETS: Record<string, Required<Pick<TxOpts, 'onsetThresh' | 'frameThresh' | 'minNoteLen' | 'melodiaTrick'>>> = {
  piano: { onsetThresh: 0.5, frameThresh: 0.3, minNoteLen: 5, melodiaTrick: true },
  dense: { onsetThresh: 0.68, frameThresh: 0.42, minNoteLen: 9, melodiaTrick: true },
  soft: { onsetThresh: 0.32, frameThresh: 0.24, minNoteLen: 3, melodiaTrick: true },
}

let cached: BasicPitch | null = null
async function getModel(): Promise<BasicPitch> {
  if (!cached) cached = new BasicPitch(`${import.meta.env.BASE_URL}model/model.json`)
  try { await cached.model } catch {
    cached = null
    throw new Error('Could not load AI model (/model/model.json). Run dev server and keep public/model files.')
  }
  return cached
}

async function decodeToMono22050(file: Blob, bandpass: boolean): Promise<{ mono: Float32Array; clipped: boolean }> {
  const ab = await file.arrayBuffer()
  const AC: typeof AudioContext | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) throw new Error('Web Audio not supported in this browser')
  const ctx = new AC()
  try {
    const decoded = await ctx.decodeAudioData(ab.slice(0))
    const targetLen = Math.min(Math.ceil(decoded.duration * 22050), 22050 * 60 * 8)
    const clipped = decoded.duration * 22050 > targetLen
    const off = new OfflineAudioContext(1, Math.max(1, targetLen), 22050)
    const src = off.createBufferSource()
    src.buffer = decoded
    if (bandpass) {
      // Cut kick rumble + cymbal hash, keep harmonium/vocal lead band.
      const hp = off.createBiquadFilter()
      hp.type = 'highpass'; hp.frequency.value = 85; hp.Q.value = 0.7
      const lp = off.createBiquadFilter()
      lp.type = 'lowpass'; lp.frequency.value = 5200; lp.Q.value = 0.5
      src.connect(hp); hp.connect(lp); lp.connect(off.destination)
    } else {
      src.connect(off.destination)
    }
    src.start(0)
    const rendered = await off.startRendering()
    return { mono: rendered.getChannelData(0).slice(0), clipped }
  } finally {
    void ctx.close().catch(() => {})
  }
}

function peakNormalize(mono: Float32Array, target = 0.7): Float32Array {
  let peak = 0
  for (let i = 0; i < mono.length; i += 7) { const v = Math.abs(mono[i]); if (v > peak) peak = v }
  if (peak < 0.05 || peak >= target) return mono
  const g = target / peak
  const out = new Float32Array(mono.length)
  for (let i = 0; i < mono.length; i++) out[i] = Math.max(-1, Math.min(1, mono[i] * g))
  return out
}

type Flat = { midi: number; time: number; duration: number; vel: number }

function postProcess(
  events: { pitchMidi: number; startTimeSeconds: number; durationSeconds: number; amplitude: number }[],
  minDur: number,
  mergeGap: number,
): Flat[] {
  const rows = events
    .filter(e => e.pitchMidi >= 21 && e.pitchMidi <= 108 && e.durationSeconds > 0.03)
    .map(e => ({
      midi: Math.round(e.pitchMidi),
      time: Math.max(0, e.startTimeSeconds),
      duration: Math.min(4, e.durationSeconds),
      vel: Math.max(0.25, Math.min(1, e.amplitude ?? 0.8)),
    }))
    .sort((a, b) => a.time - b.time || a.midi - b.midi)
  const merged: Flat[] = []
  for (const n of rows) {
    const last = merged[merged.length - 1]
    if (last && last.midi === n.midi && n.time - (last.time + last.duration) <= mergeGap) {
      last.duration = Math.min(4, Math.max(last.duration, n.time + n.duration - last.time))
      last.vel = Math.max(last.vel, n.vel)
    } else merged.push({ ...n })
  }
  return merged.filter(n => n.duration >= minDur)
}

/** Melody focus: cut percussion clutter, keep the instrumental lead. */
function focusMelody(
  input: Flat[],
  opts: { leadLow: number; leadHigh: number; maxPoly: number; percGate: boolean },
): { notes: Flat[]; removed: number } {
  const { leadLow, leadHigh, maxPoly, percGate } = opts
  const startCount = input.length
  // 1) Register: keep sustained bass roots, drop out-of-band blips.
  let notes = input.filter(n => {
    if (n.midi >= leadLow && n.midi <= leadHigh) return true
    // keep long low roots (harmonium bass), drop short low thumps (tabla/kick artifacts)
    if (n.midi < leadLow && n.duration >= 0.5 && n.vel >= 0.55) return true
    return false
  })
  if (percGate) {
    // 2) Percussion gate: unpitched hits surface as short + weak tonal notes.
    notes = notes.filter(n => !(n.duration < 0.12 && n.vel < 0.55))
    // 3) Machine-gun repeats: rapid same-pitch flams are drum artifacts, keep the first.
    const out: Flat[] = []
    for (const n of notes) {
      const last = out[out.length - 1]
      if (last && last.midi === n.midi && n.duration < 0.15 && last.duration < 0.15 && n.time - last.time < 0.12) continue
      out.push(n)
    }
    notes = out
  }
  // 4) Poly cap: keep the strongest voices per moment (lead + harmony), drop the wash.
  const scored = notes.map(n => ({ n, score: n.vel * (0.5 + Math.min(1.5, n.duration)) + (n.midi >= leadLow ? 0.15 : 0) }))
  scored.sort((a, b) => b.score - a.score)
  const kept: Flat[] = []
  for (const { n } of scored) {
    let overlap = 0
    for (const k of kept) {
      if (n.time < k.time + k.duration && k.time < n.time + n.duration) {
        overlap++
        if (overlap >= maxPoly) break
      }
    }
    if (overlap < maxPoly) kept.push(n)
  }
  kept.sort((a, b) => a.time - b.time || a.midi - b.midi)
  return { notes: kept, removed: startCount - kept.length }
}

export async function transcribeAudioFile(
  file: Blob,
  onProgress: (p: number, stage: string) => void = () => {},
  opts: TxOpts = {},
): Promise<{ notes: TranscribedNote[]; clipped: boolean; removed: number }> {
  const {
    onsetThresh = 0.5, frameThresh = 0.3, minNoteLen = 5, melodiaTrick = true,
    normalize = true, minDurationSec = 0.09, mergeGapSec = 0.04,
    melodyFocus = false, leadLow = 57, leadHigh = 96, maxPoly = 2, percGate = true, bandpass = melodyFocus,
  } = opts
  onProgress(0.02, bandpass ? 'decoding + focusing lead band (85Hz–5.2kHz)…' : 'decoding + resampling to 22050Hz mono…')
  const { mono, clipped } = await decodeToMono22050(file, bandpass)
  const ready = normalize ? peakNormalize(mono) : mono
  onProgress(0.08, 'loading Basic Pitch model…')
  const bp = await getModel()
  const frames: number[][] = []
  const onsets: number[][] = []
  const contours: number[][] = []
  await bp.evaluateModel(
    ready,
    (f, o, c) => { frames.push(...f); onsets.push(...o); contours.push(...c) },
    (p: number) => onProgress(0.08 + p * 0.84, `transcribing… ${Math.round(p * 100)}%`),
  )
  onProgress(0.94, melodyFocus ? 'isolating melody (cutting percussion)…' : 'cleaning notes (merge + filter)…')
  const events = noteFramesToTime(
    addPitchBendsToNoteEvents(contours, outputToNotesPoly(frames, onsets, onsetThresh, frameThresh, minNoteLen, true, null, null, melodiaTrick)),
  )
  const base = postProcess(events, minDurationSec, mergeGapSec)
  let notes: Flat[] = base
  let removed = 0
  if (melodyFocus) {
    const r = focusMelody(base, { leadLow, leadHigh, maxPoly, percGate })
    notes = r.notes
    removed = r.removed
  }
  const out: TranscribedNote[] = notes.map(n => ({ ...n, hand: (n.midi < 60 ? 'L' : 'R') as 'L' | 'R' }))
  onProgress(1, `done — ${out.length} melody notes${removed ? ` (cut ${removed} percussion/clutter)` : ''}${clipped ? ' (first 8 min)' : ''}`)
  return { notes: out, clipped, removed }
}
