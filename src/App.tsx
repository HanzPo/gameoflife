import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as protobuf from 'protobufjs/minimal'
import './App.css'
type LiveSet = Set<string>

function cellKey(row: number, col: number): string {
  return `${row},${col}`
}

// Base64url helpers
function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  const b64 = btoa(binary)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
function fromBase64Url(s: string): Uint8Array {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  while (b64.length % 4 !== 0) b64 += '='
  const binary = atob(b64)
  const arr = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) arr[i] = binary.charCodeAt(i)
  return arr
}

// Protobuf message encoder/decoder for compact links
// message State { repeated sint32 cells = 1 [packed=true]; }
function encodeState(cells: Array<[number, number]>): string {
  // Flatten row/col pairs into a packed sint32 array: [r0, c0, r1, c1, ...]
  const flat: number[] = []
  for (const [r, c] of cells) { flat.push(r, c) }
  const writer = protobuf.Writer.create()
  // field 1 (packed sint32) using fork/ldelim
  writer.uint32((1 << 3) | 2).fork()
  for (const v of flat) writer.sint32(v)
  writer.ldelim()
  const bytes = writer.finish()
  return toBase64Url(bytes)
}

function decodeState(param: string): Array<[number, number]> | null {
  // Try protobuf first
  try {
    const bytes = fromBase64Url(param)
    const reader = protobuf.Reader.create(bytes)
    const pairs: number[] = []
    while (reader.pos < reader.len) {
      const tag = reader.uint32()
      const fieldNo = tag >>> 3
      const wireType = tag & 7
      if (fieldNo === 1 && wireType === 2) {
        const end = reader.uint32() + reader.pos
        while (reader.pos < end) pairs.push(reader.sint32())
      } else {
        reader.skipType(wireType)
      }
    }
    const out: Array<[number, number]> = []
    for (let i = 0; i + 1 < pairs.length; i += 2) out.push([pairs[i], pairs[i + 1]])
    return out
  } catch {
    // fallthrough to backward-compatible JSON
  }
  try {
    let b64 = param.replace(/-/g, '+').replace(/_/g, '/')
    while (b64.length % 4 !== 0) b64 += '='
    const json = decodeURIComponent(escape(atob(b64)))
    const data = JSON.parse(json)
    if (Array.isArray(data?.cells)) return data.cells as Array<[number, number]>
  } catch {
    // ignore
  }
  try {
    const json = decodeURIComponent(param)
    const data = JSON.parse(json)
    if (Array.isArray(data?.cells)) return data.cells as Array<[number, number]>
  } catch {
    // ignore
  }
  return null
}

function getNextGenerationSparse(current: LiveSet): LiveSet {
  const neighborCounts = new Map<string, number>()

  const addNeighbor = (r: number, c: number) => {
    const k = cellKey(r, c)
    neighborCounts.set(k, (neighborCounts.get(k) ?? 0) + 1)
  }

  for (const key of current) {
    const [rStr, cStr] = key.split(',')
    const r = Number(rStr)
    const c = Number(cStr)
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dr === 0 && dc === 0) continue
        addNeighbor(r + dr, c + dc)
      }
    }
  }

  const next: LiveSet = new Set<string>()

  for (const [k, count] of neighborCounts) {
    const alive = current.has(k)
    if (count === 3 || (alive && count === 2)) {
      next.add(k)
    }
  }
  return next
}

