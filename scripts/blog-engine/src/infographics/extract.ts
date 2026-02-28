import type { PricingRow } from './templates/pricing-comparison.js'
import type { ComparisonFeature } from './templates/comparison-matrix.js'
import type { ProcessStep } from './templates/process-strip.js'

export type InfographicType = 'pricing-comparison' | 'stat-highlight' | 'tips-list' | 'comparison-matrix' | 'process-strip'

export interface PricingComparisonSpec {
  type: 'pricing-comparison'
  data: {
    title: string
    rows: PricingRow[]
    airportCode: string
  }
  insertAfterHeading: string
}

export interface StatHighlightSpec {
  type: 'stat-highlight'
  data: {
    stat: string
    label: string
    context: string
  }
  insertAfterHeading: string
}

export interface TipsListSpec {
  type: 'tips-list'
  data: {
    title: string
    tips: string[]
  }
  insertAfterHeading: string
}

export interface ComparisonMatrixSpec {
  type: 'comparison-matrix'
  data: {
    title: string
    lots: string[]
    features: ComparisonFeature[]
    airportCode: string
  }
  insertAfterHeading: string
}

export interface ProcessStripSpec {
  type: 'process-strip'
  data: {
    title: string
    steps: ProcessStep[]
  }
  insertAfterHeading: string
}

export type InfographicSpec = PricingComparisonSpec | StatHighlightSpec | TipsListSpec | ComparisonMatrixSpec | ProcessStripSpec

/**
 * Extract pricing data from HTML: looks for dollar amounts with lot names.
 * Patterns: "$XX/day", "$XX per day", "$XX daily"
 */
function extractPricingData(html: string, airportCode: string): PricingComparisonSpec | null {
  // Match patterns like: "Lot Name ... $XX/day" or "$XX" near lot names
  // Look for pricing in tables, lists, or paragraphs
  const pricePattern = /(?:<(?:li|td|p|strong|b)[^>]*>)?([^<]{3,60})\s+[-–—:]\s*\$(\d+(?:\.\d{2})?)\s*(?:\/|\s*per\s*)?\s*(?:day|night|daily)/gi
  const matches: { name: string; price: string }[] = []

  let match
  let lastPriceMatchIndex = 0
  while ((match = pricePattern.exec(html)) !== null) {
    lastPriceMatchIndex = match.index
    const name = match[1].replace(/<[^>]+>/g, '').trim()
    const price = `$${match[2]}/day`
    if (name.length > 2 && name.length < 60) {
      matches.push({ name, price })
    }
  }

  // Also try: "$XX ... for ... lot/garage/parking"
  const altPattern = /\$(\d+(?:\.\d{2})?)\s*(?:\/day|per day|daily)?\s+(?:for|at)\s+([^<.]{3,50}?)(?:[.<])/gi
  while ((match = altPattern.exec(html)) !== null) {
    if (match.index > lastPriceMatchIndex) lastPriceMatchIndex = match.index
    const price = `$${match[1]}/day`
    const name = match[2].replace(/<[^>]+>/g, '').trim()
    if (name.length > 2 && !matches.some(m => m.name === name)) {
      matches.push({ name, price })
    }
  }

  if (matches.length < 2) return null

  // Find the heading closest to pricing content
  const headingBeforePricing = findHeadingBefore(html, lastPriceMatchIndex, ['price', 'cost', 'rate', 'parking', 'comparison', 'option'])

  const rows: PricingRow[] = matches.slice(0, 6).map(m => ({
    name: m.name,
    price: m.price,
    features: [],
  }))

  // Try to extract features: shuttle, covered, valet, EV, etc.
  const featureKeywords = ['shuttle', 'covered', 'valet', 'EV charging', 'indoor', 'outdoor', 'self-park', 'open-air', '24/7', 'security']
  for (const row of rows) {
    // Search for features mentioned near this lot name
    const nameEscaped = row.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const contextPattern = new RegExp(`${nameEscaped}[^<]{0,300}`, 'gi')
    const ctx = contextPattern.exec(html)
    if (ctx) {
      for (const kw of featureKeywords) {
        if (ctx[0].toLowerCase().includes(kw.toLowerCase()) && row.features.length < 3) {
          row.features.push(kw)
        }
      }
    }
  }

  return {
    type: 'pricing-comparison',
    data: {
      title: 'Parking Price Comparison',
      rows,
      airportCode,
    },
    insertAfterHeading: headingBeforePricing || '',
  }
}

/**
 * Extract a standout statistic: percentages, large numbers, dollar savings.
 */
