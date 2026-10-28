---
title: "Auditing 30 of My Posts with claude -p --json-schema"
description: "I had Haiku 5.5 audit 30 of my posts twice: once with --json-schema, once asking nicely for JSON. The shape held. The judgement moved, and that's the lesson."
author: Michael John Peña
draft: false
date: 2026-10-26
tags:
  - Claude
  - Claude Code
  - LLM Evaluation
  - Prompt Engineering
  - Automation
---

**TL;DR:** I asked Claude Haiku 5.5 to audit 30 of this year's posts, twice: once with `claude -p --json-schema`, once with the same schema pasted into the prompt. The schema flag gave 30 valid objects out of 30. The prompt-only arm gave 29, because once it returned the schema itself instead of an answer. That part went as expected. The surprise was the judgement: on the same posts, one arm said 11 of 30 descriptions matched their post and the other said 25 of the 29 it answered.

Most of my scripted uses of Claude end in a parser, and a parser is only as reliable as the text it gets. Claude Code's headless mode has a flag for that. Pass `--json-schema` with `--output-format json`, and the [result carries a `structured_output` field](https://code.claude.com/docs/en/headless) that conforms to your schema. I wanted to know two things: how much that buys over asking politely, and whether a guaranteed shape makes the content any more trustworthy.

## The audit

The job was an editorial check I'd otherwise do by hand. For each post, Claude had to read the file and return five fields:

```json
{
  "type": "object",
  "properties": {
    "description_matches_post": { "type": "boolean" },
    "description_problem": { "type": "string", "description": "Empty string when the description is accurate." },
    "hype_phrases": { "type": "array", "items": { "type": "string" },
                      "description": "Marketing or AI-cliche phrases copied verbatim from the post body." },
    "weakest_claim": {
      "type": "object",
      "properties": {
        "quote": { "type": "string", "description": "A sentence copied verbatim from the post." },
        "why": { "type": "string" }
      },
      "required": ["quote", "why"], "additionalProperties": false
    },
    "verdict": { "type": "string", "enum": ["keep", "revise", "rewrite"] }
  },
  "required": ["description_matches_post", "description_problem", "hype_phrases", "weakest_claim", "verdict"],
  "additionalProperties": false
}
```

The `hype_phrases` and `weakest_claim.quote` fields are there for a reason: they have to be copied verbatim, so I can check them mechanically. If a quote doesn't appear in the post, Claude made it up.

