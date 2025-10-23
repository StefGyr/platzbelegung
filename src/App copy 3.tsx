import React, { useState, useMemo } from "react"
import dayjs from "dayjs"
import isoWeek from "dayjs/plugin/isoWeek"
import advancedFormat from "dayjs/plugin/advancedFormat"
import "dayjs/locale/de"

dayjs.extend(isoWeek)
dayjs.extend(advancedFormat)
dayjs.locale("de")

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
}

function parseBFVText(txt: string): GameItem[] {
  const lines = txt.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
  const games: GameItem[] = []
  let section = ""
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^(Herren|Frauen|A-Junioren|B-Junioren|C-Junioren|D-Junioren|E-Junioren)/.test(line)) {
      section = line
      continue
    }
    const match = line.match(/(FS|ME|PO)\s+(.+?)\s(\d{2}\.\d{2}\.\d{4})\s(\d{2}:\d{2})\s(.+)/)
    if (match) {
      const date = match[3]
      const iso = dayjs(date, "DD.MM.YYYY").format("YYYY-MM-DD")
      games.push({
        id: `${iso}_${match[4]}_${match[5].slice(0, 50)}`,
        date: iso,
        time: match[4],
        dt: `${iso}T${match[4]}:00`,
        section,
        competition: match[2],
        homeTeam: match[5].split(" ")[0],
        awayTeam: match[5],
        isHome: match[5].includes("TSV Lonnerstadt"),
        venue: "",
      })
    }
  }
  return games.sort((a, b) => a.dt.localeCompare(b.dt))
}

function exportToCSV(games: GameItem[]) {
  const header = ["Datum", "Uhrzeit", "Wettbewerb", "Heim", "Gast", "Abschnitt"]
  const rows = games.map((g) => [
    dayjs(g.date).format("DD.MM.YYYY"),
    g.time,
    g.competition,
    g.homeTeam,
    g.awayTeam,
    g.section,
  ])
  const csvContent = [header, ...rows].map((r) => r.join(";")).join("\n")
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.setAttribute("download", "platzbelegung.csv")
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export default function App() {
  const [text, setText] = useState("")
  const [games, setGames] = useState<GameItem[]>([])
  const [weekStart, setWeekStart] = useState(dayjs().startOf("week").add(1, "day").format("YYYY-MM-DD"))

  const filteredGames = useMemo(
    () => games.filter((g) => dayjs(g.date).isSame(dayjs(weekStart), "week")),
    [games, weekStart]
  )

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <header>
          <h1 className="text-3xl font-bold">🏟️ Platzbelegung – TSV Lonnerstadt</h1>
          <p className="text-zinc-400 mt-1 text-sm">
            BFV-Vereinsspielplan als Text einfügen → Spiele auswerten → CSV exportieren.
          </p>
        </header>

        <section className="bg-zinc-900 rounded-2xl p-4 space-y-3">
          <textarea
            className="w-full h-40 p-2 bg-zinc-950 border border-zinc-700 rounded-lg text-sm font-mono"
            placeholder="Hier den kopierten Text aus dem BFV-PDF einfügen..."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setGames(parseBFVText(text))}
              className="bg-emerald-600 hover:bg-emerald-700 px-4 py-2 rounded-lg text-sm font-medium"
            >
              PDF/Text auswerten
            </button>
            <button
              onClick={() => exportToCSV(games)}
              disabled={games.length === 0}
              className="bg-sky-600 hover:bg-sky-700 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              CSV exportieren
            </button>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-sm text-neutral-400">Woche ab:</span>
              <input
                type="date"
                className="bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1 text-sm"
                value={weekStart}
                onChange={(e) => setWeekStart(e.target.value)}
              />
            </div>
          </div>
        </section>

        <section className="bg-neutral-900 rounded-2xl p-4 overflow-auto">
          {filteredGames.length === 0 ? (
            <p className="text-neutral-400 text-sm text-center py-8">
              Keine Spiele geladen. Bitte Text einfügen und auf <b>„PDF/Text auswerten“</b> klicken.
            </p>
          ) : (
            <table className="min-w-full text-sm border-collapse">
              <thead className="bg-neutral-800 text-neutral-300">
                <tr>
                  <th className="p-2 text-left">Datum</th>
                  <th className="p-2 text-left">Zeit</th>
                  <th className="p-2 text-left">Wettbewerb</th>
                  <th className="p-2 text-left">Heim</th>
                  <th className="p-2 text-left">Gast</th>
                  <th className="p-2 text-left">Abschnitt</th>
                </tr>
              </thead>
              <tbody>
                {filteredGames.map((g) => (
                  <tr key={g.id} className="odd:bg-neutral-950 even:bg-neutral-900">
                    <td className="p-2">{dayjs(g.date).format("DD.MM.YYYY")}</td>
                    <td className="p-2">{g.time}</td>
                    <td className="p-2">{g.competition}</td>
                    <td className="p-2">{g.homeTeam}</td>
                    <td className="p-2">{g.awayTeam}</td>
                    <td className="p-2">{g.section}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {games.length > 0 && (
          <p className="text-xs text-neutral-500 text-center">
            {games.length} Spiele erkannt · KW {dayjs(weekStart).isoWeek()}
          </p>
        )}
      </div>
    </div>
  )
}
