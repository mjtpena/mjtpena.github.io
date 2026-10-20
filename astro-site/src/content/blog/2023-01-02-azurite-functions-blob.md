---
title: "Debugging an Azure Functions Blob Trigger Locally with Azurite"
description: "Run and debug an isolated .NET Azure Functions blob trigger against Azurite, and understand the receipts, retries and limits of local testing."
author: Michael John Peña
draft: false
date: 2023-01-02
url: /blog/azurite-functions-blob/
tags:
  - Azure Functions
  - Storage
  - .NET
  - Testing
  - Azure
---

Blob triggers are one of the easiest Azure Functions to write and one of the most annoying to debug. Every change means uploading a file and waiting, and if your only option is a real storage account you end up sharing a dev account with the team, fighting over containers and paying for the privilege. Azurite, Microsoft's open-source storage emulator, removes that loop: the whole trigger pipeline runs on your laptop, and you can put a breakpoint on the first line of your function. The catch is that a local run can mislead you unless you understand how the trigger tracks receipts and retries: a blob that already has a receipt won't fire again after a restart, so this post covers both.

## Why Azurite and not the old emulator

The Azure Storage Emulator only ran on Windows and has been deprecated in favour of [Azurite](https://learn.microsoft.com/en-us/azure/storage/common/storage-use-azurite). Azurite is cross-platform, runs from npm, Docker or as a Visual Studio Code extension, and ships with Visual Studio 2022. At the start of January 2023 the current release is 3.20.1 (see the [Azurite changelog](https://github.com/Azure/Azurite/blob/main/ChangeLog.md)), which emulates the Blob and Queue services, with Table support still in preview.

That cross-platform point matters to me: I built this sample in Rider on a Mac, where the old emulator was never an option.

## Setting up Azurite

Pick one of the two install methods. npm is the lightest if you already have Node.js installed:

```bash
npm install -g azurite
```

Docker keeps your machine clean and is what I'd use in a team devcontainer:

```bash
docker pull mcr.microsoft.com/azure-storage/azurite
```

Then start it. With npm, give it an explicit workspace folder so its data files don't end up wherever your terminal happens to be:

```bash
mkdir -p ~/azurite
azurite --silent --location ~/azurite --debug ~/azurite/debug.log
```

With Docker, map the three service ports and mount a folder so your blobs survive a container restart:

```bash
docker run -p 10000:10000 -p 10001:10001 -p 10002:10002 \
    -v ~/azurite:/data mcr.microsoft.com/azure-storage/azurite
```

On Windows, swap `~/azurite` for a path such as `c:/azurite`.

Blob listens on port 10000, Queue on 10001 and Table on 10002. Azurite doesn't create any containers for you. It exposes a single well-known development account, `devstoreaccount1`, with a fixed, publicly documented key. That key is not a secret, which is exactly why it must never appear in anything that points at a real account.

### Run all services, not just Blob

Azurite also ships `azurite-blob` if you only want the Blob service. Don't use it for Functions. The Functions host uses storage for more than your trigger: it keeps locks and blob receipts in Blob storage, and the blob trigger dispatches work and records poison blobs through Storage queues. Start only Blob and the host fails in confusing ways. Run plain `azurite` (or the default Docker image) so Queue is available too.

## Pointing the Functions host at Azurite

In `local.settings.json`, set `AzureWebJobsStorage` to the development storage shortcut:

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "dotnet-isolated"
  }
}
```

`UseDevelopmentStorage=true` expands to the `devstoreaccount1` account on `127.0.0.1` with the default ports, so you don't need a full connection string.

The trigger below doesn't set a `Connection` property, so it falls back to `AzureWebJobsStorage`. In Azure I'd point the trigger at a separate, named connection setting so the host's own bookkeeping and your data don't share an account. Locally, one Azurite instance for both is fine.

A note on what I've actually verified: I got this working with the **isolated worker** model, in Rider on macOS. I haven't tested the in-process model on Windows with the same setup, so treat that combination as unconfirmed.

## The function

The project targets the [isolated worker model](https://learn.microsoft.com/en-us/azure/azure-functions/dotnet-isolated-process-guide), which is the only way to run .NET 7 on Functions; .NET 7 support went GA in November 2022 (in-process tops out at .NET 6). These are the current stable package versions as of January 2023 (Worker 1.10.0 is the minimum Microsoft lists for .NET 7; the linked sample predates that bump and still references 1.8.0). The full project file:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net7.0</TargetFramework>
    <AzureFunctionsVersion>v4</AzureFunctionsVersion>
    <OutputType>Exe</OutputType>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.Azure.Functions.Worker" Version="1.10.0" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.Sdk" Version="1.7.0" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.Extensions.Storage.Blobs" Version="5.0.1" />
  </ItemGroup>
  <ItemGroup>
    <None Update="host.json" CopyToOutputDirectory="PreserveNewest" />
    <None Update="local.settings.json" CopyToOutputDirectory="PreserveNewest" CopyToPublishDirectory="Never" />
  </ItemGroup>
</Project>
```

The project copies `host.json` to the output folder, so it needs one. A minimal version is enough for this sample:

```json
{
  "version": "2.0",
  "logging": {
    "logLevel": {
      "default": "Information"
    }
  }
}
```

`Program.cs` is the standard isolated host:

```csharp
using Microsoft.Extensions.Hosting;

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults()
    .Build();

host.Run();
```

And the trigger:

