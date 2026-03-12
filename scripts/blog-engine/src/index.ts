import { Command } from 'commander'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getNextQueuedItems, validatePrerequisites, markGenerating, markDraft, markError, markPublished, getBatchItems } from './queue.js'
import type { QueueItem } from './queue.js'
import { scrapeCompetitors } from './scraper.js'
import type { ScrapedArticle } from './scraper.js'
import { generateArticle } from './claude.js'
import { htmlToLexical } from './html-to-lexical.js'
import { generateInfographics } from './infographics.js'
import { getAirportPhoto } from './unsplash.js'
import {
  createPost,
  updatePost,
  uploadMedia,
  findOrCreateCategory,
  findOrCreateTag,
  getApiUser,
  getQueueItems,
  getAllPublishedSlugs,
} from './payload.js'
import { env } from './config.js'
import { loadAirportData } from './airport-data.js'
import { scoreArticle, printSeoScore } from './seo-scorer.js'
import type { SeoScore } from './seo-scorer.js'
import { lexicalToHtml } from './lexical-to-html.js'
import { bootstrapAirport, verifyUrls, saveBootstrapData, printBootstrapSummary } from './bootstrap-airport.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const articlesDir = path.resolve(__dirname, '..', 'articles')

// ── Article Data — persistent per-slug file that accumulates across runs ──

interface CompetitorSnapshot {
  url: string
  title: string
  wordCount: number
  h2Count: number
  listCount: number
  tableCount: number
  linkCount: number
  faqCount: number
  headings: { level: number; text: string }[]
  schemaTypes: string[]
  outboundLinks: { href: string; anchor: string }[]
  ctaPatterns: string[]
}

interface GenerationRun {
  timestamp: string
  queueItemId: string
  article: {
    htmlLength: number
    estimatedWordCount: number
    faqCount: number
    excerpt: string
    metaTitle: string
    metaDescription: string
    suggestedCategory: string
  }
  editing: {
    changesCount: number
    qualityScore: number
    changes: string[]
  }
  infographics: { count: number }
  image: {
    found: boolean
    filename: string | null
    alt: string | null
    mediaId: string | null
  }
  post: {
    postId: string | null
    status: string
    categoryCreated: string
    tagsCreated: string[]
  }
  timing: {
    totalSeconds: number
    scrapeSeconds: number
    analyzeSeconds: number
    writeSeconds: number
    editSeconds: number
    uploadSeconds: number
  }
  seoScore: SeoScore | null
  failedChecks: string[]
  error: string | null
}

interface ArticleData {
  // Identity — never changes
  slug: string
  keyword: string
  airportCode: string
  articleType: string
  priority: string

  // Latest title (updated each run)
  title: string

  // Competitor research — replaced each run with fresh data
  competitors: {
    scrapedAt: string
    searchedKeyword: string
    articles: CompetitorSnapshot[]
  }

  // AI analysis — replaced each run with fresh analysis
  analysis: {
    analyzedAt: string
    commonTopics: string[]
    contentGaps: string[]
    topicGaps: string[]
    depthGaps: string[]
    dataGaps: string[]
    entityGaps: string[]
    entityFrequency: { entity: string; mentions: number }[]
    structuralPatterns: string[]
    contentFormats: string[]
    recommendedH2s: string[]
    faqQuestions: string[]
    suggestedTags: string[]
    competitorBenchmarks: {
      avgWordCount: number
      avgH2Count: number
      avgListCount: number
      avgTableCount: number
      avgLinkCount: number
    } | null
  }

  // Generation history — each run appended
  runs: GenerationRun[]

  // Latest score + checks (convenience — also in runs)
  latestScore: number | null
  latestGrade: string | null
  latestFailedChecks: string[]
}

function loadArticleData(slug: string): ArticleData | null {
  const filepath = path.join(articlesDir, `${slug}.json`)
  if (fs.existsSync(filepath)) {
    return JSON.parse(fs.readFileSync(filepath, 'utf-8'))
  }
  return null
}

function saveArticleData(data: ArticleData): string {
  if (!fs.existsSync(articlesDir)) {
    fs.mkdirSync(articlesDir, { recursive: true })
  }
  const filepath = path.join(articlesDir, `${data.slug}.json`)
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2))
  return filepath
}

