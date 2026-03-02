import type { ScrapedArticle } from '../scraper.js'

export function buildAnalyzePrompt(
  keyword: string,
  competitors: ScrapedArticle[]
): string {
  const competitorSummaries = competitors
    .map(
      (c, i) =>
        `### Competitor ${i + 1}: ${c.title}\nURL: ${c.url}\nStats: ${c.wordCount} words, ${c.h2Count} H2s, ${c.listCount} lists, ${c.tableCount} tables, ${c.linkCount} links, ${c.faqCount} FAQ-like headings\nHeadings: ${c.headings.join(' | ')}\nContent excerpt: ${c.content.slice(0, 2000)}`
    )
    .join('\n\n')

  return `You are an SEO content analyst for an airport parking comparison website (triplypro.com).

Analyze these competitor articles for the keyword "${keyword}" and provide a structured analysis.

${competitorSummaries || 'No competitor articles available. Provide analysis based on your knowledge of the keyword.'}

Respond with ONLY valid JSON in this exact format:
{
  "commonTopics": ["topic1", "topic2", ...],
  "gaps": ["gap1", "gap2", ...],
  "recommendedH2s": ["heading1", "heading2", ...],
  "faqQuestions": ["question1?", "question2?", ...],
  "estimatedWordCount": 1500,
  "suggestedTags": ["tag1", "tag2", ...],
  "competitorBenchmarks": {
    "avgWordCount": 1800,
    "avgH2Count": 8,
    "avgListCount": 12,
    "avgTableCount": 1,
    "avgLinkCount": 15
  }
}

Requirements:
- commonTopics: Topics covered by most competitors
- gaps: Topics competitors miss that we should cover (e.g., shuttle times, real-time availability, seasonal pricing)
- recommendedH2s: 5-8 recommended H2 headings that cover the topic comprehensively. IMPORTANT: phrase headings as questions where natural (e.g., "How Much Does JFK Parking Cost?" instead of "JFK Parking Costs") — question-format headings perform better in AI search (Google AI Overviews, Perplexity, ChatGPT)
- faqQuestions: 6-8 frequently asked questions with high search intent. Focus on questions that AI search engines commonly pull answers for — "how much", "where is", "how to", "what is the best", "is it safe" patterns
- suggestedTags: 3-5 relevant tags for categorization
- estimatedWordCount: Recommended word count based on competitor length
- competitorBenchmarks: Average structural metrics across competitors (avgWordCount, avgH2Count, avgListCount, avgTableCount, avgLinkCount). Calculate from the competitor stats provided above. These will be used to set concrete targets for the writer.
- Focus on identifying entities (terminal names, airline names, road names, neighborhoods, shuttle services) that competitors mention — entity coverage helps NLP systems understand content depth`
}
