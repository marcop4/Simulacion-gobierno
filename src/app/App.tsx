import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import {
  Play, Pause, RotateCcw, ZoomIn, ZoomOut, Info, X,
  Clock, DollarSign, TrendingUp, TrendingDown, Layers,
  ChevronRight, AlertTriangle, CheckCircle, Users, Activity,
  Eye, EyeOff, GitMerge, Target, BookOpen, Shield, Link, Unlink,
  Plus, Pencil, Trash2, Check, ChevronUp, ChevronDown
} from "lucide-react"

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────
interface StationDef {
  id: string
  label: string
  sublabel: string
  x: number
  y: number
  capacity: number
  procTicks: number
  icon: string
  color: string
  glowColor: string
  isNew?: boolean
  isBottleneck?: boolean
  cobitRef?: string
}

interface Entity {
  id: number
  stationIdx: number
  phase: "moving" | "queuing" | "processing"
  moveProg: number
  procProg: number
  queueSlot: number
  birthTick: number
}

interface SimData {
  entities: Entity[]
  queues: number[][]
  slots: (number | null)[][]
  nextId: number
  tickCount: number
  completedTicks: number[]
  totalEntities: number
}

interface DisplayStats {
  completed: number
  avgTime: number
  totalCost: number
  unitCost: number
  queueSizes: number[]
  utilization: number[]
  throughput: number
  ticksElapsed: number
}

type ViewMode = "slider" | "split"
type SpeedLevel = 1 | 2 | 4 | 8

// ─────────────────────────────────────────────────────────────
// STATION CONFIGS
// ─────────────────────────────────────────────────────────────
const CW = 960
const CH = 260

function makeStations(mode: "before" | "after"): StationDef[] {
  const y = CH / 2
  const xs = [70, 210, 340, 480, 610, 750, 890]

  if (mode === "before") {
    return [
      { id: "user", label: "Usuario", sublabel: "Detecta y Reporta", x: xs[0], y, capacity: 20, procTicks: 10, icon: "👤", color: "#94a3b8", glowColor: "#94a3b8", isBottleneck: false },
      { id: "soporte_q", label: "Cola Espera", sublabel: "Sin Mesa de Ayuda", x: xs[1], y, capacity: 30, procTicks: 2, icon: "⏳", color: "#ef4444", glowColor: "#ef4444", isBottleneck: true },
      { id: "soporte", label: "Soporte Técnico", sublabel: "1 operador · Sin protocolo", x: xs[2], y, capacity: 1, procTicks: 30, icon: "🔧", color: "#f97316", glowColor: "#f97316", isBottleneck: true },
      { id: "escal_q", label: "Cola Escalado", sublabel: "Escalamiento manual", x: xs[3], y, capacity: 20, procTicks: 2, icon: "⏳", color: "#ef4444", glowColor: "#ef4444", isBottleneck: true },
      { id: "specialist", label: "Especialista", sublabel: "Sistemas · 1 recurso", x: xs[4], y, capacity: 1, procTicks: 65, icon: "💻", color: "#8b5cf6", glowColor: "#8b5cf6", isBottleneck: true },
      { id: "eva", label: "Dinamizador EVA", sublabel: "Sin métricas / reportes", x: xs[5], y, capacity: 1, procTicks: 30, icon: "📊", color: "#ec4899", glowColor: "#ec4899" },
      { id: "done", label: "Cierre", sublabel: "Con documentación básica", x: xs[6], y, capacity: 100, procTicks: 5, icon: "📋", color: "#475569", glowColor: "#475569" },
    ]
  }

  return [
    { id: "portal", label: "Portal Web", sublabel: "Sistema de Tickets · DSS02", x: xs[0], y, capacity: 20, procTicks: 5, icon: "🌐", color: "#38bdf8", glowColor: "#38bdf8", isNew: true, cobitRef: "DSS02" },
    { id: "helpdesk", label: "Mesa de Ayuda", sublabel: "Categoriza y Deriva", x: xs[1], y, capacity: 3, procTicks: 5, icon: "🎯", color: "#06b6d4", glowColor: "#06b6d4", isNew: true, cobitRef: "APO08" },
    { id: "assign", label: "TÉCNICO", sublabel: "Especialista en sistemas", x: xs[2], y, capacity: 2, procTicks: 5, icon: "📥", color: "#10b981", glowColor: "#10b981", cobitRef: "APO07" },
    { id: "specialist", label: "Especialista N2", sublabel: "Resolución en plataforma", x: xs[3], y, capacity: 2, procTicks: 30, icon: "💻", color: "#22c55e", glowColor: "#22c55e", cobitRef: "DSS02" },
    { id: "kb", label: "Documentación", sublabel: "Especialista en sistemas", x: xs[4], y, capacity: 2, procTicks: 5, icon: "📚", color: "#a3e635", glowColor: "#a3e635", isNew: true, cobitRef: "BAI08" },
    { id: "eva", label: "Dinamizador EVA", sublabel: "Verificar documentación", x: xs[5], y, capacity: 2, procTicks: 10, icon: "📊", color: "#84cc16", glowColor: "#84cc16", cobitRef: "MEA01" },
    { id: "done", label: "Cierre de Ticket", sublabel: "Notificar al usuario", x: xs[6], y, capacity: 100, procTicks: 3, icon: "✅", color: "#4ade80", glowColor: "#4ade80" },
  ]
}

// ─────────────────────────────────────────────────────────────
// SIMULATION ENGINE (using refs, no re-render per tick)
// ─────────────────────────────────────────────────────────────
function createSimData(): SimData {
  return {
    entities: [],
    queues: Array.from({ length: 7 }, () => [] as number[]),
    slots: Array.from({ length: 7 }, () => [] as (number | null)[]),
    nextId: 0,
    tickCount: 0,
    completedTicks: [],
    totalEntities: 0,
  }
}

function tickSimulation(
  data: SimData,
  stations: StationDef[],
  spawnEvery: number,
  speed: number
): SimData {
  const N = stations.length
  const d = structuredClone(data)

  // Init slots if needed
  for (let si = 0; si < N; si++) {
    while (d.slots[si].length < stations[si].capacity) {
      d.slots[si].push(null)
    }
  }

  // Process multiple sub-ticks per frame (speed)
  for (let s = 0; s < speed; s++) {
    d.tickCount++

    // Spawn
    if (d.tickCount % spawnEvery === 0 && d.entities.length < 60) {
      const eid = d.nextId++
      d.totalEntities++
      const entity: Entity = {
        id: eid,
        stationIdx: 0,
        phase: "queuing",
        moveProg: 0,
        procProg: 0,
        queueSlot: 0,
        birthTick: d.tickCount,
      }
      d.entities.push(entity)
      d.queues[0].push(eid)
    }

    // Assign queued entities to free slots
    for (let si = 0; si < N; si++) {
      const q = d.queues[si]
      for (let slot = 0; slot < stations[si].capacity; slot++) {
        if (d.slots[si][slot] === null && q.length > 0) {
          const eid = q.shift()!
          d.slots[si][slot] = eid
          const e = d.entities.find(x => x.id === eid)
          if (e) {
            e.phase = "processing"
            e.procProg = 0
          }
        }
      }
      // Update queue slots for display
      q.forEach((eid, i) => {
        const e = d.entities.find(x => x.id === eid)
        if (e) e.queueSlot = i
      })
    }

    // Update processing
    for (let si = 0; si < N; si++) {
      for (let slot = 0; slot < stations[si].capacity; slot++) {
        const eid = d.slots[si][slot]
        if (eid === null) continue
        const e = d.entities.find(x => x.id === eid)
        if (!e) continue

        e.procProg += 1 / stations[si].procTicks

        if (e.procProg >= 1) {
          // Done at this station
          d.slots[si][slot] = null
          if (si >= N - 1) {
            // Completed
            d.completedTicks.push(d.tickCount - e.birthTick)
            d.entities = d.entities.filter(x => x.id !== eid)
          } else {
            // Move to next station
            e.stationIdx = si + 1
            e.phase = "moving"
            e.moveProg = 0
            e.procProg = 0
          }
        }
      }
    }

    // Update moving entities
    for (const e of d.entities) {
      if (e.phase === "moving") {
        e.moveProg += 0.05
        if (e.moveProg >= 1) {
          e.moveProg = 1
          e.phase = "queuing"
          d.queues[e.stationIdx].push(e.id)
        }
      }
    }
  }

  return d
}

