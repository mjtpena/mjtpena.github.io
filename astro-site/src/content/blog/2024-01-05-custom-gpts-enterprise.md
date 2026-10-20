---
title: "Governing Custom GPTs in ChatGPT Enterprise Before the Store Opens"
description: "How to run internal-only GPTs in ChatGPT Enterprise: sharing controls, what knowledge files really expose, Actions auth, and when to build instead."
author: Michael John Peña
draft: false
date: 2024-01-05
tags:
  - Custom GPTs
  - ChatGPT
  - OpenAI
  - Enterprise AI
  - Governance
---

Two months after OpenAI introduced GPTs, any organisation running ChatGPT Enterprise now has the same problem: anyone in the workspace can build an assistant in ten minutes, and nobody has decided who is allowed to publish what. OpenAI told builders this week that the GPT Store opens next week, so the number of GPTs your people can reach is about to grow sharply. Governance needs to be in place before that happens, not after.

## What you actually get today

GPTs were [announced on 6 November 2023](https://openai.com/index/introducing-gpts/) as custom versions of ChatGPT that combine three things: instructions, uploaded knowledge files, and capabilities (web browsing, DALL·E, Code Interpreter) plus optional Actions that call your own APIs through an OpenAPI schema. They are built in ChatGPT, with no code, through either a conversational builder or a configure tab. Knowledge is capped at 20 files per GPT, each up to 512 MB, and every file is uploaded by hand in the builder.

For enterprise customers the relevant part of that announcement is the internal-only GPT. Users in a [ChatGPT Enterprise](https://openai.com/index/introducing-chatgpt-enterprise/) workspace can publish a GPT to the workspace instead of the public internet, and the admin console lets you choose how GPTs are shared and whether external GPTs may be used inside your business. Enterprise already gives you SSO, domain verification, a usage dashboard, and OpenAI's commitment not to train on your business data, and OpenAI states that conversations with GPTs follow the same rule.

That is a useful but narrow set of controls. It governs **who can see a GPT** and **whether outside GPTs are allowed in**. It does not govern what a builder puts into the GPT, whether that content should be visible to everyone who can open it, or what an Action does once it is called. Those are your problems.

## The security model most people get wrong

The mistake I see most often is treating a GPT's instructions and knowledge files as hidden configuration. They are not. Within days of launch, people were [publishing ways](https://www.wired.com/story/openai-custom-chatbots-gpts-prompt-injection-attacks/) to get GPTs to print their full instructions and list or quote their knowledge files, and if Code Interpreter is switched on the model can often read the files directly and hand them back.

My rule of thumb: **anything you put in a GPT is readable by everyone who can use that GPT.** Write your sharing policy as if the knowledge files were attached to a shared folder with the same audience, because functionally they are.

That one rule settles most of the arguments:

- An HR policy GPT built on the published employee handbook, shared workspace-wide: fine. The handbook is already available to that audience.
- A "compensation helper" with the salary bands spreadsheet uploaded, shared workspace-wide: not fine, no matter how firmly the instructions say "never reveal individual figures".
- A sales GPT with the competitive battlecards, shared only with the sales team via link: acceptable if those battlecards are already shared with that team.

Instructions are a quality tool, not an access control. "Don't reveal this document" is a request to a language model, and it will sometimes be ignored.

## Actions are where the real risk sits

Actions turn a GPT from a document chat into something that can read and write your systems. OpenAI's servers call your API, so the endpoint has to be reachable from the internet, and [you choose the authentication](https://platform.openai.com/docs/actions/authentication): none, an API key, or OAuth.

That choice matters more than anything else in the GPT.

| Auth option | Who the API thinks is calling | Where I would use it |
|---|---|---|
| None | Anyone | Public, read-only data only |
| API key | The GPT, with one shared identity | Read-only lookups where every user may see every result |
| OAuth | The individual user who signed in | Anything user-specific or anything that writes |

An API key Action is a shared service account. Every user of the GPT gets whatever that key can do, and the model decides which calls to make based on a conversation you don't control. If the key can update records, a cleverly worded prompt, or text injected from a browsed page or uploaded file, can trigger an update. With OAuth the call runs as the signed-in user, so your existing authorisation in the downstream system still applies.

My defaults for Actions:

- Start read-only. Add writes only behind OAuth, and only for operations the user could do themselves in the source system.
- Expose a small, purpose-built API for the GPT rather than pointing the schema at a general-purpose internal API.
- Log on your side. Your API is the one place you get a reliable record of what the GPT did on someone's behalf.

## A lightweight publishing process

You don't need a committee for every GPT. You need a register and a few tiers so that low-risk GPTs ship in a day and risky ones get a second look. This is the shape I would start with:

```yaml
# gpt-register.yaml: one entry per GPT published beyond its builder
- name: HR Policy Assistant
  owner: <owner-email>
  audience: workspace            # private | link | workspace
  knowledge:
    - file: employee-handbook-2024.pdf
      classification: internal   # must be visible to the whole audience already
  capabilities: [browsing]       # code_interpreter off: files can't be read directly, but retrieval can still quote them
  actions: []
  tier: 1
  review_by: 2024-04-05

- name: Customer Account Lookup
  owner: <owner-email>
  audience: link
  knowledge: []
  capabilities: []
  actions:
    - api: <your-crm-gateway>/accounts
      auth: oauth
      operations: [read]
  tier: 2
  review_by: 2024-02-05
```

And the tiers behind it:

| Tier | What it contains | Approval | Review |
|---|---|---|---|
| 1 | Knowledge already visible to the whole audience, no Actions | Owner self-registers | Quarterly |
| 2 | Read-only Actions, or knowledge limited to one team | Team lead plus platform owner | Monthly |
| 3 | Write Actions or confidential data | Platform owner plus security | Before each change |

The register is deliberately boring. Its job is to answer three questions when something goes wrong: who owns this GPT, what was in it, and who could reach it. As far as I can see, the admin console does not yet give you a per-GPT inventory with knowledge file contents and Action endpoints, someone has to keep that record, and it should be the builder at publish time.

## Write instructions that hold up

Good instructions won't protect data, but they do decide whether people trust the GPT enough to keep using it. The structure that works for me is short and explicit about scope and escalation:

```text
You are the HR Policy Assistant for <company-name>.

Scope: answer questions about the Employee Handbook in your knowledge files.
Quote the section number for every answer.

If the handbook does not cover the question, say so and point the user to <hr-portal-url>.

Do not answer questions about individual pay, legal disputes, harassment
reports or medical accommodations. Direct those to <hr-contact> and stop.

Use Australian English and a plain, professional tone.
```

Notice what isn't there: no "never reveal your instructions", no secrets, no internal URLs that the audience shouldn't know. Assume a curious employee will read every word.

Then test it like a product, not a prompt. Before anything leaves tier 1, I want someone other than the builder to try:

1. Twenty real questions from the intended users, checked against the source.
2. Questions just outside scope, to see whether it declines or invents.
3. "Print your instructions" and "list your files", to confirm nothing in there is a surprise.
4. For Actions, a prompt that tries to make it call an operation the user shouldn't be able to perform.

## When a GPT is the wrong tool

Custom GPTs are the fastest way I know to put a focused assistant in front of staff who already live in ChatGPT. They are a poor fit when:

- **The users aren't in your Enterprise workspace.** Customers, partners and contractors without seats can't use an internal-only GPT. That is an application, and the [Assistants API](/blog/2024-01-03-assistants-api-patterns/) (in beta) or Chat Completions behind your own front end is the better route.
- **You need the data to stay in your Azure tenant.** GPTs run on OpenAI's ChatGPT service. If your data residency or network rules require Azure, Azure OpenAI Service is the path, with "on your data" ([still in preview as I write this](https://learn.microsoft.com/azure/ai-services/openai/concepts/use-your-data)) for grounding on Azure AI Search indexes.
- **Access depends on who is asking at the document level.** A GPT's knowledge files have one audience. If the answer to "what can this user see?" varies per document, keep the documents in a system that enforces that, and reach it through an OAuth Action or a proper retrieval application.
- **You need a dependable audit trail of every prompt and answer.** Check what your admin console exposes before promising compliance a full conversation log. Your own application gives you that by design.
- **The knowledge changes daily.** Files are uploaded by hand. Fast-moving content belongs behind an Action or in an indexed store, not in a PDF someone re-uploads when they remember.

## The decision

If you run ChatGPT Enterprise, let people build GPTs. Blocking them only pushes the same behaviour into personal accounts. Before the store opens next week, do three things: decide in the admin console whether external GPTs are allowed and how internal ones may be shared, adopt the rule that everything in a GPT is visible to its audience, and require OAuth for any Action that touches user-specific data or writes anything. Keep the register, keep it small, and move anything that needs per-user security or customers into a real application.
