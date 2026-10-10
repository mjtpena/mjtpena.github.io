---
title: "Why I Still Blog in 2026: Owning the Place I Think Out Loud"
description: "Why I still keep a blog when everyone posts on LinkedIn and X: ownership, clearer thinking, and a searchable record of my work."
author: Michael John Peña
draft: false
date: 2026-01-10
tags:
  - Personal
  - Writing
  - Career
---

Someone asked me why I still maintain a blog. "Doesn't everyone just use LinkedIn or Twitter now?" It's a fair question, and the honest answer is that social platforms are where my writing gets noticed, but this blog is where it lives.

## The short answer

This is my space. I own it and I control it. I own the domain and the source, so no platform can hold the posts hostage, change the algorithm under me, or monetise my writing without my consent; if a host disappears, I redeploy elsewhere.

That was the reason I gave myself in August 2020, when I wrote [I'm going to start writing again!](/blog/2020-08-26-writing-again/) and said I wanted "a space on the internet that I can say is mine". More than five years on, the reason hasn't changed.

The last few years made the point for me. When Twitter became X in July 2023 ([Al Jazeera's news coverage](https://www.aljazeera.com/news/2023/7/23/elon-musk-says-he-will-change-twitters-blue-bird-logo-to-an-x) of the announcement), many people wondered what would happen to their accounts, their handles and years of threads. When LinkedIn changes a feature, people adapt, because the platform sets the rules. My blog stays up for as long as I keep the domain and a build running.

## Six reasons it's still worth it

### 1. Permanence, or the closest thing to it

I've been blogging here since 2020. That's more than two thousand posts: experiments, tutorials and reflections, and they're all still here.

You know what isn't? My old MySpace posts. My early tweets, before I deleted them. That forum post from 2008 on a site that no longer exists.

Digital permanence is an illusion. Owning the platform gets you closer to it than renting space on someone else's.

### 2. Writing clarifies thinking

I don't fully understand something until I try to explain it. Writing forces me to organise my thoughts, find the gaps, and say the thing plainly. In my head I can skip from problem to answer; on the page I have to write the step in between, and that's usually where the gap shows up.

Half my posts teach me more than they teach readers.

The habit also carries over to emails, proposals and architecture documents, which is where most of a director's writing actually goes. Explaining a design to strangers on a blog is good practice for explaining it to a steering committee.

### 3. Search works

When I need to remember how I solved an Azure Functions problem, I search my own blog first; posts like the [dependency injection one](/blog/2020-11-06-azure-functions-dependency-injection/) are the ones I end up rereading.

It works better than a notes app or old Slack threads because I wrote the post for someone without my context, and years later that someone is me. A note says "fixed it with the startup class". A post says which startup class, why the obvious approach failed, and what the error message was, and that last part is what I actually type into the search box.

The same property helps strangers. A post that names the exact error and the fix gets found by the next person who hits it. A thread on a social feed is effectively unsearchable a month later, even by its author.

### 4. A portfolio that does the talking

When someone asks, "Can you help with Azure OpenAI?", I send them three blog posts, such as [what a token estimate misses on Azure OpenAI costs](/blog/2026-01-04-azure-openai-hidden-costs/). They get to see:

- the depth of what I know
- how I communicate
- how I approach a problem

That's worth more than a CV. Work has followed: multiple clients found me through blog posts, and conference organisers read it to vet my topics.

Posts get shared years after I publish them, long after anything I posted on a feed has scrolled away. A CV only works when I hand it over; the archive keeps working when I'm not paying attention.

### 5. Better conversations

The most interesting conversations I have come from blog comments and emails, from people who read the whole thing. Someone who reaches the end of a long post has already followed the reasoning, so their questions are about the details, not the headline.

The trade-off is volume. Far fewer people finish a 1,500-word post than react to a LinkedIn update, but the ones who finish are the ones who email. A hundred likes rarely turns into a conversation; one reader who disagrees with a specific paragraph often does. I'd take the smaller audience for that.

### 6. Room for long-form thinking, with no algorithm to feed

Twitter trained us to think in 140-character (later 280) sound bites. LinkedIn trained us to perform professionalism. A blog lets you actually develop an idea, with the caveats and trade-offs that make it worth reading.

It also means I don't have to game engagement: no posting at the "optimal time" and no worrying about shadowbans, and only the occasional clickbait title when I can't resist.

That has a real cost. A post on my blog doesn't get pushed into anyone's feed, so on day one it reaches far fewer people than the same idea posted on LinkedIn at 8am on a Tuesday. I accept that trade. I'd rather write things people still find useful through search a year later. If people find it, great. If not, it's still here for future me.

## How I write, and where AI fits

I don't keep a content calendar or batch-write posts; I write when I have something to say. Sometimes that's daily, sometimes weekly, and sometimes I go a month without posting. That's the luxury of owning the platform: there's no feed punishing me for a quiet month.

Could I use AI to write my blog posts? Sure. Plenty of people do. I don't: I don't let it write drafts or outlines, but I do use it to edit, tightening structure and clarity once the thinking is done.

The reason is simple: I write to think, to learn, and to share my actual experiences and opinions. If a model writes the post, I've skipped the part that was doing me any good. It can't have my experiences or form my opinions for me.

## What five years have taught me

**Consistency beats perfection.** I've published posts with typos. Posts that aged badly. Posts I'd write differently now. They're all still up, and that's fine. A record of how your thinking changed is more useful than a curated highlight reel.

**Shorter posts get read more, longer posts get referenced more.** Write both. The quick fix gets the search traffic; the long explanation is what people link to in a design review.

**Technical posts bring traffic. Personal posts start conversations.** The balance matters. A blog that's only tutorials reads like documentation; one that's only reflection doesn't help anyone fix anything.

**Nobody cares about your setup, except the few who care intensely.** By "setup" I mean posts about the blog itself: the static site generator, the hosting, the build pipeline. Most readers skip them, but the small group trying to solve the same problem reads every line, and they're the ones who reply with a better approach or a fix I'd missed. Write for those people.

## When a blog isn't the right call

I'm not going to pretend everyone needs one. If your goal is reach this month, a LinkedIn post will beat a blog post every time. If you'd only ever publish to promote yourself, skip it; that shows. And if you can't commit to owning the thing (the domain, the hosting, the occasional broken build), a hosted platform is a perfectly sensible trade.

What I'd push back on is treating social media as the *only* place your writing lives. Post there for distribution. Keep the original somewhere you control.

## If you start one

Buy your own domain on day one, before you pick a platform. Hosts come and go, and you'll probably change static site generators at least once. If your posts live at your own domain, you can move them and keep every URL and every inbound link; if they live on a platform's subdomain, moving means starting your links from zero. Most static hosts support this directly; GitHub Pages, for example, lets you [point a custom domain at your site](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site) with a DNS record and a setting in the repository.

Then pick the simplest host you can, and spend the energy on the second and third posts instead of the theme.

## To other developers

You don't need to be a "content creator". You don't need viral posts or thousands of followers.

But a place where you document what you're learning is valuable: for future you, for people facing the same problem, and as evidence of how you think. It doesn't have to be daily. It doesn't have to be long. It just has to be yours.

If you're waiting for the right moment, don't. I restarted in August 2020 after years of excuses. The industry moves fast, and it's useful to have a record of the journey. I learn by writing, and sometimes people tell me a post helped them.

But mostly, I keep blogging because it's mine. In 2026, with every platform's rules one product decision away from changing, that still matters.