function computeStats(data: SimData, stations: StationDef[], costPer: number): DisplayStats {
  const completed = data.completedTicks.length
  const avgTime = completed > 0
    ? data.completedTicks.reduce((a, b) => a + b, 0) / completed
    : 0
  const totalCost = completed * costPer
  const queueSizes = data.queues.map(q => q.length)
  const utilization = stations.map((s, i) => {
    const busy = data.slots[i].filter(x => x !== null).length
    return s.capacity > 0 ? busy / s.capacity : 0
  })
  const throughput = data.tickCount > 0
    ? (completed / data.tickCount) * 100
    : 0

  return {
    completed,
    avgTime,
    totalCost,
    unitCost: costPer,
    queueSizes,
    utilization,
    throughput,
    ticksElapsed: data.tickCount,
  }
}

// ─────────────────────────────────────────────────────────────
// PERSON ICON SVG
// ─────────────────────────────────────────────────────────────
function PersonIcon({ color, size = 18, walking = false }: { color: string; size?: number; walking?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg"
      style={walking ? { animation: "walkBob 0.4s ease-in-out infinite alternate" } : undefined}
    >
      <circle cx="10" cy="4" r="3.5" fill={color} />
      <rect x="7" y="9" width="6" height="8" rx="2" fill={color} />
      <rect x="5.5" y="10" width="2.5" height="6" rx="1.2" fill={color} opacity="0.8" />
      <rect x="12" y="10" width="2.5" height="6" rx="1.2" fill={color} opacity="0.8" />
      <rect x="7" y="17" width="2.5" height="6" rx="1.2" fill={color} opacity="0.9" />
      <rect x="10.5" y="17" width="2.5" height="6" rx="1.2" fill={color} opacity="0.9" />
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────
// SIMULATION CANVAS
// ─────────────────────────────────────────────────────────────
function SimulationCanvas({
  mode,
  simData,
  stations,
  showAnnotations,
  zoom = 1,
  pan = { x: 0, y: 0 }
}: {
  mode: "before" | "after"
  simData: SimData
  stations: StationDef[]
  showAnnotations: boolean
  zoom?: number
  pan?: { x: number, y: number }
}) {
  const entityColor = mode === "before" ? "#fb923c" : "#34d399"
  const processingColor = mode === "before" ? "#fbbf24" : "#6ee7b7"
  const gridColor = mode === "before" ? "rgba(239,68,68,0.04)" : "rgba(16,185,129,0.04)"
  const borderColor = mode === "before" ? "rgba(239,68,68,0.3)" : "rgba(16,185,129,0.3)"
  const headerBg = mode === "before"
    ? "linear-gradient(90deg, rgba(239,68,68,0.15), rgba(251,146,60,0.1))"
    : "linear-gradient(90deg, rgba(16,185,129,0.15), rgba(56,189,248,0.1))"

  return (
    <div className="relative flex flex-col h-full" style={{ fontFamily: "var(--font-body)" }}>
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 shrink-0" style={{ background: headerBg, borderBottom: `1px solid ${borderColor}` }}>
        {mode === "before" ? (
          <>
            <AlertTriangle size={16} className="text-orange-400" />
            <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: "#f97316", fontFamily: "var(--font-display)" }}>ANTES — Sin Gobierno de TI</span>
            <span className="ml-auto text-xs text-slate-500">Proceso PS8.1 · Sin COBIT</span>
          </>
        ) : (
          <>
            <CheckCircle size={16} className="text-emerald-400" />
            <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: "#10b981", fontFamily: "var(--font-display)" }}>DESPUÉS — Con Gobierno de TI · COBIT 2019</span>
            <span className="ml-auto text-xs text-slate-500">EESPP "Tarapoto" · Framework</span>
          </>
        )}
      </div>

      {/* Canvas area */}
      <div className="relative flex-1 overflow-hidden" style={{ background: "#060e1c" }}>
        {/* Grid pattern */}
        <div className="absolute inset-0" style={{
          backgroundImage: `
            linear-gradient(${gridColor} 1px, transparent 1px),
            linear-gradient(90deg, ${gridColor} 1px, transparent 1px)
          `,
          backgroundSize: "40px 40px",
        }} />

        <svg
          viewBox={`0 0 ${CW} ${CH}`}
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid meet"
          style={{ position: "absolute", inset: 0, overflow: "visible" }}
        >
          <defs>
            <marker id={`arrow-${mode}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M 0 0 L 6 3 L 0 6 Z" fill={mode === "before" ? "#475569" : "#334155"} />
            </marker>
            {stations.map(s => (
              <radialGradient key={s.id} id={`glow-${mode}-${s.id}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={s.glowColor} stopOpacity="0.3" />
                <stop offset="100%" stopColor={s.glowColor} stopOpacity="0" />
              </radialGradient>
            ))}
          </defs>

          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`} style={{ transformOrigin: "center" }}>
          {/* Connection lines */}
          {stations.slice(0, -1).map((s, i) => {
            const next = stations[i + 1]
            const mx = (s.x + next.x) / 2
            return (
              <g key={`conn-${i}`}>
                <line
                  x1={s.x + 46} y1={s.y}
                  x2={next.x - 46} y2={next.y}
                  stroke={mode === "before" ? "#1e2d40" : "#1a2f40"}
                  strokeWidth="2"
                  strokeDasharray={s.isBottleneck ? "4 3" : undefined}
                  markerEnd={`url(#arrow-${mode})`}
                />
                {/* Flow label */}
                <text x={mx} y={s.y - 16} textAnchor="middle" fontSize="9" fill="#334155" fontFamily="var(--font-mono)">
                  {i === 0 ? "notifica" : i === 1 ? "cola" : i === 2 ? "escala" : i === 3 ? "resuelve" : i === 4 ? "reporta" : "cierra"}
                </text>
              </g>
            )
          })}

          {/* Station nodes */}
          {stations.map((s) => {
            const qSize = simData.queues[stations.indexOf(s)]?.length ?? 0
            const processingCount = simData.slots[stations.indexOf(s)]?.filter(x => x !== null).length ?? 0
            const isBusy = processingCount > 0
            const isOverloaded = qSize > 3
            const si = stations.indexOf(s)

            return (
              <g key={s.id}>
                {/* Glow circle */}
                {(isBusy || isOverloaded) && (
                  <circle cx={s.x} cy={s.y} r={52} fill={`url(#glow-${mode}-${s.id})`} />
                )}

                {/* Bottleneck pulse ring */}
                {s.isBottleneck && isOverloaded && (
                  <circle cx={s.x} cy={s.y} r={48}
                    stroke="#ef4444" strokeWidth="1.5" fill="none" opacity="0.5"
                    style={{ animation: "pulseRing 1.2s ease-out infinite" }}
                  />
                )}

                {/* Station box */}
                <rect
                  x={s.x - 44} y={s.y - 36}
                  width={88} height={72}
                  rx={8}
                  fill={`${s.color}15`}
                  stroke={isOverloaded && s.isBottleneck ? "#ef4444" : s.color}
                  strokeWidth={isBusy ? 1.5 : 1}
                  strokeOpacity={isBusy ? 1 : 0.4}
                />

                {/* NEW badge */}
                {s.isNew && (
                  <g>
                    <rect x={s.x + 20} y={s.y - 48} width={28} height={13} rx={3} fill="#06b6d4" />
                    <text x={s.x + 34} y={s.y - 38} textAnchor="middle" fontSize="8" fill="#fff" fontWeight="700" fontFamily="var(--font-display)">NUEVO</text>
                  </g>
                )}

                {/* Bottleneck badge */}
                {s.isBottleneck && (
                  <g>
                    <rect x={s.x - 48} y={s.y - 48} width={34} height={13} rx={3} fill="#ef4444" />
                    <text x={s.x - 31} y={s.y - 38} textAnchor="middle" fontSize="7.5" fill="#fff" fontWeight="700" fontFamily="var(--font-display)">CUELLO</text>
                  </g>
                )}

                {/* Time Badge */}
                <g transform={`translate(${s.x - 42}, ${s.y - 33})`}>
                  <rect x={0} y={0} width={26} height={10} rx={3} fill="#0d1829" stroke={s.color} strokeWidth={0.4} opacity={0.9} />
                  <text x={13} y={7.5} textAnchor="middle" fontSize="5.5" fill={s.color} fontWeight="700" fontFamily="var(--font-mono)">
                    ⏱ {s.procTicks}m
                  </text>
                </g>

                {/* Icon */}
                <text x={s.x} y={s.y - 10} textAnchor="middle" fontSize="20">{s.icon}</text>

                {/* Label */}
                <text x={s.x} y={s.y + 10} textAnchor="middle" fontSize="9.5" fill={s.color} fontWeight="600" fontFamily="var(--font-display)">
                  {s.label}
                </text>
                <foreignObject x={s.x - 42} y={s.y + 14} width={84} height={20}>
                  <div xmlns="http://www.w3.org/1999/xhtml" style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '7px', color: '#475569', fontFamily: 'var(--font-body)', textAlign: 'center', lineHeight: '1', display: 'block', padding: '0 2px' }}>
                      {s.sublabel}
                    </span>
                  </div>
                </foreignObject>

                {/* COBIT ref */}
                {s.cobitRef && (
                  <text x={s.x} y={s.y + 34} textAnchor="middle" fontSize="7" fill="#38bdf8" opacity="0.8" fontFamily="var(--font-mono)">
                    [{s.cobitRef}]
                  </text>
                )}

                {/* Processing entities - shown AT station */}
                {Array.from({ length: processingCount }).map((_, idx) => {
                  const px = s.x - 6 + idx * 14
                  const py = s.y - 55
                  return (
                    <g key={`proc-${s.id}-${idx}`} transform={`translate(${px - 7}, ${py - 12})`}
                      style={{ animation: "procPulse 1.5s ease-in-out infinite" }}
                    >
                      <PersonIcon color={processingColor} size={16} walking />
                    </g>
                  )
                })}

                {/* Queue entities - stacked below station */}
                {simData.queues[si]?.slice(0, 8).map((eid, qi) => {
                  const qx = s.x - 38 + (qi % 4) * 20
                  const qy = s.y + 46 + Math.floor(qi / 4) * 22
                  return (
                    <g key={`q-${eid}`} transform={`translate(${qx - 8}, ${qy - 12})`}>
                      <PersonIcon color={entityColor} size={15} />
                    </g>
                  )
                })}

                {/* Queue overflow count */}
                {qSize > 8 && (
                  <text x={s.x + 30} y={s.y + 58} fontSize="9" fill="#ef4444" fontWeight="700" fontFamily="var(--font-mono)">
                    +{qSize - 8}
                  </text>
                )}

                {/* Queue size badge */}
                {qSize > 0 && (
                  <g>
                    <circle cx={s.x + 36} cy={s.y - 38} r={10} fill={isOverloaded ? "#ef4444" : "#1e3a52"} />
                    <text x={s.x + 36} y={s.y - 34} textAnchor="middle" fontSize="9" fill="#fff" fontWeight="700" fontFamily="var(--font-mono)">
                      {qSize}
                    </text>
                  </g>
                )}

                {/* Utilization bar */}
                <rect x={s.x - 44} y={s.y + 38} width={88} height={4} rx={2} fill="#0d1829" />
                <rect
                  x={s.x - 44} y={s.y + 38}
                  width={88 * (processingCount / Math.max(1, s.capacity))}
                  height={4} rx={2}
                  fill={processingCount >= s.capacity ? (mode === "before" ? "#ef4444" : "#10b981") : s.color}
                />
              </g>
            )
          })}

          {/* Moving entities */}
          {simData.entities
            .filter(e => e.phase === "moving")
            .map(e => {
              const fromStation = stations[e.stationIdx - 1] ?? stations[0]
              const toStation = stations[e.stationIdx]
              if (!fromStation || !toStation) return null
              const px = fromStation.x + (toStation.x - fromStation.x) * e.moveProg
              const py = fromStation.y + Math.sin(e.moveProg * Math.PI) * -20
              return (
                <g key={`mov-${e.id}`} transform={`translate(${px - 8}, ${py - 20})`}
                  style={{ transition: "transform 0.05s linear" }}
                >
                  <PersonIcon color={entityColor} size={16} walking />
                </g>
              )
            })}
          </g>
        </svg>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// ANNOTATION PANEL