function printArticleReport(data: ArticleData, run: GenerationRun) {
  console.log('\n  ┌──────────────────────────────────────────────────┐')
  console.log('  │              GENERATION REPORT                   │')
  console.log('  └──────────────────────────────────────────────────┘')

  console.log(`\n  Article: ${data.title}`)
  console.log(`  Slug: ${data.slug}`)
  console.log(`  Type: ${data.articleType} | Airport: ${data.airportCode} | Priority: ${data.priority}`)
  console.log(`  Run #${data.runs.length} | ${run.timestamp}`)

  console.log(`\n  COMPETITORS (${data.competitors.articles.length} scraped):`)
  for (const a of data.competitors.articles) {
    console.log(`    ✓ ${a.title || a.url} — ${a.wordCount} words, ${a.h2Count} H2s, ${a.tableCount} tables`)
  }

  console.log(`\n  ANALYSIS:`)
  console.log(`    Common topics: ${data.analysis.commonTopics.join(', ')}`)
  console.log(`    Content gaps: ${data.analysis.contentGaps.join(', ')}`)
  if (data.analysis.topicGaps.length > 0) console.log(`    Topic gaps (no competitor covers): ${data.analysis.topicGaps.join(', ')}`)
  if (data.analysis.depthGaps.length > 0) console.log(`    Depth gaps (shallow coverage): ${data.analysis.depthGaps.join(', ')}`)
  if (data.analysis.dataGaps.length > 0) console.log(`    Data gaps (missing data points): ${data.analysis.dataGaps.join(', ')}`)
  if (data.analysis.entityGaps.length > 0) console.log(`    Entity gaps (missing entities): ${data.analysis.entityGaps.join(', ')}`)
  if (data.analysis.entityFrequency.length > 0) console.log(`    Top entities: ${data.analysis.entityFrequency.slice(0, 8).map(e => `${e.entity} (${e.mentions}x)`).join(', ')}`)
  if (data.analysis.structuralPatterns.length > 0) console.log(`    Structural patterns: ${data.analysis.structuralPatterns.join('; ')}`)
  console.log(`    Recommended H2s: ${data.analysis.recommendedH2s.length}`)
  console.log(`    FAQ questions: ${data.analysis.faqQuestions.length}`)
  console.log(`    Tags: ${data.analysis.suggestedTags.join(', ')}`)
  if (data.analysis.competitorBenchmarks) {
    const b = data.analysis.competitorBenchmarks
    console.log(`    Competitor benchmarks: ~${b.avgWordCount} words, ~${b.avgH2Count} H2s, ~${b.avgListCount} lists, ~${b.avgTableCount} tables, ~${b.avgLinkCount} links`)
  }

  console.log(`\n  ARTICLE:`)
  console.log(`    HTML length: ${run.article.htmlLength.toLocaleString()} chars`)
  console.log(`    Est. word count: ~${run.article.estimatedWordCount.toLocaleString()}`)
  console.log(`    FAQs: ${run.article.faqCount}`)
  console.log(`    Meta title: ${run.article.metaTitle}`)
  console.log(`    Category: ${run.article.suggestedCategory}`)

  console.log(`\n  EDITING:`)
  console.log(`    Quality score: ${run.editing.qualityScore}/100`)
  console.log(`    Changes made: ${run.editing.changesCount}`)
  for (const c of run.editing.changes.slice(0, 5)) {
    console.log(`    - ${c}`)
  }
  if (run.editing.changes.length > 5) {
    console.log(`    ... and ${run.editing.changes.length - 5} more`)
  }

  if (run.failedChecks.length > 0) {
    console.log(`\n  FAILED CHECKS (${run.failedChecks.length}):`)
    for (const check of run.failedChecks) {
      console.log(`    ✗ ${check}`)
    }
  }

  console.log(`\n  INFOGRAPHICS:`)
  console.log(`    Generated: ${run.infographics.count}`)

  console.log(`\n  IMAGE:`)
  if (run.image.found) {
    console.log(`    File: ${run.image.filename}`)
    console.log(`    Alt: ${run.image.alt}`)
    console.log(`    Media ID: ${run.image.mediaId}`)
  } else {
    console.log(`    No image uploaded`)
  }

  console.log(`\n  POST:`)
  console.log(`    Post ID: ${run.post.postId}`)
  console.log(`    Status: ${run.post.status}`)
  console.log(`    Category: ${run.post.categoryCreated}`)
  console.log(`    Tags: ${run.post.tagsCreated.join(', ')}`)

  console.log(`\n  TIMING:`)
  console.log(`    Total: ${run.timing.totalSeconds}s`)
  console.log(`    Scraping: ${run.timing.scrapeSeconds}s | Analyze: ${run.timing.analyzeSeconds}s`)
  console.log(`    Write: ${run.timing.writeSeconds}s | Edit: ${run.timing.editSeconds}s`)
  console.log(`    Upload: ${run.timing.uploadSeconds}s`)

  if (data.runs.length > 1) {
    console.log(`\n  HISTORY (${data.runs.length} runs):`)
    for (const r of data.runs) {
      const score = r.seoScore ? `${r.seoScore.total}/${r.seoScore.maxTotal} (${r.seoScore.grade})` : 'N/A'
      const err = r.error ? ` — ERROR: ${r.error.slice(0, 60)}` : ''
      console.log(`    ${r.timestamp} — Score: ${score} | ~${r.article.estimatedWordCount} words${err}`)
    }
  }
}