function extractStatHighlight(html: string): StatHighlightSpec | null {
  const statPatterns = [
    // "save XX%" or "save up to XX%"
    { re: /save\s+(?:up\s+to\s+)?(\d{1,3})%/gi, format: (m: RegExpExecArray) => ({ stat: `${m[1]}%`, label: 'Potential Savings', context: '' }) },
    // "XX% cheaper/savings/less/off"
    { re: /(\d{1,3})%\s+((?:cheaper|savings?|less|off|discount)[^<.]{0,60})/gi, format: (m: RegExpExecArray) => ({ stat: `${m[1]}%`, label: `${m[2].trim()}`, context: '' }) },
    // "save $XX" or "$XX savings"
    { re: /save\s+\$(\d+(?:,\d{3})*(?:\.\d{2})?)/gi, format: (m: RegExpExecArray) => ({ stat: `$${m[1]}`, label: 'Potential Savings', context: '' }) },
    // "XX million passengers" or "XX,XXX spots"
    { re: /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?\s*(?:million|billion))\s+(passenger|spot|space|vehicle|traveler|visitor)s?/gi, format: (m: RegExpExecArray) => ({ stat: m[1], label: `${m[2]}s`, context: '' }) },
    // "as low as $XX/day"
    { re: /as\s+low\s+as\s+\$(\d+(?:\.\d{2})?)\s*(?:\/|\s*per\s*)?\s*(?:day|night)/gi, format: (m: RegExpExecArray) => ({ stat: `$${m[1]}`, label: 'Per Day', context: 'Lowest available rate' }) },
  ]

  for (const { re, format } of statPatterns) {
    const match = re.exec(html)
    if (match) {
      const data = format(match)
      // Get surrounding context
      const start = Math.max(0, match.index - 200)
      const contextHtml = html.slice(start, match.index + match[0].length + 200)
      const plainContext = contextHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      if (!data.context) {
        data.context = plainContext.slice(0, 120)
      }

      const heading = findHeadingBefore(html, match.index, [])
      return {
        type: 'stat-highlight',
        data,
        insertAfterHeading: heading || '',
      }
    }
  }

  return null
}

/**
 * Extract tips/checklist items from ordered/unordered lists or numbered sections.
 */
function extractTipsList(html: string): TipsListSpec | null {
  // Look for a tips/checklist section
  const tipSectionPattern = /<h[23][^>]*>([^<]*(?:tip|trick|checklist|hack|strategy|way|step|thing|must|essential|guide)[^<]*)<\/h[23]>/gi
  const sectionMatch = tipSectionPattern.exec(html)

  if (sectionMatch) {
    const headingText = sectionMatch[1].trim()
    const afterHeading = html.slice(sectionMatch.index + sectionMatch[0].length)

    // Extract list items after the heading
    const tips = extractListItems(afterHeading)
    if (tips.length >= 3) {
      return {
        type: 'tips-list',
        data: {
          title: headingText,
          tips: tips.slice(0, 8),
        },
        insertAfterHeading: headingText,
      }
    }
  }

  // Fallback: look for any substantial list with actionable items
  const listPattern = /<(?:ul|ol)[^>]*>([\s\S]*?)<\/(?:ul|ol)>/gi
  let listMatch
  while ((listMatch = listPattern.exec(html)) !== null) {
    const tips = extractListItems(listMatch[0])
    if (tips.length >= 4) {
      const heading = findHeadingBefore(html, listMatch.index, [])
      return {
        type: 'tips-list',
        data: {
          title: heading || 'Key Tips',
          tips: tips.slice(0, 8),
        },
        insertAfterHeading: heading || '',
      }
    }
  }

  return null
}

/**
 * Extract a comparison matrix from HTML tables or repeated lot+feature patterns.
 */