// ─────────────────────────────────────────────────────────────
const INITIAL_ANNOTATIONS = [
  {
    id: 1,
    title: "🏆 METAS GANADORAS COBIT 2019",
    body: "Tras evaluar los Factores de Diseño, el alcance concluido prioriza estas 4 metas ganadoras, todas con un Nivel de Capacidad Objetivo de 3:\n\n• BAI05: Managed Organizational Change (Puntaje: 65)\n• BAI01: Managed Programs (Puntaje: 60)\n• APO02: Managed Strategy (Puntaje: 60)\n• EDM04: Ensured Resource Optimization (Puntaje: 60)",
    mode: "after" as const,
    color: "#a855f7",
  },
  {
    id: 2,
    title: "CUELLO DE BOTELLA: Soporte Técnico",
    body: "La falta de canales formales y Mesa de Ayuda genera alta frustración. Un solo operador de soporte asume toda la carga sin priorización (ausencia de EDM04: Optimización de Recursos), creando colas crecientes.",
    mode: "before" as const,
    color: "#ef4444",
  },
  {
    id: 3,
    title: "CUELLO DE BOTELLA: Especialista de Sistemas",
    body: "La mala optimización de recursos (ausencia de EDM04) hace que toda intervención escale al único especialista (65 min). Además, sin procesos para identificar y construir soluciones, los diagnósticos son informales y demorados.",
    mode: "before" as const,
    color: "#f97316",
  },
  {
    id: 4,
    title: "Mesa de Ayuda — BAI05",
    body: "Implementar la Mesa de Ayuda para gestionar el cambio organizativo (BAI05) permite traducir empáticamente las necesidades de los docentes y vencer su resistencia tecnológica. 3 agentes distribuyen la carga eficientemente.",
    mode: "after" as const,
    color: "#06b6d4",
  },
  {
    id: 5,
    title: "Gestión del Cambio Organizativo — BAI05",
    body: "Fijado en Nivel 3, BAI05 gestiona el factor humano: acompaña al docente del EVA y reduce la brecha digital. Se empodera a los usuarios y las incidencias recurrentes caen un 40%.",
    mode: "after" as const,
    color: "#a3e635",
  },
  {
    id: 6,
    title: "Cascada de Metas COBIT 2019",
    body: "El modelo alineó los Objetivos Estratégicos del PEI con Metas Empresariales y de Alineamiento, pre-seleccionando un abanico de Objetivos de Gobierno y Gestión que luego fueron depurados por los Factores de Diseño.",
    mode: "after" as const,
    color: "#8b5cf6",
  },
  {
    id: 7,
    title: "Costo por Incidencia — EDM04",
    body: "ANTES: S/. 38.35 por incidencia. DESPUÉS: Con EDM04 (Asegurar Optimización de Recursos) y BAI01 (Gestión de Programas), el modelo reduce el costo a S/. 18.58, garantizando retorno de inversión.",
    mode: "before" as const,
    color: "#fbbf24",
  },
]