```csharp
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

namespace BlobTrigger.Functions;

public class BlobTriggerFunction
{
    private readonly ILogger<BlobTriggerFunction> _logger;

    public BlobTriggerFunction(ILogger<BlobTriggerFunction> logger)
    {
        _logger = logger;
    }

    [Function("BlobTriggerFunction")]
    public void Run(
        [BlobTrigger("test-samples-trigger/{name}")] string content,
        string name)
    {
        _logger.LogInformation(
            "Blob trigger processed {Name} ({Length} characters)",
            name, content.Length);
    }
}
```

The `{name}` token in the path is a binding expression, and the isolated worker makes it available as a `string name` parameter. The blob content binds to `string` here, which is fine for small text files. The isolated worker can bind a blob trigger to `string`, `byte[]` or a JSON-deserialised POCO, and all three load the whole blob into memory, so keep triggered blobs small. If you need streaming access to large files, the in-process model's `Stream` binding is one option. The isolated workaround is to bind the trigger to something cheap, take the `{name}` value, and read the blob yourself with `Azure.Storage.Blobs` (`BlobClient.OpenReadAsync`). The trade-off is that the trigger still loads the triggering blob's content, so this only pays off when the trigger fires on a small marker blob that points at the large one, or when you switch to an Event Grid trigger instead.

## Creating the container and dropping a file

You need a container named `test-samples-trigger` before the trigger has anything to watch. The quickest way is [Azure Storage Explorer](https://learn.microsoft.com/en-us/azure/storage/storage-explorer/vs-azure-tools-storage-manage-with-storage-explorer). Open it, expand **Emulator & Attached** > **Storage Accounts**, and the local emulator account appears when Azurite is running on the default ports. Under **Blob Containers**, create `test-samples-trigger`.

Start the function from Rider, Visual Studio or Visual Studio Code with the Azure Functions extension (all three drive Azure Functions Core Tools v4 under the hood). Once the host is up and your breakpoint is set, upload a file to the container in Storage Explorer. The debugger stops in `Run`, and you can inspect `name` and `content`.

## What the blob trigger is actually doing

This is the part that trips people up, and it's worth understanding before you trust a local result. The [standard blob trigger](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-storage-blob-trigger) is not push-based. The host polls the container (in Azure it also reads Storage analytics logs; Azurite doesn't produce those, so locally it is a pure container scan) and tracks what it has already processed by writing **blob receipts** to the `azure-webjobs-hosts` container. A receipt is keyed on the blob's name and ETag.

That has a few practical consequences when you're debugging:

- **Re-uploading the same file triggers again**, because overwriting a blob changes its ETag.
- **Restarting the host does not reprocess existing blobs** that already have receipts. If you want to replay a blob without changing it, delete its receipt under `azure-webjobs-hosts` in Storage Explorer.
- **Deletes don't fire the trigger.** It reacts to new and updated blobs only.
- **Failures retry, then go to a poison queue.** By default the host tries a blob five times. After that it writes a message to the `webjobs-blobtrigger-poison` queue, which you can see in Azurite's Queue service. Throw an exception in your function and watch it happen.

Seeing these mechanics locally is one of the best reasons to use Azurite. They behave the same way in Azure, and they answer most "why didn't my function run?" questions before you need to ask them.

### Where local testing stops being representative

Latency is the big difference. Against a handful of blobs in Azurite, the trigger fires within seconds. In Azure, the [blob trigger documentation](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-storage-blob-trigger) warns that on the Consumption plan there can be up to a 10-minute delay in processing new blobs when the app has gone idle, and scanning gets slower as containers grow. If latency matters, version 5.x of the Storage extension supports an Event Grid source for the blob trigger in the in-process model and in non-.NET languages, where Blob storage pushes events to your function instead of being polled. The isolated worker doesn't expose it yet, so an isolated app would use an Event Grid trigger directly. Either way, you can't reproduce it with Azurite alone, because Azurite doesn't raise Event Grid events.

Version drift is the other gotcha. Azurite validates the storage API version that the client sends. If your SDK is newer than your Azurite release, requests fail with an error saying the API version isn't supported. Update Azurite first. If you can't, start it with `--skipApiVersionCheck`, but treat that as a stopgap: you're then testing against an emulator that doesn't know about the newer API's behaviour.

Finally, Azurite is a functional emulator, not a performance or security one. It won't tell you anything about throughput limits, private endpoints, managed identity, or firewall rules. Those need a real account.

## When I'd reach for this, and when I wouldn't

Use Azurite for the inner loop: writing the function, stepping through parsing logic, and checking retry and poison handling, all without touching a shared account. It's also the right default for a devcontainer or for integration tests in CI, because it's free and disposable.

In CI, run Azurite as a Docker service container next to the job rather than installing it on the build agent. In GitHub Actions that's a `services:` entry using `mcr.microsoft.com/azure-storage/azurite` with port 10000 (and 10001 for queues) mapped, and your tests use `UseDevelopmentStorage=true` exactly as they do locally. Don't mount a volume there: a fresh container per run gives every test run an empty account, so leftover blobs and receipts from a previous run can't make a trigger silently skip. Locally, get the same reset by pointing `--location` at a new or emptied folder before a test run.

Don't use it to sign off on behaviour that depends on the cloud: trigger latency at scale, Event Grid-based triggers, identity-based connections or networking. For those, run against a real storage account in a dev subscription before you ship.

For more on the isolated model this sample uses, see my post on [Azure Functions with .NET 7 in the isolated worker](/blog/2022-11-03-azure-functions-dotnet-7-isolated/). If you're still weighing in-process against isolated, my earlier post on [Azure Functions with .NET 6](/blog/2021-11-05-azure-functions-dotnet6/) covers that choice, and it already uses Azurite for local storage.

The sample code is on GitHub: [mjtpena/AzureFunctions.Samples – BlobTrigger](https://github.com/mjtpena/AzureFunctions.Samples/tree/main/BlobTrigger).
