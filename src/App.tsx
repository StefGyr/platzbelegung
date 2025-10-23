import React, { useMemo, useState } from "react"
import dayjs from "dayjs"
import isoWeek from "dayjs/plugin/isoWeek"
import advancedFormat from "dayjs/plugin/advancedFormat"
import "dayjs/locale/de"

// ---- Time setup ----
dayjs.extend(isoWeek)
dayjs.extend(advancedFormat)
dayjs.locale("de")

// ---- Domain config ----
const FIELDS = ["A", "B", "C", "Frimmersdorf", "Vestenbergsgreuth", "ASV Weisendorf Kunstrasen"] as const
export type FieldName = typeof FIELDS[number]

const OUR_TEAM_PREFIXES: string[] = [
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

export interface GameItem {
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

// ---- Helpers ----
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
  if (v.includes("am sonnenhügel")) {
    if (v.includes("platz 1")) return "A"
    if (v.includes("platz 2")) return "B"
    if (v.includes("platz 3")) return "C"
    return "A"
  }
  return null
}
function mapRawToGame(gr: GameRaw): GameItem | null {
  if (gr.time.toUpperCase() === "SPIELFREI") return null
  const { homeTeam, awayTeam, isHome } = detectHomeAndSplit(gr.pairing)
  const iso = toISODate(gr.date)
  const dt = `${iso}T${gr.time.length === 4 ? "0" + gr.time : gr.time}:00`
  const competition = `${gr.spieltyp} ${gr.spielklasse}`.trim()
  const suggestedField = isHome ? suggestFieldFromVenue(gr.venue) : null
  return {
    id: makeId(gr),
    date: iso,
    time: gr.time,
    dt,
    section: gr.section,
    competition,
    homeTeam,
    awayTeam,
    isHome,
    venue: gr.venue,
    suggestedField,
    assignedField: suggestedField,
  }
}
function parseBFVText(txt: string): GameItem[] {
  const lines = txt.split(/\r?\n/).map((l) => l.replace(/\u00A0/g, " ").trim()).filter((l) => l.length > 0)
  const isRowStart = (l: string) => /^(FS|ME|PO)\s+/.test(l)
  const isHeaderSection = (l: string) =>
    [
      "Herren Ü32",
      "Herren",
      "Herren-Reserve",
      "A-Junioren",
      "B-Junioren",
      "C-Junioren",
      "D-Junioren",
      "E-Junioren",
      "Frauen",
      "C-Juniorinnen",
      "E-Juniorinnen",
    ].includes(l.replace(/\s+/g, " "))
  let currentSection = ""
  const raws: GameRaw[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (isHeaderSection(line)) {
      currentSection = line
      continue
    }
    if (!isRowStart(line)) continue
    const match = line.match(/^(FS|ME|PO)\s+(.*)$/)
    if (!match) continue
    const spieltyp = match[1]
    const rest = match[2]
    const dt = rest.match(/^(.*?)\s(\d{2}\.\d{2}\.\d{4})\s(\d{2}:\d{2}|SPIELFREI)\s(.*)$/)
    let spielklasse = "", date = "", time = "", pairing = ""
    if (dt) {
      spielklasse = dt[1].trim()
      date = dt[2]
      time = dt[3]
      pairing = dt[4].trim()
    }
    raws.push({ lineIdx: i, spieltyp, spielklasse, date, time, pairing, venue: "", section: currentSection })
  }
  return raws.map(mapRawToGame).filter((g): g is GameItem => !!g)
}

// ---- PDF Export ----
function exportWeekPrintable(games: GameItem[], weekStartISO: string) {
  const weekStart = dayjs(weekStartISO)
  const weekEnd = weekStart.add(6, "day")
  const days = Array.from({ length: 7 }, (_, i) => weekStart.add(i, "day"))
  const rowsHtml = FIELDS.map((field) => {
    const cols = days
      .map((d) => {
        const g = games.filter((x) => x.assignedField === field && dayjs(x.date).isSame(d, "day"))
        if (!g.length) return "<td></td>"
        const t = g.map((x) => `${x.time} – ${x.homeTeam} vs ${x.awayTeam}`).join("<br/>")
        return `<td>${t}</td>`
      })
      .join("")
    return `<tr><th>${field}</th>${cols}</tr>`
  }).join("")
  const html = `<!doctype html><html><body><table>${rowsHtml}</table></body></html>`
  const blob = new Blob([html], { type: "text/html" })
  const url = URL.createObjectURL(blob)
  window.open(url, "_blank")
}

// ---- CSV Export ----
function exportWeekCSV(games: GameItem[], weekStartISO: string) {
  if (!games.length) {
    alert("Keine Spiele geladen.")
    return
  }
  const weekStart = dayjs(weekStartISO)
  const weekEnd = weekStart.add(6, "day")
  const weekNumber = weekStart.isoWeek()
  const header = [
    "week_number",
    "start_date",
    "end_date",
    "field",
    "day",
    "date",
    "time",
    "home_team",
    "away_team",
    "category",
    "league",
  ]
  const rows = games
    .filter((g) => g.isHome && g.assignedField)
    .map((g) => [
      weekNumber,
      weekStart.format("YYYY-MM-DD"),
      weekEnd.format("YYYY-MM-DD"),
      g.assignedField,
      dayjs(g.date).format("dd"),
      g.date,
      g.time,
      g.homeTeam,
      g.awayTeam,
      g.section,
      g.competition,
    ])
  const csv = [header, ...rows].map((r) => r.join(",")).join("\r\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const link = document.createElement("a")
  link.href = URL.createObjectURL(blob)
  link.download = `platzplan_kw${weekNumber}.csv`
  link.click()
}

// ---- Dummy PDF Reader (fallback) ----
async function extractPdfText(file: File): Promise<string> {
  const text = await file.text()
  return text
}

// ---- Main App ----
export default function App() {
  const [file, setFile] = useState<File | null>(null)
  const [rawText, setRawText] = useState("")
  const [games, setGames] = useState<GameItem[]>([])
  const [homeOnly, setHomeOnly] = useState(true)
  const defaultWeekStart = useMemo(() => dayjs().startOf("week").add(1, "day").format("YYYY-MM-DD"), [])
  const [weekStart, setWeekStart] = useState(defaultWeekStart)

  const parsedGames = useMemo(
    () => (homeOnly ? games.filter((g) => g.isHome) : games).sort((a, b) => a.dt.localeCompare(b.dt)),
    [games, homeOnly]
  )

  const handleParse = async () => {
    let text = rawText.trim()
    if (!text && file) text = await extractPdfText(file)
    const list = parseBFVText(text)
    setGames(list)
  }

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-4">Platzbelegung – CSV Export integriert</h1>
      <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <button onClick={handleParse} className="ml-2 bg-blue-600 text-white px-3 py-1 rounded">
        PDF/Text auswerten
      </button>

      <div className="my-4 flex gap-2 items-center">
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={homeOnly} onChange={(e) => setHomeOnly(e.target.checked)} />
          Nur Heimspiele
        </label>
        <input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
        <button onClick={() => exportWeekPrintable(parsedGames, weekStart)} className="bg-emerald-600 text-white px-3 py-1 rounded">
          PDF drucken
        </button>
        <button onClick={() => exportWeekCSV(parsedGames, weekStart)} className="bg-slate-800 text-white px-3 py-1 rounded">
          CSV exportieren
        </button>
      </div>

      <table className="border text-sm">
        <thead>
          <tr className="bg-gray-200">
            <th className="px-2">Datum</th>
            <th className="px-2">Zeit</th>
            <th className="px-2">Heim</th>
            <th className="px-2">Gast</th>
            <th className="px-2">Platz</th>
          </tr>
        </thead>
        <tbody>
          {parsedGames.map((g) => (
            <tr key={g.id}>
              <td className="px-2">{g.date}</td>
              <td className="px-2">{g.time}</td>
              <td className="px-2">{g.homeTeam}</td>
              <td className="px-2">{g.awayTeam}</td>
              <td className="px-2">{g.assignedField ?? "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
