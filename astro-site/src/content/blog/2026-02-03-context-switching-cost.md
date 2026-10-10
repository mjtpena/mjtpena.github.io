---
title: "Six Short Meetings, One Lost Day: The Real Cost of Context Switching"
description: "Why scattered 30-minute meetings can wipe out a day of deep work, what the research actually says about interruptions, and the schedule rules I now use."
author: Michael John Peña
draft: false
date: 2026-02-03
tags:
  - Productivity
  - Engineering
  - Career
  - Leadership
---

One Tuesday I worked 10 hours and got almost nothing done. My calendar explained it: six meetings scattered through the day, none longer than 30 minutes, with plenty of "free time" between them. That free time was useless. By the time I had loaded the context for a real task, the next meeting was starting.

On paper I had hours free; in practice none of it was usable. If you design systems, write code, or do anything that needs a complicated problem held in your head, the cost of a meeting is the meeting plus the time it takes to get back into the work, and most calendars don't show that second part.

## What the research actually says

The number that gets quoted is "it takes 23 (or 25) minutes to refocus after an interruption". That figure is real, but it gets stretched.

It traces back to Gloria Mark's group at UC Irvine. In [No Task Left Behind? Examining the Nature of Fragmented Work](https://dl.acm.org/doi/10.1145/1054972.1055017) (CHI 2005), they observed information workers and found that 57% of their "working spheres" were interrupted, and that interrupted work was usually picked up again the same day, but only after more than two other activities had come in between. The paper reports an average of about 25 minutes before people returned to an interrupted task; the 23-minute version is the figure Mark has quoted in interviews (for example, to Fast Company in 2008). Either way, that is time until you *return* to the task, with other work in between. It is not a fixed refocus penalty that applies to every interruption.

Two other findings matter more to me than the minutes:

