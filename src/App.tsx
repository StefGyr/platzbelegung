import React, { useMemo, useState } from "react"
import dayjs from "dayjs"
import isoWeek from "dayjs/plugin/isoWeek"
import advancedFormat from "dayjs/plugin/advancedFormat"
import "dayjs/locale/de"

dayjs.extend(isoWeek)
dayjs.extend(advancedFormat)
dayjs.locale("de")

const FIELDS = ["A", "B", "C", "Frimmersdorf", "Vestenbergsgreuth", "ASV Weisendorf Kunstrasen"] as const
type FieldName = typeof FIELDS[number]

interface GameItem {
  id: string
  date: string
  time: string
  dt: string
  homeTeam: string
  awayTeam: string
  competition: string
  section: string
  isHome: boolean
  assignedField: FieldName | null
}

function parseBFVText(txt: string): GameItem[] {
  const lines = txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const isRow = (l: string) => /^(FS|ME|PO)\s+/.test(l)
  const isSection = (l: string) => /(Herren|Frauen|Junioren|Juniorinnen)/.test(l)
  let section = ""
  const out: GameItem[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (isSection(line)) section = line
    if (!isRow(line)) continue
    const m = line.match(/^(FS|ME|PO)\s+(.*?)\s(\d{2}\.\d{2}\.\d{4})\s(\d{2}:\d{2}|SPIELFREI)\s(.*)$/)
    if (!m) continue
    const [_, type, comp, d, time, rest] = m
    if (time.toUpperCase() === "SPIELFREI") continue
    const dateISO = dayjs(d, "DD.MM.YYYY").format("YYYY-MM-DD")
    const id = `${dateISO}_${time}_${rest.slice(0, 20)}`
    const [home, away] = rest.split(/\s+vs\s+| - | gegen /i).length === 2 ? rest.split(/\s+vs\s+| - | gegen /i) : [rest, ""]
    out.push({
      id,
      date: dateISO,
      time,
      dt: `${dateISO}T${time}:00`,
      homeTeam: home.trim(),
      awayTeam: away.trim(),
      competition: `${type} ${comp}`.trim(),
      section,
      isHome: home.toLowerCase().includes("lonnerstadt"),
      assignedField: null,
    })
  }
  return out.sort((a, b) => a.dt.localeCompare(b.dt))
}

function exportWeekPrintable(games: GameItem[], weekStart: string) {
  const week = dayjs(weekStart)
  const html = `<!doctype html><html><body><h2>Wochenplan KW ${week.isoWeek()}</h2><table border="1" cellspacing="0" cellpadding="4">
    <tr><th>Datum</th><th>Zeit</th><th>Heim</th><th>Gast</th><th>Wettbewerb</th></tr>
    ${games
      .map(
        (g) =>
          `<tr><td>${dayjs(g.date).format("DD.MM.YYYY")}</td><td>${g.time}</td><td>${g.homeTeam}</td><td>${g.awayTeam}</td><td>${g.competition}</td></tr>`
      )
      .join("")}
  </table></body></html>`
  const blob = new Blob([html], { type: "text/html" })
  const url = URL.createObjectURL(blob)
  window.open(url, "_blank")
}

function exportWeekCSV(games: GameItem[], weekStart: string) {
  if (!games.length) return alert("Keine Spiele geladen.")
  const week = dayjs(weekStart)
  const weekEnd = week.add(6, "day")
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
  const rows = games.map((g) => [
    week.isoWeek(),
    week.format("YYYY-MM-DD"),
    weekEnd.format("YYYY-MM-DD"),
    g.assignedField ?? "",
    dayjs(g.date).format("dd"),
    g.date,
    g.time,
    g.homeTeam,
    g.awayTeam,
    g.section,
    g.competition,
  ])
  const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const link = document.createElement("a")
  link.href = URL.createObjectURL(blob)
  link.download = `platzplan_kw${week.isoWeek()}.csv`
  link.click()
}

async function extractPdfText(file: File): Promise<string> {
  try {
    return await file.text()
  } catch {
    alert("PDF konnte nicht gelesen werden. Bitte Text aus PDF kopieren und unten einfügen.")
    throw new Error("PDF read failed")
  }
}

export default function App() {
  const [file, setFile] = useState<File | null>(null)
  const [rawText, setRawText] = useState("")
  const [games, setGames] = useState<GameItem[]>([])
  const [weekStart, setWeekStart] = useState(dayjs().startOf("week").add(1, "day").format("YYYY-MM-DD"))

  const parsedGames = useMemo(() => games.sort((a, b) => a.dt.localeCompare(b.dt)), [games])

  const handleParse = async () => {
    let text = rawText.trim()
    if (!text && file) text = await extractPdfText(file)
    if (!text) return alert("Kein Text oder PDF gewählt.")
    setGames(parseBFVText(text))
  }

  return (
    <div className="p-6 font-sans text-slate-800 bg-slate-50 min-h-screen">
      <h1 className="text-2xl font-bold mb-3">Platzbelegung – PDF oder Text analysieren</h1>

      <div className="bg-white p-4 rounded-xl shadow mb-4 grid md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">PDF hochladen</label>
          <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button
            onClick={handleParse}
            className="mt-3 px-3 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800"
          >
            PDF/Text auswerten
          </button>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Alternativ: Text aus PDF hier einfügen</label>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={10}
            className="w-full border rounded-lg p-2 font-mono text-xs"
            placeholder="Hier Text aus dem PDF (Strg+A, Strg+C, Strg+V) einfügen..."
          />
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <input
          type="date"
          value={weekStart}
          onChange={(e) => setWeekStart(e.target.value)}
          className="border rounded px-2 py-1"
        />
        <button
          onClick={() => exportWeekPrintable(parsedGames, weekStart)}
          className="bg-emerald-600 text-white px-3 py-2 rounded-lg hover:bg-emerald-700"
        >
          Wochenplan drucken / PDF
        </button>
        <button
          onClick={() => exportWeekCSV(parsedGames, weekStart)}
          className="bg-slate-900 text-white px-3 py-2 rounded-lg hover:bg-slate-800"
        >
          CSV exportieren
        </button>
      </div>

      <table className="text-sm border-collapse w-full">
        <thead>
          <tr className="bg-slate-900 text-white">
            <th className="px-2 py-1">Datum</th>
            <th className="px-2 py-1">Zeit</th>
            <th className="px-2 py-1">Heim</th>
            <th className="px-2 py-1">Gast</th>
            <th className="px-2 py-1">Wettbewerb</th>
            <th className="px-2 py-1">Abschnitt</th>
          </tr>
        </thead>
        <tbody>
          {parsedGames.length === 0 ? (
            <tr>
              <td colSpan={6} className="text-center text-slate-500 py-6">
                Noch keine Spiele geladen
              </td>
            </tr>
          ) : (
            parsedGames.map((g) => (
              <tr key={g.id} className="odd:bg-slate-100">
                <td className="px-2 py-1">{dayjs(g.date).format("DD.MM.YYYY")}</td>
                <td className="px-2 py-1">{g.time}</td>
                <td className="px-2 py-1">{g.homeTeam}</td>
                <td className="px-2 py-1">{g.awayTeam}</td>
                <td className="px-2 py-1">{g.competition}</td>
                <td className="px-2 py-1">{g.section}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