I sampled 30 posts at random from January to July 2026 and ran each one through both arms with Haiku 5.5, with only the `Read` tool pre-approved. (`--allowedTools` pre-approves tools. The [CLI reference](https://code.claude.com/docs/en/cli-reference) points to `--tools` if you want to restrict them.) The task was the same in both arms:

```bash
TASK="Read the blog post <file> and audit it. Check whether its frontmatter description accurately summarises the body, list any hype or AI-cliche phrases copied verbatim from the body, copy the single least supported claim verbatim, and give a verdict: keep, revise or rewrite."

# Arm 1: the schema flag
claude -p "$TASK" --model haiku --allowedTools Read --permission-mode default \
  --max-budget-usd 0.5 --output-format json --json-schema "$(cat schema.json)"

# Arm 2: the schema pasted into the prompt instead
claude -p "$TASK

Respond with only a JSON object that matches this JSON Schema, and nothing else:
$(cat schema.json)" --model haiku --allowedTools Read --permission-mode default \
  --max-budget-usd 0.5 --output-format json
```

I validated every answer with Python's `jsonschema` against the same schema, then searched each post for every quote.

## One audit, start to finish

Here's a single run of the schema arm on my hybrid search post, in a terminal, with the parsed `structured_output` printed by PowerShell.

![A terminal showing claude -p with --json-schema auditing the hybrid search blog post. The structured output says the description does not match: it claims the three-way test "shows which questions it rescues", but the body describes how to run the test and reports no results. It lists four phrases, quotes the weakest claim about metadata fields causing dilution, and gives a verdict of revise. The run took 6 turns and cost US$0.0149.](/posts/2026/2026-10-26-claude-json-schema-post-audit/01-schema-audit-run.webp)

That `description_problem` is fair. The post's description says the test "shows which questions it rescues". The post explains how to run the test, with a script, and never reports results from a run. The weakest-claim pick is fair too: "Metadata fields full of repeated values are the most common source of dilution" is stated as fact, with nothing behind it. The four "hype phrases" are a different story. They're opinionated sentences, not marketing language. I'll come back to that.

## The numbers

![A terminal table comparing the two arms over 30 posts. The --json-schema arm: 30 of 30 parsed, 30 of 30 valid, 116 of 116 quotes real, 11 of 30 descriptions judged accurate, 29 of 30 verdicts of revise, 130 turns, US$0.199, 616 seconds of summed run time. The prompt-only arm: 30 of 30 parsed, 29 of 30 valid, 141 of 141 quotes real, 25 of 30 descriptions judged accurate, 28 of 30 revise, 68 turns, US$0.144, 399 seconds of summed run time.](/posts/2026/2026-10-26-claude-json-schema-post-audit/02-arms-compared.webp)

| | `--json-schema` | Schema in the prompt |
|---|---|---|
| Parsed as JSON | 30 of 30 | 30 of 30 |
| Valid against the schema | 30 of 30 | 29 of 30 |
| Quotes found in the post | 116 of 116 (one after a manual check) | 141 of 141 |
| Descriptions judged accurate | 11 of 30 | 25 of 29 answered |
| Verdict "revise" | 29 of 30 | 28 of 30 |
| Turns, total | 130 | 68 |
| Cost, total | US$0.199 | US$0.144 |

**Shape: the flag earns its keep, narrowly.** Haiku 5.5 is good at following a pasted schema. Every prompt-only answer parsed, with no Markdown fences to strip. The one failure was a strange one: for a post about using KQL to separate noise from real changes, it returned the schema document itself, `{"type": "object", "properties": ...}`, which parses fine and is useless. One in thirty is enough to break a pipeline that doesn't validate.

**Cost: the flag isn't free.** The schema arm took nearly twice as many turns and cost 38% more. No schema-arm audit took fewer than three turns, while 22 of the 30 prompt-only audits took two. The CLI reference describes the flag as returning validated JSON "after the agent completes its workflow", and the extra steps show up on the bill. At [Haiku prices](/blog/2026-10-22-haiku-5-5-vs-opus-5-5-claude-code/) that's a rounding error. On Opus across thousands of files, it isn't.

**Quotes: no fabrication in either arm.** Every quoted phrase and claim was in the post. My script found 256 of 257 verbatim, and the last one needed a second look: Haiku had swapped a pair of double quotes for single quotes inside a JSON string, and otherwise copied it exactly. Asking for verbatim evidence and then checking it is the cheapest anti-hallucination control I know, and this run is a good reason to keep doing it.

## The judgement moved

Same model, same posts, same task, same schema, and the two arms disagreed on whether the description matched the post for 14 of the 29 posts where both gave an answer. The schema arm called 19 descriptions inaccurate. The prompt-only arm called 4.

Reading the disagreements, neither arm was making things up. They were drawing the line in different places. On a post about putting MCP tool policy in API Management, the schema arm answered `false` because the description says to move the rules to the gateway "instead", while the post keeps approvals in the agent. The prompt-only arm noticed exactly the same thing, flagged it as minor because "instead" overstates the split, then answered `true`. On a post about two tickets per data incident, the schema arm flagged that the description says "every" incident, while the body has a section titled "When this is overkill". I checked, and it does.

A boolean with no rubric is a coin with a thumb on it. "Does the description match?" has no single right answer when a description simplifies, so the model's threshold decided the result, and the framing of the request moved the threshold. The `--json-schema` flag guaranteed that I got a boolean. It said nothing about what the boolean meant.

The other two judgement fields had the opposite problem. A verdict of "revise" on 29 of 30 posts tells me nothing. And `hype_phrases` came back mostly as strongly worded opinions, because "hype" was never defined. My own writing guide bans specific words such as "game-changer" and "delve". I should have given Claude that list instead of the word "hype".

## What I'd do differently, and what I'd keep

1. **Use `--json-schema` in any pipeline that parses the output,** and still check that `structured_output` exists. The [structured outputs docs](https://code.claude.com/docs/en/agent-sdk/structured-outputs) cover the schema side, and the headless docs say a run that ends without valid output has no such field, and your script should handle that rather than crash.
2. **Validate anyway.** The prompt-only arm proved that "it parsed" and "it's valid" are different checks.
3. **Replace booleans with a rubric.** Instead of `description_matches_post`, ask for an enum such as `accurate`, `simplifies`, `overclaims` or `wrong`, each defined in the field's description. Then the threshold is mine, not the model's.
4. **Ask for evidence you can check.** Verbatim quotes turned a judgement call into something a script could verify, and they're why I trust the weakest-claim results. It's the same principle as [planting bugs before trusting a code review](/blog/2026-10-25-code-review-levels-planted-bugs/).
5. **Run two framings on a sample before you trust one.** The 14-of-29 disagreement was invisible from either arm alone. It took both side by side to see that the field was measuring the model's threshold, not my posts.

The audit did find real problems in my own posts, starting with a description that promises results the post doesn't deliver. It found them because I could check the evidence, not because the JSON was valid.
