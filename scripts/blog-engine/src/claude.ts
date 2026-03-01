import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { env, CLAUDE_MODEL, MAX_TOKENS, DOMAIN } from './config.js'
import { buildAnalyzePrompt } from './prompts/analyze.js'
import { buildWritePrompt } from './prompts/write.js'
import { buildEditPrompt } from './prompts/edit.js'
import type { QueueItem } from './queue.js'
import type { ScrapedArticle } from './scraper.js'
import type { AirportData } from './airport-data.js'

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

interface AnalysisResult {
  commonTopics: string[]
  gaps: string[]
  recommendedH2s: string[]
  faqQuestions: string[]
  estimatedWordCount: number
  suggestedTags: string[]
}

interface WriteResult {
  html: string
  excerpt: string
  metaTitle: string
  metaDescription: string
  earlyCta?: string
  closingCta?: string
  faqItems: { question: string; answer: string }[]
  suggestedCategory: string
}

interface EditResult {
  html: string
  changes: string[]
  qualityScore: number
}

const AnalysisResultSchema = z.object({
  commonTopics: z.array(z.string()),
  gaps: z.array(z.string()),
  recommendedH2s: z.array(z.string()),
  faqQuestions: z.array(z.string()),
  estimatedWordCount: z.number(),
  suggestedTags: z.array(z.string()),
})

function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max - 3).replace(/\s\S*$/, '...')
}

const WriteResultSchema = z.object({
  html: z.string(),
  excerpt: z.string(),
  metaTitle: z.string().transform(s => truncateAtWord(s, 60)),
  metaDescription: z.string().transform(s => truncateAtWord(s, 160)),
  earlyCta: z.string().optional(),
  closingCta: z.string().optional(),
  faqItems: z.array(z.object({ question: z.string(), answer: z.string() })),
  suggestedCategory: z.string(),
})

const EditResultSchema = z.object({
  html: z.string(),
  changes: z.array(z.string()),
  qualityScore: z.number(),
})

function extractJsonString(text: string): string {
  let jsonStr = text.trim()

  // Remove markdown code fences if present (greedy to handle large JSON)
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*)```\s*$/)
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim()
  }

  // Also try: find the first { and last } to extract JSON object
  if (!jsonStr.startsWith('{') && !jsonStr.startsWith('[')) {
    const start = jsonStr.indexOf('{')
    const end = jsonStr.lastIndexOf('}')
    if (start !== -1 && end !== -1 && end > start) {
      jsonStr = jsonStr.slice(start, end + 1)
    }
  }

  return jsonStr
}

function parseJsonResponse<T>(text: string, schema: z.ZodType<T>): T {
  const jsonStr = extractJsonString(text)
  const raw = JSON.parse(jsonStr)
  return schema.parse(raw)
}

const RETRY_DELAYS = [2000, 4000, 8000]

async function callClaude(prompt: string, system?: string): Promise<string> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const response = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        ...(system ? { system } : {}),
        messages: [{ role: 'user', content: prompt }],
      })

      const textBlock = response.content.find((b) => b.type === 'text')
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('No text response from Claude')
      }

      return textBlock.text
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err))
      const status = (err as { status?: number }).status
      const isRetryable = status === 429 || status === 500 || status === 503 || status === 529

      if (!isRetryable || attempt >= RETRY_DELAYS.length) throw lastError

      const delay = RETRY_DELAYS[attempt]
      console.warn(`  ⚠ Claude API error (${status}), retrying in ${delay / 1000}s... (attempt ${attempt + 1}/${RETRY_DELAYS.length})`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  throw lastError!
}

function validateCta(field: string, cta: string | undefined, airportCode: string): void {
  if (!cta) {
    console.warn(`  ⚠ ${field}: Missing from response — CTA was not provided`)
    return
  }

  const lower = cta.toLowerCase()
  const airportCodeLower = airportCode.toLowerCase()

  // Check for specificity — must contain airport code, a price reference, a terminal, or a parking type
  const hasAirportCode = lower.includes(airportCodeLower)
  const hasPriceRef = /\$\d+|under \$|starting at|save \d|save up to/i.test(cta)
  const hasTerminal = /terminal\s*[\da-f]/i.test(cta)
  const hasParkingType = /long-term|short-term|off-site|on-site|valet|economy|covered|uncovered|garage/i.test(cta)
  const hasSpecificDetail = hasAirportCode || hasPriceRef || hasTerminal || hasParkingType

  if (!hasSpecificDetail) {
    console.warn(`  ⚠ ${field}: Generic CTA detected — "${cta.slice(0, 80)}" (no airport code, price, terminal, or parking type reference)`)
  }
}

export async function analyzeCompetitors(
  keyword: string,
  competitors: ScrapedArticle[]
): Promise<AnalysisResult> {
  console.log('  Step 1/3: Analyzing competitors...')
  const prompt = buildAnalyzePrompt(keyword, competitors)
  const response = await callClaude(prompt, `You are an SEO content analyst for an airport parking comparison website (${DOMAIN}). Today's date is ${new Date().toISOString().split('T')[0]}. Respond with ONLY valid JSON.`)
  const result = parseJsonResponse(response, AnalysisResultSchema)
  console.log(`  ✓ Analysis complete — ${result.recommendedH2s.length} headings, ${result.faqQuestions.length} FAQs`)
  return result
}