function extractComparisonMatrix(html: string, airportCode: string): ComparisonMatrixSpec | null {
  const featureKeywords = ['shuttle', 'covered', 'valet', 'EV charging', '24/7', 'indoor', 'security', 'self-park']
  const lots: string[] = []
  const featureMap: Map<string, Record<string, boolean>> = new Map()

  // Strategy 1: Look for HTML tables with lot names in headers
  const tablePattern = /<table[^>]*>([\s\S]*?)<\/table>/gi
  let tableMatch
  while ((tableMatch = tablePattern.exec(html)) !== null) {
    const tableHtml = tableMatch[1]

    // Extract header cells as lot names
    const headerPattern = /<th[^>]*>([\s\S]*?)<\/th>/gi
    const headers: string[] = []
    let hMatch
    while ((hMatch = headerPattern.exec(tableHtml)) !== null) {
      const text = hMatch[1].replace(/<[^>]+>/g, '').trim()
      if (text.length > 1) headers.push(text)
    }

    // Skip first header (usually "Feature" label), rest are lot names
    if (headers.length >= 3) {
      const lotNames = headers.slice(1)

      // Extract rows
      const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
      let rowMatch
      let rowIndex = 0
      while ((rowMatch = rowPattern.exec(tableHtml)) !== null) {
        rowIndex++
        if (rowIndex === 1) continue // skip header row

        const cellPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi
        const cells: string[] = []
        let cellMatch
        while ((cellMatch = cellPattern.exec(rowMatch[1])) !== null) {
          cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim())
        }

        if (cells.length >= 2) {
          const featureName = cells[0]
          const values: Record<string, boolean> = {}
          for (let i = 1; i < cells.length && i - 1 < lotNames.length; i++) {
            const cell = cells[i].toLowerCase()
            values[lotNames[i - 1]] = cell.includes('yes') || cell.includes('\u2713') || cell.includes('check') || cell === 'x' || cell === '\u2714'
          }
          featureMap.set(featureName, values)
        }
      }

      if (lotNames.length >= 2 && featureMap.size >= 3) {
        lots.push(...lotNames)
        break
      }
    }
  }

  // Strategy 2: Fallback — scan for repeated lot names paired with feature keywords
  if (lots.length < 2) {
    featureMap.clear()

    // Find lot-like names: look for names near price patterns or "parking" mentions
    const lotNamePattern = /(?:<(?:strong|b|h[234]|td|li)[^>]*>)([A-Z][^<]{2,40}(?:Parking|Lot|Garage|Park|Valet)[^<]{0,20}?)(?:<\/)/gi
    const foundLots = new Set<string>()
    let lMatch
    while ((lMatch = lotNamePattern.exec(html)) !== null) {
      const name = lMatch[1].replace(/<[^>]+>/g, '').trim()
      if (name.length > 3 && name.length < 50) {
        foundLots.add(name)
      }
    }

    const lotNames = [...foundLots].slice(0, 5)

    if (lotNames.length >= 2) {
      // For each feature keyword, check which lots mention it nearby
      for (const kw of featureKeywords) {
        const values: Record<string, boolean> = {}
        let hasAny = false
        for (const lot of lotNames) {
          const lotEscaped = lot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const nearbyPattern = new RegExp(`${lotEscaped}[\\s\\S]{0,400}`, 'gi')
          const ctx = nearbyPattern.exec(html)
          const hasFeature = ctx ? ctx[0].toLowerCase().includes(kw.toLowerCase()) : false
          values[lot] = hasFeature
          if (hasFeature) hasAny = true
        }
        if (hasAny) {
          featureMap.set(kw.charAt(0).toUpperCase() + kw.slice(1), values)
        }
      }

      if (featureMap.size >= 3) {
        lots.push(...lotNames)
      }
    }
  }

  if (lots.length < 2 || featureMap.size < 3) return null

  const features: ComparisonFeature[] = [...featureMap.entries()].slice(0, 8).map(([name, values]) => ({
    name,
    values,
  }))

  const heading = findHeadingBefore(html, html.length, ['compare', 'comparison', 'feature', 'vs', 'versus', 'option'])
    || findHeadingBefore(html, html.length, [])

  return {
    type: 'comparison-matrix',
    data: {
      title: 'Parking Feature Comparison',
      lots: lots.slice(0, 5),
      features,
      airportCode,
    },
    insertAfterHeading: heading || '',
  }
}

/**
 * Extract a process strip from how-to sections or ordered lists.
 */
function extractProcessStrip(html: string): ProcessStripSpec | null {
  // Look for headings containing process-related keywords
  const processHeadingPattern = /<h[23][^>]*>([^<]*(?:how to|step|process|guide|getting started|book)[^<]*)<\/h[23]>/gi
  const headingMatch = processHeadingPattern.exec(html)

  if (headingMatch) {
    const headingText = headingMatch[1].trim()
    const afterHeading = html.slice(headingMatch.index + headingMatch[0].length)

    // Try to extract ordered list items
    const olPattern = /<ol[^>]*>([\s\S]*?)<\/ol>/gi
    const olMatch = olPattern.exec(afterHeading)

    if (olMatch) {
      const items = extractListItems(olMatch[0])
      if (items.length >= 3) {
        const steps: ProcessStep[] = items.slice(0, 4).map(item => {
          // Split item into label (first few words) and description (rest)
          const words = item.split(/\s+/)
          const labelWords = Math.min(3, Math.ceil(words.length / 3))
          return {
            label: words.slice(0, labelWords).join(' '),
            description: words.slice(labelWords).join(' ') || item,
          }
        })

        return {
          type: 'process-strip',
          data: { title: headingText, steps },
          insertAfterHeading: headingText,
        }
      }
    }

    // Try unordered list as fallback
    const ulPattern = /<ul[^>]*>([\s\S]*?)<\/ul>/gi
    const ulMatch = ulPattern.exec(afterHeading)
    if (ulMatch) {
      const items = extractListItems(ulMatch[0])
      if (items.length >= 3) {
        const steps: ProcessStep[] = items.slice(0, 4).map(item => {
          const words = item.split(/\s+/)
          const labelWords = Math.min(3, Math.ceil(words.length / 3))
          return {
            label: words.slice(0, labelWords).join(' '),
            description: words.slice(labelWords).join(' ') || item,
          }
        })

        return {
          type: 'process-strip',
          data: { title: headingText, steps },
          insertAfterHeading: headingText,
        }
      }
    }
  }

  // Fallback: generate standard parking process when article mentions booking/shuttle
  const hasBooking = /\b(?:book|reserv|online)\b/i.test(html)
  const hasShuttle = /\b(?:shuttle|transport|pickup)\b/i.test(html)

  if (hasBooking && hasShuttle) {
    const heading = findHeadingBefore(html, html.length, ['book', 'reserv', 'how', 'process', 'step'])
      || findHeadingBefore(html, html.length, [])

    return {
      type: 'process-strip',
      data: {
        title: 'How Airport Parking Works',
        steps: [
          { label: 'Book Online', description: 'Reserve your spot in advance for the best rates' },
          { label: 'Drive to Lot', description: 'Follow directions to your chosen parking facility' },
          { label: 'Shuttle to Terminal', description: 'Take the free shuttle to your departure terminal' },
          { label: 'Fly!', description: 'Your car stays safe and secure while you travel' },
        ],
      },
      insertAfterHeading: heading || '',
    }
  }

  return null
}