const program = new Command()
  .name('triply-blog-engine')
  .description('Automated SEO blog content generator for Triply')
  .version('1.0.0')

// Generate command
program
  .command('generate')
  .description('Generate blog articles from the content queue')
  .option('-t, --type <type>', 'Article type filter: hub, sub-pillar, spoke')
  .option('-a, --airport <code>', 'Airport code filter (e.g., JFK)')
  .option('-n, --limit <number>', 'Max articles to generate', '1')
  .option('--dry-run', 'Preview what would be generated without creating posts')
  .action(async (options) => {
    try {
      console.log('\n🚀 Triply Blog Engine — Generate\n')

      const limit = parseInt(options.limit, 10)
      const items = await getNextQueuedItems(options.type, options.airport, limit)

      if (items.length === 0) {
        console.log('No queued items found matching your filters.')
        return
      }

      console.log(`Found ${items.length} queued item(s)\n`)

      // Fetch all published slugs for internal link intelligence
      console.log('Fetching published posts for internal linking...')
      const publishedPosts = await getAllPublishedSlugs()
      console.log(`  ✓ ${publishedPosts.length} published post(s) available for linking\n`)

      // Get the API user for the author field
      const apiUser = await getApiUser()
      if (!apiUser) {
        console.error('Error: No API user found. Create a user in the CMS first.')
        process.exit(1)
      }

      for (const item of items) {
        console.log(`\n━━━ Processing: "${item.keyword}" ━━━`)
        console.log(`  Type: ${item.articleType} | Airport: ${item.airportCode} | Priority: ${item.priority}`)

        // Validate prerequisites
        const prereqError = await validatePrerequisites(item)
        if (prereqError) {
          console.log(`  ⏭ Skipping — ${prereqError}`)
          continue
        }

        if (options.dryRun) {
          console.log('  [DRY RUN] Would generate this article. Skipping.')
          continue
        }

        // Load or create the article data file
        const articleData: ArticleData = loadArticleData(item.slug) || {
          slug: item.slug,
          keyword: item.keyword,
          airportCode: item.airportCode,
          articleType: item.articleType,
          priority: item.priority,
          title: item.keyword, // Updated with AI-generated title after writing
          competitors: { scrapedAt: '', searchedKeyword: item.keyword, articles: [] },
          analysis: { analyzedAt: '', commonTopics: [], contentGaps: [], topicGaps: [], depthGaps: [], dataGaps: [], entityGaps: [], entityFrequency: [], structuralPatterns: [], contentFormats: [], recommendedH2s: [], faqQuestions: [], suggestedTags: [], competitorBenchmarks: null },
          runs: [],
          latestScore: null,
          latestGrade: null,
          latestFailedChecks: [],
        }

        // Initialize this run
        const run: GenerationRun = {
          timestamp: new Date().toISOString(),
          queueItemId: item.id,
          article: { htmlLength: 0, estimatedWordCount: 0, faqCount: 0, excerpt: '', metaTitle: '', metaDescription: '', suggestedCategory: '' },
          editing: { changesCount: 0, qualityScore: 0, changes: [] },
          infographics: { count: 0 },
          image: { found: false, filename: null, alt: null, mediaId: null },
          post: { postId: null, status: 'draft', categoryCreated: '', tagsCreated: [] },
          timing: { totalSeconds: 0, scrapeSeconds: 0, analyzeSeconds: 0, writeSeconds: 0, editSeconds: 0, uploadSeconds: 0 },
          seoScore: null,
          failedChecks: [],
          error: null,
        }

        const totalStart = Date.now()

        try {
          // Mark as generating
          await markGenerating(item.id)

          // Scrape competitors — store full data
          const scrapeStart = Date.now()
          const manualUrls = item.competitorUrls?.map((c) => c.url) || []
          const competitors = await scrapeCompetitors(item.keyword, manualUrls)
          run.timing.scrapeSeconds = Math.round((Date.now() - scrapeStart) / 1000)

          // Store full competitor snapshots
          articleData.competitors = {
            scrapedAt: new Date().toISOString(),
            searchedKeyword: item.keyword,
            articles: competitors.map((c: ScrapedArticle) => ({
              url: c.url,
              title: c.title,
              wordCount: c.wordCount,
              h2Count: c.h2Count,
              listCount: c.listCount,
              tableCount: c.tableCount,
              linkCount: c.linkCount,
              faqCount: c.faqCount,
              headings: c.headings,
              schemaTypes: c.schemaTypes,
              outboundLinks: c.outboundLinks.slice(0, 20),
              ctaPatterns: c.ctaPatterns,
            })),
          }

          // Load verified airport data (if available)
          const airportData = loadAirportData(item.airportCode)
          if (airportData) {
            console.log(`  ✓ Loaded verified data for ${item.airportCode} (verified ${airportData.lastVerified})`)
          } else {
            console.log(`  ⚠ No verified data file for ${item.airportCode} — Claude will use general knowledge`)
          }

          // Filter published posts to same airport (keep context focused)
          const airportPosts = publishedPosts.filter(p =>
            p.airportCode === item.airportCode || !p.airportCode
          )

          // Generate with Claude (3-prompt pipeline)
          const result = await generateArticle(item, competitors, (step, data) => {
            const r = data.result as Record<string, unknown>
            if (step === 'analyze') {
              run.timing.analyzeSeconds = Math.round(data.elapsed / 1000)
              articleData.analysis = {
                analyzedAt: new Date().toISOString(),
                commonTopics: (r.commonTopics as string[]) || [],
                contentGaps: (r.gaps as string[]) || [],
                topicGaps: (r.topicGaps as string[]) || [],
                depthGaps: (r.depthGaps as string[]) || [],
                dataGaps: (r.dataGaps as string[]) || [],
                entityGaps: (r.entityGaps as string[]) || [],
                entityFrequency: (r.entityFrequency as { entity: string; mentions: number }[]) || [],
                structuralPatterns: (r.structuralPatterns as string[]) || [],
                contentFormats: (r.contentFormats as string[]) || [],
                recommendedH2s: (r.recommendedH2s as string[]) || [],
                faqQuestions: (r.faqQuestions as string[]) || [],
                suggestedTags: (r.suggestedTags as string[]) || [],
                competitorBenchmarks: (r.competitorBenchmarks as { avgWordCount: number; avgH2Count: number; avgListCount: number; avgTableCount: number; avgLinkCount: number }) || null,
              }
            } else if (step === 'write') {
              run.timing.writeSeconds = Math.round(data.elapsed / 1000)
            } else if (step === 'edit') {
              run.timing.editSeconds = Math.round(data.elapsed / 1000)
              run.editing = {
                changesCount: (r.changes as string[])?.length || 0,
                qualityScore: (r.qualityScore as number) || 0,
                changes: (r.changes as string[]) || [],
              }
            }
          }, airportData || undefined, airportPosts)

          // Capture failed checks
          if (result.failedChecks.length > 0) {
            run.failedChecks = result.failedChecks
          }

          // Title comes from the AI writer — it generates based on keyword + competitive analysis
          const resolvedTitle = result.title || item.keyword
          articleData.title = resolvedTitle

          // Article stats
          run.article = {
            htmlLength: result.html.length,
            estimatedWordCount: Math.round(result.html.replace(/<[^>]+>/g, ' ').split(/\s+/).length),
            faqCount: result.faqItems.length,
            excerpt: result.excerpt,
            metaTitle: result.metaTitle,
            metaDescription: result.metaDescription,
            suggestedCategory: result.suggestedCategory,
          }

          // Score the article for SEO
          console.log('  Scoring article for SEO...')
          const seoScore = scoreArticle({
            html: result.html,
            keyword: item.keyword,
            slug: item.slug,
            metaTitle: result.metaTitle,
            metaDescription: result.metaDescription,
            excerpt: result.excerpt,
            faqItems: result.faqItems,
            articleType: item.articleType as 'hub' | 'sub-pillar' | 'spoke',
            targetWords: item.targetWords || (item.articleType === 'hub' ? 3500 : item.articleType === 'sub-pillar' ? 2500 : 1000),
            airportCode: item.airportCode,
            parentSlug: item.parentSlug,
            hubSlug: item.hubSlug,
            recommendedH2s: articleData.analysis.recommendedH2s,
            commonTopics: articleData.analysis.commonTopics,
          })
          run.seoScore = seoScore
          console.log(`  ✓ SEO Score: ${seoScore.total}/${seoScore.maxTotal} (${seoScore.grade})`)

          // Generate infographics
          let contentHtml = result.html
          if (airportData) {
            try {
              console.log('  Generating infographics...')
              const infResult = await generateInfographics(contentHtml, airportData, item.airportCode)
              contentHtml = infResult.html
              run.infographics.count = infResult.count
              if (infResult.count > 0) {
                console.log(`  ✓ ${infResult.count} infographic(s) generated`)
              } else {
                console.log('  No infographics generated')
              }
            } catch (err) {
              console.log(`  ⚠ Infographic generation failed: ${err instanceof Error ? err.message : err} — continuing without`)
            }
          }

          // Convert HTML to Lexical
          console.log('  Converting to Lexical format...')
          const lexicalContent = htmlToLexical(contentHtml)

          // Upload featured image
          const uploadStart = Date.now()
          let featuredImageId: string | null = null
          console.log('  Fetching featured image...')
          const photo = await getAirportPhoto(item.airportCode)
          if (photo) {
            const media = await uploadMedia(photo.buffer, photo.filename, photo.alt)
            featuredImageId = media.doc?.id || media.id
            run.image = { found: true, filename: photo.filename, alt: photo.alt, mediaId: featuredImageId }
            console.log(`  ✓ Image uploaded: ${photo.filename}`)
          } else {
            console.log('  ⚠ No image found — post will be created without featured image')
          }
          run.timing.uploadSeconds = Math.round((Date.now() - uploadStart) / 1000)

          // Re-score with post-infographic HTML (contentHtml has infographic images)
          if (run.seoScore) {
            run.seoScore = scoreArticle({
              html: contentHtml,
              keyword: item.keyword,
              slug: item.slug,
              metaTitle: result.metaTitle,
              metaDescription: result.metaDescription,
              excerpt: result.excerpt,
              faqItems: result.faqItems,
              articleType: item.articleType as 'hub' | 'sub-pillar' | 'spoke',
              targetWords: item.targetWords || (item.articleType === 'hub' ? 3500 : item.articleType === 'sub-pillar' ? 2500 : 1000),
              airportCode: item.airportCode,
              parentSlug: item.parentSlug,
              hubSlug: item.hubSlug,
              recommendedH2s: articleData.analysis.recommendedH2s,
              commonTopics: articleData.analysis.commonTopics,
            })
          }

          // Find or create category and tags
          const category = await findOrCreateCategory(result.suggestedCategory)
          run.post.categoryCreated = result.suggestedCategory
          const tagIds: string[] = []
          for (const tagName of result.suggestedTags) {
            const tag = await findOrCreateTag(tagName)
            tagIds.push(tag.doc?.id || tag.id)
            run.post.tagsCreated.push(tagName)
          }

          // Create draft post in CMS
          console.log('  Creating draft post in CMS...')
          const postData: Record<string, unknown> = {
            title: resolvedTitle,
            slug: item.slug,
            excerpt: result.excerpt,
            content: lexicalContent,
            category: category.doc?.id || category.id,
            tags: tagIds,
            author: apiUser.id,
            status: 'draft',
            airportCode: item.airportCode,
            articleType: item.articleType,
            parentSlug: item.parentSlug || undefined,
            hubSlug: item.hubSlug || undefined,
            faqItems: result.faqItems,
            seo: {
              metaTitle: result.metaTitle,
              metaDescription: result.metaDescription,
            },
          }

          if (featuredImageId) {
            postData.featuredImage = featuredImageId
          }

          if (run.seoScore) {
            // CMS field is 0-100; send percentage, not raw points
            const pct = run.seoScore.maxTotal > 0
              ? Math.round((run.seoScore.total / run.seoScore.maxTotal) * 100)
              : 0
            postData.seoScore = pct
            postData.seoScoreDetails = run.seoScore
          }

          const post = await createPost(postData)
          const postId = post.doc?.id || post.id
          run.post.postId = postId

          await markDraft(item.id, postId)

          run.timing.totalSeconds = Math.round((Date.now() - totalStart) / 1000)

          // Update article data with latest score
          articleData.latestScore = run.seoScore?.total || null
          articleData.latestGrade = run.seoScore?.grade || null
          articleData.latestFailedChecks = run.failedChecks

          // Append this run to history
          articleData.runs.push(run)

          console.log(`  ✅ Draft created! SEO Score: ${run.seoScore?.total}/${run.seoScore?.maxTotal} (${run.seoScore?.grade})`)
          console.log(`  📝 Review at: CMS Admin → Posts → "${resolvedTitle}" (keyword: "${item.keyword}")`)

          // Print report and save article data
          printArticleReport(articleData, run)
          if (run.seoScore) printSeoScore(run.seoScore)
          const dataPath = saveArticleData(articleData)
          console.log(`\n  📄 Article data: ${dataPath}`)
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          console.error(`  ❌ Error: ${errorMsg}`)
          run.error = errorMsg
          run.timing.totalSeconds = Math.round((Date.now() - totalStart) / 1000)
          await markError(item.id, errorMsg)

          // Save even on error — preserves scrape/analysis data
          articleData.runs.push(run)
          const dataPath = saveArticleData(articleData)
          console.log(`  📄 Article data saved (with error): ${dataPath}`)
        }
      }

      console.log('\n✨ Generation complete!\n')
    } catch (err) {
      console.error('Fatal error:', err)
      process.exit(1)
    }
  })

