import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ❗ Falls dein Repo anders heißt, ersetze 'platzbelegung' unten entsprechend.
export default defineConfig({
  plugins: [react()],
  base: '/platzbelegung/',
})
