import React from 'react'
import { renderToPng } from './renderer.js'
import { extractInfographicData } from './extract.js'
import type { InfographicSpec } from './extract.js'
import { PricingComparison } from './templates/pricing-comparison.js'
import { StatHighlight } from './templates/stat-highlight.js'
import { TipsList } from './templates/tips-list.js'
import { ComparisonMatrix } from './templates/comparison-matrix.js'
import { ProcessStrip } from './templates/process-strip.js'

export interface InfographicResult {
  buffer: Buffer
  filename: string
  alt: string
  insertAfterHeading: string
}

interface QueueItemLike {
  slug: string
  articleType: string
  airportCode: string
  keyword: string
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

async function renderSpec(spec: InfographicSpec, slug: string, index: number): Promise<InfographicResult> {
  switch (spec.type) {
    case 'pricing-comparison': {
      const jsx = React.createElement(PricingComparison, spec.data)
      const buffer = await renderToPng({ width: 1200, height: 675, jsx })
      return {
        buffer,
        filename: `${slug}-pricing-${index}.png`,
        alt: `${spec.data.title} - ${spec.data.airportCode} airport parking rates comparison`,
        insertAfterHeading: spec.insertAfterHeading,
      }
    }
    case 'stat-highlight': {
      const jsx = React.createElement(StatHighlight, spec.data)
      const buffer = await renderToPng({ width: 1200, height: 400, jsx })
      return {
        buffer,
        filename: `${slug}-stat-${index}.png`,
        alt: `${spec.data.stat} - ${spec.data.label}`,
        insertAfterHeading: spec.insertAfterHeading,
      }
    }
    case 'tips-list': {
      const jsx = React.createElement(TipsList, spec.data)
      const buffer = await renderToPng({ width: 1200, height: 675, jsx })
      return {
        buffer,
        filename: `${slug}-tips-${index}.png`,
        alt: `${spec.data.title} infographic`,
        insertAfterHeading: spec.insertAfterHeading,
      }
    }
    case 'comparison-matrix': {
      const jsx = React.createElement(ComparisonMatrix, spec.data)
      const buffer = await renderToPng({ width: 1200, height: 675, jsx })
      return {
        buffer,
        filename: `${slug}-matrix-${index}.png`,
        alt: `${spec.data.title} - ${spec.data.airportCode} airport parking features comparison`,
        insertAfterHeading: spec.insertAfterHeading,
      }
    }
    case 'process-strip': {
      const jsx = React.createElement(ProcessStrip, spec.data)
      const buffer = await renderToPng({ width: 1200, height: 400, jsx })
      return {
        buffer,
        filename: `${slug}-process-${index}.png`,
        alt: `${spec.data.title} - step by step process`,
        insertAfterHeading: spec.insertAfterHeading,
      }
    }
  }
}

/**
 * Generate infographics for an article.
 * Extracts structured data from HTML, determines which templates to use
 * based on article style, and renders PNG buffers.
 */
export async function generateInfographics(
  html: string,
  item: QueueItemLike,
): Promise<InfographicResult[]> {
  // Determine article style from articleType (map CMS types to template styles)
  const style = mapArticleTypeToStyle(item.articleType)

  const specs = extractInfographicData(html, item.airportCode, style)

  if (specs.length === 0) {
    return []
  }

  const results: InfographicResult[] = []
  for (let i = 0; i < specs.length; i++) {
    const result = await renderSpec(specs[i], item.slug, i)
    results.push(result)
  }

  return results
}

function mapArticleTypeToStyle(articleType: string): string {
  // Map CMS article types to infographic style categories
  switch (articleType) {
    case 'hub':
      return 'hub'
    case 'sub-pillar':
      return 'sub-pillar'
    case 'spoke':
      return 'spoke'
    default:
      return 'standard'
  }
}

export { extractInfographicData } from './extract.js'
export type { InfographicSpec } from './extract.js'
