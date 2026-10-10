---
title: "Foundry Agent Versions as Releases: Git, Evals and Publishing"
description: "How I'd run Microsoft Foundry agent changes like releases in April 2026: definitions in Git, versions from CI, evaluation gates and Agent Application promotion."
author: Michael John Peña
draft: false
date: 2026-04-10
tags:
  - Microsoft Foundry
  - AI Agents
  - LLMOps
  - CI/CD
  - GitHub Actions
---

Most agent demos die in the same way. Someone tweaks the instructions in the playground, the answers improve, and two weeks later nobody can say which prompt production is running or why Tuesday's answers differ from Monday's. Moving from demos to governed operations is mostly about that daily loop: who changes an agent, where the change is recorded, what has to pass before users see it, and how you go back. Microsoft Foundry now has the primitives to answer each of those, but it won't put them together into a release process for you.

I covered [what went GA in March and what's still preview](/blog/2026-03-19-microsoft-foundry-build-notes-moving-from-model-demos-to-governed-operations/) separately. This post is the engineering workflow I'd build on top of it.

## The primitives, as they stand in April 2026

Three concepts do the work. The [agent development lifecycle](https://learn.microsoft.com/azure/foundry/agents/concepts/development-lifecycle) page covers versions; the [publishing article](https://learn.microsoft.com/azure/foundry/agents/how-to/agent-applications) covers applications, deployments and roles:

- **Agent versions.** Every saved change to a prompt agent or workflow creates a new version, and versions are immutable. You can test unsaved changes in the playground, but you can't view history, monitor or run full evaluations against them. In code you refer to an agent as `<agent_name>:<version>`, and the name can't be changed once set.
- **Agent Applications.** Publishing wraps a version in an Azure resource with a stable endpoint, its own RBAC scope, and its own Microsoft Entra agent identity. A child **deployment** points at one specific agent version.
- **Roles.** Publishing needs Azure AI Project Manager on the Foundry resource. Callers need Azure AI User on the Agent Application itself, and API keys aren't supported for invoking an application.

The status picture matters. On the [GA readiness table](https://learn.microsoft.com/azure/foundry/concepts/general-availability), Build > Agents and Build > Evaluations are GA, while Workflows, Tracing and Monitoring are still preview. Don't be thrown by the lifecycle page, which still labels its evaluation section as preview: the portal Evaluations area is GA on the readiness table, while the evaluation GitHub Action I use below is explicitly preview. The publishing article still carries the "packages currently in preview" notice on its code, and its sample call to the application endpoint uses `api-version=2025-11-15-preview`. On the SDK side, `azure-ai-projects` 2.0.0 shipped on 6 March as the first stable release against the GA v1 Foundry REST APIs, with 2.0.1 following on 12 March. That's what I'd pin today.

Two constraints shape the rest of the design. First, an Agent Application has one active deployment, and it receives 100% of the traffic. There's no built-in canary or traffic split. Second, the application's Responses endpoint is stateless: `/conversations` and `/files` aren't exposed there, so the client keeps conversation history. Neither is a reason to avoid publishing, but both belong in your design review before anyone promises gradual rollouts or server-side chat history.

## The repository is the source of truth

The decision I'd make first: the agent's definition lives in Git, and the portal is a sandbox. People can and should experiment in the playground. Nothing reaches users unless it came from a merged change.

That rule earns its keep the moment you have more than one environment. If you split [projects by environment](/blog/2026-03-08-foundry-decisions-i-stand-behind-how-project-boundaries-change-delivery-speed/), version numbers are assigned per agent inside each project, so `support-agent:7` in dev and `support-agent:7` in prod don't have to be the same thing. Promote by *definition*, not by version number. I tag every version with a hash of its definition and the commit it came from, so any version in any project can be traced back to a pull request.

| Change | Where it's made | What records it |
|---|---|---|
| Experiment with instructions or tools | Playground in the dev project | Nothing, deliberately |
| Proposed change | Pull request against the agent definition | Git history and review |
| Candidate | New agent version created by CI | Version metadata: definition hash, commit SHA |
| Release | Deployment repointed to that version | Deployment resource and pipeline run |

## Creating versions from CI

The script below reads a definition from the repository, hashes it, and creates a new version only when the definition changed. Running it twice on the same commit is a no-op, which keeps the version list readable. It uses `azure-ai-projects` 2.0.1 with keyless auth. The client only supports Entra ID, which is what you want in a pipeline anyway.

```python
# release_agent.py
# pip install "azure-ai-projects==2.0.1" azure-identity
import hashlib
import json
import os
import sys

from azure.ai.projects import AIProjectClient
from azure.ai.projects.models import PromptAgentDefinition
from azure.core.exceptions import ResourceNotFoundError
from azure.identity import DefaultAzureCredential


def main(definition_path: str) -> None:
    with open(definition_path, encoding="utf-8") as f:
        spec = json.load(f)

    # Canonical JSON so whitespace or key order changes don't create new versions.
    canonical = json.dumps(spec, sort_keys=True, separators=(",", ":"))
    definition_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]
    agent_name = spec["name"]

    with (
        DefaultAzureCredential() as credential,
        AIProjectClient(
            endpoint=os.environ["AZURE_AI_PROJECT_ENDPOINT"], credential=credential
        ) as project,
    ):
        try:
            latest = project.agents.get(agent_name=agent_name).versions.latest
            if (latest.metadata or {}).get("definition_hash") == definition_hash:
                print(f"No change; reusing {agent_name}:{latest.version}")
                write_output(f"{agent_name}:{latest.version}")
                return
        except ResourceNotFoundError:
            pass  # First version of this agent in this project.

        created = project.agents.create_version(
            agent_name=agent_name,
            description=spec.get("description"),
            definition=PromptAgentDefinition(
                model=spec["model"],
                instructions=spec["instructions"],
                temperature=spec.get("temperature"),
            ),
            metadata={
                "definition_hash": definition_hash,
                "git_sha": os.environ.get("GITHUB_SHA", "local"),
            },
        )
        print(f"Created {created.name}:{created.version}")
        write_output(f"{created.name}:{created.version}")


def write_output(agent_id: str) -> None:
    # Expose the agent ID to later GitHub Actions steps when running in CI.
    output_file = os.environ.get("GITHUB_OUTPUT")
    if output_file:
        with open(output_file, "a", encoding="utf-8") as f:
            f.write(f"agent_id={agent_id}\n")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "agent/support-agent.json")
```

The definition file is plain JSON with `name`, `model` (a deployment name in the project), `instructions`, and optional `description` and `temperature`. I keep instructions in the JSON rather than a separate prompt file so a single hash covers everything that changes behaviour. If you attach tools, add them to the same file and the same hash. A tool change is a behaviour change. Version metadata allows up to 16 key-value pairs, which is plenty for a hash, a commit and a ticket reference.

## Gate the candidate against what's live

A new version is only a candidate. The question for the release isn't "is it good?" but "is it better than, or at least not worse than, what users have now?" Microsoft's [AI agent evaluation GitHub Action](https://learn.microsoft.com/azure/foundry/how-to/evaluation-github-action) fits this well, as long as you remember it's preview. It takes `agent-ids` in `name:version` form, runs a dataset of queries through each agent, scores them with evaluators from the project catalogue, and compares multiple agents against a `baseline-agent-id` with statistical tests.

```yaml
# Fragment: jobs section of a GitHub Actions workflow.
# Requires permissions: id-token: write, contents: read at the workflow level.
jobs:
  candidate:
    runs-on: ubuntu-latest
    environment: dev
    outputs:
      agent_id: ${{ steps.version.outputs.agent_id }}
    steps:
      - uses: actions/checkout@v4
      - uses: azure/login@v2
        with:
          client-id: ${{ vars.AZURE_CLIENT_ID }}
          tenant-id: ${{ vars.AZURE_TENANT_ID }}
          subscription-id: ${{ vars.AZURE_SUBSCRIPTION_ID }}
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install "azure-ai-projects==2.0.1" azure-identity
      - id: version
        run: python release_agent.py agent/support-agent.json
        env:
          AZURE_AI_PROJECT_ENDPOINT: ${{ vars.AZURE_AI_PROJECT_ENDPOINT }}
      - name: Compare candidate with the live version
        uses: microsoft/ai-agent-evals@v3-beta
        with:
          azure-ai-project-endpoint: ${{ vars.AZURE_AI_PROJECT_ENDPOINT }}
          deployment-name: <your-judge-deployment>
          agent-ids: ${{ vars.BASELINE_AGENT_ID }},${{ steps.version.outputs.agent_id }}
          baseline-agent-id: ${{ vars.BASELINE_AGENT_ID }}
          data-path: ${{ github.workspace }}/evals/support-agent.json
```

This job runs against the dev project, so `BASELINE_AGENT_ID` must be a `name:version` that exists *there*. With per-environment projects, the baseline is the dev-project version whose `definition_hash` metadata matches the version live in prod; find it by hash with `project.agents.list_versions(agent_name=...)` rather than copying the prod version number, which may point at a different definition or at nothing in dev. Promotion then reruns `release_agent.py` against the prod project endpoint, which creates a prod version with the same definition and hash but its own version number, before repointing the prod deployment. If you run a single shared project instead, the live version ID works directly as the baseline.

Recording what's live needs one more decision. The default `GITHUB_TOKEN` can't write repository or environment Actions variables, so a promotion job that runs `gh variable set` needs a GitHub App token or a fine-grained token with Variables write permission. The alternative I prefer is not storing it at all: read the live `agentVersion` back from the prod deployment with a GET on the same `agentdeployments` resource used below, then look up its hash.

Run the candidate job on pull requests for the comparison, but don't promote the version it creates. On a `pull_request` event `GITHUB_SHA` is a temporary merge commit, so its `git_sha` metadata never appears in main's history. The version you promote should be created by the run on main after merge.

The action produces a report rather than a pass/fail opinion on your business, so I put the promotion job behind a GitHub environment with required reviewers. A human reads the comparison, then approves. Limit the trigger to changes in the agent folder rather than every commit; each run invokes the agent and the judge model for every query, and those tokens are billed like any others. How I build the dataset itself is in [the groundedness post](/blog/2026-03-09-how-i-evaluate-llm-changes-tracking-groundedness-before-celebrating-fluency/).

## Promotion is repointing a deployment

Because the deployment references an exact version, promotion and rollback are the same operation: update the deployment's `agentVersion`. Changing the published version sends 100% of traffic to it immediately. I'd script it rather than click **Publish Updates**, so the pipeline run is the audit trail:

```bash
# Repoint an existing Agent Application deployment to a new agent version.
# Agent Applications use a preview control-plane api-version; 2026-01-15-preview
# is the one azure-mgmt-cognitiveservices 15.0.0b1 (1 April 2026) targets.
AGENT_VERSION="<agent-version>"  # Prod version created by the post-merge run on main.
az rest --method put \
  --url "https://management.azure.com/subscriptions/<subscription-id>/resourceGroups/<resource-group>/providers/Microsoft.CognitiveServices/accounts/<foundry-resource-name>/projects/<project-name>/applications/<application-name>/agentdeployments/<deployment-name>?api-version=2026-01-15-preview" \
  --body "{
    \"properties\": {
      \"displayName\": \"support-agent production\",
      \"deploymentType\": \"Managed\",
      \"protocols\": [{ \"protocol\": \"Responses\", \"version\": \"1.0\" }],
      \"agents\": [{ \"agentName\": \"support-agent\", \"agentVersion\": \"$AGENT_VERSION\" }]
    }
  }"
```

Rollback is the same call with the previous version, which is why I'd never delete versions that have been live. Keep at least the last few, and make "previous version" a recorded value in the pipeline rather than something someone looks up under pressure.

If you need a gradual rollout, it has to happen in front of Foundry for now. One way is two applications with your own application or gateway splitting traffic between them. That's real extra complexity, and for most internal agents I'd accept the all-at-once switch and rely on fast rollback.

## Identity is the step people miss

Publishing changes who the agent *is*. An unpublished agent acts through the project's shared agent identity. A published one gets its own [agent identity](https://learn.microsoft.com/azure/foundry/agents/concepts/agent-identity) and blueprint, and permissions don't transfer. Any tool using agent identity authentication that worked in dev fails with authorisation errors after publishing, until you grant the new identity the roles it needs.

Treat those role assignments as part of the release, in the same infrastructure-as-code as the Agent Application, and scope them to exactly the resources the agent's tools touch. It's also the right moment to remove anything the shared project identity was granted "just to get the demo working".

## When this is more process than you need

I wouldn't build this for an agent that a handful of people use from the playground, or for a spike you intend to throw away. The trigger for me is any of: another system consumes the agent's output, the agent calls tools with side effects, or more than one person changes it. Hosted agents (preview) follow a different path, built as containers, and the definition-hash approach above applies to prompt agents. Workflows are versioned the same way, but they're still preview, so I wouldn't make them the first thing you automate.

## Where I'd start on Monday

Move one agent's definition into a repository and make the playground a place for experiments, not releases. Have CI create versions with a definition hash and commit SHA in the metadata. Put a baseline comparison between the candidate and the live version before a human approves promotion. Script promotion and rollback as the same deployment update. Add the published identity's role assignments to the release itself. None of these steps is novel. Together they're the difference between "it worked in the demo" and knowing exactly what users are talking to.
