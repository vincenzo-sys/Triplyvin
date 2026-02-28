import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LINKS_PATH = path.resolve(__dirname, '..', 'data', 'external-links.json')

export interface ExternalLink {
  id: string
  url: string
  domain: string
  title: string
  description: string
  anchorTextSuggestions: string[]
  category: string
  subcategory: string
  linkType: string
  authority: 'high' | 'medium' | 'low'
  trustSignals: string[]
  relevantAirports: string[]
  relevantTopics: string[]
  relevantArticleTypes: string[]
  rel: 'dofollow' | 'nofollow' | 'sponsored'
  contextualUsage: string
  pageType: string
  lastVerified: string
  status: string
}

interface ExternalLinksDB {
  _metadata: Record<string, unknown>
  links: ExternalLink[]
  _usageGuidelines: Record<string, unknown>
}

let _cache: ExternalLinksDB | null = null

function loadDB(): ExternalLinksDB {
  if (_cache) return _cache
  if (!fs.existsSync(LINKS_PATH)) {
    console.warn(`  ⚠ External links DB not found at ${LINKS_PATH} — no external links will be used`)
    _cache = { _metadata: {}, links: [], _usageGuidelines: {} }
    return _cache
  }
  const data = JSON.parse(fs.readFileSync(LINKS_PATH, 'utf-8')) as ExternalLinksDB
  _cache = data
  return data
}

/**
 * Get external links filtered by airport code and article type.
 * Returns only active links relevant to the given airport and article type.
 */
export function getExternalLinks(
  airportCode: string,
  articleType: string
): ExternalLink[] {
  const db = loadDB()
  const code = airportCode.toUpperCase()

  return db.links.filter((link) => {
    if (link.status !== 'active' && link.status !== 'cloudflare-blocked') return false
    const airportMatch = link.relevantAirports.includes(code) || link.relevantAirports.includes('all')
    const typeMatch = link.relevantArticleTypes.includes(articleType)
    return airportMatch && typeMatch
  })
}

/**
 * Format external links into a prompt-ready string for the AI writer.
 * Groups by authority level and includes anchor text + usage guidance.
 */
export function formatExternalLinksForPrompt(
  links: ExternalLink[],
  articleType: string
): string {
  if (links.length === 0) return ''

  const densityGuide: Record<string, string> = {
    hub: '6-10 external links',
    'sub-pillar': '4-7 external links',
    spoke: '2-4 external links',
  }

  const high = links.filter((l) => l.authority === 'high')
  const medium = links.filter((l) => l.authority === 'medium')
  const low = links.filter((l) => l.authority === 'low')

  let output = `**EXTERNAL LINKS DATABASE — use these verified links in the article:**
Target: ${densityGuide[articleType] || '4-7 external links'}. At least 50% should be high-authority. Use 4+ unique domains.
Never use "click here" as anchor text. Never put external links in CTAs (CTAs link to Triply only).
Place links naturally within body paragraphs. Front-load high-authority links in the first half.\n\n`

  const formatLink = (l: ExternalLink) => {
    const rel = l.rel === 'nofollow' ? ' rel="nofollow"' : ''
    const anchors = l.anchorTextSuggestions.slice(0, 2).join('" or "')
    return `- [${l.authority.toUpperCase()}] ${l.url}${rel}
  Anchors: "${anchors}"
  When: ${l.contextualUsage}`
  }

  if (high.length > 0) {
    output += `HIGH AUTHORITY (prefer these):\n${high.map(formatLink).join('\n')}\n\n`
  }
  if (medium.length > 0) {
    output += `MEDIUM AUTHORITY:\n${medium.map(formatLink).join('\n')}\n\n`
  }
  if (low.length > 0) {
    output += `LOW AUTHORITY (use sparingly):\n${low.map(formatLink).join('\n')}\n\n`
  }

  return output
}
