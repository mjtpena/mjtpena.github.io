export const meta = {
  name: 'rewrite-posts',
  description: 'Rewrite blog posts to WRITING_GUIDE.md, verify date-accurate facts, revise until they score 95+',
  whenToUse: 'Raise a batch of existing blog posts to the WRITING_GUIDE.md standard. args: { root, files, reviewOnly? }',
  phases: [
    { title: 'Rewrite', detail: 'research the post date and rewrite the file' },
    { title: 'Review', detail: 'independent fact-check and rubric score' },
    { title: 'Revise', detail: 'fix reviewer findings until 95+' },
  ],
}

// args.root: absolute path of the repository checkout
// args.files: post file names in astro-site/src/content/blog/
// args.reviewOnly: file names already rewritten; they skip straight to review/revise
const ROOT = args.root
const BLOG = `${ROOT}/astro-site/src/content/blog`
const PASS = 95
const MAX_REVISIONS = 4
const reviewOnly = new Set(args.reviewOnly || [])

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'number', description: 'Total out of 100' },
    breakdown: {
      type: 'object',
      properties: {
        accuracy: { type: 'number' }, substance: { type: 'number' }, code: { type: 'number' },
        voice: { type: 'number' }, structure: { type: 'number' }, sources: { type: 'number' },
      },
      required: ['accuracy', 'substance', 'code', 'voice', 'structure', 'sources'],
    },
    issues: { type: 'array', items: { type: 'string' }, description: 'Every concrete problem that cost points, with the exact fix' },
    draft: { type: 'boolean', description: 'true if the post is set to draft: true' },
  },
  required: ['score', 'breakdown', 'issues', 'draft'],
}

const common = (file) => `File: ${BLOG}/${file}
Standard: read ${ROOT}/WRITING_GUIDE.md first and follow it exactly. The post's frontmatter \`date\` is the point in time the post must be accurate for.
Use WebSearch and WebFetch (load them with ToolSearch "select:WebSearch,WebFetch") to verify facts against dated primary sources: release notes, Azure updates, Microsoft Learn "What's new", product blog announcements, SDK changelogs and GitHub release history.
Some hosts (e.g. azure.microsoft.com) may be unreachable from this sandbox; when a source can't be fetched, use search results or an equivalent learn.microsoft.com page instead, and prefer learn.microsoft.com links in the post.`

const lint = `cd ${ROOT}/astro-site && node scripts/lint-content.mjs`

const writePrompt = (file) => `Rewrite one blog post so it meets the writing guide and scores ${PASS}+ on its rubric.

${common(file)}

Steps:
1. Read the post. Note its date and topic. Identify what existed, its name, and its release status (preview/GA) on that date.
2. Check for other posts with the same or a very similar title (grep the titles in ${BLOG}). If one exists, give this post a distinct angle and title so the two don't duplicate each other, and link to the other where useful.
3. Research the topic as of that date. Confirm every product name, feature, API, SDK version, limit, and price you will mention.
4. Rewrite the file in place: keep the file name and the frontmatter fields the guide says to keep; improve title/description/tags as allowed. Keep any genuine personal facts from the original. Never invent experiences.
5. Run \`${lint}\` and fix anything it reports about this file.

Return a 2-3 sentence summary of what changed and any accuracy problems you corrected (e.g. anachronisms).`

const reviewPrompt = (file) => `You are an independent, skeptical technical editor. Score one blog post against the rubric in the writing guide. Do NOT edit the file.

${common(file)}

Check, with research, every factual claim: product names as of the date, release status, API/SDK usage and versions, limits, prices, and whether linked URLs resolve today (fetch a sample). Look for fabricated experiences (invented clients, incidents, metrics) and AI clichés. Apply the guide's cap: any fabrication, invented feature, or anachronism caps the score at 70.
Do not deduct for a link you could not fetch only because this sandbox blocks the host; note it, and deduct only if the URL is malformed or you find evidence it is dead.

Be strict: ${PASS}+ means a senior Microsoft MVP would publish it unchanged. List every issue that cost points with the exact fix.`

const revisePrompt = (file, review) => `Revise one blog post to fix every issue an editor found. Target: ${PASS}+ on the rubric.

${common(file)}

Editor's score: ${review.score}/100 (${JSON.stringify(review.breakdown)})
Issues to fix:
${review.issues.map((i) => `- ${i}`).join('\n')}

Verify each fix with research where it concerns facts. Fix everything listed, not just the biggest items. Edit the file in place, keep the honesty rules, then run \`${lint}\` and fix anything it reports for this file. Return a one-paragraph summary of the fixes.`

const short = (file) => file.replace(/\.md$/, '').slice(0, 38)

const results = await pipeline(
  args.files,
  (file) => reviewOnly.has(file)
    ? 'Already rewritten; went straight to review.'
    : agent(writePrompt(file), { label: `write:${short(file)}`, phase: 'Rewrite' }),
  async (summary, file) => {
    let review = await agent(reviewPrompt(file), { label: `review:${short(file)}`, phase: 'Review', schema: REVIEW_SCHEMA, effort: 'high' })
    let rounds = 0
    while (review && review.score < PASS && !review.draft && rounds < MAX_REVISIONS) {
      rounds++
      await agent(revisePrompt(file, review), { label: `revise${rounds}:${short(file)}`, phase: 'Revise' })
      review = await agent(reviewPrompt(file), { label: `review${rounds + 1}:${short(file)}`, phase: 'Review', schema: REVIEW_SCHEMA, effort: 'high' })
    }
    if (review) log(`${file}: ${review.score}/100 after ${rounds} revision(s)${review.draft ? ' (draft)' : ''}`)
    return { file, summary, score: review?.score ?? null, breakdown: review?.breakdown ?? null, remaining: review?.issues ?? [], draft: review?.draft ?? false, revisions: rounds }
  },
)

const done = results.filter(Boolean)
const passed = done.filter((r) => r.score >= PASS)
const missing = args.files.filter((f) => !done.some((r) => r.file === f))
if (missing.length) log(`No result for ${missing.length} file(s): ${missing.join(', ')}`)
log(`${passed.length}/${args.files.length} posts at ${PASS}+`)
return { passed: passed.length, total: args.files.length, below: done.filter((r) => r.score < PASS).map((r) => ({ file: r.file, score: r.score, remaining: r.remaining })), missing, results: done }