// ─────────────────────────────────────────────────────────────
// COBIT DOMAINS PANEL
// ─────────────────────────────────────────────────────────────
const COBIT_DOMAINS = [
  {
    code: "EDM",
    name: "Evaluar, Dirigir y Monitorizar",
    color: "#8b5cf6",
    items: ["EDM01 Marco de Gobierno", "EDM02 Obtención de Beneficios", "EDM04 Optimización Recursos"],
    icon: <Shield size={14} />,
  },
  {
    code: "APO",
    name: "Alinear, Planificar y Organizar",
    color: "#38bdf8",
    items: ["APO07 Recursos Humanos", "APO08 Gestión Relaciones", "APO09 Acuerdos de Servicio", "APO11 Calidad"],
    icon: <Target size={14} />,
  },
  {
    code: "BAI",
    name: "Construir, Adquirir e Implementar",
    color: "#10b981",
    items: ["BAI02 Definición Requisitos", "BAI05 Cambio Organizativo", "BAI08 Conocimiento", "BAI11 Proyectos"],
    icon: <GitMerge size={14} />,
  },
  {
    code: "DSS",
    name: "Entregar, Dar Servicio y Soporte",
    color: "#f59e0b",
    items: ["DSS02 Incidentes", "DSS03 Problemas", "DSS04 Continuidad"],
    icon: <Activity size={14} />,
  },
  {
    code: "MEA",
    name: "Monitorizar, Evaluar y Valorar",
    color: "#ec4899",
    items: ["MEA01 Rendimiento", "MEA02 Control Interno", "MEA04 Aseguramiento"],
    icon: <BookOpen size={14} />,
  },
]