// Report command
program
  .command('report')
  .description('Show content queue status report')
  .option('-a, --airport <code>', 'Airport code filter')
  .option('-b, --batch <batch>', 'Batch name filter')
  .action(async (options) => {
    try {
      console.log('\n📊 Triply Blog Engine — Queue Report\n')

      const filters: Record<string, string> = {}
      if (options.airport) {
        filters['where[airportCode][equals]'] = options.airport.toUpperCase()
      }
      if (options.batch) {
        filters['where[batch][equals]'] = options.batch
      }

      const result = await getQueueItems(filters)
      const items = result.docs as QueueItem[]

      if (items.length === 0) {
        console.log('Queue is empty.')
        return
      }

      // Group by status
      const byStatus: Record<string, QueueItem[]> = {}
      for (const item of items) {
        if (!byStatus[item.status]) byStatus[item.status] = []
        byStatus[item.status].push(item)
      }

      const statusOrder = ['queued', 'generating', 'draft', 'review', 'published', 'error']
      for (const status of statusOrder) {
        const group = byStatus[status]
        if (!group) continue

        console.log(`\n${status.toUpperCase()} (${group.length}):`)
        for (const item of group) {
          const batchTag = item.batch ? ` [${item.batch}]` : ''
          console.log(`  ${item.priority} | ${item.airportCode} | ${item.articleType.padEnd(11)} | ${item.keyword}${batchTag}`)
        }
      }

      console.log(`\nTotal: ${items.length} items`)

      // Show batch summary if filtering by batch
      if (options.batch) {
        const published = byStatus['published']?.length || 0
        const draft = byStatus['draft']?.length || 0
        const review = byStatus['review']?.length || 0
        const queued = byStatus['queued']?.length || 0
        const error = byStatus['error']?.length || 0
        console.log(`\nBatch "${options.batch}" summary:`)
        console.log(`  Queued: ${queued} | Draft: ${draft} | Review: ${review} | Published: ${published} | Error: ${error}`)
      }

      console.log('')
    } catch (err) {
      console.error('Error:', err)
      process.exit(1)
    }
  })

