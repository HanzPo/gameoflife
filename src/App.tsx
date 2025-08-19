import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
type LiveSet = Set<string>

function cellKey(row: number, col: number): string {
  return `${row},${col}`
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
  const [cellSizePx, setCellSizePx] = useState(18)
  const GAP_PX = 2
  const PADDING_PX = 2
  const PITCH_PX = useMemo(() => cellSizePx + GAP_PX, [cellSizePx])
  const LEAD_CELLS = 1

  const clampCell = (v: number) => Math.min(42, Math.max(10, v))
  const [offsetXPx, setOffsetXPx] = useState(0)
  const [offsetYPx, setOffsetYPx] = useState(0)

  // Resize grid when window changes, keeping current cells if possible
  useEffect(() => {
    function handleResize() {
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const controlBarHeight = 120
      const padding = 48
      const maxCols = Math.max(8, Math.floor((viewportWidth - padding) / PITCH_PX))
      const maxRows = Math.max(8, Math.floor((viewportHeight - controlBarHeight - padding) / PITCH_PX))
      setRows(maxRows)
      setCols(maxCols)
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [PITCH_PX])

  // Load last initial state and last export name
  useEffect(() => {
    try {
      const saved = localStorage.getItem('gol_initial')
      if (saved) {
        const data = JSON.parse(saved) as { cells?: Array<[number, number]> }
        const set = new Set<string>()
        for (const [r, c] of data.cells ?? []) set.add(cellKey(r, c))
        setInitialLive(set)
        setLive(new Set(set))
        setGeneration(0)
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

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(true)
    dragRef.current = { startX: e.clientX, startY: e.clientY, startOffsetX: offsetXPx, startOffsetY: offsetYPx, moved: false, startCamRow: camRow, startCamCol: camCol }
    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
  }, [offsetXPx, offsetYPx, camRow, camCol])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return
    const ref = dragRef.current
    const dx = e.clientX - ref.startX
    const dy = e.clientY - ref.startY
    const totalX = ref.startOffsetX + dx
    const totalY = ref.startOffsetY + dy
    const dCols = Math.floor(totalX / PITCH_PX)
    const dRows = Math.floor(totalY / PITCH_PX)
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      ref.moved = true
    }
    const newCamCol = ref.startCamCol - dCols
    const newCamRow = ref.startCamRow - dRows
    const remX = totalX - dCols * PITCH_PX
    const remY = totalY - dRows * PITCH_PX
    setCamCol(newCamCol)
    setCamRow(newCamRow)
    setOffsetXPx(remX)
    setOffsetYPx(remY)
  }, [isDragging, PITCH_PX])

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const ref = dragRef.current
    setIsDragging(false)
    ;(e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId)
    if (!ref.moved && !isPlaying) {
      const gridEl = e.currentTarget
      const rect = gridEl.getBoundingClientRect()
      // rect already reflects the CSS transform translation; only subtract padding
      const localX = e.clientX - rect.left - PADDING_PX
      const localY = e.clientY - rect.top - PADDING_PX
      if (localX >= 0 && localY >= 0) {
        const vc = Math.floor(localX / PITCH_PX)
        const vr = Math.floor(localY / PITCH_PX)
        if (vc >= 0 && vc < cols + LEAD_CELLS && vr >= 0 && vr < rows + LEAD_CELLS) {
          const wr = camRow + vr - LEAD_CELLS
          const wc = camCol + vc - LEAD_CELLS
          toggleCell(wr, wc)
        }
      }
    }
  }, [isPlaying, toggleCell, camRow, camCol, cols, rows, PITCH_PX])

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const beforePitch = PITCH_PX
        // smooth zoom using an exponential response
        const scale = Math.exp(-e.deltaY * 0.002)
        const nextSize = clampCell(Math.round(cellSizePx * scale))
        if (nextSize === cellSizePx) return
        const afterPitch = nextSize + GAP_PX
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
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
    const centerR = camRow + Math.floor(rows / 2)
    const centerC = camCol + Math.floor(cols / 2)
    const next = new Set<string>()
    for (const [dr, dc] of shape) next.add(cellKey(centerR + dr, centerC + dc))
    setIsPlaying(false)
    setGeneration(0)
    setLive(next)
    setInitialLive(new Set(next))
  }, [PRESETS, preset, camRow, camCol, rows, cols])

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

  return (
    <div className="gol-root">
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
          className={`grid ${isDragging ? 'dragging' : ''}`}
          style={{
            gridTemplateColumns: `repeat(${cols + LEAD_CELLS}, ${cellSizePx}px)`,
            transform: `translate(${offsetXPx - LEAD_CELLS * PITCH_PX}px, ${offsetYPx - LEAD_CELLS * PITCH_PX}px)`,
          }}
          role="grid"
          aria-label="Editable grid to set initial state"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          {Array.from({ length: rows + LEAD_CELLS }).map((_, vr) =>
            Array.from({ length: cols + LEAD_CELLS }).map((__, vc) => {
              const wr = camRow + (vr - LEAD_CELLS)
              const wc = camCol + (vc - LEAD_CELLS)
              const alive = live.has(cellKey(wr, wc))
              return (
                <button
                  key={`${vr}-${vc}`}
                  className={`cell ${alive ? 'alive' : ''}`}
                  aria-pressed={alive}
                  aria-label={`Cell ${wr}, ${wc} ${alive ? 'alive' : 'dead'}`}
                  data-r={wr}
                  data-c={wc}
                  disabled={isPlaying}
                />
              )
            }),
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
    </div>
  )
}

export default App
