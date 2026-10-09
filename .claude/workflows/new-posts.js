export const meta = {
  name: 'new-posts',
  description: 'Plan and write new blog posts covering a date range, reviewed to 95+ against WRITING_GUIDE.md',
  whenToUse: 'Bring the blog up to date with new posts. args: { root, from, to, count }',
  phases: [
    { title: 'Plan', detail: 'find what shipped in the range and pick topics' },
    { title: 'Write', detail: 'research and write each new post' },
    { title: 'Review', detail: 'independent fact-check and rubric score' },
    { title: 'Revise', detail: 'fix reviewer findings until 95+' },
  ],
}

// args: { root: repo path, from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', count: number of posts }
const ROOT = args.root
const BLOG = `${ROOT}/astro-site/src/content/blog`
const PASS = 95
const MAX_REVISIONS = 4
const lint = `cd ${ROOT}/astro-site && node scripts/lint-content.mjs`

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    posts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD publish date, on or after the news it covers' },
          file: { type: 'string', description: 'YYYY-MM-DD-kebab-slug.md, slug under 60 chars' },
          title: { type: 'string' },
          angle: { type: 'string', description: 'The practitioner argument the post makes, not just the news' },
          sources: { type: 'array', items: { type: 'string' }, description: 'Primary source URLs that establish the facts and dates' },
        },
        required: ['date', 'file', 'title', 'angle', 'sources'],
      },
    },
  },
  required: ['posts'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'number' },
    breakdown: {
      type: 'object',
      properties: {
        accuracy: { type: 'number' }, substance: { type: 'number' }, code: { type: 'number' },
        voice: { type: 'number' }, structure: { type: 'number' }, sources: { type: 'number' },
      },
      required: ['accuracy', 'substance', 'code', 'voice', 'structure', 'sources'],
    },
    issues: { type: 'array', items: { type: 'string' } },
    draft: { type: 'boolean' },
  },
  required: ['score', 'breakdown', 'issues', 'draft'],
}

const research = `Use WebSearch and WebFetch (load them with ToolSearch "select:WebSearch,WebFetch"). Some hosts may be unreachable from this sandbox; fall back to search results or learn.microsoft.com.`

phase('Plan')
const plan = await agent(`Plan ${args.count} new posts for michaeljohnpena.com covering ${args.from} to ${args.to}.

Read ${ROOT}/WRITING_GUIDE.md for who the author is and what he writes about. List the newest existing posts (\`ls ${BLOG} | tail -60\`) and read a few of the strongest recent ones to see the topics already covered.
${research}

Find what actually shipped or changed in the range in his areas: Microsoft Fabric (monthly feature summaries, OneLake, Real-Time Intelligence, Data Factory, Power BI), Azure AI Foundry / Azure OpenAI and agents, Azure data services, Power Platform, and the wider data/AI engineering practice. Only real, verifiable announcements with dates.

Pick ${args.count} topics that a Data & AI Director and Microsoft MVP would have a useful opinion on. Avoid duplicating existing posts. Spread publish dates across the range (no more than one per day, none after ${args.to}), each dated on or after the announcement it discusses. Prefer depth: a post that explains a design decision or trade-off beats a news recap.`, { schema: PLAN_SCHEMA, phase: 'Plan', effort: 'high' })

const posts = (plan?.posts || []).slice(0, args.count)
log(`Planned ${posts.length} posts`)

const common = (p) => `File: ${BLOG}/${p.file}
Standard: read ${ROOT}/WRITING_GUIDE.md first and follow it exactly. The post must be accurate as of ${p.date}: nothing announced after that date.
${research}`

const results = await pipeline(
  posts,
  (p) => agent(`Write a new blog post.

${common(p)}
Working title: ${p.title}
Angle: ${p.angle}
Starting sources: ${p.sources.join(', ')}

Create the file with frontmatter: title, description (120-160 chars, double-quoted), author: Michael John Peña, draft: false, date: ${p.date}, tags (3-6, reusing existing tag spellings from other posts). Research every claim first. Link related existing posts on this blog where genuinely relevant. Never invent experiences. Then run \`${lint}\` and fix anything it reports for this file. Return a 2-sentence summary.`, { label: `write:${p.file.slice(0, 38)}`, phase: 'Write' }),
  async (summary, p) => {
    const reviewPrompt = `You are an independent, skeptical technical editor. Score this new blog post against the rubric in the writing guide. Do NOT edit the file.

${common(p)}

Verify every factual claim with research (names, release status, dates, APIs, limits, prices) and check a sample of links resolve. Any fabrication, invented feature, or claim dated after ${p.date} caps the score at 70. Do not deduct for links you could not fetch only because the sandbox blocks the host. Be strict: ${PASS}+ means a senior Microsoft MVP would publish it unchanged. List every issue with the exact fix.`
    let review = await agent(reviewPrompt, { label: `review:${p.file.slice(0, 36)}`, phase: 'Review', schema: REVIEW_SCHEMA, effort: 'high' })
    let rounds = 0
    while (review && review.score < PASS && !review.draft && rounds < MAX_REVISIONS) {
      rounds++
      await agent(`Revise a blog post to fix every issue an editor found. Target ${PASS}+.

${common(p)}

Score: ${review.score}/100 (${JSON.stringify(review.breakdown)})
Issues:
${review.issues.map((i) => `- ${i}`).join('\n')}

Verify fixes with research, edit in place, keep the honesty rules, run \`${lint}\` and fix anything for this file. Return a one-paragraph summary.`, { label: `revise${rounds}:${p.file.slice(0, 34)}`, phase: 'Revise' })
      review = await agent(reviewPrompt, { label: `review${rounds + 1}:${p.file.slice(0, 34)}`, phase: 'Review', schema: REVIEW_SCHEMA, effort: 'high' })
    }
    if (review) log(`${p.file}: ${review.score}/100 after ${rounds} revision(s)`)
    return { file: p.file, summary, score: review?.score ?? null, remaining: review?.issues ?? [], revisions: rounds }
  },
)

const done = results.filter(Boolean)
log(`${done.filter((r) => r.score >= PASS).length}/${posts.length} new posts at ${PASS}+`)
return { planned: posts.length, results: done }