- **Interrupted people work faster and pay for it in stress.** In [The Cost of Interrupted Work: More Speed and Stress](https://dl.acm.org/doi/10.1145/1357054.1357072) (Mark, Gudith and Klocke, CHI 2008), people who were interrupted finished tasks in less time with no drop in quality, but reported more stress, frustration, time pressure and effort. The cost shows up as stress more than as missed output.
- **Part of your attention stays on the last task.** Sophie Leroy's 2009 paper [Why is it so hard to do my work?](https://doi.org/10.1016/j.obhdp.2009.04.002) introduced *attention residue*: when you switch before finishing, part of your attention stays on the previous task and you perform worse on the next one. That is the feeling of sitting down after a meeting and rereading the same function three times.

Microsoft's own telemetry puts a number on it. Its June 2025 Work Trend Index special report, [Breaking down the infinite workday](https://www.microsoft.com/en-us/worklab/work-trend-index/breaking-down-infinite-workday), found that people using Microsoft 365 are interrupted by a meeting, email or chat roughly every two minutes during core hours. The methodology says that figure comes from the top 20% of users by ping volume, so read it as what heavy collaborators deal with, not the median. Still, if you're senior, a lead, or the person everyone asks, you're probably in that 20%.

My takeaway: don't treat "25 minutes" as a precise constant. The evidence still points one way. Switching has a real cost, it's bigger for complex work, and it isn't visible on a calendar.

## The math of a fragmented day

The morning of my Tuesday looked like this, and the afternoon repeated it. I'm using a 25-minute recovery as a rough model:

| Time | What the calendar said | What actually happened |
|---|---|---|
| 9:00 | Meeting (30 min) | Meeting |
| 9:30 | Free | Recovering context (25 min) |
| 9:55 | Free | Productive (5 min) |
| 10:00 | Meeting (30 min) | Meeting |
| 10:30 | Free | Recovering context (25 min) |
| 10:55 | Free | Productive (5 min) |
| 11:00 | Meeting (30 min) | Meeting |
| Afternoon | Three more meetings, same pattern | Same pattern |

Six meetings. The meetings and their recovery took about five and a half hours. Maybe 30 minutes of the 10-hour day was real deep work.

The model is crude and the exact numbers are arguable, but the pattern holds: a 30-minute gap isn't half an hour of capacity when it takes most of that just to get going again. Paul Graham made the same point in 2009 in [Maker's Schedule, Manager's Schedule](https://www.paulgraham.com/makersschedule.html): one meeting can wreck a whole afternoon because it splits the time into two pieces that are each too small to do anything hard in.

## What I changed

These rules are simple; the hard part is keeping them.

### Meeting batching

All meetings now go into two blocks: morning (9 to 11) and late afternoon (3 to 5). The middle of the day is protected.

Microsoft's report found that half of all meetings land between 9 and 11 am or 1 and 3 pm, which are prime focus hours for a lot of people. I gave the morning to meetings so the middle of the day stays protected. The 3 to 5 pm block is deliberate too: for many people late afternoon suits conversations better than hard problems. If you work with other time zones, put your meeting block where the overlap is. Your best hours may be different. The principle is to cluster meetings next to each other so the gaps between them are either zero or long enough to use.

### No-meeting days

Tuesdays and Thursdays. No exceptions unless something is genuinely urgent, and "urgent" has a high bar.

Of the four rules, this is the one I'd keep if I could only keep one. Batching makes each day less fragmented. A no-meeting day gives you a whole day with nothing to recover from.

### Communication windows

I check Slack and email at 9 am, 12 pm and 4 pm. Three times a day, not continuously. The 12 pm check sits at the natural lunch break, so it doesn't split a focus block. The 9 am check happens just before my first meeting and the 4 pm check sits between meetings in the afternoon block, where I'm already switching anyway, so neither costs focus time.

The first week people complained. The second week they adapted. Now they batch their questions too.

If you use Teams, [Viva Insights focus plan](https://learn.microsoft.com/en-us/viva/insights/personal/protect-time/focus-plan) can book recurring focus blocks and mute notifications while they run. That helps, though a tool that mutes notifications can't stop you from opening the app yourself.

### Task minimums

If I start a coding task, I commit to at least 90 minutes. No switching before then. If a meeting falls in the middle of that window, I either move the meeting or start the task after it.

This rule goes after attention residue directly. Most of the cost comes from starting something, getting halfway into it, and abandoning it. If I don't have 90 minutes, I pick a small task I can finish instead.

## The results

Treat this as an early read, not a verdict. Measured by finished work rather than hours logged, output roughly doubled: same hours, about twice the meaningful work. Quality improved too, with fewer bugs, because I could hold the whole problem in my head.

The frantic feeling of never finishing anything went away. That matches the 2008 finding that some of the cost of interruptions is stress rather than output.

The team adapted as well. People learned to plan ahead instead of dropping spontaneous requests on me.

## Where this doesn't work

I'd be overselling this if I said it fits every role.

- **On-call and incident response.** If you're the pager that week, being interruptible is the job. Protect focus on the other weeks instead.
- **Roles that are mostly coordination.** A delivery lead or engagement manager whose job is unblocking people should run closer to a manager's schedule. Their deep work *is* the conversations. The fix there is to stop pulling makers into those conversations by default.
- **New starters and juniors.** Strict communication windows can leave someone stuck for three hours on a question that takes two minutes to answer. I'd pair focus rules with an explicit "interrupt me for this" agreement for people who are still ramping up.
- **Teams spread across time zones.** Working from Sydney with people in other regions often means the only overlap sits right in your protected block. Choose those exceptions on purpose instead of letting them pile up.

The rules still help in these cases. They just need deliberate exceptions instead of blanket ones.

## For managers

If your engineers are in meetings all day, they're not engineering.

Every meeting with an engineer carries a hidden cost: the time afterwards spent rebuilding the mental context they had before it. Four 30-minute meetings spread across a day don't cost two hours. They can cost the whole day.

What I'd do if you lead a team:

1. **Look at the shape of the calendar, not just the total meeting hours.** Ten hours of meetings in two solid days is far less damaging than the same ten hours scattered across five.
2. **Hold recurring meetings at the edges of the day.** A lone 11:30 stand-up costs more than the same stand-up at 9:00 next to other meetings, because it splits the focus block in two.
3. **Make async the default for status updates.** If a meeting only shares information, it can be a written update.
4. **Protect no-meeting days by example.** If you book over them, nobody else will respect them either.

## Decide what you're optimising for

For knowledge work, being "available" and being "productive" pull in opposite directions. You can optimise for responsiveness or for output, but not both at the same time.

Both are legitimate choices. A support lead should optimise for responsiveness. An engineer building a data platform should optimise for output. Most of us drift into the first one without choosing it. My February plan was about [fewer threads and deeper focus](/blog/2026-02-01-february-fresh-start/); these rules are the calendar subtractions that make that plan possible. Pick the mode your role needs, then set your calendar up for it on purpose.
