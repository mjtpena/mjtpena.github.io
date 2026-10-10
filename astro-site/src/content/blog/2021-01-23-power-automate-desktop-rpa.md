---
title: "Power Automate Desktop at GA: Designing RPA Flows That Survive"
description: "How to design Power Automate Desktop flows that survive UI changes, when to choose attended or unattended RPA, and when an API beats a bot."
author: Michael John Pena
draft: false
date: 2021-01-23
url: /blog/power-automate-desktop-rpa/
tags:
  - Power Automate
  - RPA
  - Automation
  - Power Platform
---

Most back-office work that still runs on copy and paste lives in applications with no API: a thick-client line-of-business system, a supplier portal, a terminal session nobody wants to touch. Power Automate Desktop, which reached general availability in December 2020, is Microsoft's answer for that work, and it changes who can build the automation. The hard part was never recording the clicks. It's building something that still works after the next UI update, and knowing when a bot is the wrong tool.

The scenarios I've built with it are the classic ones: entering data into a legacy app, and pulling a scheduled report out of a portal that has no API.

## What Power Automate Desktop actually is

Power Automate Desktop is a Windows application for building desktop flows. Its roots are in WinAutomation, which came with Microsoft's [acquisition of Softomotive](https://www.microsoft.com/en-us/power-platform/blog/power-automate/microsoft-acquires-softomotive-to-expand-low-code-robotic-process-automation-capabilities-in-microsoft-power-automate/) in May 2020. Microsoft [announced Power Automate Desktop](https://www.microsoft.com/en-us/power-platform/blog/power-automate/jumpstart-your-business-with-power-automates-new-desktop-rpa-solution/) in public preview around Ignite in September 2020, and the [December 2020 update](https://www.microsoft.com/en-us/power-platform/blog/power-automate/take-a-tour-of-process-advisor-and-new-rpa-enhancements/) made it generally available. The same update renamed the original "UI flows" to desktop flows, which is the term you'll now see across the Power Automate portal.

In practice you get:

- A designer with hundreds of drag-and-drop actions covering files, folders, Excel, email, web browsers, Windows UI, terminal emulators and scripting.
- A desktop recorder and a web recorder that capture what you do as actions.
- UI elements: captured references to controls in a window or web page, identified by selectors instead of screen coordinates.
- Variables, loops, conditions, subflows, and error handling at both the action level and the block level.
- Input and output variables, so a cloud flow can pass values in and read results back.

The December 2020 release also added a sensitive text type for input variables and encrypted direct input for actions such as "Populate text field on web page", "Populate text field in window" and "Send keys". That matters, and I'll come back to it.

## Licensing, as it stands today

The installer is a free download, but signing in and running desktop flows requires the Power Automate per user plan with attended RPA (or a trial). The current model, unchanged since RPA arrived in Power Automate in April 2020:

| Need | Licence | List price |
|---|---|---|
| A person runs bots on their own machine while signed in (attended) | Power Automate per user plan with attended RPA | US$40 per user per month |
| A bot runs on a machine with no one signed in (unattended) | Unattended RPA add-on, on top of an attended or per flow plan | US$150 per bot per month |

This is the first thing to sort out with whoever owns the budget. A pilot built on a trial looks free until someone asks for 20 people to run it. For many teams, US$40 per user per month is the real gate on rolling this out widely.

## Attended or unattended: decide before you build

The run mode changes how you build the flow, so pick it up front.

**Attended** flows run on a user's machine while that user is signed in, usually started by them or by a cloud flow on their behalf. Use attended when a person needs to make a judgement mid-process, when the app needs the user's own session or smart card, or when the volume is a handful of runs a day.

**Unattended** flows run on a machine where no user is signed in; the bot signs in, runs and signs out. Use unattended for scheduled, high-volume, no-judgement work such as overnight report extraction.