// ─────────────────────────────────────────────────────────────
// KPI CARD
// ─────────────────────────────────────────────────────────────
function KpiCard({ label, before, after, unit = "", unitBefore, prefix = "", better = "lower", icon, subBefore, subAfter }: {
  label: string; before: number; after: number; unit?: string; unitBefore?: string; prefix?: string; better?: "lower" | "higher"; icon: React.ReactNode; subBefore?: React.ReactNode; subAfter?: React.ReactNode
}) {
  const improved = better === "lower" ? after < before : after > before
  const pct = before > 0 ? Math.abs((after - before) / before * 100) : 0

  return (
    <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: "#0d1829", border: "1px solid rgba(56,189,248,0.1)" }}>
      <div className="flex items-center gap-2 text-slate-400 text-xs uppercase tracking-wider" style={{ fontFamily: "var(--font-display)" }}>
        {icon}{label}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg p-2.5 text-center flex flex-col items-center justify-center" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
          <div className="text-xs text-orange-400 mb-1 font-medium" style={{ fontFamily: "var(--font-display)" }}>ANTES</div>
          <div className="text-xl font-bold text-orange-300" style={{ fontFamily: "var(--font-mono)" }}>
            {prefix}{typeof before === "number" ? before.toFixed(before < 10 ? 1 : 0) : before}{unitBefore !== undefined ? unitBefore : unit}
          </div>
          {subBefore && <div className="text-[10px] text-orange-400/70 mt-1">{subBefore}</div>}
        </div>
        <div className="rounded-lg p-2.5 text-center flex flex-col items-center justify-center" style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
          <div className="text-xs text-emerald-400 mb-1 font-medium" style={{ fontFamily: "var(--font-display)" }}>DESPUÉS</div>
          <div className="text-xl font-bold text-emerald-300" style={{ fontFamily: "var(--font-mono)" }}>
            {prefix}{typeof after === "number" ? after.toFixed(after < 10 ? 1 : 0) : after}{unit}
          </div>
          {subAfter && <div className="text-[10px] text-emerald-400/70 mt-1">{subAfter}</div>}
        </div>
      </div>
      <div className={`flex items-center gap-1.5 text-xs font-semibold rounded-lg px-2.5 py-1.5 ${improved ? "text-emerald-400" : "text-red-400"}`}
        style={{ background: improved ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)", fontFamily: "var(--font-display)" }}>
        {improved ? <TrendingDown size={12} /> : <TrendingUp size={12} />}
        {improved ? `Mejora del ${pct.toFixed(0)}%` : `Aumento del ${pct.toFixed(0)}%`}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// APP
// ─────────────────────────────────────────────────────────────
export default function App() {
  const [viewMode, setViewMode] = useState<ViewMode>("split")
  const [speed, setSpeed] = useState<SpeedLevel>(1)
  const [paused, setPaused] = useState(true)
  const [showAnnotations, setShowAnnotations] = useState(true)
  const [selectedAnnotation, setSelectedAnnotation] = useState<number | null>(null)
  const [sliderPos, setSliderPos] = useState(50)
  const [zoom, setZoom] = useState(1)
  const [showCobit, setShowCobit] = useState(false)
  const [tick, setTick] = useState(0)

  // Annotations state
  const [annotations, setAnnotations] = useState(() => {
    const saved = localStorage.getItem("sim_annotations")
    if (saved) {
      try { return JSON.parse(saved) } catch (e) { return INITIAL_ANNOTATIONS }
    }
    return INITIAL_ANNOTATIONS
  })

  useEffect(() => {
    localStorage.setItem("sim_annotations", JSON.stringify(annotations))
  }, [annotations])
  const [editingAnnotationId, setEditingAnnotationId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState({ title: "", body: "" })

  const handleAddAnnotation = () => {
    const newId = annotations.length > 0 ? Math.max(...annotations.map(a => a.id)) + 1 : 1;
    const colors = ["#38bdf8", "#a3e635", "#fbbf24", "#f97316", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    const newAnnotation = {
      id: newId,
      title: "Nueva Anotación",
      body: "Describe el hallazgo o meta aquí...",
      mode: "after" as const,
      color: randomColor,
    };
    setAnnotations([...annotations, newAnnotation]);
    setEditingAnnotationId(newId);
    setEditForm({ title: newAnnotation.title, body: newAnnotation.body });
    setSelectedAnnotation(newId);
  };

  const handleSaveAnnotation = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    setAnnotations(annotations.map(a => 
      a.id === id ? { ...a, title: editForm.title, body: editForm.body } : a
    ));
    setEditingAnnotationId(null);
  };

  const handleDeleteAnnotation = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    setAnnotations(annotations.filter(a => a.id !== id));
    if (selectedAnnotation === id) setSelectedAnnotation(null);
    if (editingAnnotationId === id) setEditingAnnotationId(null);
  };

  const handleMoveUp = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    if (index === 0) return;
    const newAnns = [...annotations];
    const temp = newAnns[index - 1];
    newAnns[index - 1] = newAnns[index];
    newAnns[index] = temp;
    setAnnotations(newAnns);
  };

  const handleMoveDown = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    if (index === annotations.length - 1) return;
    const newAnns = [...annotations];
    const temp = newAnns[index + 1];
    newAnns[index + 1] = newAnns[index];
    newAnns[index] = temp;
    setAnnotations(newAnns);
  };

  // Pan states
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [panAfter, setPanAfter] = useState({ x: 0, y: 0 })
  const [syncPan, setSyncPan] = useState(true)
  const [isPanDragging, setIsPanDragging] = useState<"before" | "after" | null>(null)
  const lastPtr = useRef({ x: 0, y: 0 })

  const handlePointerDown = useCallback((e: React.PointerEvent, panel: "before" | "after") => {
    setIsPanDragging(panel)
    lastPtr.current = { x: e.clientX, y: e.clientY }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent, panel: "before" | "after") => {
    if (isPanDragging !== panel) return
    const dx = (e.clientX - lastPtr.current.x) / zoom
    const dy = (e.clientY - lastPtr.current.y) / zoom
    lastPtr.current = { x: e.clientX, y: e.clientY }

    if (syncPan) {
      setPan(p => ({ x: p.x + dx, y: p.y + dy }))
      setPanAfter(p => ({ x: p.x + dx, y: p.y + dy }))
    } else {
      if (panel === "before") setPan(p => ({ x: p.x + dx, y: p.y + dy }))
      else setPanAfter(p => ({ x: p.x + dx, y: p.y + dy }))
    }
  }, [isPanDragging, syncPan, zoom])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    setIsPanDragging(null)
    ;(e.currentTarget as Element).releasePointerCapture(e.pointerId)
  }, [])

  const beforeDataRef = useRef<SimData>(createSimData())
  const afterDataRef = useRef<SimData>(createSimData())
  const [beforeDisplay, setBeforeDisplay] = useState<SimData>(createSimData())
  const [afterDisplay, setAfterDisplay] = useState<SimData>(createSimData())

  const beforeStations = useMemo(() => makeStations("before"), [])
  const afterStations = useMemo(() => makeStations("after"), [])

  // Spawn rates (ticks between spawns)
  const BEFORE_SPAWN = 15
  const AFTER_SPAWN = 15

  // Simulation loop
  useEffect(() => {
    if (paused) return
    const id = setInterval(() => {
      beforeDataRef.current = tickSimulation(beforeDataRef.current, beforeStations, BEFORE_SPAWN, speed)
      afterDataRef.current = tickSimulation(afterDataRef.current, afterStations, AFTER_SPAWN, speed)
      setTick(t => t + 1)
    }, 80)
    return () => clearInterval(id)
  }, [paused, speed, beforeStations, afterStations])

  // Sync display every few ticks
  useEffect(() => {
    setBeforeDisplay(structuredClone(beforeDataRef.current))
    setAfterDisplay(structuredClone(afterDataRef.current))
  }, [tick])

  const beforeStats = useMemo(() => computeStats(beforeDisplay, beforeStations, 38.35), [beforeDisplay, beforeStations])
  const afterStats = useMemo(() => computeStats(afterDisplay, afterStations, 18.58), [afterDisplay, afterStations])

  const handleReset = useCallback(() => {
    beforeDataRef.current = createSimData()
    afterDataRef.current = createSimData()
    setTick(0)
  }, [])

  const sliderRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)

  const handleSliderMouseDown = () => { isDragging.current = true }
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current || !sliderRef.current) return
    const rect = sliderRef.current.getBoundingClientRect()
    const pct = Math.max(0, Math.min(100, (e.clientX - rect.left) / rect.width * 100))
    setSliderPos(pct)
  }, [])
  const handleMouseUp = () => { isDragging.current = false }

  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [handleMouseMove])

  const { d, h, m } = useMemo(() => {
    // 1 tick = 1 minuto en la simulación (según procTicks y las métricas)
    const totalMinutes = beforeDisplay.tickCount;
    return {
      d: Math.floor(totalMinutes / 1440),
      h: Math.floor((totalMinutes % 1440) / 60),
      m: totalMinutes % 60
    }
  }, [beforeDisplay.tickCount])

  return (
    <div className="w-screen h-screen flex flex-col overflow-hidden" style={{
      background: "#050c18",
      fontFamily: "var(--font-body)",
    }}>
      <style>{`
        @keyframes walkBob {
          from { transform: translateY(0px); }
          to { transform: translateY(-3px); }
        }
        @keyframes pulseRing {
          0% { opacity: 0.7; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.4); }
        }
        @keyframes procPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        @keyframes scanline {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(100vh); }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0d1829; }
        ::-webkit-scrollbar-thumb { background: #1e3a52; border-radius: 2px; }
      `}</style>

      {/* ── HEADER ── */}
      <header className="shrink-0 px-6 py-3 flex items-center gap-4 border-b" style={{
        background: "linear-gradient(90deg, #050c18, #081420, #050c18)",
        borderColor: "rgba(56,189,248,0.15)",
      }}>
        <div className="flex flex-col">
          <h1 className="text-xl font-bold tracking-wide text-white" style={{ fontFamily: "var(--font-display)", letterSpacing: "0.06em" }}>
            GOBIERNO DE TI · COBIT 2019
          </h1>
          <p className="text-xs text-slate-500" style={{ fontFamily: "var(--font-body)" }}>
            Simulación ProModel · EESPP "Tarapoto" · Proceso PS8.1 Gestión de Recursos Tecnológicos y EVA
          </p>
        </div>

        {/* Live clock */}
        <div className="ml-auto flex items-center gap-2 rounded-lg px-3 py-1.5" style={{ background: "#0d1829", border: "1px solid rgba(56,189,248,0.15)" }}>
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" style={{ animation: paused ? "none" : "procPulse 1s infinite" }} />
          <span className="text-xs font-mono text-slate-400">
            Tiempo: {d.toString().padStart(2, '0')}d {h.toString().padStart(2, '0')}h {m.toString().padStart(2, '0')}m
          </span>
        </div>

        {/* Entity counters */}
        <div className="flex gap-3">
          <div className="flex items-center gap-1.5 text-xs rounded-lg px-2.5 py-1.5" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}>
            <AlertTriangle size={11} className="text-orange-400" />
            <span className="text-orange-300 font-mono">{beforeStats.completed} cerrados</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs rounded-lg px-2.5 py-1.5" style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)" }}>
            <CheckCircle size={11} className="text-emerald-400" />
            <span className="text-emerald-300 font-mono">{afterStats.completed} cerrados</span>
          </div>
        </div>
      </header>

      {/* ── CONTROL BAR ── */}
      <div className="shrink-0 flex items-center gap-3 px-6 py-2 border-b" style={{ background: "#060e1c", borderColor: "rgba(56,189,248,0.1)" }}>
        {/* Playback controls */}
        <div className="flex items-center gap-1 rounded-lg p-1" style={{ background: "#0d1829", border: "1px solid rgba(56,189,248,0.1)" }}>
          <button
            onClick={() => setPaused(p => !p)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all"
            style={{
              background: paused ? "#38bdf8" : "transparent",
              color: paused ? "#050c18" : "#94a3b8",
              fontFamily: "var(--font-display)",
            }}
          >
            {paused ? <Play size={13} /> : <Pause size={13} />}
            {paused ? "PLAY" : "PAUSE"}
          </button>
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-slate-500 hover:text-slate-300 transition-all"
            style={{ fontFamily: "var(--font-display)" }}
          >
            <RotateCcw size={13} />RESET
          </button>
        </div>

        {/* Speed */}
        <div className="flex items-center gap-1 rounded-lg p-1" style={{ background: "#0d1829", border: "1px solid rgba(56,189,248,0.1)" }}>
          {([1, 2, 4, 8] as SpeedLevel[]).map(s => (
            <button key={s} onClick={() => setSpeed(s)}
              className="px-2.5 py-1.5 rounded-md text-xs font-bold transition-all"
              style={{
                fontFamily: "var(--font-mono)",
                background: speed === s ? "#1e3a52" : "transparent",
                color: speed === s ? "#38bdf8" : "#475569",
              }}
            >
              {s}×
            </button>
          ))}
        </div>

        {/* View mode */}
        <div className="flex items-center gap-1 rounded-lg p-1" style={{ background: "#0d1829", border: "1px solid rgba(56,189,248,0.1)" }}>
          {(["split", "slider"] as ViewMode[]).map(v => (
            <button key={v} onClick={() => setViewMode(v)}
              className="px-3 py-1.5 rounded-md text-xs font-semibold transition-all"
              style={{
                fontFamily: "var(--font-display)",
                background: viewMode === v ? "#1e3a52" : "transparent",
                color: viewMode === v ? "#38bdf8" : "#475569",
              }}
            >
              {v === "split" ? "PANTALLA DIVIDIDA" : "SLIDER COMPARATIVO"}
            </button>
          ))}
        </div>

        {/* Zoom */}
        <div className="flex items-center gap-1 ml-auto rounded-lg p-1" style={{ background: "#0d1829", border: "1px solid rgba(56,189,248,0.1)" }}>
          <button onClick={() => {
            const nextSync = !syncPan;
            setSyncPan(nextSync);
            if (nextSync) setPanAfter(pan);
          }} title="Sincronizar arrastre" className={`p-1.5 transition-all ${syncPan ? "text-emerald-400" : "text-slate-500 hover:text-slate-300"}`}>
            {syncPan ? <Link size={14} /> : <Unlink size={14} />}
          </button>
          <div className="w-px h-4 bg-slate-800 mx-1" />
          <button onClick={() => setZoom(z => Math.min(2, z + 0.2))} className="p-1.5 text-slate-500 hover:text-slate-300 transition-all"><ZoomIn size={14} /></button>
          <span className="text-xs text-slate-500 px-1" style={{ fontFamily: "var(--font-mono)" }}>{(zoom * 100).toFixed(0)}%</span>
          <button onClick={() => setZoom(z => Math.max(0.5, z - 0.2))} className="p-1.5 text-slate-500 hover:text-slate-300 transition-all"><ZoomOut size={14} /></button>
          <button onClick={() => { setZoom(1); setPan({x:0,y:0}); setPanAfter({x:0,y:0}) }} className="px-2 py-1 text-xs text-slate-500 hover:text-slate-300 transition-all" style={{ fontFamily: "var(--font-mono)" }}>1:1</button>
        </div>

        {/* Annotations toggle */}
        <button
          onClick={() => setShowAnnotations(a => !a)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
          style={{
            fontFamily: "var(--font-display)",
            background: showAnnotations ? "rgba(56,189,248,0.15)" : "#0d1829",
            color: showAnnotations ? "#38bdf8" : "#475569",
            border: "1px solid rgba(56,189,248,0.1)",
            userSelect: "none",
          }}
        >
          {showAnnotations ? <Eye size={13} /> : <EyeOff size={13} />}
          ANOTACIONES
        </button>

        {/* COBIT panel toggle */}
        <button
          onClick={() => setShowCobit(c => !c)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
          style={{
            fontFamily: "var(--font-display)",
            background: showCobit ? "rgba(139,92,246,0.15)" : "#0d1829",
            color: showCobit ? "#a78bfa" : "#475569",
            border: "1px solid rgba(56,189,248,0.1)",
          }}
        >
          <Layers size={13} />
          COBIT FRAMEWORK
        </button>
      </div>

      {/* ── MAIN CONTENT ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* Simulation area */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Canvas */}
          <div className="flex-1 relative overflow-hidden">
            <div style={{ width: '100%', height: '100%' }}>
              {viewMode === "split" ? (
                <div className="flex h-full" style={{ gap: "1px", background: "rgba(56,189,248,0.1)" }}>
                  <div className={`flex-1 overflow-hidden ${isPanDragging === 'before' ? 'cursor-grabbing' : 'cursor-grab'}`} style={{ background: "#050c18", touchAction: "none", userSelect: "none", WebkitUserSelect: "none" }}
                       onPointerDown={(e) => handlePointerDown(e, "before")} onPointerMove={(e) => handlePointerMove(e, "before")} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>
                      <SimulationCanvas mode="before" simData={beforeDisplay} stations={beforeStations} showAnnotations={showAnnotations} zoom={zoom} pan={pan} />
                  </div>
                  <div className={`flex-1 overflow-hidden ${isPanDragging === 'after' ? 'cursor-grabbing' : 'cursor-grab'}`} style={{ background: "#050c18", touchAction: "none", userSelect: "none", WebkitUserSelect: "none" }}
                       onPointerDown={(e) => handlePointerDown(e, "after")} onPointerMove={(e) => handlePointerMove(e, "after")} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>
                      <SimulationCanvas mode="after" simData={afterDisplay} stations={afterStations} showAnnotations={showAnnotations} zoom={zoom} pan={panAfter} />
                  </div>
                </div>
              ) : (
                // Slider mode
                <div ref={sliderRef} className="relative h-full w-full overflow-hidden" style={{ background: "#050c18", touchAction: "none", userSelect: "none", WebkitUserSelect: "none" }}>
                    {/* ANTES - full width, clipped right */}
                    <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}>
                      <SimulationCanvas mode="before" simData={beforeDisplay} stations={beforeStations} showAnnotations={showAnnotations} zoom={zoom} />
                    </div>
                  {/* DESPUÉS - full width, clipped left */}
                  <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${sliderPos}%)` }}>
                    <SimulationCanvas mode="after" simData={afterDisplay} stations={afterStations} showAnnotations={showAnnotations} zoom={zoom} />
                  </div>
                  {/* Divider line */}
                  <div className="absolute top-0 bottom-0 z-10 flex flex-col items-center"
                    style={{ left: `${sliderPos}%`, transform: "translateX(-50%)" }}
                    onMouseDown={handleSliderMouseDown}
                  >
                    <div className="flex-1" style={{ width: 2, background: "linear-gradient(180deg, transparent, #38bdf8 20%, #38bdf8 80%, transparent)" }} />
                    <div className="rounded-full flex items-center justify-center shadow-lg cursor-col-resize"
                      style={{ width: 36, height: 36, background: "#38bdf8", position: "absolute", top: "50%", transform: "translateY(-50%)" }}
                    >
                      <ChevronRight size={12} className="text-slate-900 -ml-1" />
                      <ChevronRight size={12} className="text-slate-900 -ml-2.5 opacity-50" />
                    </div>
                  </div>
                  {/* Labels */}
                  <div className="absolute top-12 left-4 z-10 text-xs font-bold text-orange-400 px-2 py-1 rounded" style={{ background: "rgba(239,68,68,0.15)", fontFamily: "var(--font-display)" }}>◀ ANTES</div>
                  <div className="absolute top-12 right-4 z-10 text-xs font-bold text-emerald-400 px-2 py-1 rounded" style={{ background: "rgba(16,185,129,0.15)", fontFamily: "var(--font-display)" }}>DESPUÉS ▶</div>
                </div>
              )}
            </div>
          </div>

          {/* ── KPI DASHBOARD ── */}
          <div className="shrink-0 border-t" style={{ borderColor: "rgba(56,189,248,0.1)", background: "#060e1c" }}>
            <div className="px-6 py-2 border-b flex items-center gap-2" style={{ borderColor: "rgba(56,189,248,0.08)" }}>
              <Activity size={13} className="text-slate-500" />
              <span className="text-xs font-semibold tracking-widest uppercase text-slate-500" style={{ fontFamily: "var(--font-display)" }}>Comparativa de Métricas en Tiempo Real</span>
            </div>
            <div className="grid grid-cols-4 gap-3 p-4">
              <KpiCard
                label="Cola Máxima"
                before={Math.max(...beforeStats.queueSizes, 0)}
                after={Math.max(...afterStats.queueSizes, 0)}
                unitBefore=" solics."
                unit=" tickets"
                better="lower"
                icon={<Users size={12} />}
              />
              <KpiCard
                label="Costo Unitario por Incidencia"
                before={beforeStats.unitCost}
                after={afterStats.unitCost}
                prefix="S/. "
                better="lower"
                icon={<DollarSign size={12} />}
                subBefore={`Total Acum: S/. ${beforeStats.totalCost.toFixed(0)}`}
                subAfter={`Total Acum: S/. ${afterStats.totalCost.toFixed(0)}`}
              />
              <KpiCard
                label="Tiempo Promedio Atención"
                before={beforeStats.avgTime}
                after={afterStats.avgTime}
                unit=" ticks"
                better="lower"
                icon={<Clock size={12} />}
              />
              <KpiCard
                label="Incidencias Resueltas"
                before={beforeStats.completed}
                after={afterStats.completed}
                unit=""
                better="higher"
                icon={<TrendingUp size={12} />}
              />
            </div>
          </div>
        </div>

        {/* ── SIDE PANELS ── */}
        <div className="flex flex-col shrink-0 overflow-y-auto" style={{ width: 300, minWidth: 300, maxWidth: 300, background: "#060e1c", borderLeft: "1px solid rgba(56,189,248,0.1)", wordBreak: "break-word" }}>

          {/* Annotations panel */}
          {showAnnotations && (
            <div className="p-3 border-b flex flex-col" style={{ borderColor: "rgba(56,189,248,0.08)" }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Info size={12} className="text-slate-500" />
                  <span className="text-xs font-semibold tracking-widest uppercase text-slate-500" style={{ fontFamily: "var(--font-display)" }}>Anotaciones</span>
                </div>
                <button onClick={handleAddAnnotation} className="p-1 hover:bg-slate-800 rounded transition-colors text-slate-400 hover:text-sky-400" title="Añadir Anotación">
                  <Plus size={14} />
                </button>
              </div>
              
              {/* Custom scrollbar for annotations container */}
              <style>{`
                .annotations-scroll::-webkit-scrollbar { width: 4px; }
                .annotations-scroll::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); border-radius: 4px; }
                .annotations-scroll::-webkit-scrollbar-thumb { background: rgba(56,189,248,0.2); border-radius: 4px; }
                .annotations-scroll::-webkit-scrollbar-thumb:hover { background: rgba(56,189,248,0.5); }
              `}</style>
              <div className="flex flex-col gap-2 overflow-y-auto pr-1 annotations-scroll" style={{ maxHeight: "300px" }}>
                {annotations.map((a, index) => (
                  <div
                    key={a.id}
                    onClick={() => {
                      if (editingAnnotationId !== a.id) {
                        setSelectedAnnotation(selectedAnnotation === a.id ? null : a.id);
                        setEditingAnnotationId(null);
                      }
                    }}
                    className="text-left rounded-lg p-2.5 transition-all relative group cursor-pointer"
                    style={{
                      background: selectedAnnotation === a.id ? `${a.color}15` : "#0d1829",
                      border: `1px solid ${selectedAnnotation === a.id ? a.color : "rgba(56,189,248,0.08)"}`,
                    }}
                  >
                    {editingAnnotationId === a.id ? (
                      <div className="flex flex-col gap-2 w-full" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <div className="rounded-full shrink-0" style={{ width: 8, height: 8, background: a.color }} />
                          <input 
                            value={editForm.title}
                            onChange={(e) => setEditForm({...editForm, title: e.target.value})}
                            className="bg-slate-900 text-xs font-semibold w-full rounded px-2 py-1 outline-none border border-slate-700 focus:border-sky-500"
                            style={{ color: a.color, fontFamily: "var(--font-display)" }}
                            autoFocus
                          />
                        </div>
                        <textarea 
                          value={editForm.body}
                          onChange={(e) => setEditForm({...editForm, body: e.target.value})}
                          className="bg-slate-900 text-xs text-slate-300 w-full rounded px-2 py-1 outline-none border border-slate-700 focus:border-sky-500 min-h-[60px] resize-none"
                        />
                        <div className="flex justify-end gap-1 mt-1">
                          <button onClick={(e) => { e.stopPropagation(); setEditingAnnotationId(null); }} className="p-1 text-slate-400 hover:text-slate-200 bg-slate-800 rounded" title="Cancelar">
                            <X size={12} />
                          </button>
                          <button onClick={(e) => handleSaveAnnotation(e, a.id)} className="p-1 text-emerald-400 hover:text-emerald-300 bg-emerald-400/10 hover:bg-emerald-400/20 rounded" title="Guardar">
                            <Check size={12} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2 w-full">
                        <div className="rounded-full shrink-0 mt-0.5" style={{ width: 8, height: 8, background: a.color, marginTop: 4 }} />
                        <div className="flex-1 min-w-0">
                          <div className={`text-xs font-semibold ${selectedAnnotation === a.id ? 'pr-1' : 'pr-4 truncate'}`} style={{ color: a.color, fontFamily: "var(--font-display)", lineHeight: 1.3, whiteSpace: selectedAnnotation === a.id ? "normal" : "nowrap" }}>
                            {a.title}
                          </div>
                          
                          {selectedAnnotation === a.id && (
                            <div className="mt-1.5 flex flex-col gap-3">
                              <div className="text-xs text-slate-400 leading-relaxed pr-1" style={{ whiteSpace: "pre-wrap" }}>
                                {a.body}
                              </div>
                              <div className="flex justify-end gap-1 pt-2 border-t" style={{ borderColor: "rgba(56,189,248,0.08)" }}>
                                {index > 0 && (
                                  <button onClick={(e) => handleMoveUp(e, index)} className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-sky-400" title="Subir">
                                    <ChevronUp size={12} />
                                  </button>
                                )}
                                {index < annotations.length - 1 && (
                                  <button onClick={(e) => handleMoveDown(e, index)} className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-sky-400" title="Bajar">
                                    <ChevronDown size={12} />
                                  </button>
                                )}
                                <button onClick={(e) => { e.stopPropagation(); setEditingAnnotationId(a.id); setEditForm({title: a.title, body: a.body}); setSelectedAnnotation(a.id); }} className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-sky-400" title="Editar">
                                  <Pencil size={12} />
                                </button>
                                <button onClick={(e) => handleDeleteAnnotation(e, a.id)} className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-red-400" title="Eliminar">
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* COBIT Framework panel */}
          {showCobit && (
            <div className="p-3 border-b" style={{ borderColor: "rgba(56,189,248,0.08)" }}>
              <div className="flex items-center gap-2 mb-3">
                <Layers size={12} className="text-purple-400" />
                <span className="text-xs font-semibold tracking-widest uppercase text-slate-500" style={{ fontFamily: "var(--font-display)" }}>Dominios COBIT 2019</span>
              </div>
              <div className="flex flex-col gap-2">
                {COBIT_DOMAINS.map(d => (
                  <div key={d.code} className="rounded-lg p-2.5" style={{ background: "#0d1829", border: `1px solid ${d.color}25` }}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <div style={{ color: d.color }}>{d.icon}</div>
                      <span className="text-xs font-bold" style={{ color: d.color, fontFamily: "var(--font-display)" }}>{d.code}</span>
                      <span className="text-xs text-slate-500 truncate">{d.name}</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {d.items.map(item => (
                        <div key={item} className="flex items-center gap-1.5 text-xs text-slate-500">
                          <ChevronRight size={9} style={{ color: d.color }} />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Legend */}
          <div className="p-3">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-semibold tracking-widest uppercase text-slate-500" style={{ fontFamily: "var(--font-display)" }}>Leyenda</span>
            </div>
            <div className="flex flex-col gap-2 text-xs text-slate-400">
              {[
                { icon: "👤", color: "#fb923c", label: "Entidad ANTES (incidencia)" },
                { icon: "👤", color: "#34d399", label: "Entidad DESPUÉS (incidencia)" },
                { icon: "⚠️", color: "#ef4444", label: "Cuello de botella activo" },
                { icon: "🆕", color: "#06b6d4", label: "Proceso NUEVO (COBIT)" },
                { icon: "📊", color: "#38bdf8", label: "Barra = utilización estación" },
                { icon: "🔢", color: "#fbbf24", label: "Badge = entities en cola" },
              ].map(l => (
                <div key={l.label} className="flex items-center gap-2">
                  <span>{l.icon}</span>
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: l.color }} />
                  <span>{l.label}</span>
                </div>
              ))}
            </div>

            {/* Stats summary */}
            <div className="mt-4 rounded-lg p-3" style={{ background: "#0d1829", border: "1px solid rgba(56,189,248,0.08)" }}>
              <div className="text-xs font-semibold text-slate-400 mb-2" style={{ fontFamily: "var(--font-display)" }}>PROCESO REAL PS8.1</div>
              <div className="flex flex-col gap-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Costo ANTES</span>
                  <span className="text-orange-300 font-mono font-semibold">S/. 38.35</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Tiempo ANTES</span>
                  <span className="text-orange-300 font-mono font-semibold">~140 min</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Costo DESPUÉS</span>
                  <span className="text-emerald-300 font-mono font-semibold">~S/. 18.58</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Tiempo DESPUÉS</span>
                  <span className="text-emerald-300 font-mono font-semibold">~63 min</span>
                </div>
                <div className="h-px my-1" style={{ background: "rgba(56,189,248,0.1)" }} />
                <div className="flex justify-between">
                  <span className="text-slate-500">Ahorro estimado</span>
                  <span className="text-emerald-400 font-mono font-bold">51.5%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Framework</span>
                  <span className="text-sky-400 font-mono">COBIT 2019</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Institución</span>
                  <span className="text-slate-300 font-mono text-xs">EESPP Tarapoto</span>
                </div>
              </div>
            </div>

            {/* Team credits */}
            <div className="mt-3 rounded-lg p-3" style={{ background: "#0d1829", border: "1px solid rgba(56,189,248,0.08)" }}>
              <div className="text-xs font-semibold text-slate-400 mb-1.5" style={{ fontFamily: "var(--font-display)" }}>EQUIPO · 2026</div>
              {[
                "Abanto Sanchez L.",
                "Ayachi Llanos K.",
                "Carranza Diaz J.",
                "García Llerena W.",
                "Pacheco Acedo M.",
                "Sisniegas Arevalo C.",
              ].map(name => (
                <div key={name} className="text-xs text-slate-500 py-0.5">{name}</div>
              ))}
              <div className="text-xs text-slate-600 mt-1.5">Docente: Ing. Dra. Janina Cotrina</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