// Publish command
program
  .command('publish')
  .description('Publish articles by batch — updates post status and queue item status')
  .requiredOption('-b, --batch <batch>', 'Batch name to publish')
  .option('--dry-run', 'Preview what would be published without making changes')
  .action(async (options) => {
    try {
      console.log('\n📤 Triply Blog Engine — Batch Publish\n')
      console.log(`Batch: ${options.batch}${options.dryRun ? ' (DRY RUN)' : ''}\n`)

      // Fetch items in the batch with draft/review status
      const items = await getBatchItems(options.batch, ['draft', 'review'])

      if (items.length === 0) {
        console.log('No draft or review items found in this batch.')
        console.log('Items must have status "draft" or "review" to be published.')
        return
      }

      console.log(`Found ${items.length} article(s) to publish:\n`)

      let published = 0
      let failed = 0

      for (const item of items) {
        const postId = typeof item.generatedPost === 'string' ? item.generatedPost : null
        console.log(`  ${item.slug}`)
        console.log(`    Keyword: ${item.keyword}`)
        console.log(`    Status: ${item.status} → published`)
        console.log(`    Post ID: ${postId || 'none'}`)

        if (options.dryRun) {
          console.log('    [DRY RUN] Would publish this article.\n')
          published++
          continue
        }

        try {
          // Update the linked post status to published
          if (postId) {
            await updatePost(postId, { status: 'published' })
          } else {
            console.log('    ⚠ No linked post — skipping post update')
          }

          // Update queue item status
          await markPublished(item.id)
          console.log('    ✓ Published\n')
          published++
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.log(`    ✗ Failed: ${msg}\n`)
          failed++
        }
      }

      console.log('━━━ Summary ━━━')
      console.log(`  Published: ${published}`)
      if (failed > 0) console.log(`  Failed: ${failed}`)
      console.log(`  Slugs: ${items.map((i) => i.slug).join(', ')}`)

      if (!options.dryRun && published > 0) {
        console.log('\n  💡 Next steps:')
        console.log('  1. Submit updated sitemap via Google Search Console')
        console.log('  2. Monitor indexing over the next 24-48 hours')
        console.log('  3. Check Search Console for any crawl errors')
      }

      console.log('')
    } catch (err) {
      console.error('Error:', err)
      process.exit(1)
    }
  })

