import React, { useMemo, useState } from "react";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import advancedFormat from "dayjs/plugin/advancedFormat";
import "dayjs/locale/de";

// ---- Time setup ----
dayjs.extend(isoWeek);
dayjs.extend(advancedFormat);
dayjs.locale("de");

// ---- Domain config from user ----
const FIELDS = [
  "A",
  "B",
  "C",
  "Frimmersdorf",
  "Vestenbergsgreuth",
  "ASV Weisendorf Kunstrasen",
] as const;
export type FieldName = typeof FIELDS[number];

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
];

// ---- Types ----
interface GameRaw {
  lineIdx: number;
  spieltyp: string;
  spielklasse: string;
  date: string;
  time: string;
  pairing: string;
  venue: string;
  section: string;
}

export interface GameItem {
  id: string;
  date: string;
  time: string;
  dt: string;
  section: string;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  isHome: boolean;
  venue: string;
  suggestedField: FieldName | null;
  assignedField: FieldName | null;
}

// ---- Helpers ----
function normalizeSpaces(s: string) {
  return s.replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
}

function toISODate(dmy: string) {
  const [d, m, y] = dmy.split(".").map(Number);
  return dayjs(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`).format("YYYY-MM-DD");
}

function makeId(gr: GameRaw) {
  return `${gr.date}_${gr.time}_${normalizeSpaces(gr.pairing).slice(0, 60)}`;
}

function detectHomeAndSplit(pairing: string): { homeTeam: string; awayTeam: string; isHome: boolean } {
  const text = normalizeSpaces(pairing);
  for (const prefix of OUR_TEAM_PREFIXES.sort((a, b) => b.length - a.length)) {
    if (text.startsWith(prefix + " ") || text === prefix) {
      const rest = text.slice(prefix.length).trim();
      return { homeTeam: prefix, awayTeam: rest, isHome: true };
    }
  }
  const rightPrefix = OUR_TEAM_PREFIXES.find((p) => text.endsWith(" " + p) || text === p || text.includes(" " + p));
  if (rightPrefix) {
    const idx = text.lastIndexOf(rightPrefix);
    const left = text.slice(0, idx).trim();
    return { homeTeam: left, awayTeam: rightPrefix, isHome: false };
  }
  const twoSpace = text.indexOf("  ");
  if (twoSpace > -1) {
    return { homeTeam: text.slice(0, twoSpace).trim(), awayTeam: text.slice(twoSpace).trim(), isHome: false };
  }
  const m = text.match(/^(.*?)(?= [A-ZÄÖÜ(])/);
  if (m) {
    return { homeTeam: m[0].trim(), awayTeam: text.slice(m[0].length).trim(), isHome: false };
  }
  return { homeTeam: text, awayTeam: "", isHome: false };
}

function suggestFieldFromVenue(venue: string): FieldName | null {
  const v = venue.toLowerCase();
  if (v.includes("frimmersdorf")) return "Frimmersdorf";
  if (v.includes("vestenbergsgreuth")) return "Vestenbergsgreuth";
  if (v.includes("weisendorf") && v.includes("kunstrasen")) return "ASV Weisendorf Kunstrasen";
  if (v.includes("am sonnenhügel")) {
    if (v.includes("platz 1")) return "A";
    if (v.includes("platz 2")) return "B";
    if (v.includes("platz 3")) return "C";
    return "A";
  }
  return null;
}

function mapRawToGame(gr: GameRaw): GameItem | null {
  if (gr.time.toUpperCase() === "SPIELFREI") return null;
  const { homeTeam, awayTeam, isHome } = detectHomeAndSplit(gr.pairing);
  const iso = toISODate(gr.date);
  const dt = `${iso}T${gr.time.length === 4 ? "0" + gr.time : gr.time}:00`;
  const competition = `${gr.spieltyp} ${gr.spielklasse}`.trim();
  const suggestedField = isHome ? suggestFieldFromVenue(gr.venue) : null;
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
  };
}

function parseBFVText(txt: string): GameItem[] {
  const lines = txt
    .split(/\r?\n/)
    .map((l) => l.replace(/\u00A0/g, " ").trim())
    .filter((l) => l.length > 0);

  const isRowStart = (l: string) => /^(FS|ME|PO)\s+/.test(l);
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
    ].includes(l.replace(/\s+/g, " "));

  let currentSection = "";
  const raws: GameRaw[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isHeaderSection(line)) {
      currentSection = line;
      continue;
    }
    if (!isRowStart(line)) continue;

    const typeMatch = line.match(/^(FS|ME|PO)\s+(.*)$/);
    if (!typeMatch) continue;
    const spieltyp = typeMatch[1];
    const rest = typeMatch[2];

    const dateTimeMatch = rest.match(/^(.*?)\s(\d{2}\.\d{2}\.\d{4})\s((?:\d{2}:\d{2})|SPIELFREI)\s(.*)$/);

    let spielklasse = "";
    let date = "";
    let time = "";
    let pairing = "";

    if (dateTimeMatch) {
      spielklasse = dateTimeMatch[1].trim();
      date = dateTimeMatch[2];
      time = dateTimeMatch[3];
      pairing = dateTimeMatch[4].trim();
    } else {
      const dateOnlyMatch = rest.match(/^(.*?)\s(\d{2}\.\d{2}\.\d{4})\s(.*)$/);
      if (!dateOnlyMatch) continue;
      spielklasse = dateOnlyMatch[1].trim();
      date = dateOnlyMatch[2];
      const tail = dateOnlyMatch[3].trim();
      const timeMatch = tail.match(/^(\d{2}:\d{2})\s(.*)$/);
      if (timeMatch) {
        time = timeMatch[1];
        pairing = timeMatch[2];
      } else if (/^SPIELFREI/.test(tail)) {
        time = "SPIELFREI";
        pairing = tail.replace(/^SPIELFREI\s*/, "");
      } else {
        time = "";
        pairing = tail;
      }
    }

    let venue = "";
    let j = i + 1;
    while (j < lines.length && !isRowStart(lines[j]) && !isHeaderSection(lines[j])) {
      if (
        /^Bayerischer Fußball-Verband/.test(lines[j]) ||
        /^Ergebnisse online/.test(lines[j]) ||
        /^Kursiv dargestellte Spiele/.test(lines[j]) ||
        /^https:\/\//.test(lines[j]) ||
        /^Zeit:/.test(lines[j]) ||
        /^Seite \d+ von/.test(lines[j]) ||
        /^TSV Lonnerstadt$/.test(lines[j]) ||
        /^Alle Vereinsspiele in der Übersicht$/.test(lines[j])
      ) {
        j++;
        continue;
      }
      if (lines[j].match(/^[A-ZÄÖÜ][A-Za-zÄÖÜäöüß\- ]+$/) && isHeaderSection(lines[j])) break;
      venue += (venue ? " " : "") + lines[j];
      j++;
    }

    raws.push({
      lineIdx: i,
      spieltyp,
      spielklasse,
      date,
      time: time || "",
      pairing,
      venue: venue.trim(),
      section: currentSection || "",
    });

    i = j - 1;
  }

  return raws
    .map(mapRawToGame)
    .filter((g): g is GameItem => !!g)
    .sort((a, b) => a.dt.localeCompare(b.dt));
}

// ---- Print-based PDF export (no external libs) ----
function exportWeekPrintable(games: GameItem[], weekStartISO: string, title = "TSV Lonnerstadt – Wochenplan Platzbelegung") {
  const weekStart = dayjs(weekStartISO);
  const weekEnd = weekStart.add(6, "day");
  const days = Array.from({ length: 7 }, (_, i) => weekStart.add(i, "day"));

  const cell = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const rowsHtml = FIELDS.map((field) => {
    const cols = days.map((d) => {
      const dayGames = games.filter(
        (g) => g.isHome && g.assignedField === field && dayjs(g.date).isSame(d, "day")
      );
      if (dayGames.length === 0) return `<td></td>`;
      const text = dayGames
        .map((g) => `${cell(g.time)} – ${cell(g.homeTeam)} vs ${cell(g.awayTeam)}<br/><span class=\"muted\">${cell(g.section)} · ${cell(g.competition)}</span>`)
        .join("<br/><br/>");
      return `<td>${text}</td>`;
    }).join("");
    return `<tr><th>${field}</th>${cols}</tr>`;
  }).join("");

  const html = `<!doctype html>
<html>
<head>
<meta charset=\"utf-8\" />
<title>${cell(title)}</title>
<style>
  @page { size: A4 landscape; margin: 16mm; }
  body { font: 12px system-ui, -apple-system, Segoe UI, Roboto, \"Helvetica Neue\", Arial; color: #0f172a; }
  h1 { font-size: 18px; margin: 0 0 12px; }
  .muted { color: #475569; font-size: 10px; }
  table { border-collapse: collapse; width: 100%; }
  thead th { background:#0f172a; color:#fff; padding: 6px 8px; text-align:left; }
  tbody th { background:#e2e8f0; text-align:left; padding: 6px 8px; white-space:nowrap; }
  td { border: 1px solid #cbd5e1; vertical-align: top; padding: 6px 8px; min-width: 120px; }
  th { border: 1px solid #cbd5e1; }
  .footer { margin-top: 10px; font-size: 10px; color:#64748b; }
</style>
</head>
<body>
  <h1>${cell(title)} – KW ${weekStart.isoWeek()} (${weekStart.format("DD.MM.")}–${weekEnd.format("DD.MM.YYYY")})</h1>
  <table>
    <thead>
      <tr>
        <th>Platz</th>
        ${days.map((d) => `<th>${d.format("dd DD.MM.")}</th>`).join("")}
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>
  <div class=\"footer\">Generiert mit Platzbelegung-Tool</div>
  <script>window.onload = () => { try { window.print(); } catch(e){} };</script>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank");
  if (!w) {
    alert("Popup wurde blockiert. Bitte Popups erlauben oder den Link manuell öffnen.");
  }
}

// ---- PDF reading (lazy import + graceful fallback) ----
async function extractPdfText(file: File): Promise<string> {
  try {
    // @ts-ignore
    const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf");
    // @ts-ignore
    if (pdfjs.GlobalWorkerOptions) {
      // @ts-ignore
      pdfjs.GlobalWorkerOptions.workerSrc = "";
    }
    const buf = await file.arrayBuffer();
    const loadingTask = pdfjs.getDocument({ data: buf, isEvalSupported: false, useWorkerFetch: false });
    const pdf = await loadingTask.promise;
    let fullText = "";
    const total = pdf.numPages || 0;
    for (let p = 1; p <= total; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const strings = content.items.map((it: any) => (it.str ?? "")).filter(Boolean);
      fullText += strings.join("\n") + "\n";
    }
    return fullText;
  } catch (err) {
    console.warn("PDF parse failed or blocked. Falling back to paste mode.", err);
    throw new Error(
      "PDF-Text-Extraktion ist in dieser Umgebung nicht möglich. Bitte kopiere den Text aus dem PDF (Strg+A, Strg+C) in das Textfeld und klicke erneut auf 'PDF/Text auswerten'."
    );
  }
}

// -----------------------------
// 🔎 Built-in Parser Test Suite
// -----------------------------
const SAMPLE_BFV_TEXT = `
TSV Lonnerstadt
Alle Vereinsspiele in der Übersicht

