import React, { useMemo, useState } from "react"
import dayjs from "dayjs"
import isoWeek from "dayjs/plugin/isoWeek"
import advancedFormat from "dayjs/plugin/advancedFormat"
import "dayjs/locale/de"

dayjs.extend(isoWeek)
dayjs.extend(advancedFormat)
dayjs.locale("de")

// ---- Plätze & Teams ----
const FIELDS = ["A", "B", "C", "Frimmersdorf", "Vestenbergsgreuth", "ASV Weisendorf Kunstrasen"] as const
type FieldName = typeof FIELDS[number]

const OUR_TEAM_PREFIXES = [
  "(SG) TSV Lonnerstadt II/ASV Weisendorf",
  "TSV Lonnerstadt 2 (7er)",
  "TSV Lonnerstadt AH",
  "TSV Lonnerstadt 3",
  "TSV Lonnerstadt 2",
  "TSV Lonnerstadt/ ASV Weisendorf",
  "(SG) TSV Lonnerstadt II",
  "(SG) TSV Lonnerstadt",
  "TSV Lonnerstadt",
]

// ---- Types ----
interface GameRaw {
  lineIdx: number
  spieltyp: string
  spielklasse: string
  date: string
  time: string
  pairing: string
  venue: string
  section: string
}

interface GameItem {
  id: string
  date: string
  time: string
  dt: string
  section: string
  competition: string
  homeTeam: string
  awayTeam: string
  isHome: boolean
  venue: string
  suggestedField: FieldName | null
  assignedField: FieldName | null
}

// ---- Parser helpers ----
function normalizeSpaces(s: string) {
  return s.replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim()
}