How cloud flows reach the machine catches people out. Today, [triggering a desktop flow from a cloud flow](https://learn.microsoft.com/en-us/power-automate/desktop-flows/trigger-desktop-flows) goes through the desktop flows connector, and that connection needs an **on-premises data gateway** installed on the machine running the bot. Plan for gateway installation, its service account, and its updates as part of the build. Don't leave them for the week of go-live.

### What an unattended machine needs

Unattended runs have stricter requirements than a developer laptop. The machine should run Windows 10 Pro or Enterprise, or Windows Server 2016 or 2019, with Power Automate Desktop and the gateway installed and registered against the same environment as your cloud flows. The desktop flows connection stores the Windows account and password the bot signs in with, so that account must be allowed to sign in to that machine, and nobody else can be signed in when the run starts: a disconnected or locked session blocks it. Each machine runs one unattended desktop flow at a time. When volume grows, add machines to a gateway cluster and let the [desktop flow queue](https://www.microsoft.com/en-us/power-platform/blog/power-automate/take-a-tour-of-process-advisor-and-new-rpa-enhancements/) (in preview since the December update) and its priorities decide what runs next.

My rule of thumb: start attended, prove the process is stable for a few weeks, then move it to unattended. An unattended bot that fails at 2 am with nobody watching is much more expensive than an attended one that fails in front of the person who knows the process.

## Designing flows that survive the next UI change

Every RPA project eventually meets the same problem: the target application changes. A button moves, a window title gains a version number, a web page gets a redesign. Here's how I design for that.

### Use UI elements, not coordinates

When the recorder can't identify a control, or when you add "Send mouse click" by hand, you end up with screen-coordinate clicks. Replace them with actions that target UI elements ("Click UI element in window", "Populate text field in window"), because a selector based on control type, name or automation ID survives screen resolution, window position and DPI changes. Coordinates survive none of those.

Selectors can be edited after capture. The most common fix I make is removing brittle attributes, such as a window title that includes today's date or a record ID, so the selector matches the window you mean rather than the exact window you happened to record.

### Wait for state, not for time

A fixed "Wait 5 seconds" works on your machine and fails on a busy VM. Wait for something real instead: "Wait for window", "Wait for image", or "Wait for web page content", each with a timeout. When the timeout hits, that's a real error you can handle, instead of a click that lands on nothing.

### Split the flow into subflows by screen

Put each logical screen or step in its own subflow: sign in, navigate to the report, set filters, extract, export. When the vendor changes the reports screen, you fix one subflow and leave the rest alone. It also makes run failures readable, because the failing subflow name tells you where it broke.

### Keep credentials out of the flow

Never type a password into a "Send keys" action as plain text. Use a sensitive text input variable or the encrypted direct input added in the December release, and pass the value in from the cloud flow when you can. Better still, run the bot as a dedicated account with the minimum access the process needs, and treat that account like any other service account: owned, documented, password rotated.

## Error handling that tells you what happened

Desktop flows stop on the first error by default. That's the right default for development and the wrong one for production. There are two levels of error handling:

- **Action level:** each action's "On error" settings can retry a number of times with a delay, continue the run, or go to a label. Use retries for known transient failures, such as a slow page load.
- **Block level:** "On block error" wraps a group of actions in one handler. It went into public preview in November 2020 and the [release plan](https://learn.microsoft.com/en-us/power-platform-release-plan/2020wave2/power-automate/second-level-error-handling-power-automate-desktop) still lists it as preview at the time of writing, so test it properly before you lean on it. It's the closest thing to a try/catch you get.

The pattern I use: wrap each item's processing in an "On block error" block, so one bad record doesn't kill the batch. In the handler, use "Get last error", take a screenshot, write the record ID and error to a log file, and continue with the next item. At the end, return counts of processed and failed items as output variables so the calling cloud flow can send a summary or raise an alert.

A screenshot at the moment of failure is worth more than any log line. Most RPA failures are "the screen wasn't what the bot expected", and a picture settles that in seconds.

## Governance before the second bot

Desktop flows are called through the desktop flows connector, and that connector sits in your environment data loss prevention (DLP) policies like any other. Decide which group it belongs in alongside the connectors your cloud flows use, and put production bots in their own environment rather than the default one. DLP governs connectors, not the individual actions inside a desktop flow, so review what each bot does before it reaches production.

For monitoring, the calling cloud flow's run history is your first stop: the desktop flow step shows its status, duration and outputs, which is why returning counts as output variables pays off. The December update also added real-time views of desktop flow runs and queues in a Monitor section of the portal. Someone has to own those views; a failed run nobody looks at is the same as no automation.

## When not to use a desktop flow

RPA is the integration of last resort. It's slower than an API, more fragile, and needs a Windows machine to stay healthy. Before building a bot, ask:

| If… | Use instead |
|---|---|
| The system has a REST API, even an undocumented one the vendor will support | A cloud flow with the [HTTP connector](/blog/2020-08-07-power-automate-http-connector/) or a [custom connector](/blog/2020-08-30-power-automate-custom-connectors/) |
| The data is in a database you're allowed to read | A direct query, a dataflow or a pipeline |
| The source can drop a file somewhere on a schedule | File-based integration |
| The process changes every month | Fix the process first; automating churn means rebuilding the bot every month |

Desktop flows earn their place when the only interface is the UI and the system isn't going away soon: legacy line-of-business apps, mainframe terminals, and supplier portals with no export. They're also a reasonable bridge while a proper integration is on the roadmap. In that case, say so out loud and give the bot an end date.

## Where I'd start

Pick one high-volume, rules-based process with a stable UI and a patient process owner. Build it attended, using UI elements instead of coordinates, subflows per screen, sensitive inputs for credentials and block-level error handling with screenshots. Run it for a month before you talk about unattended bots, gateways and the US$150 add-on.

If you can't name the person who will fix the bot when the vendor ships a new UI, don't build it yet.
