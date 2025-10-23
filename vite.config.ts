import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// ⚠️ ganz wichtig: Base-URL für GitHub Pages muss deinem Repo-Namen entsprechen!
export default defineConfig({
  plugins: [react()],
  base: "/platzbelegung/",
  build: {
    outDir: "dist",
  },
})
