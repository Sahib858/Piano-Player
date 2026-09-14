import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type Note = { midi: number; time: number; duration: number; hand: 'L' | 'R'; vel?: number }

const YT_URL = 'https://www.youtube.com/watch?v=8y7Kednwa-M'
const YT_TITLE = 'Ek Oliyo Lutavane Betho — Lakhona Taranhar (devotional)'

function genDemoNotes(durationSec: number): Note[] {
  const d = Math.max(30, durationSec || 120)
  const scaleR = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84]
  const scaleL = [36, 43, 48, 55, 48, 43]
  const notes: Note[] = []
  let t = 2
  let i = 0
  while (t < d - 2) {
    const step = i % 2 === 0 ? 0.5 : 0.5
    const midi = scaleR[i % scaleR.length] + (Math.floor(i / scaleR.length) % 2 === 1 ? -12 : 0)
    notes.push({ midi, time: t, duration: 0.45, hand: 'R' })
    if (i % 4 === 0) notes.push({ midi: scaleL[(i / 4) % scaleL.length | 0], time: t, duration: 1.2, hand: 'L' })
    if (i % 8 === 7) notes.push({ midi: midi + 7, time: t, duration: 0.4, hand: 'R' })
    t += step
    i++
  }
  return notes
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function midiName(m: number) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  return `${names[m % 12]}${Math.floor(m / 12) - 1}`
}
const isBlack = (m: number) => [1, 3, 6, 8, 10].includes(m % 12)

