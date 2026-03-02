import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { env, CLAUDE_MODEL, MAX_TOKENS, DOMAIN, REVISION_THRESHOLD } from './config.js'
import { scoreArticle } from './seo-scorer.js'
import type { SeoScore } from './seo-scorer.js'
import { buildAnalyzePrompt } from './prompts/analyze.js'
import { buildWritePrompt } from './prompts/write.js'
import { buildEditPrompt } from './prompts/edit.js'
import type { QueueItem } from './queue.js'
import type { ScrapedArticle } from './scraper.js'
import type { AirportData } from './airport-data.js'
import type { PublishedPost } from './payload.js'

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

interface CompetitorBenchmarks {
  avgWordCount: number
  avgH2Count: number
  avgListCount: number
  avgTableCount: number
  avgLinkCount: number
}

interface AnalysisResult {
  commonTopics: string[]
  gaps: string[]
  recommendedH2s: string[]
  faqQuestions: string[]
  estimatedWordCount: number
  suggestedTags: string[]
  competitorBenchmarks?: CompetitorBenchmarks
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

const CompetitorBenchmarksSchema = z.object({
  avgWordCount: z.number(),
  avgH2Count: z.number(),
  avgListCount: z.number(),
  avgTableCount: z.number(),
  avgLinkCount: z.number(),
}).optional()

const AnalysisResultSchema = z.object({
  commonTopics: z.array(z.string()),
  gaps: z.array(z.string()),
  recommendedH2s: z.array(z.string()),
  faqQuestions: z.array(z.string()),
  estimatedWordCount: z.number(),
  suggestedTags: z.array(z.string()),
  competitorBenchmarks: CompetitorBenchmarksSchema,
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

type SystemMessage = string | Anthropic.MessageCreateParams['system']

const RETRY_DELAYS = [2000, 4000, 8000]

async function callClaude(prompt: string, system?: SystemMessage): Promise<string> {
  let lastError: Error | null = null

  // Convert string system to content blocks format for caching support
  const systemParam = typeof system === 'string'
    ? [{ type: 'text' as const, text: system }]
    : system

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const response = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        ...(systemParam ? { system: systemParam } : {}),
        messages: [{ role: 'user', content: prompt }],
      })

      // Log cache performance if available
      const usage = response.usage as unknown as Record<string, unknown>
      if (usage.cache_read_input_tokens || usage.cache_creation_input_tokens) {
        console.log(`    Cache: ${usage.cache_read_input_tokens || 0} read, ${usage.cache_creation_input_tokens || 0} created`)
      }

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

function validateCta(field: string, cta: string | undefined, airportCode: string): string[] {
  const issues: string[] = []

  if (!cta) {
    const msg = `${field}: Missing CTA — not provided in response`
    console.warn(`  ⚠ ${msg}`)
    issues.push(msg)
    return issues
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
    const msg = `${field}: Generic CTA detected — "${cta.slice(0, 80)}" (needs airport code, price, terminal, or parking type)`
    console.warn(`  ⚠ ${msg}`)
    issues.push(msg)
  }

  return issues
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
  airportData?: AirportData,
  publishedPosts?: PublishedPost[]
): Promise<WriteResult> {
  console.log('  Step 2/3: Writing article...')
  const prompt = buildWritePrompt(item, analysis, airportData, publishedPosts)
  const systemBlocks: Anthropic.MessageCreateParams['system'] = [
    {
      type: 'text' as const,
      text: `You are a professional travel and airport parking content writer for ${DOMAIN}. Today's date is ${new Date().toISOString().split('T')[0]}. Respond with ONLY valid JSON.`,
      cache_control: { type: 'ephemeral' as const },
    },
  ]
  const response = await callClaude(prompt, systemBlocks)
  const result = parseJsonResponse(response, WriteResultSchema)

  console.log(`  ✓ Article written — ${result.html.length} chars, ${result.faqItems.length} FAQs`)
  return result
}

export async function editArticle(
  html: string,
  keyword: string,
  articleType: string,
  articleStyle?: string,
  airportCode?: string,
  publishedPosts?: PublishedPost[],
  failedChecks?: string[]
): Promise<EditResult> {
  console.log(failedChecks ? '  Step 3b/3: Re-editing with failed checks...' : '  Step 3/3: Editing & QA...')
  const prompt = buildEditPrompt(html, keyword, articleType, articleStyle as 'standard' | 'narrative' | 'listicle' | 'data-heavy' | 'comparison' | undefined, airportCode, publishedPosts, failedChecks)
  const systemBlocks: Anthropic.MessageCreateParams['system'] = [
    {
      type: 'text' as const,
      text: `You are a senior editor reviewing an airport parking blog article for ${DOMAIN}. Today's date is ${new Date().toISOString().split('T')[0]}. Respond with ONLY valid JSON.`,
      cache_control: { type: 'ephemeral' as const },
    },
  ]
  const response = await callClaude(prompt, systemBlocks)
  const result = parseJsonResponse(response, EditResultSchema)
  console.log(`  ✓ Edit complete — ${result.changes.length} changes, quality: ${result.qualityScore}/100`)
  return result
}

export async function generateArticle(
  item: QueueItem,
  competitors: ScrapedArticle[],
  onStep?: (step: string, data: { elapsed: number; result: Record<string, unknown> }) => void,
  airportData?: AirportData,
  publishedPosts?: PublishedPost[]
): Promise<{
  html: string
  excerpt: string
  metaTitle: string
  metaDescription: string
  faqItems: { question: string; answer: string }[]
  suggestedCategory: string
  suggestedTags: string[]
  qualityScore: number
  revision?: {
    triggered: boolean
    scoreBefore: number
    scoreAfter: number
    failedChecks: string[]
  }
}> {
  // Step 1: Analyze competitors
  const analyzeStart = Date.now()
  const analysis = await analyzeCompetitors(item.keyword, competitors)
  onStep?.('analyze', { elapsed: Date.now() - analyzeStart, result: analysis as unknown as Record<string, unknown> })

  // Step 2: Write article
  const writeStart = Date.now()
  const writeResult = await writeArticle(item, analysis, airportData, publishedPosts)
  onStep?.('write', { elapsed: Date.now() - writeStart, result: writeResult as unknown as Record<string, unknown> })

  // Step 3: Edit and QA
  const editStart = Date.now()
  let editResult = await editArticle(writeResult.html, item.keyword, item.articleType, item.articleStyle, item.airportCode, publishedPosts)
  onStep?.('edit', { elapsed: Date.now() - editStart, result: editResult as unknown as Record<string, unknown> })

  // Step 3b: Auto-revision loop — score and re-edit if below threshold
  let revisionMeta: { triggered: boolean; scoreBefore: number; scoreAfter: number; failedChecks: string[] } | undefined

  // Validate CTAs and collect issues
  const ctaIssues = [
    ...validateCta('earlyCta', writeResult.earlyCta, item.airportCode),
    ...validateCta('closingCta', writeResult.closingCta, item.airportCode),
  ]

  // Score the edited article
  const targetWords = item.targetWords || (item.articleType === 'hub' ? 2500 : item.articleType === 'sub-pillar' ? 1500 : 1000)
  const firstScore = scoreArticle({
    html: editResult.html,
    keyword: item.keyword,
    slug: item.slug,
    metaTitle: writeResult.metaTitle,
    metaDescription: writeResult.metaDescription,
    excerpt: writeResult.excerpt,
    faqItems: writeResult.faqItems,
    articleType: item.articleType as 'hub' | 'sub-pillar' | 'spoke',
    targetWords,
    hasImage: false,
    imageAlt: null,
    airportCode: item.airportCode,
    parentSlug: item.parentSlug,
    hubSlug: item.hubSlug,
  })

  console.log(`  ✓ Initial SEO score: ${firstScore.total}/${firstScore.maxTotal} (${firstScore.grade})`)

  // Collect failed checks for revision
  const failedChecks: string[] = [
    ...ctaIssues,
    ...firstScore.categories.flatMap(cat =>
      cat.checks.filter(c => !c.passed).map(c => `[${cat.name}] ${c.name}: ${c.detail}`)
    ),
  ]

  if (firstScore.total < REVISION_THRESHOLD && failedChecks.length > 0) {
    console.log(`  ⚠ Score ${firstScore.total} < ${REVISION_THRESHOLD} threshold — triggering re-edit with ${failedChecks.length} failed checks`)
    const revisionStart = Date.now()
    editResult = await editArticle(editResult.html, item.keyword, item.articleType, item.articleStyle, item.airportCode, publishedPosts, failedChecks)
    onStep?.('revision', { elapsed: Date.now() - revisionStart, result: editResult as unknown as Record<string, unknown> })

    // Re-score
    const revisedScore = scoreArticle({
      html: editResult.html,
      keyword: item.keyword,
      slug: item.slug,
      metaTitle: writeResult.metaTitle,
      metaDescription: writeResult.metaDescription,
      excerpt: writeResult.excerpt,
      faqItems: writeResult.faqItems,
      articleType: item.articleType as 'hub' | 'sub-pillar' | 'spoke',
      targetWords,
      hasImage: false,
      imageAlt: null,
      airportCode: item.airportCode,
      parentSlug: item.parentSlug,
      hubSlug: item.hubSlug,
    })

    console.log(`  ✓ Revised SEO score: ${revisedScore.total}/${revisedScore.maxTotal} (${revisedScore.grade}) — ${revisedScore.total >= firstScore.total ? '+' : ''}${revisedScore.total - firstScore.total} points`)

    revisionMeta = {
      triggered: true,
      scoreBefore: firstScore.total,
      scoreAfter: revisedScore.total,
      failedChecks,
    }
  }

  return {
    html: editResult.html,
    excerpt: writeResult.excerpt,
    metaTitle: writeResult.metaTitle,
    metaDescription: writeResult.metaDescription,
    faqItems: writeResult.faqItems,
    suggestedCategory: writeResult.suggestedCategory,
    suggestedTags: analysis.suggestedTags,
    qualityScore: editResult.qualityScore,
    revision: revisionMeta,
  }
}
