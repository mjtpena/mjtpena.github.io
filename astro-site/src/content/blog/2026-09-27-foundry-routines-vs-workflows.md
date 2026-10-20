---
title: "Foundry Routines Are GA: Scheduled Agents Without Building a Scheduler"
description: "Foundry routines run an agent on a timer, a schedule or a GitHub or Teams event. When to use them, when to use a workflow, and guardrails for unattended runs."
author: Michael John Peña
draft: false
date: 2026-09-27
tags:
  - Microsoft Foundry
  - AI Agents
  - Architecture
  - Cost Optimization
---

Most agents still wait for someone to type something. The moment a team wants "summarise yesterday's incidents at 7am" or "triage every new GitHub issue", it ends up building a scheduler: a Function with a timer trigger, a Logic App, a cron job on a VM, each with its own identity, secrets and logging that lives outside the agent platform. On 24 September 2026 Microsoft made [routines in Foundry Agent Service generally available](https://devblogs.microsoft.com/foundry/from-chatbots-to-automated-assistants-routines-in-microsoft-foundry-are-now-generally-available/), which puts the trigger next to the agent instead. That removes a lot of glue code, and it also makes it very easy to run an agent unattended before you have thought about what happens when it runs twice, or a thousand times.

## What a routine is

A routine is one trigger wired to one action, stored in your Foundry project along with its identity, connections and run history. The [routines concept page](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/routines) describes three kinds of trigger:

- **Timer**: runs once at a future date and time, or after a set duration.
- **Recurring**: a five-field cron expression plus a time zone, with a minimum interval of five minutes.
- **Event**: fires when something happens in a connected system. At GA that means GitHub issue events (opened or closed) and new messages in a monitored Microsoft Teams channel.

The action calls an agent. `invoke_agent_responses_api` sends input to a prompt agent or hosted agent through the Responses API, optionally into an existing conversation. `invoke_agent_invocations_api` targets a hosted agent's invocations endpoint, optionally with a session ID. Workflow agents are not supported as a routine target.

Identity matters more than the trigger. By default a routine runs as the agent's own Microsoft Entra identity, which suits tools that use managed identity or keys. You can opt in at creation to run as the routine's creator, which you need when a tool uses delegated user auth such as OAuth. "Creator" means exactly the person or service principal who created the routine, so if that person changes roles or leaves, the routine's access goes with them.

The limits worth knowing before you design around routines:

| Constraint | What it means in practice |
|---|---|
| One trigger, one action | No fan-out, no branching, no "then call agent B" |
| Five-minute minimum interval | Not a substitute for streaming or near-real-time processing |
| Prompt and hosted agents only | A routine cannot start a workflow agent |
| No customer-managed keys | Customer-managed key encryption isn't supported for routines |
| Region gaps | Not available in UK West, Switzerland West, Japan West, UAE North or Norway East |

One related feature has not graduated: the reminder tool, which lets a hosted agent schedule its own follow-up run in the same conversation, is still in preview.

## A minimal recurring routine

The Python client exposes routines under the `beta` namespace of `azure-ai-projects`, even after GA, so you need a recent version of the package:

```bash
pip install "azure-ai-projects>=2.6.1" azure-identity
```

This creates a weekday morning summary, based on the sample in the [how-to guide](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/use-routines). It expects `PROJECT_ENDPOINT` and `AGENT_NAME` to be set as environment variables and an existing agent in the project, and `DefaultAzureCredential` picks up your `az login` session:

```python
import os

from azure.ai.projects import AIProjectClient
from azure.identity import DefaultAzureCredential

project = AIProjectClient(
    endpoint=os.environ["PROJECT_ENDPOINT"],  # https://<your-resource>.services.ai.azure.com/api/projects/<your-project>
    credential=DefaultAzureCredential(),
)

routine = project.beta.routines.create_or_update(
    routine_name="incident-summary-weekdays",
    description="Summarises the previous day's incidents on weekday mornings.",
    enabled=True,
    triggers={
        "weekday-morning": {
            "type": "schedule",
            "cron_expression": "0 7 * * 1-5",  # 7am Mon-Fri Sydney time, DST handled by the time zone
            "time_zone": "Australia/Sydney",
        }
    },
    action={
        "type": "invoke_agent_responses_api",
        "agent_name": os.environ["AGENT_NAME"],
        "input": "Summarise incidents opened or updated in the 24 hours before this run.",
    },
)

print(f"Created routine: {routine.name}")
```

Two details I'd copy into every routine. First, set `time_zone` explicitly, to an IANA zone such as `Australia/Sydney` rather than UTC. A UTC schedule drifts an hour whenever daylight saving changes; an IANA zone keeps the run at 7am local all year. The portal only offers daily and weekly schedules and uses your browser's time zone; the API is where you get full cron control. Second, keep `enabled` in your deployment config, not just in the portal. Setting it to `False` is your kill switch, and you want that switch in source control.

For an event trigger, the trigger block references a GitHub connector connection, which Foundry provisions in your account's connector namespace; use its connection ID. This fragment shows the shape:

```python
# Fragment: replaces the triggers argument in the call above
triggers={
    "new-issues": {
        "type": "github_issue",
        "connection_id": "<your-github-connection-id>",
        "owner": "<your-org>",
        "repository": "<your-repo>",
        "issue_event": "opened",
    }
}
```

## Routines, workflows, or something else

The obvious next question is where routines stop and an orchestrator starts. Before answering, one fact changes the shape of the decision: the visual [Foundry workflows](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/workflow) feature is still in preview and is being retired on 1 December 2026. After that the designer and in-portal execution go away, YAML workflow definitions keep running when deployed as hosted agents, and Microsoft points new work at Microsoft Agent Framework (or Logic Apps if you want a visual designer). So "use a Foundry workflow" in late 2026 really means "use an Agent Framework workflow, probably running as a hosted agent".

Here is how I'd split it:

| Need | Use |
|---|---|
| Run one agent on a timer, a cron schedule, a new GitHub issue or a Teams message | Routine |
| Branching, multiple agents, loops, checkpoints, human approval before an action | Agent Framework workflow, deployed as a hosted agent; trigger it from a routine if the start condition fits |
| A business process that touches many SaaS systems, with a visual designer and run history that ops teams already know | Logic Apps |
| Agent work that is one step in a data load or refresh | Fabric Data Factory pipeline |
| Sub-five-minute or high-volume event processing | Event Hubs, Eventstream or Functions, with the agent called as a step |

### Use a routine when the agent is the whole job

A routine fits when one agent, given one prompt, can do the entire task, and the trigger is one of the supported ones. Daily digests, weekly report drafts, first-pass triage of issues, and answering a question posted in a support channel are all good fits. The agent's tools do the work; the routine only decides when.

### Use a workflow when the logic is between agents

If you find yourself writing an agent prompt that says "first do X, then if Y ask a person, then hand to the billing agent", that logic belongs in a workflow, not a prompt. Agent Framework workflows give you explicit edges, checkpoints and human-in-the-loop requests, which you can test and trace. A routine can still be the trigger: point it at a hosted agent that runs the workflow. The agent protocol must match the action, so use `invoke_agent_invocations_api` if the hosted agent exposes the invocations protocol rather than Responses. I covered why the hosted runtime is usually worth it in [Foundry Hosted Agents Are GA](/blog/2026-08-12-foundry-hosted-agents-ga-when-to-stop-self-hosting/), and how to handle approvals properly in the [Agent Framework harness post](/blog/2026-07-29-agent-framework-harness-vs-plain-agent/).

### Keep Logic Apps or Fabric pipelines when the agent is a step

The mistake I'd expect to see is moving an existing process into a routine because routines are new. If a Logic App already pulls from ServiceNow, enriches from Dataverse and posts to Teams, adding an agent call as one action is less work and less risk than rebuilding it around a routine. The same applies in Fabric: if the agent summarises data a pipeline just landed, the pipeline should call it after the load succeeds. A routine on a fixed cron cannot know whether last night's load finished, and an agent summarising stale data on schedule is worse than one that didn't run. Routines have no concept of upstream dependencies, so anything with one belongs in the orchestrator that owns that dependency. I wrote about that failure-first mindset in [designing Data Factory pipelines for failure](/blog/2026-05-10-fabric-data-factory-notes-designing-pipelines-for-failure-not-the-happy-path/).

## Idempotency: assume every run happens twice

Unattended runs remove the human who would notice a duplicate. The how-to guide says the delivery worker retries the dispatch to the agent and only marks a run failed once retries are exhausted. The guide also treats request timeouts as retryable, and for Responses API actions the timeout covers only the acceptance of the background request. A slow accept can therefore be retried while the first request is still running. I don't find any guarantee in the documentation that an agent is invoked exactly once per trigger, and I wouldn't design as if there were one. A retry after a timeout, an issue closed and reopened, or someone using manual dispatch to test in production can all produce a second run for the same piece of work.

My rules for anything a routine triggers:

- **Make side effects keyed.** If the agent comments on an issue, creates a ticket or sends a message, the tool should check for an existing result keyed on the issue number or the reporting window, and update rather than create. Put that check in the tool code, not the prompt. A prompt instruction like "don't post twice" is a hope, not a control.
- **Express time windows explicitly.** "The last 24 hours" means something different for a run that fires late or twice. Where you can, have the tool compute the window from a stored high-water mark, so a repeat run finds nothing new.
- **Read-only by default.** Start every routine with an agent whose tools can only read and draft. Promote it to write access after you have seen a few weeks of run history.
- **Use the run history, but don't stop there.** Each run records its inputs, outputs and status, with a link to the agent response and its trace. Review it the way you'd review a new scheduled job, not the way you'd review a chat transcript. A successful run only means the agent accepted the request, not that it finished the work. Watch the agent's traces and response status too, and alert on those, not just on routine run failures.

## Cost guardrails for agents nobody is watching

The [Foundry Agent Service pricing page](https://azure.microsoft.com/en-us/pricing/details/foundry-agent-service/) charges nothing extra for prompt agents themselves; you pay for model tokens, for built-in tools such as Code Interpreter and web search, and for compute if you use hosted agents. That makes the cost of a routine almost entirely a function of how often it fires and how much each run does.

The arithmetic is easy to ignore. A five-minute recurring routine runs 288 times a day. A Teams trigger fires on every message in the monitored channel, so a busy channel can cost more than any schedule. The guardrails I'd put in place before enabling one:

- **Give routines their own agent and deployment.** A routine has no model of its own; the agent it invokes binds the deployment. Point routines at a dedicated agent (not the one serving interactive users) whose model is a dedicated deployment with a deliberately low tokens-per-minute quota. That caps the damage of a runaway trigger, and its usage shows up separately in cost analysis.
- **Pick the slowest schedule that meets the need.** Hourly is usually enough for "keep an eye on". Every five minutes is a monitoring system, and there are cheaper ones.
- **Bound each run.** Keep tool output sizes small, avoid tools that return whole documents, and keep the prompt specific so the agent doesn't wander through every tool on each run.
- **Set an Azure budget alert on the resource group**, and treat the `enabled` flag as the response to that alert.
- **Narrow event triggers.** Watch a dedicated triage channel rather than a general one, and start with issue `opened`. A GitHub trigger watches one issue event, so watching closed issues as well means a second routine with its own cost. Only add it if the closing event does real work.

## Where I'd start

Routines are the right default for "run this one agent at this time or on this event", and they remove a scheduler most teams should never have built. They are deliberately small: one trigger, one action, no dependencies. When the logic lives between agents, use an Agent Framework workflow and let a routine start it. When the agent is one step in a process that already has an orchestrator, leave it there. Whichever you choose, ship the first version read-only, keyed and on a dedicated agent and deployment, because an unattended agent that runs twice is a when, not an if.