function extractListItems(html: string): string[] {
  const liPattern = /<li[^>]*>([\s\S]*?)<\/li>/gi
  const items: string[] = []
  let match
  while ((match = liPattern.exec(html)) !== null) {
    const text = match[1].replace(/<[^>]+>/g, '').trim()
    if (text.length > 10 && text.length < 150) {
      items.push(text)
    }
  }
  return items
}

/**
 * Find the nearest heading before a given position in HTML, optionally matching keywords.
 */
function findHeadingBefore(html: string, position: number, keywords: string[]): string {
  const headingPattern = /<h[23][^>]*>([^<]+)<\/h[23]>/gi
  let best = ''
  let bestPos = -1
  let match

  while ((match = headingPattern.exec(html)) !== null) {
    if (match.index < position) {
      const text = match[1].trim()
      if (keywords.length === 0 || keywords.some(kw => text.toLowerCase().includes(kw))) {
        if (match.index > bestPos) {
          best = text
          bestPos = match.index
        }
      }
    }
  }

  // If no keyword match, just use the closest heading
  if (!best && keywords.length > 0) {
    return findHeadingBefore(html, position, [])
  }

  return best
}

type ArticleStyle = 'data-heavy' | 'comparison' | 'hub' | 'sub-pillar' | 'spoke' | 'narrative' | 'listicle' | 'standard'

/**
 * Determine which infographic types to generate based on article style.
 */
function getTemplatesForStyle(style: ArticleStyle): InfographicType[] {
  switch (style) {
    case 'data-heavy':
      return ['pricing-comparison', 'stat-highlight', 'comparison-matrix']
    case 'comparison':
      return ['pricing-comparison', 'comparison-matrix', 'tips-list']
    case 'hub':
      return ['stat-highlight', 'tips-list', 'pricing-comparison', 'comparison-matrix', 'process-strip']
    case 'sub-pillar':
      return ['pricing-comparison', 'stat-highlight', 'process-strip']
    case 'spoke':
    case 'narrative':
    case 'standard':
      return ['stat-highlight', 'process-strip']
    case 'listicle':
      return ['tips-list', 'process-strip']
    default:
      return ['stat-highlight']
  }
}

/**
 * Extract structured data from final article HTML and return infographic specs.
 * Returns at most `maxCount` specs (default 3).
 */
export function extractInfographicData(
  html: string,
  airportCode: string,
  articleStyle: string,
  maxCount = 3,
): InfographicSpec[] {
  const style = (articleStyle || 'standard') as ArticleStyle
  const desiredTypes = getTemplatesForStyle(style)
  const specs: InfographicSpec[] = []

  for (const templateType of desiredTypes) {
    if (specs.length >= maxCount) break

    let spec: InfographicSpec | null = null

    switch (templateType) {
      case 'pricing-comparison':
        spec = extractPricingData(html, airportCode)
        break
      case 'stat-highlight':
        spec = extractStatHighlight(html)
        break
      case 'tips-list':
        spec = extractTipsList(html)
        break
      case 'comparison-matrix':
        spec = extractComparisonMatrix(html, airportCode)
        break
      case 'process-strip':
        spec = extractProcessStrip(html)
        break
    }

    if (spec) {
      specs.push(spec)
    }
  }

  return specs
}
