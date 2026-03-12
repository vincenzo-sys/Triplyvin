/**
 * update-links — Separate tool from generation.
 *
 * After a batch of articles is published, run this to inject downward
 * internal links into parent articles:
 *   - Hub → links to its sub-pillars
 *   - Sub-pillars → links to their spokes
 *
 * Usage:
 *   npx tsx src/update-links.ts -a JFK
 *   npx tsx src/update-links.ts -a JFK --dry-run
 */

import { Command } from 'commander'
import Anthropic from '@anthropic-ai/sdk'
import { env, CLAUDE_MODEL, BLOG_BASE_URL } from './config.js'
import { lexicalToHtml } from './lexical-to-html.js'
import { htmlToLexical } from './html-to-lexical.js'
import {
  getAllPublishedSlugs,
  updatePost,
  getQueueItems,
} from './payload.js'
import type { QueueItem } from './queue.js'

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

interface PublishedArticle {
  id: string
  slug: string
  title: string
  articleType: string
  airportCode: string
  hubSlug?: string
  parentSlug?: string
  content: unknown
}

async function fetchPublishedPosts(airportCode: string): Promise<PublishedArticle[]> {
  const params = new URLSearchParams({
    'where[status][equals]': 'published',
    'where[airportCode][equals]': airportCode.toUpperCase(),
    limit: '100',
  })

  const url = `${env.PAYLOAD_CMS_URL}/api/posts?${params.toString()}`
  const res = await fetch(url, {
    headers: { Authorization: `users API-Key ${env.PAYLOAD_API_KEY}` },
  })
  const data = await res.json()
  return (data.docs || []).map((doc: Record<string, unknown>) => ({
    id: doc.id as string,
    slug: doc.slug as string,
    title: doc.title as string,
    articleType: (doc.articleType as string) || 'spoke',
    airportCode: (doc.airportCode as string) || '',
    hubSlug: doc.hubSlug as string | undefined,
    parentSlug: doc.parentSlug as string | undefined,
    content: doc.content,
  }))
}

function findChildArticles(
  parent: PublishedArticle,
  allArticles: PublishedArticle[],
  queueItems: QueueItem[]
): PublishedArticle[] {
  // For a hub: find sub-pillars whose hubSlug matches this hub's slug
  // For a sub-pillar: find spokes whose parentSlug matches this sub-pillar's slug
  return allArticles.filter(article => {
    if (parent.articleType === 'hub') {
      // Check published post's hubSlug, or fall back to queue item
      if (article.articleType === 'sub-pillar') {
        if (article.hubSlug === parent.slug) return true
        const qi = queueItems.find(q => q.slug === article.slug)
        return qi?.hubSlug === parent.slug
      }
    }
    if (parent.articleType === 'sub-pillar') {
      if (article.articleType === 'spoke') {
        if (article.parentSlug === parent.slug) return true
        const qi = queueItems.find(q => q.slug === article.slug)
        return qi?.parentSlug === parent.slug
      }
    }
    return false
  })
}

function findExistingLinks(html: string, children: PublishedArticle[]): {
  linked: PublishedArticle[]
  missing: PublishedArticle[]
} {
  const linked: PublishedArticle[] = []
  const missing: PublishedArticle[] = []

  for (const child of children) {
    // Check if the article HTML already contains a link to this child's slug
    if (html.includes(`/${child.slug}`) || html.includes(`/${child.slug}"`)) {
      linked.push(child)
    } else {
      missing.push(child)
    }
  }

  return { linked, missing }
}

async function injectLinks(
  html: string,
  parent: PublishedArticle,
  missingChildren: PublishedArticle[]
): Promise<string> {
  const childList = missingChildren
    .map(c => `- ${BLOG_BASE_URL}/${c.slug} — "${c.title}" (${c.articleType})`)
    .join('\n')

  const prompt = `You are editing an existing blog article to add internal links to child articles that have been published since this article was written.

**Current article:** "${parent.title}" (${parent.articleType})
**URL:** ${BLOG_BASE_URL}/${parent.slug}

**Child articles that need links added:**
${childList}

**Instructions:**
1. Find the most natural place in the existing content to add a link to each child article
2. Prefer adding links within existing paragraphs where the topic is already mentioned
3. If a section discusses the child article's topic, add a sentence like "For a detailed guide, see our [anchor text](url)." or weave the link naturally into existing text
4. If no natural placement exists, add a brief sentence at the end of the most relevant section
5. Use descriptive anchor text that includes the child article's topic (NOT "click here" or "read more")
6. Do NOT restructure, rewrite, or remove any existing content — only ADD links
7. Do NOT add links that are already present in the HTML
8. Keep changes minimal — the article should read almost identically, just with new internal links

**Current HTML:**
${html}

Return ONLY the updated HTML. No explanation, no markdown fences, no JSON wrapper.`

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 16384,
    system: 'You are a precise HTML editor. Return only the modified HTML with internal links added. Make minimal changes.',
    messages: [{ role: 'user', content: prompt }],
  })

  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude')
  }

  let result = textBlock.text.trim()
  // Strip markdown fences if Claude added them
  if (result.startsWith('```')) {
    result = result.replace(/^```(?:html)?\n?/, '').replace(/\n?```$/, '')
  }

  return result
}

