# Writing guide

The standard every post on michaeljohnpena.com is held to, and the rubric used to score it. Posts live in `astro-site/src/content/blog/`.

## Who is writing

Michael John Peña is a Data & AI Director and Microsoft MVP based in Sydney. He writes as a practitioner who designs and ships data and AI platforms on Microsoft (Azure, Fabric, Power Platform, Azure OpenAI), plus occasional personal posts on career, family, fitness, and productivity.

Voice: direct, opinionated, practical. He takes a position ("That framing is wrong for anyone responsible for access control"), explains *why*, and names trade-offs. He uses first person for judgement and recommendations. Australian English spelling (organisation, optimise, licence as a noun). No hype words ("game-changer", "revolutionary", "delve", "in today's fast-paced world", "unlock the power").

## Honesty rules (non-negotiable)

- **Never invent experiences.** No fabricated clients, projects, incidents, metrics, quotes, dates, or people. First-person is for opinion and advice: "I'd start with…", "The mistake I see most often is…", "My rule of thumb is…". Do not write "Last month a client…" unless the original post already said it.
- **Keep real personal facts.** On personal posts (family, MVP award, speaking, running, books), keep every fact as written. Improve clarity, grammar, and structure only.
- **Never invent capabilities.** Every product, feature, API, SKU, parameter, limit, price, and version must be real and verifiable.

## Accuracy as of the post's date

Each post must be technically correct **on the date in its frontmatter**. A reader in that month should find nothing that didn't exist yet.

- Check every product and feature name against when it shipped. Use dated sources: Microsoft Learn "What's new" pages, Azure updates, Tech Community and product blog announcements, GitHub releases and changelogs, SDK version history.
- Use the names current **at the time** (Azure Cognitive Services, not Azure AI services, before the July 2023 rename; Azure Active Directory, not Entra ID, before July 2023; Form Recognizer, not Document Intelligence, before Nov 2023; Synapse, not Fabric, before 23 May 2023).
- State the release status at that time: preview, public preview, or GA.
- Code must use the SDK/API versions available then (e.g. `openai` Python 0.x patterns before Nov 2023; Azure SDK track-2 libraries where they existed).
- **If the topic itself didn't exist yet** (e.g. a "Microsoft Fabric" post dated 2023-05-02), rewrite the post to cover the closest real equivalent that did exist at that date (e.g. Synapse, Power BI datamarts), and change the title, description, and tags to match. If there is no honest equivalent, set `draft: true` and say so in your summary.
- Links must work **today**. Prefer `learn.microsoft.com` URLs (docs.microsoft.com redirects, but use the current host). Don't link to things that would have been impossible at that date (a doc page about a later feature).

## Content standard

- **Length:** 900–1,800 words of prose for technical posts (code doesn't count). Personal posts can be shorter if complete.
- **Opening:** 2–4 sentences that state the problem and why it matters. No "In this post we will…" or restating the title.
- **Substance over code dumps:** explain the design decision, the alternatives, and when *not* to use the approach. Code is supporting evidence, under ~40% of the post.
- **Code:** complete and runnable as shown (or clearly marked as a fragment), correct language tag on every fence, realistic but obviously placeholder values (`<your-resource-name>`), no secrets, no truncation, no "..." in the middle of logic.
- **Structure:** `##` and `###` headings only (never `#`; the layout renders the title). Use tables for comparisons where they genuinely help.
- **Ending:** a short section with the takeaway or decision guidance. Not the same "Best Practices / Conclusion / Resources" skeleton every time, and never "Tomorrow, I will cover…" unless it links to that post.
- **Sources:** 2–5 links to official documentation or primary announcements, inline where the claim is made. Link related posts on this blog (`/blog/<file-name-without-.md>/`) when genuinely relevant.

## Frontmatter

Keep the file name, `date`, `author`, `draft`, `url`, and `images` fields unchanged (except `draft: true` per the accuracy rule). You may improve:

- `title`: specific and honest, under ~70 characters where possible.
- `description`: one sentence, 120–160 characters, plain text, double-quoted.
- `tags`: 3–6 tags, reusing existing spellings (check `/blog/tags/` or grep the folder), Title Case, no typos.

## Scoring rubric (100 points, pass = 95+)

| Criterion | Points | Full marks means |
|---|---|---|
| Technical accuracy as of the post date | 30 | Every claim, name, status, API, and code sample is correct for that date; no anachronisms |
| Substance and insight | 25 | Real problem, trade-offs, reasoning, and guidance on when not to use it |
| Code quality | 15 | Runnable, correct for its date, idiomatic, safe placeholders (full marks if no code is needed) |
| Voice and honesty | 15 | Sounds like a practitioner with opinions; no fabricated experiences; no AI clichés |
| Structure and readability | 10 | Strong opening, logical headings, varied ending, clean Markdown |
| Sources and links | 5 | Official, working, date-appropriate links, inline |

Any fabricated experience, invented feature, or anachronism caps the score at 70.

Check your work with `npm run lint:content` in `astro-site/`.