export default function App() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [audioUrl, setAudioUrl] = useState<string>('')
  const [audioName, setAudioName] = useState<string>('No MP3 loaded — upload or use demo')
  const [duration, setDuration] = useState(120)
  const [cur, setCur] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [transpose, setTranspose] = useState(0)
  const [stage, setStage] = useState(false)
  const [lowNote, setLowNote] = useState(48)
  const [notes, setNotes] = useState<Note[]>(() => genDemoNotes(120))
  const [noteSrc, setNoteSrc] = useState('demo-pattern (AI transcribe ready below)')
  const [setlist, setSetlist] = useState<string[]>([YT_TITLE])
  const [outputs, setOutputs] = useState<{ id: string; label: string }[]>([])
  const [audioFile, setAudioFile] = useState<Blob | null>(null)
  const [txBusy, setTxBusy] = useState(false)
  const [txProg, setTxProg] = useState(0)
  const [txStage, setTxStage] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const mp3Input = useRef<HTMLInputElement>(null)
  const midiInput = useRef<HTMLInputElement>(null)
  const [preset, setPreset] = useState<'piano' | 'dense' | 'soft' | 'custom'>('dense')
  const [onset, setOnset] = useState(0.68)
  const [frame, setFrame] = useState(0.42)
  const [minLen, setMinLen] = useState(9)
  const [melodyFocus, setMelodyFocus] = useState(true)
  const [register, setRegister] = useState<'lead' | 'wide' | 'full'>('lead')
  // practice: loop
  const [loopA, setLoopA] = useState<number | null>(null)
  const [loopB, setLoopB] = useState<number | null>(null)
  const [loopOn, setLoopOn] = useState(false)
  // practice: wait mode
  const [waitOn, setWaitOn] = useState(false)
  const [waitTarget, setWaitTarget] = useState<number[]>([])
  const [waitHits, setWaitHits] = useState<number[]>([])
  const waitOnRef = useRef(false)
  const waitForRef = useRef(-1)
  const toneRef = useRef<AudioContext | null>(null)
  // chords view
  const [view, setView] = useState<'notes' | 'chords'>('notes')
  // stems
  const [stemBusy, setStemBusy] = useState(false)
  const [stemProg, setStemProg] = useState(0)
  const [stemStage, setStemStage] = useState('')
  const [origFile, setOrigFile] = useState<Blob | null>(null)
  const [origUrl, setOrigUrl] = useState('')
  const [origName, setOrigName] = useState('')
  const [mixLabel, setMixLabel] = useState('')

  function applyPreset(p: 'piano' | 'dense' | 'soft') {
    setPreset(p)
    const map = { piano: [0.5, 0.3, 5], dense: [0.68, 0.42, 9], soft: [0.32, 0.24, 3] } as const
    setOnset(map[p][0]); setFrame(map[p][1]); setMinLen(map[p][2])
  }

  const viewHigh = lowNote + 36
  const shown = useMemo(() => notes.map(n => ({ ...n, midi: n.midi + transpose })), [notes, transpose])

  useEffect(() => {
    document.body.classList.toggle('stage', stage)
    try { screen.orientation?.lock?.('landscape').catch(() => {}) } catch { /* ignore */ }
  }, [stage])

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const onMeta = () => {
      const d = isFinite(a.duration) ? a.duration : 120
      setDuration(d)
      setNotes(prev => (noteSrc.startsWith('demo') ? genDemoNotes(d) : prev))
    }
    const onEnd = () => setPlaying(false)
    a.addEventListener('loadedmetadata', onMeta)
    a.addEventListener('ended', onEnd)
    return () => { a.removeEventListener('loadedmetadata', onMeta); a.removeEventListener('ended', onEnd) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl])

  useEffect(() => { waitOnRef.current = waitOn; if (!waitOn) { waitForRef.current = -1; setWaitTarget([]); setWaitHits([]) } }, [waitOn])

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const a = audioRef.current
      const t = a?.currentTime || 0
      if (a) {
        if (loopOn && loopA != null && loopB != null && loopB > loopA && t >= loopB) {
          a.currentTime = loopA
        }
        if (waitOnRef.current && !a.paused && shown.length) {
          let next = Infinity
          for (const n of shown) { if (n.time >= t - 0.02 && n.time < next) next = n.time }
          if (next !== Infinity && t >= next - 0.02 && Math.abs(next - waitForRef.current) > 0.05) {
            waitForRef.current = next
            const group = [...new Set(shown.filter(n => Math.abs(n.time - next) < 0.06).map(n => n.midi))].sort((x, y) => x - y)
            setWaitTarget(group)
            setWaitHits([])
            a.pause()
            setPlaying(false)
          }
        }
        setCur(a.currentTime || 0)
      }
      draw()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, lowNote, playing, stage, loopA, loopB, loopOn])

  useEffect(() => {
    (async () => {
      try {
        const { get } = await import('idb-keyval')
        const buf = await get('pp-audio') as ArrayBuffer | undefined
        const name = await get('pp-audio-name') as string | undefined
        if (buf) {
          const blob = new Blob([buf])
          setAudioUrl(URL.createObjectURL(blob))
          setAudioName(String(name || 'Restored offline MP3'))
          setAudioFile(blob)
        }
      } catch { /* offline cache optional */ }
      try {
        const devs = await navigator.mediaDevices?.enumerateDevices()
        const outs = (devs || []).filter(d => d.kind === 'audiooutput').map((d, i) => ({ id: d.deviceId, label: d.label || `Output ${i + 1}` }))
        setOutputs(outs)
      } catch { /* ignore */ }
    })()
  }, [])

  function draw() {
    const cv = canvasRef.current
    const a = audioRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const W = cv.clientWidth, H = cv.clientHeight
    if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const t = a?.currentTime || 0
    const kbH = 76
    const rollH = H - kbH
    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, '#0a0a16')
    bg.addColorStop(1, '#07070d')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)
    const range = viewHigh - lowNote + 1
    const xOf = (m: number) => ((m - lowNote) / range) * W
    const wNote = W / range
    const pxPerSec = 155
    // beat grid + bar accents
    for (let b = Math.floor(t); b < t + rollH / pxPerSec + 1; b++) {
      const y = rollH - (b - t) * pxPerSec
      ctx.strokeStyle = b % 4 === 0 ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.05)'
      ctx.lineWidth = b % 4 === 0 ? 1.2 : 1
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
    }
    // lane separators
    ctx.strokeStyle = 'rgba(255,255,255,.045)'
    for (let m = lowNote; m <= viewHigh + 1; m++) {
      const x = xOf(m)
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, rollH); ctx.stroke()
    }
    // falling notes with glow
    ctx.save()
    for (const n of shown) {
      if (n.midi < lowNote || n.midi > viewHigh) continue
      const dt = n.time - t
      if (dt > rollH / pxPerSec + 2 || dt + n.duration < -1) continue
      const x = xOf(n.midi)
      const yHead = rollH - dt * pxPerSec
      const h = Math.max(12, n.duration * pxPerSec)
      const y = yHead - h
      const active = t >= n.time && t <= n.time + n.duration + 0.05
      const base = n.hand === 'L' ? '0,229,204' : '139,108,255'
      const v = n.vel ?? 0.85
      const alpha = active ? 1 : 0.5 + v * 0.4
      ctx.shadowColor = `rgba(${base},${active ? 0.9 : 0.45})`
      ctx.shadowBlur = active ? 16 : 8
      ctx.fillStyle = `rgba(${base},${alpha})`
      const bw = isBlack(n.midi) ? wNote * 0.88 : wNote * 0.9
      ctx.beginPath()
      ctx.roundRect(x + 1.5, y, Math.max(4, bw - 3), h, 6)
      ctx.fill()
      // top cap highlight
      ctx.shadowBlur = 0
      ctx.fillStyle = 'rgba(255,255,255,.35)'
      ctx.fillRect(x + 4, y + 2, Math.max(2, bw - 8), 2)
    }
    ctx.restore()
    // play line
    const lg = ctx.createLinearGradient(0, 0, W, 0)
    lg.addColorStop(0, '#ff5d73')
    lg.addColorStop(0.5, '#ff9d6b')
    lg.addColorStop(1, '#7c5cff')
    ctx.fillStyle = lg
    ctx.fillRect(0, rollH - 2.5, W, 2.5)
    // keyboard
    const whites: number[] = []
    for (let m = lowNote; m <= viewHigh; m++) if (!isBlack(m)) whites.push(m)
    const ww = W / whites.length
    whites.forEach((m, i) => {
      const sounding = shown.some(n => n.midi === m && t >= n.time && t <= n.time + n.duration + 0.05)
      const g = ctx.createLinearGradient(0, rollH, 0, H)
      if (sounding) { g.addColorStop(0, '#a78bff'); g.addColorStop(1, '#6d4dff') }
      else { g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#cfcfe0') }
      ctx.fillStyle = g
      ctx.strokeStyle = 'rgba(0,0,0,.4)'
      ctx.beginPath()
      ctx.roundRect(i * ww + 1, rollH + 3, ww - 2, kbH - 3, [0, 0, 6, 6])
      ctx.fill(); ctx.stroke()
      if (m % 12 === 0) {
        ctx.fillStyle = sounding ? '#fff' : '#6b6b85'
        ctx.font = '600 10px system-ui'
        ctx.fillText(midiName(m), i * ww + 5, H - 9)
      }
    })
    for (let m = lowNote; m <= viewHigh; m++) {
      if (!isBlack(m)) continue
      const wi = whites.filter(w => w < m).length
      const x = wi * ww - ww * 0.32
      const sounding = shown.some(n => n.midi === m && t >= n.time && t <= n.time + n.duration + 0.05)
      ctx.fillStyle = sounding ? '#00e5cc' : '#14141f'
      ctx.strokeStyle = sounding ? '#fff' : 'rgba(255,255,255,.14)'
      ctx.beginPath()
      ctx.roundRect(x, rollH + 3, ww * 0.64, kbH * 0.58, [0, 0, 5, 5])
      ctx.fill(); ctx.stroke()
    }
  }

  async function saveMp3(f: File) {
    const url = URL.createObjectURL(f)
    setAudioUrl(url)
    setAudioName(f.name)
    setAudioFile(f)
    try {
      const { set } = await import('idb-keyval')
      await set('pp-audio', await f.arrayBuffer())
      await set('pp-audio-name', f.name)
    } catch { /* ignore */ }
  }
  async function onMp3(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) void saveMp3(f)
    e.target.value = ''
  }

  async function loadMidiFile(f: File) {
    const { Midi } = await import('@tonejs/midi')
    const buf = await f.arrayBuffer()
    const midi = new Midi(buf)
    const out: Note[] = []
    midi.tracks.forEach((tr, ti) => {
      tr.notes.forEach(n => out.push({ midi: n.midi, time: n.time, duration: Math.max(.2, n.duration), hand: ti === 0 ? 'R' : 'L' }))
    })
    out.sort((a, b) => a.time - b.time)
    if (out.length) { setNotes(out); setNoteSrc(`MIDI: ${f.name} (${out.length} notes)`) }
  }
  async function onMidi(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) await loadMidiFile(f)
    e.target.value = ''
  }

  async function onTranscribe() {
    if (!audioFile) return
    setTxBusy(true)
    setTxProg(0)
    setTxStage('starting…')
    try {
      const { transcribeAudioFile } = await import('./lib/transcribe')
      const band = register === 'full' ? { leadLow: 21, leadHigh: 108 } : register === 'wide' ? { leadLow: 48, leadHigh: 96 } : { leadLow: 57, leadHigh: 96 }
      const { notes: out, clipped, removed } = await transcribeAudioFile(audioFile, (p, s) => { setTxProg(p); setTxStage(s) }, { onsetThresh: onset, frameThresh: frame, minNoteLen: minLen, melodyFocus, ...band, maxPoly: 2 })
      if (out.length) {
        setNotes(out.map(n => ({ midi: n.midi, time: n.time, duration: n.duration, hand: n.hand, vel: n.vel })))
        setNoteSrc(`AI ${preset}${melodyFocus ? ' melody' : ''} ${onset.toFixed(2)}/${frame.toFixed(2)}/${minLen} (${out.length} notes${removed ? `, cut ${removed}` : ''}${clipped ? ', 8min cap' : ''})`)
      } else {
        setTxStage('No notes found — try Soft preset or turn off Melody focus for full mix')
      }
    } catch (err) {
      setTxStage(`Transcribe failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setTxBusy(false)
    }
  }

  async function onExportMidi() {
    const { Midi } = await import('@tonejs/midi')
    const midi = new Midi()
    const rh = midi.addTrack()
    rh.name = 'Right hand (AI)'
    const lh = midi.addTrack()
    lh.name = 'Left hand (AI)'
    for (const n of notes) {
      ;(n.hand === 'L' ? lh : rh).addNote({ midi: n.midi, time: n.time, duration: n.duration, velocity: n.vel ?? 0.85 })
    }
    const bytes = midi.toArray()
    const blob = new Blob([bytes as unknown as BlobPart], { type: 'audio/midi' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${audioName.replace(/\.[^.]+$/, '') || 'piano'}-transcription.mid`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }

  function toggle() {
    const a = audioRef.current
    if (!a || !audioUrl) return
    if (a.paused) { a.playbackRate = speed; a.play().then(() => setPlaying(true)).catch(() => {}) }
    else { a.pause(); setPlaying(false) }
  }
  function seek(v: number) {
    const a = audioRef.current
    if (!a) return
    a.currentTime = v
    setCur(v)
  }
  function changeSpeed(s: number) {
    setSpeed(s)
    if (audioRef.current) audioRef.current.playbackRate = s
  }
  async function setOutput(id: string) {
    try { await (audioRef.current as unknown as { setSinkId: (id: string) => Promise<void> })?.setSinkId?.(id) } catch { /* unsupported */ }
  }

  function playTone(midi: number) {
    try {
      toneRef.current ??= new AudioContext()
      const ctx = toneRef.current
      if (ctx.state === 'suspended') void ctx.resume()
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'triangle'
      o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12)
      g.gain.setValueAtTime(0.25, ctx.currentTime)
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6)
      o.connect(g); g.connect(ctx.destination)
      o.start(); o.stop(ctx.currentTime + 0.65)
    } catch { /* ignore */ }
  }

  function midiAtPoint(clientX: number, clientY: number): number | null {
    const cv = canvasRef.current
    if (!cv) return null
    const r = cv.getBoundingClientRect()
    const x = clientX - r.left
    const y = clientY - r.top
    const W = r.width, H = r.height
    const kbH = 76
    const rollH = H - kbH
    if (y < rollH || x < 0 || x > W) return null
    const whites: number[] = []
    for (let m = lowNote; m <= viewHigh; m++) if (!isBlack(m)) whites.push(m)
    const ww = W / whites.length
    const relY = y - rollH
    if (relY < kbH * 0.58 + 3) {
      for (let m = lowNote; m <= viewHigh; m++) {
        if (!isBlack(m)) continue
        const wi = whites.filter(w => w < m).length
        const bx = wi * ww - ww * 0.32
        if (x >= bx && x <= bx + ww * 0.64) return m // view coords already transposed
      }
    }
    const wi = Math.min(whites.length - 1, Math.max(0, Math.floor(x / ww)))
    return whites[wi]
  }

  function registerHit(midi: number) {
    playTone(midi)
    if (!waitOnRef.current || !waitTarget.length) return
    setWaitHits(prev => {
      if (prev.includes(midi)) return prev
      const next = [...prev, midi]
      if (waitTarget.every(t => next.includes(t))) {
        const a = audioRef.current
        setTimeout(() => {
          setWaitTarget([]); setWaitHits([]); waitForRef.current = -1
          if (a && waitOnRef.current) { a.playbackRate = speed; a.play().then(() => setPlaying(true)).catch(() => {}) }
        }, 180)
      }
      return next
    })
  }

  function onCanvasTap(e: React.MouseEvent<HTMLCanvasElement>) {
    const m = midiAtPoint(e.clientX, e.clientY)
    if (m != null) registerHit(m)
  }

  useEffect(() => {
    if (!waitOn) return
    let access: { close?: () => void } | null = null
    ;(async () => {
      try {
        const req = (navigator as unknown as { requestMIDIAccess?: () => Promise<{ inputs: Map<string, { onmidimessage: ((e: { data?: Uint8Array }) => void) | null }>; close?: () => void }> }).requestMIDIAccess
        if (!req) return
        const a = await req.call(navigator)
        access = a
        a.inputs.forEach(input => {
          input.onmidimessage = (ev: { data?: Uint8Array }) => {
            const d = ev.data
            if (d && d[0] === 0x90 && d[2] > 0) registerHit(d[1])
          }
        })
      } catch { /* MIDI optional */ }
    })()
    return () => { try { access?.close?.() } catch { /* ignore */ } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitOn])

  const chords = useMemo(() => {
    if (!shown.length) return [] as { time: number; name: string }[]
    const step = 2
    const end = Math.max(...shown.map(n => n.time + n.duration), 0)
    const out: { time: number; name: string }[] = []
    const templates: { suf: string; iv: number[] }[] = [
      { suf: '', iv: [0, 4, 7] }, { suf: 'm', iv: [0, 3, 7] }, { suf: '7', iv: [0, 4, 7, 10] },
      { suf: 'maj7', iv: [0, 4, 7, 11] }, { suf: 'm7', iv: [0, 3, 7, 10] }, { suf: 'sus4', iv: [0, 5, 7] },
    ]
    for (let t = 0; t < end; t += step) {
      const chroma = new Array(12).fill(0)
      for (const n of shown) {
        if (n.time < t + step && n.time + n.duration > t) {
          const overlap = Math.min(n.time + n.duration, t + step) - Math.max(n.time, t)
          chroma[n.midi % 12] += overlap * (n.vel ?? 0.8)
        }
      }
      const total = chroma.reduce((a, b) => a + b, 0)
      if (total < 0.3) { out.push({ time: t, name: 'N.C.' }); continue }
      let best = 'N.C.'
      let bestScore = -Infinity
      for (let root = 0; root < 12; root++) {
        for (const tp of templates) {
          let s = 0
          for (let pc = 0; pc < 12; pc++) {
            const iv = (pc - root + 12) % 12
            if (tp.iv.includes(iv)) s += chroma[pc]
            else s -= chroma[pc] * 0.6
          }
          // root emphasis: bass notes matter
          s += chroma[root] * 0.3
          if (s > bestScore) { bestScore = s; best = `${NOTE_NAMES[root]}${tp.suf}` }
        }
      }
      out.push({ time: t, name: best })
    }
    return out.filter((c, i) => i === 0 || c.name !== out[i - 1].name)
  }, [shown])

  const curChord = useMemo(() => {
    let c = chords[0]?.name ?? '—'
    let nxt = '—'
    for (let i = 0; i < chords.length; i++) {
      if (chords[i].time <= cur + 0.1) c = chords[i].name
      else { nxt = chords[i].name; break }
    }
    return { c, nxt }
  }, [chords, cur])

  async function onStems(mode: 'karaoke' | 'nodrums' | 'instruments') {
    const src = audioFile
    if (!src || stemBusy) return
    setStemBusy(true)
    setStemProg(0)
    setStemStage('starting stem separation…')
    try {
      const { separateStems } = await import('./lib/stems')
      const r = await separateStems(src, mode, (p, s) => { setStemProg(p); setStemStage(s) })
      if (!origFile && audioFile) { setOrigFile(audioFile); setOrigUrl(audioUrl); setOrigName(audioName) }
      setAudioUrl(r.url)
      setAudioFile(r.blob)
      const label = mode === 'karaoke' ? 'no-vocals mix' : mode === 'nodrums' ? 'no-drums mix' : 'instruments mix'
      setMixLabel(`${label}${r.capped ? ' (first 5 min)' : ''}`)
      setAudioName(`${audioName.replace(/\.[^.]+$/, '')} [${label}]`)
      setNoteSrc('stems ready — hit Transcribe')
    } catch (err) {
      setStemStage(`Stem split failed: ${err instanceof Error ? err.message : String(err)} (desktop Chrome/Edge recommended)`)
    } finally {
      setStemBusy(false)
    }
  }

  function useOriginal() {
    if (!origFile) return
    setAudioUrl(origUrl)
    setAudioFile(origFile)
    setAudioName(origName)
    setMixLabel('')
  }

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

  return (
    <>
      <header className="top">
        <div className="brand">
          <div className="logo">♪</div>
          <div>
            <h1>Piano Player</h1>
            <p>Follow-along • concerts • worship • practice</p>
          </div>
        </div>
        <div className="toolbar">
          <span className="pill">Now: <b>{YT_TITLE}</b></span>
          <button className={stage ? 'stage-on' : ''} onClick={() => setStage(s => !s)}>{stage ? '● STAGE MODE' : 'Stage Mode'}</button>
        </div>
      </header>

      <div className="grid">
        <section className="card">
          <h2>Library</h2>
          <div className="song active">
            <div className="t">{YT_TITLE}</div>
            <div className="s"><a href={YT_URL} target="_blank" rel="noreferrer">YouTube source</a> → download MP3 you own, then drop below. Respect rights/ToS.</div>
          </div>
          {setlist.slice(1).map(s => <div key={s} className="song"><div className="t">{s}</div></div>)}
          <div
            className={`drop${dragOver ? ' over' : ''}`}
            role="button" tabIndex={0}
            onClick={() => mp3Input.current?.click()}
            onKeyDown={e => { if (e.key === 'Enter') mp3Input.current?.click() }}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault(); setDragOver(false)
              const f = e.dataTransfer.files?.[0]
              if (f) void saveMp3(f)
            }}
          >
            <strong>{audioFile ? `♪ ${audioName}` : 'Drop MP3 here or tap to upload'}</strong>
            <span>MP3 stays on-device (IndexedDB) for offline stage use</span>
            <input ref={mp3Input} type="file" accept="audio/mpeg,audio/*" onChange={onMp3} />
          </div>
          <div className="row">
            <button className="ghost" onClick={() => midiInput.current?.click()}>Import MIDI</button>
            <input ref={midiInput} type="file" accept=".mid,.midi" onChange={onMidi} style={{ display: 'none' }} />
            <span className="chip">Notes <b>{shown.length}</b></span>
            <span className="chip"><b>{noteSrc}</b></span>
          </div>
          <div className="row">
            <button className="primary" onClick={onTranscribe} disabled={!audioFile || txBusy}>{txBusy ? `Transcribing ${Math.round(txProg * 100)}%…` : '✨ Transcribe with AI'}</button>
            <button onClick={onExportMidi} disabled={!notes.length}>Export MIDI</button>
          </div>
          <div className="seg" role="group" aria-label="Accuracy preset">
            {(['piano', 'dense', 'soft'] as const).map(p => (
              <button key={p} className={preset === p ? 'on' : ''} disabled={txBusy} onClick={() => applyPreset(p)} title={p === 'piano' ? 'Clean piano solo (balanced)' : p === 'dense' ? 'Dense mix / kirtan with vocals + percussion (fewer false notes)' : 'Soft / quiet passages (catches more notes)'}>
                {p === 'piano' ? 'Piano' : p === 'dense' ? 'Dense mix' : 'Soft'}
              </button>
            ))}
          </div>
          <div className="row">
            <button className={melodyFocus ? 'primary' : 'ghost'} disabled={txBusy} onClick={() => setMelodyFocus(v => !v)} title="Cut percussion/rumble, keep the instrumental lead (lead band + mono-ish + percussive gate)">
              {melodyFocus ? '✂ Melody focus ON' : 'Melody focus OFF'}
            </button>
            <label>Range <select className="slim" value={register} disabled={txBusy || !melodyFocus} onChange={e => setRegister(e.target.value as 'lead' | 'wide' | 'full')}>
              <option value="lead">Lead 57–96</option>
              <option value="wide">Wide 48–96</option>
              <option value="full">Full 21–108</option>
            </select></label>
          </div>
          <div className="row">
            <label>Onset <input className="seek" style={{ width: 110 }} type="range" min={0.2} max={0.8} step={0.02} value={onset} disabled={txBusy} onChange={e => { setOnset(Number(e.target.value)); setPreset('custom') }} /> {onset.toFixed(2)}</label>
            <label>Frame <input className="seek" style={{ width: 110 }} type="range" min={0.2} max={0.6} step={0.02} value={frame} disabled={txBusy} onChange={e => { setFrame(Number(e.target.value)); setPreset('custom') }} /> {frame.toFixed(2)}</label>
            <label>Min len <select className="slim" value={minLen} disabled={txBusy} onChange={e => { setMinLen(Number(e.target.value)); setPreset('custom') }}>
              {[3, 5, 7, 9, 11].map(v => <option key={v} value={v}>{v}</option>)}
            </select></label>
          </div>
          {(txBusy || txStage) && <div className="progress"><i style={{ width: `${Math.round(txProg * 100)}%` }} /></div>}
          {txStage && <div className="kbd-hint">{txStage}{!audioFile && ' — upload an MP3 first.'}</div>}
          <h2 style={{ marginTop: 12 }}>Stems — true separation (beta)</h2>
          <div className="row">
            <button disabled={!audioFile || stemBusy} onClick={() => onStems('nodrums')}>🥁 Cut drums</button>
            <button disabled={!audioFile || stemBusy} onClick={() => onStems('karaoke')}>🎤 Cut vocals</button>
            <button disabled={!audioFile || stemBusy} onClick={() => onStems('instruments')}>🎹 Instruments</button>
            {mixLabel && <button className="ghost" onClick={useOriginal}>Original</button>}
          </div>
          {(stemBusy || stemStage) && <div className="progress"><i style={{ width: `${Math.round(stemProg * 100)}%` }} /></div>}
          {stemStage && <div className="kbd-hint">{stemStage}{mixLabel && !stemBusy && <> — active: <b>{mixLabel}</b>. Transcribe now uses the mix.</>}</div>}
          {!stemBusy && !stemStage && <div className="kbd-hint">Downloads Demucs model once (~170MB, cached). Best on desktop; first 5 min on long tracks.</div>}
          <div className="row">
            <button className="ghost" onClick={() => { const n = prompt('Add to setlist:'); if (n) setSetlist(s => [...s, n]) }}>+ Setlist</button>
            <button className="ghost" onClick={() => { setNotes(genDemoNotes(duration)); setNoteSrc('demo-pattern') }}>Reset demo</button>
          </div>
          <div className="row">
            <label>PA / Bluetooth out{' '}
              <select className="slim" onChange={e => setOutput(e.target.value)}>
                <option value="">Default</option>
                {outputs.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
          </div>
          <div className="kbd-hint">
            In-browser Basic Pitch (~742KB, offline after first load). Best on clear piano.
            Kirtan helper: <code className="inline">scripts/download.sh "{YT_URL}"</code> (yt-dlp + ffmpeg).
          </div>
        </section>

        <section className="card">
          <h2>Player — {audioName}</h2>
          <audio ref={audioRef} src={audioUrl} preload="metadata" />
          <div className="transport">
            <button className="playbtn" onClick={toggle} disabled={!audioUrl} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
            <span className="time">{fmt(cur)} / {fmt(duration)}</span>
            <div className="seg" role="group" aria-label="View">
              {(['notes', 'chords'] as const).map(v => (
                <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{v === 'notes' ? '🎹 Notes' : '⛪ Chords'}</button>
              ))}
            </div>
            <div className="seg" role="group" aria-label="Speed">
              {[0.5, 0.75, 1, 1.25].map(s => (
                <button key={s} className={speed === s ? 'on' : ''} onClick={() => changeSpeed(s)}>{s}x</button>
              ))}
            </div>
            <label>Key <select className="slim" value={transpose} onChange={e => setTranspose(Number(e.target.value))}>
              {[-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6].map(v => <option key={v} value={v}>{v > 0 ? `+${v}` : v}</option>)}
            </select></label>
            <label>View <select className="slim" value={lowNote} onChange={e => setLowNote(Number(e.target.value))}>
              {[36, 48, 60].map(v => <option key={v} value={v}>{midiName(v)}–{midiName(v + 36)}</option>)}
            </select></label>
          </div>
          <div className="row">
            <button className={loopOn ? 'primary' : 'ghost'} disabled={!audioUrl || loopA == null || loopB == null} onClick={() => setLoopOn(v => !v)} title="Repeat the A–B section">
              {loopOn ? '🔁 Loop ON' : '🔁 Loop'}
            </button>
            <button className="ghost" disabled={!audioUrl} onClick={() => setLoopA(cur)}>Set A {loopA != null ? fmt(loopA) : ''}</button>
            <button className="ghost" disabled={!audioUrl} onClick={() => setLoopB(cur)}>Set B {loopB != null ? fmt(loopB) : ''}</button>
            {(loopA != null || loopB != null) && <button className="ghost" onClick={() => { setLoopA(null); setLoopB(null); setLoopOn(false) }}>Clear</button>}
            <button className={waitOn ? 'primary' : 'ghost'} disabled={!shown.length} onClick={() => setWaitOn(v => !v)} title="Song pauses at each phrase until you play the notes (tap keys or use MIDI keyboard)">
              {waitOn ? '✋ Wait ON' : '✋ Wait mode'}
            </button>
          </div>
          {waitOn && waitTarget.length > 0 && (
            <div className="song active">
              <div className="t">Your turn: play {waitTarget.map(midiName).join(' + ')}</div>
              <div className="s">Hit {waitHits.length}/{waitTarget.length} — tap the piano keys below or play your MIDI keyboard. <button className="ghost" onClick={() => { setWaitTarget([]); setWaitHits([]); waitForRef.current = -1; const a = audioRef.current; if (a) { a.playbackRate = speed; a.play().then(() => setPlaying(true)).catch(() => {}) } }}>Skip ▶</button></div>
            </div>
          )}
          <input className="seek" type="range" min={0} max={duration} step={0.1} value={cur} onChange={e => seek(Number(e.target.value))} />
          {view === 'notes' ? (
            <div className="stage-wrap">
              <canvas ref={canvasRef} className="roll" onClick={onCanvasTap} style={{ cursor: 'pointer' }} />
              {!audioUrl && (
                <div className="empty"><div className="box">
                  <strong>Ready for your first song</strong>
                  <span>Drop the MP3 on the left, hit Transcribe, then Play — notes fall in sync for practice, worship or stage.</span>
                </div></div>
              )}
            </div>
          ) : (
            <div className="stage-wrap">
              <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', flexWrap: 'wrap' }}>
                <div className="song active" style={{ flex: '1 1 220px', textAlign: 'center', padding: '22px 12px' }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: 1 }}>NOW</div>
                  <div style={{ fontSize: 64, fontWeight: 800, lineHeight: 1.1 }}>{curChord.c}</div>
                  <div style={{ color: 'var(--muted)', fontSize: 14 }}>next: <b style={{ color: 'var(--text)' }}>{curChord.nxt}</b> • key {transpose >= 0 ? `+${transpose}` : transpose}</div>
                </div>
                <div style={{ flex: '2 1 320px', maxHeight: 300, overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: 8, alignContent: 'flex-start' }}>
                  {chords.length === 0 && <span className="chip">Transcribe first — chords derive from notes</span>}
                  {chords.map((c, i) => (
                    <button key={`${c.time}-${i}`} className="ghost" onClick={() => seek(c.time)} title={`Jump to ${fmt(c.time)}`}>
                      <b>{c.name}</b> <span style={{ color: 'var(--muted)' }}>{fmt(c.time)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div className="kbd-hint">
            Purple = right hand • Teal = left. 0.5x for practice, transpose for worship keys, Stage Mode for big touch targets on mobile. Tap piano keys to play them aloud{waitOn ? ' — wait mode listens for your notes' : ''}.
          </div>
        </section>
      </div>
    </>
  )
}