function App() {
  const [rows, setRows] = useState(28)
  const [cols, setCols] = useState(48)
  const [live, setLive] = useState<LiveSet>(() => new Set())
  const [initialLive, setInitialLive] = useState<LiveSet>(() => new Set())
  const [isPlaying, setIsPlaying] = useState(false)
  const [generation, setGeneration] = useState(0)
  const intervalRef = useRef<number | null>(null)
  const [delayMs, setDelayMs] = useState(160)
  const [camRow, setCamRow] = useState(0)
  const [camCol, setCamCol] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; startOffsetX: number; startOffsetY: number; moved: boolean; startCamRow: number; startCamCol: number }>({ startX: 0, startY: 0, startOffsetX: 0, startOffsetY: 0, moved: false, startCamRow: 0, startCamCol: 0 })
  const isDraggingRef = useRef(false)
  const [cellSizePx, setCellSizePx] = useState(18)
  const viewportRef = useRef<HTMLDivElement>(null)
  const GAP_PX = 2
  const PADDING_PX = 2
  const PITCH_PX = useMemo(() => cellSizePx + GAP_PX, [cellSizePx])
  const LEAD_CELLS = 1

  const clampCell = (v: number) => Math.min(42, Math.max(10, v))
  const [offsetXPx, setOffsetXPx] = useState(0)
  const [offsetYPx, setOffsetYPx] = useState(0)

  // Toast notification state
  const [isToastVisible, setIsToastVisible] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const toastTimeoutRef = useRef<number | null>(null)

  // Resize grid when window changes, keeping current cells if possible
  useEffect(() => {
    function handleResize() {
      const stage = document.querySelector('.gol-stage') as HTMLElement | null
      const rect = stage?.getBoundingClientRect()
      const usableW = rect ? rect.width : window.innerWidth
      const usableH = rect ? rect.height : window.innerHeight - 140
      const maxCols = Math.max(8, Math.floor((usableW - PADDING_PX * 2) / PITCH_PX))
      const maxRows = Math.max(8, Math.floor((usableH - PADDING_PX * 2) / PITCH_PX))
      setRows(maxRows)
      setCols(maxCols)
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [PITCH_PX])

  // Load from URL param `state` if present; else load last initial state and last export name
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const param = params.get('state')
      if (param) {
        const cells = decodeState(param) || []
        const set = new Set<string>()
        for (const [r, c] of cells) set.add(cellKey(r, c))
        setInitialLive(set)
        setLive(new Set(set))
        setGeneration(0)
      } else {
      const saved = localStorage.getItem('gol_initial')
      if (saved) {
        const data = JSON.parse(saved) as { cells?: Array<[number, number]> }
        const set = new Set<string>()
        for (const [r, c] of data.cells ?? []) set.add(cellKey(r, c))
        setInitialLive(set)
        setLive(new Set(set))
        setGeneration(0)
      }
      }
      const savedName = localStorage.getItem('gol_export_name')
      if (savedName) setExportName(savedName)
    } catch {
      // ignore
    }
  }, [])

  const toggleCell = useCallback((r: number, c: number) => {
    const k = cellKey(r, c)
    setLive((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
    if (generation === 0) {
      setInitialLive((prev) => {
        const next = new Set(prev)
        if (next.has(k)) next.delete(k)
        else next.add(k)
        return next
      })
    }
  }, [generation])

  const step = useCallback(() => {
    setLive((prev) => getNextGenerationSparse(prev))
    setGeneration((g) => g + 1)
  }, [])

  const reset = useCallback(() => {
    setIsPlaying(false)
    setLive(new Set(initialLive))
    setGeneration(0)
  }, [initialLive])

  const clear = useCallback(() => {
    setIsPlaying(false)
    const empty = new Set<string>()
    setLive(empty)
    setInitialLive(empty)
    setGeneration(0)
  }, [])

  const resetView = useCallback(() => {
    setCamRow(0)
    setCamCol(0)
    setOffsetXPx(0)
    setOffsetYPx(0)
    setCellSizePx(18)
  }, [])

  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = window.setInterval(() => {
        setLive((prev) => getNextGenerationSparse(prev))
        setGeneration((g) => g + 1)
      }, delayMs)
    }
    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [isPlaying, delayMs])

  const aliveCount = useMemo(() => live.size, [live])


  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLElement>) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const beforePitch = PITCH_PX
        // smooth zoom using an exponential response
        const scale = Math.exp(-e.deltaY * 0.002)
        const nextSize = clampCell(Math.round(cellSizePx * scale))
        if (nextSize === cellSizePx) return
        const afterPitch = nextSize + GAP_PX
        const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect()
        const localX = e.clientX - rect.left - PADDING_PX - (offsetXPx - LEAD_CELLS * PITCH_PX)
        const localY = e.clientY - rect.top - PADDING_PX - (offsetYPx - LEAD_CELLS * PITCH_PX)
        if (localX >= 0 && localY >= 0) {
          const vColBefore = localX / beforePitch
          const vRowBefore = localY / beforePitch
          const worldCol = camCol + vColBefore
          const worldRow = camRow + vRowBefore
          setCellSizePx(nextSize)
          const vColAfter = localX / afterPitch
          const vRowAfter = localY / afterPitch
          setCamCol(Math.round(worldCol - vColAfter))
          setCamRow(Math.round(worldRow - vRowAfter))
        } else {
          setCellSizePx(nextSize)
        }
      } else {
        // two-axis panning with wheel with smooth fractional offsets
        const nx = offsetXPx - e.deltaX
        const ny = offsetYPx - e.deltaY
        const dCols = Math.floor(nx / PITCH_PX)
        const dRows = Math.floor(ny / PITCH_PX)
        setCamCol((c) => c + dCols)
        setCamRow((r) => r + dRows)
        setOffsetXPx(nx - dCols * PITCH_PX)
        setOffsetYPx(ny - dRows * PITCH_PX)
      }
    },
    [PITCH_PX, cellSizePx, camRow, camCol, offsetXPx, offsetYPx],
  )

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'select' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) return
      if (e.code === 'Space') {
        e.preventDefault()
        setIsPlaying((p) => !p)
        return
      }
      if (e.key === 's' || e.key === 'S') {
        if (!isPlaying) step()
        return
      }
      if (e.key === 'r' || e.key === 'R') {
        reset()
        return
      }
      if (e.key === 'ArrowUp') { setCamRow((r) => r - (e.shiftKey ? 5 : 1)) }
      if (e.key === 'ArrowDown') { setCamRow((r) => r + (e.shiftKey ? 5 : 1)) }
      if (e.key === 'ArrowLeft') { setCamCol((c) => c - (e.shiftKey ? 5 : 1)) }
      if (e.key === 'ArrowRight') { setCamCol((c) => c + (e.shiftKey ? 5 : 1)) }
      if (e.key === '+' || e.key === '=') setCellSizePx((s) => clampCell(s + 2))
      if (e.key === '-' || e.key === '_') setCellSizePx((s) => clampCell(s - 2))
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isPlaying, step, reset])

  // Presets
  type PresetId = 'glider' | 'pulsar' | 'gosper' | 'block' | 'blinker' | 'toad' | 'beacon' | 'beehive' | 'boat' | 'rpentomino' | 'acorn' | 'diehard'
  const [preset, setPreset] = useState<PresetId>('glider')
  const PRESET_LABELS: Record<PresetId, string> = {
    glider: 'Glider', pulsar: 'Pulsar', gosper: 'Gosper Gun', block: 'Block', blinker: 'Blinker', toad: 'Toad', beacon: 'Beacon', beehive: 'Beehive', boat: 'Boat', rpentomino: 'R-Pentomino', acorn: 'Acorn', diehard: 'Diehard',
  }
  const PRESETS: Record<PresetId, Array<[number, number]>> = useMemo(() => ({
    glider: [
      [0, 1], [1, 2], [2, 0], [2, 1], [2, 2],
    ],
    block: [
      [0, 0], [0, 1], [1, 0], [1, 1],
    ],
    blinker: [
      [0, -1], [0, 0], [0, 1],
    ],
    toad: [
      [-1, 0], [-1, 1], [-1, 2],
      [0, -1], [0, 0], [0, 1],
    ],
    beacon: [
      [-1, -1], [-1, 0], [0, -1], [0, 0],
      [1, 1], [1, 2], [2, 1], [2, 2],
    ],
    beehive: [
      [0, -1], [0, 1],
      [1, -2], [1, 2],
      [2, -1], [2, 1],
    ],
    boat: [
      [0, 0], [0, 1], [1, 0], [1, 2], [2, 1],
    ],
    rpentomino: [
      [0, 0], [0, 1], [1, -1], [1, 0], [2, 0],
    ],
    pulsar: [
      // 48-cell pulsar centered at (0,0)
      [-6,-4],[-6,-3],[-6,-2],[-6,2],[-6,3],[-6,4],
      [-1,-4],[-1,-3],[-1,-2],[-1,2],[-1,3],[-1,4],
      [-8,-1],[-8,0],[-8,1],[-3,-1],[-3,0],[-3,1],
      [3,-1],[3,0],[3,1],[8,-1],[8,0],[8,1],
      [1,-4],[1,-3],[1,-2],[1,2],[1,3],[1,4],
      [6,-4],[6,-3],[6,-2],[6,2],[6,3],[6,4],
      [-4,-6],[-3,-6],[-2,-6],[2,-6],[3,-6],[4,-6],
      [-4,6],[-3,6],[-2,6],[2,6],[3,6],[4,6],
    ],
    gosper: [
      // Gosper glider gun
      [0,24],
      [1,22],[1,24],
      [2,12],[2,13],[2,20],[2,21],[2,34],[2,35],
      [3,11],[3,15],[3,20],[3,21],[3,34],[3,35],
      [4,0],[4,1],[4,10],[4,16],[4,20],[4,21],
      [5,0],[5,1],[5,10],[5,14],[5,16],[5,17],[5,22],[5,24],
      [6,10],[6,16],[6,24],
      [7,11],[7,15],
      [8,12],[8,13],
    ],
    acorn: [
      [0, 1],
      [1, 3],
      [2, 0], [2, 1], [2, 4], [2, 5], [2, 6],
    ],
    diehard: [
      [0, 6],
      [1, 0], [1, 1],
      [2, 1], [2, 5], [2, 6], [2, 7],
    ],
  }), [])

  // Preset picker popover
  const [isPresetOpen, setIsPresetOpen] = useState(false)
  const presetMenuRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!isPresetOpen) return
      if (presetMenuRef.current && !presetMenuRef.current.contains(e.target as Node)) {
        setIsPresetOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsPresetOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [isPresetOpen])

  function PresetPreview({ cells, size = 56 }: { cells: Array<[number, number]>; size?: number }) {
    if (!cells.length) return <svg width={size} height={size} />
    let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity
    for (const [r, c] of cells) {
      if (r < minR) minR = r
      if (r > maxR) maxR = r
      if (c < minC) minC = c
      if (c > maxC) maxC = c
    }
    const w = maxC - minC + 1
    const h = maxR - minR + 1
    const pad = 1
    const cell = Math.max(2, Math.floor((size - pad * (w + 1)) / Math.max(w, h)))
    const pitch = cell + pad
    const gridW = w * pitch + pad
    const gridH = h * pitch + pad
    const offX = Math.floor((size - gridW) / 2)
    const offY = Math.floor((size - gridH) / 2)
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <rect x={0} y={0} width={size} height={size} rx={8} fill="var(--elevated)" stroke="var(--border)" />
        {cells.map(([r, c], i) => {
          const x = offX + pad + (c - minC) * pitch
          const y = offY + pad + (r - minR) * pitch
          return <rect key={i} x={x} y={y} width={cell} height={cell} rx={2} fill="var(--foreground)" />
        })}
      </svg>
    )
  }

  const insertPreset = useCallback(() => {
    const shape = PRESETS[preset]
    if (!shape) return
    const next = new Set<string>()
    for (const [dr, dc] of shape) next.add(cellKey(camRow + dr, camCol + dc))
    setIsPlaying(false)
    setGeneration(0)
    setLive(next)
    setInitialLive(new Set(next))
  }, [PRESETS, preset, camRow, camCol])

  // Export/Import
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const exportToFile = useCallback((filename: string) => {
    const coords = Array.from(live).map((k) => k.split(',').map(Number))
    const blob = new Blob([JSON.stringify({ cells: coords }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename.endsWith('.json') ? filename : `${filename}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [live])

  const [isExportOpen, setIsExportOpen] = useState(false)
  const [exportName, setExportName] = useState('game-of-life')
  const exportInputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (isExportOpen) {
      setTimeout(() => exportInputRef.current?.select(), 0)
    }
  }, [isExportOpen])
  const confirmExport = useCallback(() => {
    const name = exportName.trim() || 'game-of-life'
    exportToFile(name)
    setIsExportOpen(false)
  }, [exportName, exportToFile])

  // Persist initial state and export name
  useEffect(() => {
    try {
      const cells = Array.from(initialLive).map((k) => k.split(',').map(Number))
      localStorage.setItem('gol_initial', JSON.stringify({ cells }))
    } catch {
      // ignore
    }
  }, [initialLive])

  useEffect(() => {
    try {
      localStorage.setItem('gol_export_name', exportName)
    } catch {
      // ignore
    }
  }, [exportName])

  const onImportClick = useCallback(() => fileInputRef.current?.click(), [])
  const onImportChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result)) as { cells: Array<[number, number]> }
        const next = new Set<string>()
        for (const [r, c] of data.cells ?? []) next.add(cellKey(r, c))
        setIsPlaying(false)
        setGeneration(0)
        setLive(next)
        setInitialLive(new Set(next))
      } catch {
        // ignore invalid
      }
    }
    reader.readAsText(file)
    e.currentTarget.value = ''
  }, [])

  const copyShareLink = useCallback(async () => {
    const coords = Array.from(initialLive).map((k) => k.split(',').map(Number) as [number, number])
    const encoded = encodeState(coords)
    const base = `${window.location.origin}${window.location.pathname}`
    const url = `${base}?state=${encoded}`
    try {
      await navigator.clipboard.writeText(url)
      setToastMessage('Link copied to clipboard')
      setIsToastVisible(true)
      if (toastTimeoutRef.current !== null) {
        window.clearTimeout(toastTimeoutRef.current)
      }
      toastTimeoutRef.current = window.setTimeout(() => {
        setIsToastVisible(false)
        toastTimeoutRef.current = null
      }, 1600)
    } catch {
      // fallback prompt
      window.prompt('Shareable link (copy)', url)
    }
  }, [initialLive])

  return (
    <div className="gol-root">
      {/* Mobile-only notice overlay */}
      <div className="mobile-overlay" role="dialog" aria-modal="true" aria-label="Mobile not supported">
        <h2 className="mobile-title">Available on desktop</h2>
        <p className="mobile-text">
          This site is optimized for larger screens and precise input. Please open it on a desktop or widen your browser window.
        </p>
      </div>
      <header className="gol-header">
        <h1 className="gol-title">Conway's Game of Life</h1>
        <div className="header-center" ref={presetMenuRef}>
          <button
            className="control-btn preset-trigger"
            onClick={() => setIsPresetOpen((v) => !v)}
            aria-expanded={isPresetOpen}
            aria-haspopup="menu"
            aria-label="Select preset"
            title="Choose a preset pattern"
          >
            <span className="label">Preset:</span>
            <span className="value">{PRESET_LABELS[preset]}</span>
            <svg className="caret" width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
              <path d="M3 4l3 4 3-4z" />
            </svg>
          </button>
          {isPresetOpen && (
            <div className="preset-menu" role="menu">
              <div className="preset-menu-title">Select a preset</div>
              {Object.keys(PRESETS).map((key) => {
                const id = key as PresetId
                return (
                  <button
                    key={id}
                    role="menuitemradio"
                    aria-checked={preset === id}
                    className={`preset-item ${preset === id ? 'active' : ''}`}
                    onClick={() => { setPreset(id); setIsPresetOpen(false) }}
                  >
                    <PresetPreview cells={PRESETS[id]} />
                    <span className="label">{PRESET_LABELS[id]}</span>
                  </button>
                )
              })}
            </div>
          )}
          <div className="header-actions">
            <button className="control-btn" onClick={insertPreset} aria-label="Insert preset">Insert</button>
            <button className="control-btn" onClick={() => setIsExportOpen(true)} aria-label="Export pattern">Export</button>
            <button className="control-btn" onClick={onImportClick} aria-label="Import pattern">Import</button>
            <button className="control-btn" onClick={copyShareLink} aria-label="Copy share link">Share</button>
            <input ref={fileInputRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={onImportChange} />
          </div>
        </div>
        <div className="gol-stats">
          <span>Alive {aliveCount}</span>
          <span>
            {rows}×{cols}
          </span>
        </div>
      </header>

      <main className="gol-stage">
        <div
          ref={viewportRef}
          className={`grid-viewport ${isDragging ? 'dragging' : ''}`}
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            overflow: 'hidden',
            cursor: isDragging ? 'grabbing' : 'grab',
            background: 'var(--border)',
            borderRadius: '12px',
          }}
          onMouseDown={(e) => {
            e.preventDefault()
            setIsDragging(true)
            isDraggingRef.current = true
            dragRef.current = {
              startX: e.clientX,
              startY: e.clientY,
              startOffsetX: offsetXPx,
              startOffsetY: offsetYPx,
              moved: false,
              startCamRow: camRow,
              startCamCol: camCol
            }
          }}
          onMouseMove={(e) => {
            if (!isDraggingRef.current) return
            const ref = dragRef.current
            const dx = e.clientX - ref.startX
            const dy = e.clientY - ref.startY
            
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
              ref.moved = true
            }
            
            const totalX = ref.startOffsetX + dx
            const totalY = ref.startOffsetY + dy
            const dCols = Math.floor(totalX / PITCH_PX)
            const dRows = Math.floor(totalY / PITCH_PX)
            
            setCamCol(ref.startCamCol - dCols)
            setCamRow(ref.startCamRow - dRows)
            setOffsetXPx(totalX - dCols * PITCH_PX)
            setOffsetYPx(totalY - dRows * PITCH_PX)
          }}
          onMouseUp={() => {
            setIsDragging(false)
            isDraggingRef.current = false
          }}
          onMouseLeave={() => {
            setIsDragging(false)
            isDraggingRef.current = false
          }}
          onClick={(e) => {
            if (isPlaying || dragRef.current.moved) return
            
            const rect = e.currentTarget.getBoundingClientRect()
            const x = e.clientX - rect.left
            const y = e.clientY - rect.top
            
            // Convert click coordinates to world coordinates directly
            const viewportCenterX = (viewportRef.current?.clientWidth || 800) / 2
            const viewportCenterY = (viewportRef.current?.clientHeight || 600) / 2
            
            const worldX = x - offsetXPx - viewportCenterX + PITCH_PX / 2 + camCol * PITCH_PX
            const worldY = y - offsetYPx - viewportCenterY + PITCH_PX / 2 + camRow * PITCH_PX
            
            const worldCol = Math.floor(worldX / PITCH_PX)
            const worldRow = Math.floor(worldY / PITCH_PX)
            
            toggleCell(worldRow, worldCol)
          }}
          onWheel={onWheel}
        >
          {Array.from({ length: rows + 8 }).map((_, r) =>
            Array.from({ length: cols + 8 }).map((_, c) => {
              const worldRow = camRow + r - Math.floor((rows + 8) / 2)
              const worldCol = camCol + c - Math.floor((cols + 8) / 2)
              const alive = live.has(cellKey(worldRow, worldCol))
              
              return (
                <div
                  key={`${worldRow}-${worldCol}`}
                  data-key={`${worldRow}-${worldCol}`}
                  className={`grid-cell ${alive ? 'alive' : ''}`}
                  style={{
                    position: 'absolute',
                    left: (worldCol - camCol) * PITCH_PX + offsetXPx + (viewportRef.current?.clientWidth || 800) / 2 - PITCH_PX / 2,
                    top: (worldRow - camRow) * PITCH_PX + offsetYPx + (viewportRef.current?.clientHeight || 600) / 2 - PITCH_PX / 2,
                    width: cellSizePx,
                    height: cellSizePx,
                    borderRadius: Math.max(2, Math.min(6, cellSizePx * 0.33)),
                    pointerEvents: 'none',
                  }}
                />
              )
            })
          )}
        </div>
        <div className="stage-actions">
          <button className="control-btn" onClick={resetView} aria-label="Reset view to default">Reset view</button>
          {!isPlaying && aliveCount > 0 && (
            <button
              className="control-btn danger"
              onClick={() => {
                const num = aliveCount
                if (num > 200) {
                  const ok = window.confirm(`Clear ${num} live cells? This cannot be undone.`)
                  if (!ok) return
                }
                clear()
              }}
              aria-label="Clear grid"
            >
              Clear
            </button>
          )}
      </div>
      </main>

      <div className="controls">
        <div className="control-group">
          <button
          className={`control-btn primary ${isPlaying ? 'active' : ''}`}
          onClick={() => setIsPlaying((p) => !p)}
          aria-label={isPlaying ? 'Pause' : 'Start'}
        >
          <span className="icon" aria-hidden>
            {isPlaying ? (
              // pause icon
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <rect x="3" y="2" width="4" height="12" rx="1" />
                <rect x="9" y="2" width="4" height="12" rx="1" />
              </svg>
            ) : (
              // play icon
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M4 2l10 6-10 6V2z" />
              </svg>
            )}
          </span>
          {isPlaying ? 'Pause' : 'Start'}
        </button>

        <button className="control-btn" onClick={reset} aria-label="Reset">
          <span className="icon" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 5V1L7 6l5 5V7c3.309 0 6 2.691 6 6s-2.691 6-6 6-6-2.691-6-6H4c0 4.411 3.589 8 8 8s8-3.589 8-8-3.589-8-8-8z" />
            </svg>
          </span>
          Reset
        </button>

        <button
          className="control-btn"
          onClick={() => !isPlaying && step()}
          disabled={isPlaying}
          aria-label="Step"
        >
          <span className="icon" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M4 3l10 9-10 9z" />
              <rect x="16" y="3" width="4" height="18" />
            </svg>
          </span>
          Step
        </button>
        </div>
        <div className="gen" aria-live="polite" aria-atomic="true">
          <span className="gen-label">Gen</span>
          <span className="gen-value">{generation}</span>
        </div>
        
        <div className="speed">
          <span className="speed-label">Delay</span>
          <input
            id="delay"
            type="range"
            min={20}
            max={1000}
            step={10}
            value={delayMs}
            onChange={(e) => setDelayMs(Number(e.target.value))}
            aria-label="Simulation delay in milliseconds"
          />
          <span className="speed-value">{delayMs}ms</span>
          <div className="tools"></div>
        </div>
      </div>
      {isExportOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Name export file" onClick={() => setIsExportOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Save pattern</h2>
            <label className="modal-label" htmlFor="export-name">Filename</label>
            <div className="modal-row">
              <input
                id="export-name"
                ref={exportInputRef}
                className="text-input"
                value={exportName}
                onChange={(e) => setExportName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmExport()
                  if (e.key === 'Escape') setIsExportOpen(false)
                }}
                autoFocus
              />
              <span className="ext">.json</span>
            </div>
            <div className="modal-actions">
              <button className="control-btn" onClick={() => setIsExportOpen(false)}>Cancel</button>
              <button className="control-btn primary" onClick={confirmExport}>Save</button>
            </div>
          </div>
        </div>
      )}
      {/* Toast notification */}
      <div className={`toast ${isToastVisible ? 'visible' : ''}`} role="status" aria-live="polite" aria-atomic="true">
        {toastMessage}
      </div>
    </div>
  )
}

export default App