export async function writeArticle(
  item: QueueItem,
  analysis: AnalysisResult,
  airportData?: AirportData
): Promise<WriteResult> {
  console.log('  Step 2/3: Writing article...')
  const prompt = buildWritePrompt(item, analysis, airportData)
  const response = await callClaude(prompt, `You are a professional travel and airport parking content writer for ${DOMAIN}. Today's date is ${new Date().toISOString().split('T')[0]}. Respond with ONLY valid JSON.`)
  const result = parseJsonResponse(response, WriteResultSchema)

  // Validate CTA specificity
  validateCta('earlyCta', result.earlyCta, item.airportCode)
  validateCta('closingCta', result.closingCta, item.airportCode)

  console.log(`  ✓ Article written — ${result.html.length} chars, ${result.faqItems.length} FAQs`)
  return result
}

export async function editArticle(
  html: string,
  keyword: string,
  articleType: string,
  articleStyle?: string,
  airportCode?: string
): Promise<EditResult> {
  console.log('  Step 3/3: Editing & QA...')
  const prompt = buildEditPrompt(html, keyword, articleType, articleStyle as 'standard' | 'narrative' | 'listicle' | 'data-heavy' | 'comparison' | undefined, airportCode)
  const response = await callClaude(prompt, `You are a senior editor reviewing an airport parking blog article for ${DOMAIN}. Today's date is ${new Date().toISOString().split('T')[0]}. Respond with ONLY valid JSON.`)
  const result = parseJsonResponse(response, EditResultSchema)
  console.log(`  ✓ Edit complete — ${result.changes.length} changes, quality: ${result.qualityScore}/100`)
  return result
}

export async function generateArticle(
  item: QueueItem,
  competitors: ScrapedArticle[],
  onStep?: (step: string, data: { elapsed: number; result: Record<string, unknown> }) => void,
  airportData?: AirportData
): Promise<{
  html: string
  excerpt: string
  metaTitle: string
  metaDescription: string
  faqItems: { question: string; answer: string }[]
  suggestedCategory: string
  suggestedTags: string[]
  qualityScore: number
}> {
  // Step 1: Analyze competitors
  const analyzeStart = Date.now()
  const analysis = await analyzeCompetitors(item.keyword, competitors)
  onStep?.('analyze', { elapsed: Date.now() - analyzeStart, result: analysis as unknown as Record<string, unknown> })

  // Step 2: Write article
  const writeStart = Date.now()
  const writeResult = await writeArticle(item, analysis, airportData)
  onStep?.('write', { elapsed: Date.now() - writeStart, result: writeResult as unknown as Record<string, unknown> })

  // Step 3: Edit and QA
  const editStart = Date.now()
  const editResult = await editArticle(writeResult.html, item.keyword, item.articleType, item.articleStyle, item.airportCode)
  onStep?.('edit', { elapsed: Date.now() - editStart, result: editResult as unknown as Record<string, unknown> })

  return {
    html: editResult.html,
    excerpt: writeResult.excerpt,
    metaTitle: writeResult.metaTitle,
    metaDescription: writeResult.metaDescription,
    faqItems: writeResult.faqItems,
    suggestedCategory: writeResult.suggestedCategory,
    suggestedTags: analysis.suggestedTags,
    qualityScore: editResult.qualityScore,
  }
}