Herren
ME Kreisliga 21.09.2025 15:00 TSV Lonnerstadt SpVgg Reuth
Lonnerstadt, Am Sonnenhügel, Platz 1
ME Kreisliga 22.09.2025 10:00 SC Adelsdorf TSV Lonnerstadt
Adelsdorf, Hauptplatz
ME Gruppe 23.09.2025 (SG) TSV Lonnerstadt SPIELFREI
ME Gruppe 24.09.2025 18:00 TSV Lonnerstadt (SG) SV Beispiel
Frimmersdorf, Sportplatz
ME Gruppe 25.09.2025 18:00 TSV Lonnerstadt (SG) Team Zwei
Vestenbergsgreuth, Sportanlage

Frauen
ME Bezirksliga 26.09.2025 19:30 TSV Lonnerstadt Frauen SV Beispiel Frauen
ASV Weisendorf, Kunstrasen
`;

function runParserTests() {
  const results: { name: string; pass: boolean; info?: string }[] = [];
  const items = parseBFVText(SAMPLE_BFV_TEXT);

  // T1: SPIELFREI filtered
  const hasSpielfrei = items.some((g) => g.time.toUpperCase() === "SPIELFREI");
  results.push({ name: "SPIELFREI wird ignoriert", pass: !hasSpielfrei });

  // T2: Count (we expect 5 items parsed, 1 SPIELFREI dropped from 6 entries)
  results.push({ name: "Gesamtzahl Spiele (ohne SPIELFREI) == 5", pass: items.length === 5, info: `count=${items.length}` });

  // T3: Home + Platz A Vorschlag (Sonnenhügel Platz 1)
  const t3 = items.find((g) => g.homeTeam.startsWith("TSV Lonnerstadt") && g.venue.toLowerCase().includes("platz 1"));
  results.push({ name: "Vorschlag Platz A aus 'Am Sonnenhügel, Platz 1'", pass: !!t3 && t3.suggestedField === "A", info: `got=${t3?.suggestedField}` });

  // T4: Away detection (SC Adelsdorf TSV Lonnerstadt)
  const t4 = items.find((g) => g.homeTeam.startsWith("SC Adelsdorf"));
  results.push({ name: "Auswärts korrekt erkannt", pass: !!t4 && !t4.isHome, info: `isHome=${t4?.isHome}` });

  // T5: Frimmersdorf mapping
  const t5 = items.find((g) => g.venue.toLowerCase().includes("frimmersdorf"));
  results.push({ name: "Frimmersdorf → Platz 'Frimmersdorf'", pass: !!t5 && t5.suggestedField === "Frimmersdorf", info: `got=${t5?.suggestedField}` });

  // T6: Vestenbergsgreuth mapping
  const t6 = items.find((g) => g.venue.toLowerCase().includes("vestenbergsgreuth"));
  results.push({ name: "Vestenbergsgreuth → Platz 'Vestenbergsgreuth'", pass: !!t6 && t6.suggestedField === "Vestenbergsgreuth", info: `got=${t6?.suggestedField}` });

  // T7: Weisendorf (Kunstrasen) should auto-map to ASV Weisendorf Kunstrasen
  const t7 = items.find((g) => g.venue.toLowerCase().includes("weisendorf") && g.venue.toLowerCase().includes("kunstrasen"));
  results.push({ name: "Weisendorf (Kunstrasen) → Platz 'ASV Weisendorf Kunstrasen'", pass: !!t7 && t7.suggestedField === "ASV Weisendorf Kunstrasen", info: `got=${t7?.suggestedField}` });

  // T8: Section mapping for Frauen
  const t8 = items.find((g) => g.section === "Frauen");
  results.push({ name: "Abschnitt 'Frauen' korrekt übernommen", pass: !!t8, info: t8 ? `ok` : `missing` });

  // T9: Section mapping for Herren
  const t9 = items.find((g) => g.section === "Herren");
  results.push({ name: "Abschnitt 'Herren' korrekt übernommen", pass: !!t9, info: t9 ? `ok` : `missing` });

  return { items, results };
}

// ---- Main App ----
export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [rawText, setRawText] = useState<string>("");
  const [games, setGames] = useState<GameItem[]>([]);
  const [homeOnly, setHomeOnly] = useState<boolean>(true);
  const [tests, setTests] = useState<{ name: string; pass: boolean; info?: string }[] | null>(null);

  const defaultWeekStart = useMemo(() => {
    const today = dayjs();
    const dow = today.day();
    const daysToNextMon = (8 - dow) % 7; // 0 if Monday
    return today.add(daysToNextMon, "day").format("YYYY-MM-DD");
  }, []);
  const [weekStart, setWeekStart] = useState<string>(defaultWeekStart);

  const parsedGames = useMemo(() => {
    const list = games.slice();
    return (homeOnly ? list.filter((g) => g.isHome) : list).sort((a, b) => a.dt.localeCompare(b.dt));
  }, [games, homeOnly]);

  const assignedCount = useMemo(() => parsedGames.filter((g) => !!g.assignedField).length, [parsedGames]);

  async function handleParse() {
    try {
      let text = rawText.trim();
      if (!text) {
        if (!file) {
          alert("Bitte PDF auswählen oder Text einfügen.");
          return;
        }
        text = await extractPdfText(file);
      }
      const items = parseBFVText(text);
      setGames(items);
    } catch (e: any) {
      console.error(e);
      alert(
        e?.message ||
          "Konnte das PDF nicht automatisch lesen. Bitte kopiere den Text aus dem PDF (z.B. mit STRG+A, STRG+C) in das Textfeld und klicke erneut auf 'PDF/Text auswerten'."
      );
    }
  }

  function handleLoadSample() {
    setRawText(SAMPLE_BFV_TEXT.trim());
  }

  function handleRunTests() {
    const { results } = runParserTests();
    setTests(results);
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold">Platzbelegung – BFV-Vereinsspielplan ➜ Wochenplan</h1>
          <p className="text-sm text-slate-600">
            Schritt 1: PDF hochladen oder Text einfügen → Schritt 2: Heimspiele prüfen & Plätze zuweisen → Schritt 3: Woche
            wählen und PDF erzeugen.
          </p>
          <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-2">
            Hinweis: In dieser Umgebung ist das automatische Lesen von PDFs ggf. eingeschränkt. Wenn der PDF-Import scheitert,
            bitte den Text aus dem BFV-PDF kopieren und im Feld rechts einfügen.
          </div>
        </header>

        {/* Import */}
        <section className="bg-white rounded-2xl shadow p-4 grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium">BFV-Vereinsspielplan (PDF)</label>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full border rounded-lg p-2"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleParse}
                className="inline-flex items-center gap-2 bg-slate-900 text-white px-3 py-2 rounded-lg hover:bg-slate-800"
              >
                PDF/Text auswerten
              </button>
              <button
                onClick={handleLoadSample}
                className="inline-flex items-center gap-2 bg-slate-100 text-slate-900 px-3 py-2 rounded-lg hover:bg-slate-200"
              >
                Beispieltext laden
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Falls der PDF-Import Probleme macht: Text aus dem PDF hier unten einfügen und erneut auswerten.
            </p>
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium">Alternativ: Reiner Text (aus PDF kopiert)</label>
            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              rows={12}
              className="w-full border rounded-lg p-2 font-mono text-xs"
              placeholder={"Hier optional den Text aus dem BFV-PDF einfügen..."}
            />
            <div className="flex items-center gap-2 text-xs">
              <button onClick={handleRunTests} className="px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700">
                Parser-Tests ausführen
              </button>
              {tests && (
                <span>
                  {tests.filter((t) => t.pass).length}/{tests.length} Tests OK
                </span>
              )}
            </div>
            {tests && (
              <ul className="text-xs mt-1 space-y-1">
                {tests.map((t, i) => (
                  <li key={i} className={t.pass ? "text-emerald-700" : "text-red-700"}>
                    {t.pass ? "✔" : "✖"} {t.name} {t.info ? `(${t.info})` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Controls */}
        <section className="bg-white rounded-2xl shadow p-4 flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={homeOnly} onChange={(e) => setHomeOnly(e.target.checked)} />
            Nur Heimspiele anzeigen
          </label>
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-600">Woche ab (Mo):</span>
              <input
                type="date"
                className="border rounded-lg px-2 py-1"
                value={weekStart}
                onChange={(e) => setWeekStart(e.target.value)}
              />
            </div>
            <button
              onClick={() => exportWeekPrintable(parsedGames, weekStart)}
              disabled={parsedGames.length === 0}
              className="inline-flex items-center gap-2 bg-emerald-600 disabled:opacity-40 text-white px-3 py-2 rounded-lg hover:bg-emerald-700"
              title={parsedGames.length ? `${assignedCount}/${parsedGames.length} zugewiesen` : "Erst Spiele laden"}
            >
              Wochenplan drucken/als PDF speichern
            </button>
          </div>
        </section>

        {/* Games table */}
        <section className="bg-white rounded-2xl shadow p-0 overflow-hidden">
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-900 text-white">
                <tr>
                  <th className="text-left px-3 py-2">Datum</th>
                  <th className="text-left px-3 py-2">Anstoß</th>
                  <th className="text-left px-3 py-2">Team (links)</th>
                  <th className="text-left px-3 py-2">Team (rechts)</th>
                  <th className="text-left px-3 py-2">Wettbewerb</th>
                  <th className="text-left px-3 py-2">Abschnitt</th>
                  <th className="text-left px-3 py-2">Spielort (aus PDF)</th>
                  <th className="text-left px-3 py-2">Vorschlag</th>
                  <th className="text-left px-3 py-2">Platz</th>
                </tr>
              </thead>
              <tbody>
                {parsedGames.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-slate-500" colSpan={9}>
                      Keine Spiele geladen. Bitte PDF/Text auswerten.
                    </td>
                  </tr>
                ) : (
                  parsedGames.map((g) => (
                    <tr key={g.id} className="odd:bg-slate-50">
                      <td className="px-3 py-2 whitespace-nowrap">{dayjs(g.date).format("ddd, DD.MM.YYYY")}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{g.time}</td>
                      <td className="px-3 py-2">{g.homeTeam}</td>
                      <td className="px-3 py-2">{g.awayTeam}</td>
                      <td className="px-3 py-2">{g.competition}</td>
                      <td className="px-3 py-2">{g.section}</td>
                      <td className="px-3 py-2 min-w-[280px]">{g.venue}</td>
                      <td className="px-3 py-2">{g.suggestedField ?? "–"}</td>
                      <td className="px-3 py-2">
                        <select
                          className="border rounded-lg px-2 py-1"
                          value={g.assignedField ?? ""}
                          onChange={(e) =>
                            setGames((prev) => prev.map((x) => (x.id === g.id ? { ...x, assignedField: (e.target.value || null) as FieldName | null } : x)))
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
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {parsedGames.length > 0 && (
            <div className="p-3 text-xs text-slate-600 flex items-center justify-between">
              <span>
                Spiele: <b>{parsedGames.length}</b> · Zuweisungen: <b>{assignedCount}</b>
              </span>
              <span className="italic">Hinweis: \"SPIELFREI\"-Einträge werden automatisch ignoriert.</span>
            </div>
          )}
        </section>

        <section className="text-xs text-slate-500">
          <details>
            <summary className="cursor-pointer">Parser-Details anzeigen</summary>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Erkennt Zeilen, die mit <code>FS</code>, <code>ME</code> oder <code>PO</code> beginnen, und liest <em>Spielklasse</em>, Datum, Anstoß und Spielpaarung.</li>
              <li>Fasst die folgenden Zeilen als <em>Spielort</em> zusammen, bis die nächste Spielzeile oder ein Abschnittswechsel kommt.</li>
              <li>Bestimmt <em>Heim</em>/<em>Auswärts</em> anhand bekannter Teampräfixe (TSV/SG Lonnerstadt …), längstes Präfix gewinnt.</li>
              <li>Leitet Platzvorschläge aus dem Spielort ab: Lonnerstadt Platz 1→A, Platz 2→B, Platz 3→C; enthält der Ort
                <em>Frimmersdorf</em>, <em>Vestenbergsgreuth</em> oder <em>ASV Weisendorf, Kunstrasen</em>, wird dies direkt gesetzt.</li>
              <li>Ignoriert <em>SPIELFREI</em>-Einträge automatisch.</li>
              <li>Fallback: Wenn das PDF nicht lesbar ist, kann der Text eingefügt und ausgewertet werden.</li>
            </ul>
          </details>
        </section>
      </div>
    </div>
  );
}
