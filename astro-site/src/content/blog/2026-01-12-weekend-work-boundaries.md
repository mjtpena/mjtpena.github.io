---
title: "The Weekend I Stopped Answering Slack"
description: "How I went from working every weekend to zero weekend work: the setup, the team pushback, what changed after eight weeks, and the exceptions I still allow."
author: Michael John Peña
draft: false
date: 2026-01-12
tags:
  - Personal
  - Work-Life
  - Career
  - Parenting
  - Productivity
---

Saturday morning. My phone buzzed. A Slack message: "Hey MJ, quick question about the deployment..."

I put the phone down and didn't respond. That sounds trivial. For me it was the first visible proof that I'd actually changed how I work, after years of telling myself weekend availability was part of the job.

## The pattern I called dedication

For years, my weekends looked like this:

| When | What I was doing |
|---|---|
| Saturday morning | Catching up on email |
| Saturday afternoon | A "quick fix" that took three hours |
| Sunday morning | Reviewing pull requests |
| Sunday afternoon | Planning Monday |
| Sunday evening | Anxiety about the week ahead |

I called it dedication. Professionalism. Being a good team player. It was poor boundaries dressed up as work ethic.

Weekend protection is one of the rules in [The Tech Parent's Dilemma](/blog/2026-01-06-parenting-in-tech/). This post is how that rule started and what enforcing it actually looked like.

## The moment it stopped being abstract

Archael asked if we could go to the park.

"After I finish this, bud."

Two hours later he'd stopped asking and gone to play alone in his room. My son had learned not to expect me to show up.

That evening, after the kids were asleep, I decided: no more weekend work. Not "try to reduce it". Not "only emergencies". Zero.

My wife looked sceptical. "You've said this before."

She was right. I had. I'd just never committed to it in a way anyone else could see.

## What I set up on Monday

Willpower alone hadn't worked before, so I made the boundary public and made the tools enforce it.

### 1. A Slack status that answers the question before it's asked

```text
Off on weekends
Available Monday-Friday 9 AM - 6 PM Sydney time
For emergencies: [phone number]
```

The phone number matters. It changes the question from "is MJ around?" to "is this worth a phone call?", and most things aren't. If you want the tool to do the work, Slack also lets you [set a notification schedule](https://slack.com/help/articles/214908388-Pause-your-Slack-notifications) so notifications pause outside the days and hours you pick. While they're paused, someone sending a direct message can still choose to notify you about something urgent, which is a sensible escape hatch.

### 2. A weekend autoresponder

```text
I'm offline for the weekend. I'll respond to your email on Monday.

For urgent issues, contact [on-call person].
```

Note what it does: it routes urgent issues to whoever is actually on call, not to me by default.

### 3. Telling my team directly

"I'm not available on weekends anymore. This isn't about dedication. I work hard during the week. It's about sustainability. I need this boundary to be effective long-term."

Saying it out loud did more than the status and autoresponder combined. A status can be ignored. A conversation sets an expectation.

## The first weekend

Saturday morning. Phone buzzed. Slack message. I looked at it and put the phone in a drawer.

My head kept checking anyway. Is it urgent? Should I just quickly respond? What if they're blocked? I caught myself and closed the drawer.

I took Archael to the park and was actually present. I didn't check my phone.

Sunday, no work. It felt like I was forgetting something important. I wasn't. Everything was fine.

## The pushback

On Monday, one team member seemed annoyed. "I was blocked on Saturday."

"What was the blocker?"

"I couldn't remember how the authentication flow worked."

"Did you check the documentation?"

"Well, no, but I thought I'd just ask you."

That exchange told me the real problem. I'd made myself so available that people asked me before they looked anywhere else. My constant availability wasn't helping the team. It was stopping them from building their own ways of getting unblocked.

If you lead a team, this is the uncomfortable bit: every weekend reply you send trains people to route around the documentation, the runbook and each other.

## How it played out

- **Week 1:** Guilty. I checked Slack occasionally. I didn't respond, but I felt anxious.
- **Week 2:** Still guilty, but I stuck to it. The team adapted and found answers elsewhere.
- **Week 3:** The guilt faded. I started enjoying weekends again.
- **Week 4:** It became normal. The team stopped expecting weekend replies.
- **Week 8:** Someone new joined and asked if I'd seen their Saturday message. I said, "I don't work weekends." They said, "Oh, okay!" and figured it out.

By then the new norm was the default, so the new starter never learned the old one.

## What actually changed

- **My stress:** way down.
- **My relationship with my kids:** noticeably better.
- **My work during the week:** better, because I'm less burned out.
- **My team's independence:** they solve more problems on their own.
- **Project delivery:** unchanged. Nothing broke because I wasn't available on Saturdays.

If a sceptical manager reads one line, it should be that one. The cost I'd been afraid of never showed up.

The biggest lesson was that availability feeds itself. The more available I was, the more people expected it, and the more I expected it of myself. My kids had learned that work came first, and I'm teaching them something different now. The boundary also needs maintaining: every weekend reply I send makes the old norm a little more normal again.

## Give the team somewhere else to go first

People do adapt, but only if there's somewhere else to go. Pulling yourself out of the weekend without replacing what you were doing just moves the frustration onto your team. If you are setting this up, these are the two things I would put in place first:

- **A runbook or FAQ for the questions that keep coming to you.** The Saturday message about the authentication flow wasn't an emergency. It was a gap in the documentation that I'd been papering over by answering. If the same question reaches you twice, write the answer down where the team can find it and point people there.
- **A named on-call rota.** "Contact the on-call person" only works if everyone knows who that is this weekend and how to reach them. The autoresponder and the Slack status both depend on it.

The trade-off is effort up front: writing a runbook entry takes longer than answering the question once. It pays off because you stop answering the same question every weekend.

## Most urgency is manufactured, but not all of it

Most "urgent" things can wait until Monday. True emergencies still exist: production down, a data breach, an actual crisis.

I've had two in six months. Both times I got a phone call, not a Slack message. Both times I responded, and both times it was genuinely urgent.

The other 47 Slack messages? None were emergencies. All of them could wait.

My rule of thumb now: if it's worth interrupting my weekend, it's worth a phone call. That rule only works if there's a real on-call arrangement behind it.

Time zones complicate this. Saturday morning in Sydney is still Friday afternoon in the US, so a US-based colleague or client sending a message then is just finishing their week. I put my handover time in my status ("back Monday 9 AM Sydney time") and let the notification schedule follow Sydney hours, not the sender's. Anything that genuinely can't wait for my Monday goes to the on-call person, the same as a local message would.

### When zero contact is the wrong goal

Some roles shouldn't aim for zero weekend contact. If you're the single point of failure for production, you can't opt out on your own. Raise it with your manager as a staffing gap and get a second person trained up before you go dark. If weekend availability is part of the job, such as an on-call allowance, a support roster or an incident-commander rotation, you're being paid to be reachable for those weekends. There the answer is a fair rota, so that each person's on-call weekends are known in advance and the rest are genuinely off, rather than nobody ever being on call.

It's also worth knowing where you stand if you work in Australia. The [right to disconnect](https://www.fairwork.gov.au/employment-conditions/hours-of-work-breaks-and-rosters/right-to-disconnect) in the Fair Work Act lets employees refuse to monitor, read or respond to contact outside working hours unless the refusal is unreasonable. It has applied to non-small business employers since 26 August 2024 and [to small business employers since 26 August 2025](https://www.fairwork.gov.au/newsroom/media-releases/2025-media-releases/august-2025/20250826-right-to-disconnect-starts-for-small-business-employees-media-release). It doesn't stop anyone from sending you a message, and whether a refusal is unreasonable depends on things like the reason for the contact, how it disrupts you, whether you're paid to be available, your role and level of responsibility, and your personal circumstances, including caring responsibilities. That "paid to be available" factor is the on-call case above. I'd treat the law as a backstop. The boundary that actually holds is the one your team has agreed to.

## If you want to try it

You don't get extra points for weekend availability. You don't advance faster. You don't build better products. You burn out faster.

I spent years optimising my code, my tools and my workflows. I never optimised my boundaries, and that turned out to be the real bottleneck.

Start with one weekend that is truly off, with a named on-call person your team knows to call instead of you. It'll feel uncomfortable and you'll want to check. Don't. Monday will come, the work will be there, and you'll be in better shape to handle it.

Nobody remembers the Saturday Slack replies. My kids will remember whether I showed up.

This weekend, Archael asked if we could go to the park. I said yes straight away. We went, and I was fully there. My phone stayed home. That's the success metric I care about now.
