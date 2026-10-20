---
title: "GitHub Copilot Technical Preview: Should Your Team Try It?"
description: "What GitHub Copilot's technical preview does well, where it fails, and the IP, privacy and review questions to answer before a team relies on it."
author: Michael John Peña
draft: false
date: 2022-01-12
url: /blog/github-copilot-preview/
tags:
  - GitHub
  - Copilot
  - AI
  - OpenAI
  - Development
---

GitHub Copilot has been in technical preview for about six months, and the conversation about it is still stuck between two extremes: "this replaces programmers" and "this is autocomplete that writes bugs". Neither helps a tech lead who has developers on the waitlist and has to decide what's allowed on the team's code. The useful question is narrower: where does Copilot save real time, where does it add risk you won't notice in review, and what do you need to agree on before anyone accepts a suggestion into a production repository?

## What Copilot actually is right now

GitHub [announced Copilot on 29 June 2021](https://github.blog/2021-06-29-introducing-github-copilot-ai-pair-programmer/) as a technical preview, with access through a waitlist. It's powered by OpenAI Codex, a GPT-3 descendant trained on natural language and a large corpus of public source code. OpenAI opened a [private beta of Codex through its own API](https://openai.com/blog/openai-codex/) in August 2021, so Copilot is effectively the first mass-market product built on that model.

As of January 2022 the facts that matter are:

| Question | Answer in January 2022 |
|---|---|
| Release status | Technical preview, waitlist only |
| Editors | Visual Studio Code, Neovim, and JetBrains IDEs (the latter two added in late 2021) |
| Price | Free during the preview; GitHub hasn't announced commercial pricing |
| Organisation controls | None. Access is granted to individual GitHub accounts |
| Languages GitHub says work best | Python, JavaScript, TypeScript, Ruby, Java and Go |

The organisation-controls row is the one most teams overlook. There's no admin console, no organisation policy and no business agreement. If your developers are using it, they're doing so as individuals under the preview terms.

## How it works in the editor

Copilot reads the file you're editing (the code above and below the cursor, the file name, and comments) and sends that context to the service, which returns a suggested completion as greyed-out "ghost text". In VS Code, Tab accepts, Esc dismisses, Alt+] and Alt+[ cycle through alternatives (Option+] and Option+[ on macOS), and Ctrl+Enter opens a panel with several candidate completions side by side.

The important consequence is that Copilot's context is essentially the file you're editing: the code around the cursor, the file name and its language. In practice it doesn't see your other modules, your database schema, your team's conventions document or the ticket you're working on. Everything it suggests is a guess about what code statistically follows the context you've given it.

That's why comments and names matter so much. A descriptive function signature and a one-line comment stating intent is effectively the prompt:

```python
import re

# Return True if the string is a valid Australian Business Number (ABN).
# ABNs are 11 digits; apply the official weighting checksum.
def is_valid_abn(abn: str) -> bool:
    digits = re.sub(r"\s", "", abn)
    if not re.fullmatch(r"\d{11}", digits):
        return False
    weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19]
    numbers = [int(d) for d in digits]
    numbers[0] -= 1
    total = sum(w * n for w, n in zip(weights, numbers))
    return total % 89 == 0


if __name__ == "__main__":
    print(is_valid_abn("51 824 753 556"))  # True: the ABN from the ATO's worked example
    print(is_valid_abn("51 824 753 557"))  # False: last digit changed
```

This is the kind of code Copilot is suited to: a well-known algorithm, plenty of public examples, and a result you can verify with two lines. You still have to check the weights and the "subtract 1 from the first digit" step against the published rule, because a plausible-looking wrong checksum is exactly the failure mode you'd expect.

## Where it earns its keep

In my view Copilot's value is concentrated in a few areas:

- **Boilerplate with an obvious shape.** Test scaffolding, DTOs, mapping code, argument parsing, and repetitive `switch` or `if` ladders. You know what the code should be; Copilot types it faster.
- **Unfamiliar APIs.** The "I know what I want but can't remember the method name" moments. It's often faster than switching to the docs, provided you check the result against them afterwards.
- **Languages you use occasionally.** A .NET developer writing a Bash script or a bit of Python gets idiomatic syntax without a search for every line.
- **Tests from a description.** Write the test name as a sentence and Copilot will usually propose a reasonable arrange/act/assert body.

## Where it quietly adds risk

The failures that matter aren't the obviously broken suggestions. Those you reject. The risky ones compile, look idiomatic, and encode a pattern you wouldn't approve in review.

### It reproduces what's common, not what's current

Public code is full of older patterns, so Copilot suggests them. Ask for an Azure Blob Storage upload and the most likely completion uses an account connection string, because that's what most public samples do:

```csharp
// Fragment: what a typical suggestion looks like
var blobServiceClient = new BlobServiceClient(connectionString);
```

For Azure workloads I'd rather see a managed identity through `DefaultAzureCredential`, which the [Azure Identity client library](https://learn.microsoft.com/en-us/dotnet/api/overview/azure/identity-readme) supports with the current `Azure.Storage.Blobs` package:

```csharp
using System;
using System.IO;
using System.Threading.Tasks;
using Azure.Identity;
using Azure.Storage.Blobs;

public static class BlobUploader
{
    public static async Task UploadFileAsync(string accountName, string containerName, string filePath)
    {
        var serviceUri = new Uri($"https://{accountName}.blob.core.windows.net");
        var serviceClient = new BlobServiceClient(serviceUri, new DefaultAzureCredential());
        var containerClient = serviceClient.GetBlobContainerClient(containerName);
        await containerClient.CreateIfNotExistsAsync();

        var blobClient = containerClient.GetBlobClient(Path.GetFileName(filePath));
        await using var stream = File.OpenRead(filePath);
        await blobClient.UploadAsync(stream, overwrite: true);
    }
}
```

Copilot will write the second version too, if the file already imports `Azure.Identity` or a comment asks for it. That's the pattern to internalise: it follows your context, so your context needs to carry your standards. The same applies to infrastructure code, where it'll happily suggest outdated API versions or secrets inlined into app settings.

### It doesn't know your domain

Business rules that live in your heads, your wiki or other files are invisible to it. It'll invent a field name that looks right, assume a currency is in cents when yours is in dollars, or pick a rounding rule. These are the suggestions to treat as untrusted input.

### It can make reviews shallower

When a developer hand-writes 40 lines, they've reasoned through them. When they accept 40 lines with Tab, the reasoning may never happen, and the reviewer sees code that looks no different. My rule of thumb: the author owns every accepted line as if they typed it, and "Copilot wrote it" is never an answer in a pull request.

## The IP and privacy questions to settle first

Two concerns come up in every conversation I have about Copilot, and both deserve a clear position rather than a shrug.

**Recitation of training data.** Because Codex was trained on public code, it can occasionally reproduce code from that training set. GitHub's own [research on recitation](https://github.blog/2021-06-30-github-copilot-research-recitation/) found this to be rare, and more likely when the context is thin (such as an empty file) or the snippet is extremely common. Rare isn't never. If your organisation has strict policies on third-party licences, treat long, distinctive suggestions with suspicion and don't use Copilot on code you plan to release under a specific licence until legal has given an opinion.

**What leaves the machine.** Copilot sends editor context to the service to generate suggestions, and the preview's FAQ and [terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#github-copilot) describe collecting usage telemetry, including code snippets, to improve the product. For a personal side project that's fine. For a client codebase under a confidentiality agreement, or a repository containing regulated data, it's a decision for whoever owns that agreement, not the individual developer. Since there are no organisation-level controls in the preview, the only lever you have is policy. Before anyone opens a sensitive repository, each developer should check the telemetry settings and read the preview terms themselves, and your team policy should state which telemetry setting is required.

## How I'd run a trial

If you want evidence rather than opinions, keep it small and deliberate:

1. **Pick the right code.** Internal tools, test suites and greenfield prototypes. Not client code under NDA, not security-sensitive components, not anything with licensing obligations.
2. **Write the guardrails down.** Which repositories are in scope, that secrets and customer data never go in comments or files opened with Copilot active, and that accepted code gets the same review as hand-written code.
3. **Ask better questions than "is it faster?"** Did it reduce time on boilerplate? Did reviewers find more or fewer issues? Did anyone accept something they didn't understand?
4. **Plan for the preview ending.** Pricing, terms and enterprise controls are all unknown. Don't build a workflow that assumes today's free, individual access continues unchanged.

## When not to use it

Turn it off, or don't start, when the code is confidential under a contract that restricts sharing it with third-party services, when you're working in a domain where subtle correctness errors are expensive (financial calculations, access control, cryptography), or when you're learning a language. In that last case, Copilot removes exactly the struggle that builds understanding. Juniors benefit from it only after they can spot a wrong suggestion on sight.

## The verdict

Copilot is the first AI coding tool I'd call genuinely useful day to day, and it's still a preview with no organisation controls, no announced pricing and open IP questions. Treat it as a fast typist with a good memory and no judgement: let it handle the code you could write yourself without thinking, keep it away from code that needs thinking, and make sure the person pressing Tab is accountable for the result. If you're also watching what OpenAI's models can do on Azure, my notes on [Azure OpenAI Service](/blog/2021-11-13-azure-openai-service-updates/) cover the enterprise side of the same technology.