// Score command
program
  .command('score')
  .description('Run SEO scoring on existing posts in the CMS')
  .option('-s, --slug <slug>', 'Score a specific post by slug')
  .option('-a, --airport <code>', 'Score all posts for an airport')
  .option('--all', 'Score all posts')
  .option('--save', 'Update the seoScore field in the CMS')
  .action(async (options) => {
    try {
      console.log('\n📊 Triply Blog Engine — SEO Scorer\n')

      // Build query filters
      const params = new URLSearchParams({ limit: '100' })
      if (options.slug) {
        params.set('where[slug][equals]', options.slug)
      } else if (options.airport) {
        params.set('where[airportCode][equals]', options.airport.toUpperCase())
      } else if (!options.all) {
        console.log('Usage: score --slug <slug> | --airport <code> | --all')
        console.log('  Add --save to update the seoScore field in the CMS')
        return
      }

      // Fetch posts directly
      const postsUrl = `${env.PAYLOAD_CMS_URL}/api/posts?${params.toString()}`
      const postsRes = await fetch(postsUrl, {
        headers: { Authorization: `users API-Key ${env.PAYLOAD_API_KEY}` },
      })
      const postsData = await postsRes.json()
      const posts = postsData.docs || []

      if (posts.length === 0) {
        console.log('No posts found matching your filters.')
        return
      }

      console.log(`Found ${posts.length} post(s) to score\n`)

      // Fetch queue items for keyword lookup
      const queueRes = await getQueueItems({ limit: '200' })
      const queueItems = (queueRes.docs || []) as QueueItem[]
      const queueBySlug = new Map(queueItems.map((q) => [q.slug, q]))

      const results: { slug: string; title: string; score: number; grade: string }[] = []

      for (const post of posts) {
        console.log(`━━━ ${post.title} ━━━`)

        // Convert Lexical content back to HTML
        const html = post.content ? lexicalToHtml(post.content) : ''
        if (!html) {
          console.log('  ⚠ No content to score\n')
          continue
        }

        // Look up keyword from queue item
        const queueItem = queueBySlug.get(post.slug)
        const keyword = queueItem?.keyword || post.slug.replace(/-/g, ' ')

        // Determine target words based on article type
        const articleType = post.articleType || 'spoke'
        const targetWords = queueItem?.targetWords
          || (articleType === 'hub' ? 3500 : articleType === 'sub-pillar' ? 2500 : 1000)

        // Load article data for analysis context (if available)
        const articleData = loadArticleData(post.slug)

        const score = scoreArticle({
          html,
          keyword,
          slug: post.slug,
          metaTitle: post.seo?.metaTitle || post.title || '',
          metaDescription: post.seo?.metaDescription || post.excerpt || '',
          excerpt: post.excerpt || '',
          faqItems: post.faqItems || [],
          articleType: articleType as 'hub' | 'sub-pillar' | 'spoke',
          targetWords,
          airportCode: post.airportCode || undefined,
          parentSlug: post.parentSlug || undefined,
          hubSlug: post.hubSlug || undefined,
          recommendedH2s: articleData?.analysis.recommendedH2s,
          commonTopics: articleData?.analysis.commonTopics,
        })

        printSeoScore(score)
        results.push({ slug: post.slug, title: post.title, score: score.total, grade: score.grade })

        // Optionally save score to CMS
        if (options.save) {
          try {
            const scorePct = score.maxTotal > 0 ? Math.round((score.total / score.maxTotal) * 100) : 0
            await updatePost(post.id, { seoScore: scorePct, seoScoreDetails: score })
            console.log(`\n  ✓ Score saved to CMS: ${scorePct}/100`)
          } catch (err) {
            console.log(`\n  ⚠ Failed to save score: ${err instanceof Error ? err.message : err}`)
          }
        }

        console.log('')
      }

      // Summary table for multiple posts
      if (results.length > 1) {
        console.log('\n  ┌──────────────────────────────────────────────────┐')
        console.log('  │              SCORE SUMMARY                       │')
        console.log('  └──────────────────────────────────────────────────┘')
        for (const r of results) {
          console.log(`  ${r.grade.padEnd(3)} ${String(r.score).padStart(3)}/100  ${r.title.slice(0, 60)}`)
        }
        const avg = Math.round(results.reduce((s, r) => s + r.score, 0) / results.length)
        console.log(`\n  Average: ${avg}/100`)
      }

      console.log('')
    } catch (err) {
      console.error('Error:', err)
      process.exit(1)
    }
  })