const program = new Command()
  .name('update-links')
  .description('Add downward internal links to parent articles after children are published')
  .requiredOption('-a, --airport <code>', 'Airport code (e.g., JFK)')
  .option('--dry-run', 'Show what links would be added without making changes')
  .option('--hub-only', 'Only update the hub article')
  .action(async (options) => {
    try {
      const code = options.airport.toUpperCase()
      console.log(`\n🔗 Update Links — ${code}\n`)

      // Fetch all published posts for this airport
      const articles = await fetchPublishedPosts(code)
      if (articles.length === 0) {
        console.log('No published articles found for this airport.')
        return
      }

      console.log(`Found ${articles.length} published article(s)`)

      // Fetch queue items for parent/hub slug relationships
      const queueRes = await getQueueItems({
        'where[airportCode][equals]': code,
        limit: '200',
      })
      const queueItems = (queueRes.docs || []) as QueueItem[]

      // Find articles that need downward links
      const parents = articles.filter(a => {
        if (options.hubOnly) return a.articleType === 'hub'
        return a.articleType === 'hub' || a.articleType === 'sub-pillar'
      })

      if (parents.length === 0) {
        console.log('No hub or sub-pillar articles to update.')
        return
      }

      let updated = 0
      let skipped = 0

      for (const parent of parents) {
        console.log(`\n━━━ ${parent.title} (${parent.articleType}) ━━━`)

        // Find child articles
        const children = findChildArticles(parent, articles, queueItems)
        if (children.length === 0) {
          console.log('  No child articles found — skipping')
          skipped++
          continue
        }

        // Convert Lexical to HTML
        const html = parent.content ? lexicalToHtml(parent.content as Parameters<typeof lexicalToHtml>[0]) : ''
        if (!html) {
          console.log('  No content — skipping')
          skipped++
          continue
        }

        // Check which children are already linked
        const { linked, missing } = findExistingLinks(html, children)

        if (linked.length > 0) {
          console.log(`  Already linked (${linked.length}):`)
          for (const c of linked) {
            console.log(`    ✓ ${c.title}`)
          }
        }

        if (missing.length === 0) {
          console.log('  All child articles already linked — skipping')
          skipped++
          continue
        }

        console.log(`  Missing links (${missing.length}):`)
        for (const c of missing) {
          console.log(`    ✗ ${c.title} → /blog/${c.slug}`)
        }

        if (options.dryRun) {
          console.log('  [DRY RUN] Would inject links via Claude')
          continue
        }

        // Use Claude to inject links naturally
        console.log('  Injecting links...')
        const updatedHtml = await injectLinks(html, parent, missing)

        // Verify links were actually added
        const { missing: stillMissing } = findExistingLinks(updatedHtml, missing)
        const injected = missing.length - stillMissing.length

        if (injected === 0) {
          console.log('  ⚠ Claude did not add any links — skipping update')
          skipped++
          continue
        }

        // Convert back to Lexical and update the post
        const lexicalContent = htmlToLexical(updatedHtml)
        await updatePost(parent.id, { content: lexicalContent })

        console.log(`  ✓ Updated — ${injected}/${missing.length} links added`)
        if (stillMissing.length > 0) {
          console.log(`  ⚠ ${stillMissing.length} link(s) not injected:`)
          for (const c of stillMissing) {
            console.log(`    - ${c.title}`)
          }
        }
        updated++
      }

      console.log('\n━━━ Summary ━━━')
      console.log(`  Updated: ${updated}`)
      console.log(`  Skipped: ${skipped}`)
      console.log('')
    } catch (err) {
      console.error('Error:', err)
      process.exit(1)
    }
  })

program.parse()
