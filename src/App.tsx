import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type Note = { midi: number; time: number; duration: number; hand: 'L' | 'R' }

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

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const a = audioRef.current
      if (a) setCur(a.currentTime || 0)
      draw()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, lowNote, playing, stage])

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
    const kbH = 72
    const rollH = H - kbH
    ctx.fillStyle = '#080810'
    ctx.fillRect(0, 0, W, H)
    const range = viewHigh - lowNote + 1
    const xOf = (m: number) => ((m - lowNote) / range) * W
    const wNote = W / range
    const pxPerSec = 150
    // beat grid
    ctx.strokeStyle = 'rgba(255,255,255,.06)'
    ctx.lineWidth = 1
    for (let b = Math.floor(t); b < t + rollH / pxPerSec + 1; b++) {
      const y = rollH - (b - t) * pxPerSec
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
    }
    // falling notes
    for (const n of shown) {
      if (n.midi < lowNote || n.midi > viewHigh) continue
      const dt = n.time - t
      if (dt > rollH / pxPerSec + 2 || dt + n.duration < -1) continue
      const x = xOf(n.midi)
      const yHead = rollH - dt * pxPerSec
      const h = Math.max(10, n.duration * pxPerSec)
      const y = yHead - h
      const active = t >= n.time && t <= n.time + n.duration + 0.05
      ctx.fillStyle = n.hand === 'L' ? (active ? '#00e5cc' : 'rgba(0,229,204,.75)') : (active ? '#a78bff' : 'rgba(124,92,255,.8)')
      ctx.strokeStyle = active ? '#fff' : 'transparent'
      const bw = isBlack(n.midi) ? wNote * 0.9 : wNote * 0.92
      ctx.beginPath()
      ctx.roundRect(x + 1, y, bw - 2, h, 5)
      ctx.fill()
      if (active) ctx.stroke()
    }
    // play line
    ctx.fillStyle = '#ff5d73'
    ctx.fillRect(0, rollH - 2, W, 2)
    // keyboard
    const whites: number[] = []
    for (let m = lowNote; m <= viewHigh; m++) if (!isBlack(m)) whites.push(m)
    const ww = W / whites.length
    whites.forEach((m, i) => {
      const sounding = shown.some(n => n.midi === m && t >= n.time && t <= n.time + n.duration + 0.05)
      ctx.fillStyle = sounding ? '#7c5cff' : '#f2f2f7'
      ctx.fillRect(i * ww + 1, rollH, ww - 2, kbH)
      ctx.fillStyle = '#555'
      ctx.font = '10px system-ui'
      if (m % 12 === 0) ctx.fillText(midiName(m), i * ww + 4, H - 8)
    })
    for (let m = lowNote; m <= viewHigh; m++) {
      if (!isBlack(m)) continue
      const wi = whites.filter(w => w < m).length
      const x = wi * ww - ww * 0.3
      const sounding = shown.some(n => n.midi === m && t >= n.time && t <= n.time + n.duration + 0.05)
      ctx.fillStyle = sounding ? '#00e5cc' : '#15151f'
      ctx.fillRect(x, rollH, ww * 0.6, kbH * 0.6)
    }
  }

  async function onMp3(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
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

  async function onMidi(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
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

  async function onTranscribe() {
    if (!audioFile) return
    setTxBusy(true)
    setTxProg(0)
    setTxStage('starting…')
    try {
      const { transcribeAudioFile } = await import('./lib/transcribe')
      const out = await transcribeAudioFile(audioFile, (p, s) => { setTxProg(p); setTxStage(s) })
      if (out.length) {
        setNotes(out.map(n => ({ midi: n.midi, time: n.time, duration: n.duration, hand: n.hand })))
        setNoteSrc(`AI Basic Pitch (${out.length} notes)`)
      } else {
        setTxStage('No notes found — try a clearer piano recording or lower thresholds')
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
      ;(n.hand === 'L' ? lh : rh).addNote({ midi: n.midi, time: n.time, duration: n.duration, velocity: 0.9 })
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
            <div className="s"><a href={YT_URL} target="_blank" rel="noreferrer">YouTube source</a> → download MP3 locally, then upload below. Respect rights/ToS.</div>
          </div>
          {setlist.slice(1).map(s => <div key={s} className="song"><div className="t">{s}</div></div>)}
          <div className="row">
            <label>MP3 <input type="file" accept="audio/mpeg,audio/*" onChange={onMp3} /></label>
          </div>
          <div className="row">
            <label>MIDI <input type="file" accept=".mid,.midi" onChange={onMidi} /></label>
          </div>
          <div className="row"><span className="pill">Notes: <b>{noteSrc}</b> • {shown.length}</span></div>
          <div className="row">
            <button className="primary" onClick={onTranscribe} disabled={!audioFile || txBusy}>{txBusy ? `Transcribing ${Math.round(txProg * 100)}%…` : '✨ Transcribe MP3 with AI'}</button>
            <button onClick={onExportMidi} disabled={!notes.length}>Export MIDI</button>
          </div>
          {txBusy && <input className="seek" type="range" min={0} max={1} step={0.01} value={txProg} readOnly />}
          {txStage && <div className="kbd-hint">{txStage}{!audioFile && ' — upload an MP3 first.'}</div>}
          <div className="row">
            <button onClick={() => { const n = prompt('Add to setlist:'); if (n) setSetlist(s => [...s, n]) }}>+ Setlist</button>
            <button onClick={() => { setNotes(genDemoNotes(duration)); setNoteSrc('demo-pattern') }}>Reset demo notes</button>
          </div>
          <h2 style={{ marginTop: 14 }}>How to get your MP3</h2>
          <div className="kbd-hint">
            Upload an MP3 you own, then hit Transcribe — runs fully in-browser (Basic Pitch, ~742KB model in <code className="inline">public/model</code>, offline after first load).
            Best on clear piano; dense mixes need MIDI cleanup. For your kirtan: <code className="inline">scripts/download.sh "{YT_URL}"</code> needs <code className="inline">yt-dlp</code> + <code className="inline">ffmpeg</code>, then upload here (respect rights/ToS, saved to IndexedDB for stage offline).
          </div>
          <div className="row">
            <label>PA / Bluetooth out{' '}
              <select onChange={e => setOutput(e.target.value)}>
                <option value="">Default</option>
                {outputs.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
          </div>
        </section>

        <section className="card">
          <h2>Player — {audioName}</h2>
          <audio ref={audioRef} src={audioUrl} preload="metadata" />
          <div className="transport">
            <button className="primary" onClick={toggle} disabled={!audioUrl}>{playing ? 'Pause' : 'Play'} ▶</button>
            <span className="time">{fmt(cur)} / {fmt(duration)}</span>
            {[0.5, 0.75, 1, 1.25].map(s => (
              <button key={s} disabled={speed === s} onClick={() => changeSpeed(s)}>{s}x</button>
            ))}
            <label>Transpose <select value={transpose} onChange={e => setTranspose(Number(e.target.value))}>
              {[-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6].map(v => <option key={v} value={v}>{v > 0 ? `+${v}` : v}</option>)}
            </select></label>
            <label>Octave <select value={lowNote} onChange={e => setLowNote(Number(e.target.value))}>
              {[36, 48, 60].map(v => <option key={v} value={v}>{midiName(v)}–{midiName(v + 36)}</option>)}
            </select></label>
            <button disabled title="V0.2: pauses until you play the note">Wait mode (V0.2)</button>
          </div>
          <input className="seek" type="range" min={0} max={duration} step={0.1} value={cur} onChange={e => seek(Number(e.target.value))} />
          <canvas ref={canvasRef} className="roll" />
          <div className="kbd-hint">
            Falling notes sync to <code className="inline">audio.currentTime</code>. Purple = right hand, teal = left.
            Slow to 0.5x for practice, transpose for worship keys, Stage Mode for big controls on mobile.
            {!audioUrl && <> — <b>upload the MP3 to start streaming alongside your live performance.</b></>}
          </div>
        </section>
      </div>
    </>
  )
}