// Bootstrap command — generate airport data JSON
program
  .command('bootstrap')
  .description('Bootstrap a new airport data file using Claude + URL verification')
  .requiredOption('-a, --airport <code>', 'Airport code (e.g., ORD)')
  .option('--verify', 'Verify all URLs in the generated data with HTTP HEAD checks')
  .action(async (options) => {
    try {
      const code = options.airport.toUpperCase()
      console.log(`\n🏗️  Triply Blog Engine — Airport Data Bootstrap\n`)
      console.log(`Airport: ${code}\n`)

      // Generate base data
      const data = await bootstrapAirport(code)

      // Print summary
      printBootstrapSummary(data)

      // Optionally verify URLs
      if (options.verify) {
        console.log(`\n  URL Verification:`)
        const verification = await verifyUrls(data)
        console.log(`\n  Results: ${verification.valid} valid, ${verification.broken} broken out of ${verification.total} URLs`)

        // Add verification results to the data file
        ;(data as Record<string, unknown>)._urlVerification = {
          date: new Date().toISOString().split('T')[0],
          total: verification.total,
          valid: verification.valid,
          broken: verification.broken,
          brokenUrls: verification.results
            .filter(r => !r.ok)
            .map(r => ({ path: r.path, url: r.url, status: r.status })),
        }
      }

      // Save the data
      const filepath = saveBootstrapData(data)
      console.log(`\n  📄 Airport data saved: ${filepath}`)

      console.log(`\n  💡 Next steps:`)
      console.log(`  1. Review the generated JSON and fix [UNVERIFIED] values`)
      console.log(`  2. Replace VERIFY_URL_NEEDED placeholders with real URLs`)
      if (!options.verify) {
        console.log(`  3. Run with --verify to check all URLs: npm run bootstrap -- -a ${code} --verify`)
      }
      console.log(`  4. Add parkingLots array with off-site lot data`)
      console.log(`  5. Import queue items from your content spreadsheet using: npm run import-queue`)

      console.log('')
    } catch (err) {
      console.error('Error:', err)
      process.exit(1)
    }
  })

program.parse()
