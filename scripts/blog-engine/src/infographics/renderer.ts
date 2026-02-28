import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import type { ReactNode } from 'react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const assetsDir = path.resolve(__dirname, '..', '..', 'assets')

let fontsLoaded: { name: string; data: ArrayBuffer; weight: 400 | 700; style: 'normal' }[] | null = null

function loadFonts() {
  if (fontsLoaded) return fontsLoaded

  const regularPath = path.join(assetsDir, 'Inter-Regular.ttf')
  const boldPath = path.join(assetsDir, 'Inter-Bold.ttf')

  if (!fs.existsSync(regularPath) || !fs.existsSync(boldPath)) {
    throw new Error(`Inter font files not found in ${assetsDir}. Download Inter-Regular.ttf and Inter-Bold.ttf.`)
  }

  const regularBuf = fs.readFileSync(regularPath)
  const boldBuf = fs.readFileSync(boldPath)

  fontsLoaded = [
    {
      name: 'Inter',
      data: new Uint8Array(regularBuf).buffer as ArrayBuffer,
      weight: 400,
      style: 'normal' as const,
    },
    {
      name: 'Inter',
      data: new Uint8Array(boldBuf).buffer as ArrayBuffer,
      weight: 700,
      style: 'normal' as const,
    },
  ]

  return fontsLoaded
}

export interface RenderOptions {
  width: number
  height: number
  jsx: ReactNode
}

/**
 * Render a JSX element to a PNG buffer via satori → SVG → resvg → PNG.
 */
export async function renderToPng(options: RenderOptions): Promise<Buffer> {
  const fonts = loadFonts()

  const svg = await satori(options.jsx as React.ReactElement, {
    width: options.width,
    height: options.height,
    fonts,
  })

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: options.width },
  })

  const pngData = resvg.render()
  return Buffer.from(pngData.asPng())
}