function toISODate(dmy: string) {
  const [d, m, y] = dmy.split(".").map(Number)
  return dayjs(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`).format("YYYY-MM-DD")
}

function makeId(gr: GameRaw) {
  return `${gr.date}_${gr.time}_${normalizeSpaces(gr.pairing).slice(0, 60)}`
}

function detectHomeAndSplit(pairing: string) {
  const text = normalizeSpaces(pairing)
  for (const prefix of OUR_TEAM_PREFIXES.sort((a, b) => b.length - a.length)) {
    if (text.startsWith(prefix + " ") || text === prefix) {
      const rest = text.slice(prefix.length).trim()
      return { homeTeam: prefix, awayTeam: rest, isHome: true }
    }
  }
  const rightPrefix = OUR_TEAM_PREFIXES.find((p) => text.endsWith(" " + p) || text === p || text.includes(" " + p))
  if (rightPrefix) {
    const idx = text.lastIndexOf(rightPrefix)
    const left = text.slice(0, idx).trim()
    return { homeTeam: left, awayTeam: rightPrefix, isHome: false }
  }
  return { homeTeam: text, awayTeam: "", isHome: false }
}

function suggestFieldFromVenue(venue: string): FieldName | null {
  const v = venue.toLowerCase()
  if (v.includes("frimmersdorf")) return "Frimmersdorf"
  if (v.includes("vestenbergsgreuth")) return "Vestenbergsgreuth"
  if (v.includes("weisendorf") && v.includes("kunstrasen")) return "ASV Weisendorf Kunstrasen"
  if (v.includes("am sonnenhügel") || v.includes("sportgelände")) {
    if (v.includes("platz 1")) return "A"
    if (v.includes("platz 2")) return "B"
    if (v.includes("platz 3")) return "C"
    return "A"
  }
  return null
}

// ---- Hauptparser ----
function parseBFVText(txt: string): GameItem[] {
  const lines = txt
    .split(/\r?\n/)
    .map((l) => l.replace(/\u00A0/g, " ").trim())
    .filter((l) => l.length > 0)

  const isRowStart = (l: string) => /^(FS|ME|PO)\s+/.test(l)
  const isHeaderSection = (l: string) =>
    /(Herren|Frauen|A-|B-|C-|D-|E-|F-|G-|Junioren|Juniorinnen|Ü32)/i.test(l)

  let currentSection = ""
  const raws: GameRaw[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (isHeaderSection(line)) {
      currentSection = line
      continue
    }
    if (!isRowStart(line)) continue

    const typeMatch = line.match(/^(FS|ME|PO)\s+(.*)$/)
    if (!typeMatch) continue
    const spieltyp = typeMatch[1]
    const rest = typeMatch[2]

    const dateTimeMatch = rest.match(/^(.*?)\s(\d{2}\.\d{2}\.\d{4})\s((?:\d{2}:\d{2})|SPIELFREI)\s(.*)$/)
    if (!dateTimeMatch) continue

    const spielklasse = dateTimeMatch[1].trim()
    const date = dateTimeMatch[2]
    const time = dateTimeMatch[3]
    const pairing = dateTimeMatch[4].trim()

    let venue = ""
    let j = i + 1
    while (j < lines.length && !isRowStart(lines[j]) && !isHeaderSection(lines[j])) {
      if (/^Kursiv|^Ergebnisse|^VEREINSSPIELPLAN|^Seite/i.test(lines[j])) {
        j++
        continue
      }
      venue += (venue ? " " : "") + lines[j]
      j++
    }

    raws.push({
      lineIdx: i,
      spieltyp,
      spielklasse,
      date,
      time,
      pairing,
      venue: venue.trim(),
      section: currentSection || "",
    })

    i = j - 1
  }

  return raws
    .map((r) => {
      if (r.time.toUpperCase() === "SPIELFREI") return null
      const { homeTeam, awayTeam, isHome } = detectHomeAndSplit(r.pairing)
      const iso = toISODate(r.date)
      const dt = `${iso}T${r.time.length === 4 ? "0" + r.time : r.time}:00`
      const competition = `${r.spieltyp} ${r.spielklasse}`.trim()
      const suggestedField = isHome ? suggestFieldFromVenue(r.venue) : null
      return {
        id: makeId(r),
        date: iso,
        time: r.time,
        dt,
        section: r.section,
        competition,
        homeTeam,
        awayTeam,
        isHome,
        venue: r.venue,
        suggestedField,
        assignedField: suggestedField,
      } as GameItem
    })
    .filter((g): g is GameItem => g !== null)
    .sort((a, b) => a.dt.localeCompare(b.dt))

}

// ---- CSV Export ----
function exportWeekCSV(games: GameItem[], weekStart: string) {
  const header = ["Datum", "Zeit", "Heim", "Gast", "Wettbewerb", "Abschnitt", "Platz", "Spielort"]
  const rows = games.map((g) => [
    dayjs(g.date).format("DD.MM.YYYY"),
    g.time,
    g.homeTeam,
    g.awayTeam,
    g.competition,
    g.section,
    g.assignedField ?? "",
    g.venue.replace(/"/g, "'"),
  ])
  const csv = [header, ...rows].map((r) => r.join(";")).join("\r\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const link = document.createElement("a")
  link.href = URL.createObjectURL(blob)
  link.download = `platzplan_${dayjs(weekStart).format("YYYYMMDD")}.csv`
  link.click()
}

// ---- PDF Export ----
function exportWeekPrintable(games: GameItem[], weekStartISO: string) {
  const weekStart = dayjs(weekStartISO)
  const weekEnd = weekStart.add(6, "day")
  const days = Array.from({ length: 7 }, (_, i) => weekStart.add(i, "day"))

  const cell = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const rowsHtml = FIELDS.map((field) => {
    const cols = days
      .map((d) => {
        const dayGames = games.filter(
          (g) => g.isHome && g.assignedField === field && dayjs(g.date).isSame(d, "day")
        )
        if (dayGames.length === 0) return "<td></td>"
        const text = dayGames
          .map(
            (g) =>
              `${cell(g.time)} – ${cell(g.homeTeam)} vs ${cell(g.awayTeam)}<br/><span class="muted">${cell(
                g.section
              )} · ${cell(g.competition)}</span>`
          )
          .join("<br/><br/>")
        return `<td>${text}</td>`
      })
      .join("")
    return `<tr><th>${field}</th>${cols}</tr>`
  }).join("")

  const html = `<!doctype html><html><head>
<meta charset="utf-8">
<style>
@page { size: A4 landscape; margin: 14mm; }
body { font: 12px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; color: #0f172a; }
h1 { font-size: 18px; margin: 0 0 12px; }
.muted { color:#475569; font-size:10px; }
table { border-collapse: collapse; width:100%; }
thead th { background:#0f172a; color:#fff; padding:6px 8px; text-align:left; }
tbody th { background:#e2e8f0; text-align:left; padding:6px 8px; white-space:nowrap; }
td { border:1px solid #cbd5e1; vertical-align:top; padding:6px 8px; min-width:120px; }
.footer { margin-top:10px; font-size:10px; color:#64748b; }
</style>
</head><body>
<h1>TSV Lonnerstadt – Platzbelegung KW ${weekStart.isoWeek()} (${weekStart.format("DD.MM.")}–${weekEnd.format("DD.MM.YYYY")})</h1>
<table>
<thead><tr><th>Platz</th>${days.map((d) => `<th>${d.format("dd DD.MM.")}</th>`).join("")}</tr></thead>
<tbody>${rowsHtml}</tbody>
</table>
<div class="footer">Automatisch generiert – Platzbelegungstool</div>
<script>window.onload=()=>window.print()</script>
</body></html>`

  const blob = new Blob([html], { type: "text/html" })
  const url = URL.createObjectURL(blob)
  window.open(url, "_blank")
}

// ---- React Component ----
export default function App() {
  const [rawText, setRawText] = useState("")
  const [games, setGames] = useState<GameItem[]>([])
  const [showHomeOnly, setShowHomeOnly] = useState(true)
  const [hidePast, setHidePast] = useState(true)
  const [weekStart, setWeekStart] = useState(dayjs().startOf("week").add(1, "day").format("YYYY-MM-DD"))

  const parsedGames = useMemo(() => {
    let g = [...games]
    if (showHomeOnly) g = g.filter((x) => x.isHome)
    if (hidePast) g = g.filter((x) => dayjs(x.date).isAfter(dayjs().subtract(1, "day"), "day"))
    return g
  }, [games, showHomeOnly, hidePast])

  const handleParse = () => {
    if (!rawText.trim()) return alert("Bitte Text einfügen.")
    const parsed = parseBFVText(rawText)
    setGames(parsed)
    alert(`${parsed.length} Spiele erkannt (${parsed.filter((x) => x.isHome).length} Heimspiele)`)
  }

  return (
    <div className="p-6 font-sans bg-slate-50 min-h-screen text-slate-800">
      <h1 className="text-2xl font-bold mb-3">BFV-Vereinsspielplan ➜ Platzbelegung</h1>

      <textarea
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
        rows={12}
        className="w-full border rounded-lg p-2 font-mono text-xs mb-4"
        placeholder="Hier den Text aus dem BFV-PDF einfügen (Strg+A → Strg+C → Strg+V)"
      />

      <div className="flex flex-wrap gap-2 mb-4">
        <button onClick={handleParse} className="bg-slate-900 text-white px-3 py-2 rounded hover:bg-slate-800">
          Text auswerten
        </button>
        <button
          onClick={() => setShowHomeOnly((v) => !v)}
          className={`px-3 py-2 rounded text-white ${showHomeOnly ? "bg-amber-600" : "bg-slate-700"} hover:opacity-80`}
        >
          {showHomeOnly ? "Alle Spiele" : "Nur Heimspiele"}
        </button>
        <button
          onClick={() => setHidePast((v) => !v)}
          className={`px-3 py-2 rounded text-white ${hidePast ? "bg-rose-600" : "bg-slate-700"} hover:opacity-80`}
        >
          {hidePast ? "Vergangene einblenden" : "Vergangene ausblenden"}
        </button>
        <button
          onClick={() => exportWeekCSV(parsedGames, weekStart)}
          className="bg-sky-600 text-white px-3 py-2 rounded hover:bg-sky-700"
        >
          CSV exportieren
        </button>
        <button
          onClick={() => exportWeekPrintable(parsedGames, weekStart)}
          className="bg-emerald-600 text-white px-3 py-2 rounded hover:bg-emerald-700"
        >
          Wochenplan drucken / PDF
        </button>
      </div>

      <table className="text-sm border-collapse w-full bg-white rounded-xl overflow-hidden shadow">
        <thead>
          <tr className="bg-slate-900 text-white">
            <th className="px-2 py-1">Datum</th>
            <th className="px-2 py-1">Zeit</th>
            <th className="px-2 py-1">Heim</th>
            <th className="px-2 py-1">Gast</th>
            <th className="px-2 py-1">Wettbewerb</th>
            <th className="px-2 py-1">Abschnitt</th>
            <th className="px-2 py-1">Platz</th>
            <th className="px-2 py-1">Spielort</th>
          </tr>
        </thead>
        <tbody>
          {parsedGames.length === 0 ? (
            <tr>
              <td colSpan={8} className="text-center py-6 text-slate-500">
                Noch keine Spiele erkannt
              </td>
            </tr>
          ) : (
            parsedGames.map((g, i) => (
  <tr key={g.id} className={g.isHome ? "bg-emerald-50" : i % 2 ? "bg-slate-100" : ""}>
    <td className="px-2 py-1">{dayjs(g.date).format("DD.MM.YYYY")}</td>
    <td className="px-2 py-1">{g.time}</td>
    <td className="px-2 py-1">{g.homeTeam}</td>
    <td className="px-2 py-1">{g.awayTeam}</td>
    <td className="px-2 py-1">{g.competition}</td>
    <td className="px-2 py-1">{g.section}</td>
    <td className="px-2 py-1">
      <select
        className="border rounded-lg px-2 py-1"
        value={g.assignedField ?? ""}
        onChange={(e) =>
          setGames((prev) =>
            prev.map((x) =>
              x.id === g.id
                ? { ...x, assignedField: (e.target.value || null) as FieldName | null }
                : x
            )
          )
        }
      >
        <option value="">Nicht zugewiesen</option>
        {FIELDS.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
    </td>
    <td className="px-2 py-1 text-xs text-slate-600">{g.venue || "–"}</td>
  </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
