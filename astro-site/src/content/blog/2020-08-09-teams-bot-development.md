---
title: "Building a Microsoft Teams Bot with Bot Framework v4 and .NET Core"
description: "A practical path from echo bot to Teams: TeamsActivityHandler, Adaptive Cards, proactive messages, Bot Channels Registration and the app manifest."
author: Michael John Peña
draft: false
date: 2020-08-09
tags:
  - Microsoft Teams
  - Bot Framework
  - .NET Core
  - C#
  - Azure
---

With most organisations now working from home, Teams has become the place where work happens, and people keep asking for a bot that can answer questions, post alerts or kick off a process without anyone leaving the chat. Building one is mostly ordinary ASP.NET Core code. The hard part is the plumbing between your code, Azure and Teams, and that is where first-time projects lose days.

My recommended stack today is the Bot Framework SDK v4 for .NET (4.9, released in May 2020) on .NET Core 3.1 LTS, wired up by hand once before you reach for any tooling.

## Decide whether you need a bot at all

A bot is a conversational endpoint. Teams sends your web service an HTTP POST for every message, mention or card click, and you reply. That suits question-and-answer, notifications that people can act on, and short guided workflows.

It is the wrong tool for a few common requests:

| Need | Better fit in Teams today |
|---|---|
| Post one-way notifications into a channel | Incoming webhook connector, or Power Automate |
| A rich UI with forms, grids and navigation | A tab (your web app inside Teams) |
| Look something up and insert it into a message | A messaging extension (which is also a bot under the hood) |
| A simple approval or reminder flow | Power Automate with the Teams connector |

If the answer is "we just want messages in a channel", stop here and use a webhook. A bot adds an Azure AD app registration, a hosted service and an app package to maintain.

One more trade-off decides a lot of projects: a bot can only message a person after the app is installed for that person. For a notification bot aimed at the whole organisation, that means pushing the install yourself, either through a Teams app setup policy in the admin centre or by [installing the app for users through Microsoft Graph](https://github.com/MicrosoftDocs/msteams-docs/blob/b749b967efa7fcea09af3be32fe1759f3ca376e9/msteams-platform/bots/how-to/conversations/send-proactive-messages.md#proactively-install-your-app-using-graph), which the Teams docs flag as beta. Budget for that admin conversation early.

## The moving parts

A Teams bot has four pieces, and each is worth understanding before you write business logic:

1. **Your bot service**: an ASP.NET Core app exposing `/api/messages`.
2. **An Azure AD app registration**: its application ID and secret identify the bot. It must be a multi-tenant registration; the Bot Framework does not accept single-tenant apps.
3. **A Bot Channels Registration** in Azure Bot Service: it maps the app ID to your HTTPS endpoint and enables the Microsoft Teams channel.
4. **A Teams app package**: a zip containing `manifest.json` and two icons, which you sideload or publish to your organisation's app catalogue.

## Start from the echo bot template

The echo bot `dotnet new` template is the right starting point because it already contains the adapter, error handler and controller wiring.

```bash
dotnet new -i Microsoft.Bot.Framework.CSharp.EchoBot
dotnet new echobot -n MyTeamsBot
cd MyTeamsBot
dotnet add package AdaptiveCards --version 1.2.4
```

I pin AdaptiveCards to 1.2.4 deliberately. Version 2.0.0 landed on NuGet on 4 August and targets schema 1.3, which Teams doesn't render yet.

The template's bot class derives from `ActivityHandler`. For Teams, switch it to `TeamsActivityHandler` from `Microsoft.Bot.Builder.Teams` (in the core `Microsoft.Bot.Builder` package since 4.6). It adds Teams-specific events such as channel creation, team renames, member changes with Teams user details, and messaging extension and task module invokes.

Delete `Bots/EchoBot.cs`, then point the dependency injection at the new class in `Startup.ConfigureServices`. This fragment shows only the lines that change; the template's adapter and controller registrations stay as they are.

```csharp
// Startup.ConfigureServices (fragment): replace the EchoBot registration
services.AddTransient<IBot, TeamsBot>();

// Used by the proactive messaging section below
services.AddSingleton<IConversationReferenceStore, InMemoryConversationReferenceStore>();
services.AddSingleton<ProactiveMessageService>();
```

`InMemoryConversationReferenceStore` is a stub, shown in the proactive section, so the project compiles; swap it for a durable store before production.

```csharp
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Bot.Builder;
using Microsoft.Bot.Builder.Teams;
using Microsoft.Bot.Schema;
using Newtonsoft.Json.Linq;

public partial class TeamsBot : TeamsActivityHandler
{
    protected override async Task OnMessageActivityAsync(
        ITurnContext<IMessageActivity> turnContext,
        CancellationToken cancellationToken)
    {
        // Capture the reference on every message too, so users who installed
        // the app before the store existed (or before a data loss) stay reachable.
        var reference = turnContext.Activity.GetConversationReference();
        var key = ConversationKey(reference);
        reference.Conversation.Id = key; // store the channel, not this reply chain
        await _references.SaveAsync(key, reference, cancellationToken);

        // Action.Submit on a card arrives as a message with Value set and no Text.
        if (turnContext.Activity.Value is JObject submit)
        {
            var action = submit.Value<string>("action");
            if (action == "status")
            {
                await SendStatusAsync(turnContext, cancellationToken);
            }
            return;
        }

        // In channels the text includes "<at>BotName</at>"; strip it before matching.
        turnContext.Activity.RemoveRecipientMention();
        var text = turnContext.Activity.Text?.Trim().ToLowerInvariant();

        switch (text)
        {
            case "help":
                await SendHelpCardAsync(turnContext, cancellationToken);
                break;
            case "status":
                await SendStatusAsync(turnContext, cancellationToken);
                break;
            default:
                await turnContext.SendActivityAsync(
                    MessageFactory.Text($"You said: {text}. Type 'help' for commands."),
                    cancellationToken);
                break;
        }
    }

    protected override async Task OnMembersAddedAsync(
        IList<ChannelAccount> membersAdded,
        ITurnContext<IConversationUpdateActivity> turnContext,
        CancellationToken cancellationToken)
    {
        var botId = turnContext.Activity.Recipient.Id;
        var isPersonal = turnContext.Activity.Conversation.ConversationType == "personal";

        foreach (var member in membersAdded)
        {
            // Welcome a user only in a 1:1 chat, and a team only once, when the bot itself is added.
            var shouldWelcome = isPersonal ? member.Id != botId : member.Id == botId;
            if (shouldWelcome)
            {
                await turnContext.SendActivityAsync(
                    MessageFactory.Text("Hi! Type 'help' (or @mention me in a channel) to see what I can do."),
                    cancellationToken);
            }
        }
    }

    private Task SendStatusAsync(ITurnContext turnContext, CancellationToken cancellationToken) =>
        turnContext.SendActivityAsync(MessageFactory.Text("All systems normal."), cancellationToken);
}
```

The mention markup is the first bug most Teams bots ship with. In a channel the bot only receives messages where it is @mentioned, and the markup is part of `Text`, so a `switch` on raw text fails in channels while working in personal chat. `RemoveRecipientMention()` fixes that. The second trap: an `Action.Submit` button raises no separate event; it arrives as an ordinary message with the button's `data` in `Activity.Value`. `Action.OpenUrl` never reaches the bot at all.

The welcome logic is deliberate. Teams sends a members-added event whenever someone joins a team, so the template's greeting would post into the channel for everyone. Greet individuals only in personal scope, and introduce the bot once per team.

### Know who is asking

The display name in `Activity.From.Name` is not an identity: it can change, and two people can share one. `Activity.From.AadObjectId` gives you the caller's Azure AD object ID, and `TeamsInfo.GetMemberAsync(turnContext, turnContext.Activity.From.Id)` returns a `TeamsChannelAccount` with the user principal name, email and tenant ID. Authorise against the object ID and the tenant, never the name. If the bot needs to call Graph or your own API *as* the user, that is a separate step: an OAuth connection on the bot registration and an `OAuthPrompt`, which shows the user a sign-in card.

## Adaptive Cards: target 1.2

Teams renders Adaptive Cards up to schema 1.2 (the [Teams cards reference](https://github.com/MicrosoftDocs/msteams-docs/blob/65cd1091faa3cb6f7089079b1889a27a585ac589/msteams-platform/task-modules-and-cards/cards/cards-reference.md) points to v1.2.0 and notes media elements aren't supported yet), so build to 1.2 even if the designer offers newer elements; anything Teams can't render will show as a fallback or an error.

```csharp
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using AdaptiveCards;
using Microsoft.Bot.Builder;
using Microsoft.Bot.Schema;

public partial class TeamsBot
{
    private static async Task SendHelpCardAsync(
        ITurnContext turnContext,
        CancellationToken cancellationToken)
    {
        var card = new AdaptiveCard(new AdaptiveSchemaVersion(1, 2))
        {
            Body = new List<AdaptiveElement>
            {
                new AdaptiveTextBlock
                {
                    Text = "Teams Bot Help",
                    Size = AdaptiveTextSize.Large,
                    Weight = AdaptiveTextWeight.Bolder
                },
                new AdaptiveFactSet
                {
                    Facts = new List<AdaptiveFact>
                    {
                        new AdaptiveFact("help", "Show this message"),
                        new AdaptiveFact("status", "Check system status")
                    }
                }
            },
            Actions = new List<AdaptiveAction>
            {
                new AdaptiveSubmitAction
                {
                    Title = "Get status",
                    Data = new { action = "status" }
                }
            }
        };

        var attachment = new Attachment
        {
            ContentType = AdaptiveCard.ContentType,
            Content = card
        };

        await turnContext.SendActivityAsync(
            MessageFactory.Attachment(attachment),
            cancellationToken);
    }
}
```

Keep cards small. A card that needs scrolling on mobile belongs in a task module or a tab.

## Proactive messages: store the conversation reference

Ask a team what they want from a bot and "ping me when X happens" usually comes first. A bot cannot message someone without a conversation, and it cannot create one unless the app is installed for that user or team. The reliable pattern is to capture a `ConversationReference` when the bot is installed or first messaged, persist it, and use it later.

Installation raises a conversation update, so that is the natural place to capture the reference; the message handler above saves it too, as a safety net. Calling the base implementation keeps `OnMembersAddedAsync` and the other Teams events firing.

Watch the key. In a channel, `Conversation.Id` carries a `;messageid=...` suffix per reply chain, so keying on the raw ID stores one reference per thread and a broadcast posts the same alert into every thread anyone used with the bot. Strip the suffix from both the key and the stored `Conversation.Id` to get one reference per channel, so a broadcast posts a new top-level message. Removal matters too: when the app is uninstalled or the bot removed from a team, Teams sends a members-removed update containing the bot's ID, and `OnTeamsMembersRemovedAsync` is where to delete the reference.

```csharp
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Bot.Builder;
using Microsoft.Bot.Schema;
using Microsoft.Bot.Schema.Teams;

public interface IConversationReferenceStore
{
    Task SaveAsync(string key, ConversationReference reference, CancellationToken cancellationToken);
    Task DeleteAsync(string key, CancellationToken cancellationToken);
    Task<IReadOnlyList<ConversationReference>> GetAllAsync(CancellationToken cancellationToken);
}

// Stub so the project builds. Replace before production: a restart empties it.
public class InMemoryConversationReferenceStore : IConversationReferenceStore
{
    private readonly ConcurrentDictionary<string, ConversationReference> _items =
        new ConcurrentDictionary<string, ConversationReference>();

    public Task SaveAsync(string key, ConversationReference reference, CancellationToken cancellationToken)
    {
        _items[key] = reference;
        return Task.CompletedTask;
    }

    public Task DeleteAsync(string key, CancellationToken cancellationToken)
    {
        _items.TryRemove(key, out _);
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<ConversationReference>> GetAllAsync(CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<ConversationReference>>(_items.Values.ToList());
}

public partial class TeamsBot
{
    private readonly IConversationReferenceStore _references;

    public TeamsBot(IConversationReferenceStore references)
    {
        _references = references;
    }

    // One key per 1:1 chat, group chat or channel: drop the ";messageid=..." thread suffix.
    public static string ConversationKey(ConversationReference reference) =>
        reference.Conversation.Id.Split(';')[0];

    protected override async Task OnConversationUpdateActivityAsync(
        ITurnContext<IConversationUpdateActivity> turnContext,
        CancellationToken cancellationToken)
    {
        var botId = turnContext.Activity.Recipient.Id;
        var botRemoved = turnContext.Activity.MembersRemoved?.Any(m => m.Id == botId) == true;
        if (!botRemoved)
        {
            var reference = turnContext.Activity.GetConversationReference();
            var key = ConversationKey(reference);
            reference.Conversation.Id = key;
            await _references.SaveAsync(key, reference, cancellationToken);
        }

        await base.OnConversationUpdateActivityAsync(turnContext, cancellationToken);
    }

    protected override async Task OnTeamsMembersRemovedAsync(
        IList<TeamsChannelAccount> membersRemoved,
        TeamInfo teamInfo,
        ITurnContext<IConversationUpdateActivity> turnContext,
        CancellationToken cancellationToken)
    {
        var botId = turnContext.Activity.Recipient.Id;
        if (membersRemoved.Any(m => m.Id == botId))
        {
            var reference = turnContext.Activity.GetConversationReference();
            await _references.DeleteAsync(ConversationKey(reference), cancellationToken);
        }
    }
}
```

The service that sends the notification later only needs the adapter, the app ID and a stored reference.

```csharp
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Bot.Builder;
using Microsoft.Bot.Builder.Integration.AspNet.Core;
using Microsoft.Bot.Connector.Authentication;
using Microsoft.Bot.Schema;
using Microsoft.Extensions.Configuration;

public class ProactiveMessageService
{
    private readonly BotAdapter _adapter;
    private readonly string _appId;

    public ProactiveMessageService(IBotFrameworkHttpAdapter adapter, IConfiguration configuration)
    {
        _adapter = (BotAdapter)adapter;
        _appId = configuration["MicrosoftAppId"];
    }

    public Task SendAsync(ConversationReference reference, string message, CancellationToken cancellationToken)
    {
        // SDK 4.9 only trusts service URLs it has seen in this process.
        MicrosoftAppCredentials.TrustServiceUrl(reference.ServiceUrl);

        return _adapter.ContinueConversationAsync(
            _appId,
            reference,
            (turnContext, ct) => turnContext.SendActivityAsync(MessageFactory.Text(message), ct),
            cancellationToken);
    }
}
```

Something has to trigger the send. A small controller is enough to start with. Isolate each send so one bad recipient can't stop the rest. Teams returns 403 Forbidden once the bot has been removed from a conversation, which is the signal to delete the reference; that also catches anything the removal handler missed, such as other channels in a team the bot has left.

```csharp
using System;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Bot.Schema;
using Microsoft.Extensions.Logging;

public class NotifyRequest
{
    public string Message { get; set; }
}

[Route("api/notify")]
[ApiController]
public class NotifyController : ControllerBase
{
    private readonly IConversationReferenceStore _references;
    private readonly ProactiveMessageService _sender;
    private readonly ILogger<NotifyController> _logger;

    public NotifyController(
        IConversationReferenceStore references,
        ProactiveMessageService sender,
        ILogger<NotifyController> logger)
    {
        _references = references;
        _sender = sender;
        _logger = logger;
    }

    [HttpPost]
    public async Task<IActionResult> PostAsync([FromBody] NotifyRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request?.Message))
        {
            return BadRequest();
        }

        // Add 429 backoff and pacing here, or hand the work to a queue.
        foreach (var reference in await _references.GetAllAsync(cancellationToken))
        {
            var key = TeamsBot.ConversationKey(reference);
            try
            {
                await _sender.SendAsync(reference, request.Message, cancellationToken);
            }
            catch (ErrorResponseException ex) when (ex.Response?.StatusCode == HttpStatusCode.Forbidden)
            {
                // The bot was uninstalled or removed from this conversation.
                await _references.DeleteAsync(key, cancellationToken);
            }
            catch (ErrorResponseException ex)
            {
                _logger.LogWarning(ex, "Proactive send to {Key} failed with {Status}", key, ex.Response?.StatusCode);
            }
        }

        return Accepted();
    }
}
```

Callers POST `{ "message": "..." }`. Protect that endpoint (an API key or Azure AD) before it leaves your machine; as written, anyone who finds the URL can message your users. And replace the stub with a real store, such as Table storage through `Microsoft.Azure.Cosmos.Table` or Cosmos DB, or every restart of the App Service loses your audience. A reference reloaded after a restart needs that `TrustServiceUrl` call or Teams returns 401. Microsoft's [proactive messaging guide for Teams](https://github.com/MicrosoftDocs/msteams-docs/blob/b749b967efa7fcea09af3be32fe1759f3ca376e9/msteams-platform/bots/how-to/conversations/send-proactive-messages.md) also explains how to create a new conversation when you only have a user's ID, which requires the app to be installed for that user.

Broadcast is where notification bots break. Teams [rate-limits bot messages](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/rate-limit) per bot per conversation, and a loop that posts to hundreds of conversations at once will start getting `HTTP 429 Too Many Requests`. Catch the 429, retry with exponential backoff, and pace large sends rather than firing a tight `foreach`. Microsoft publishes per-thread figures (about 7 messages a second, 60 every 30 seconds) but says the exact values are subject to change, so code for the 429 rather than the number.

That is also where this controller stops being the right shape. Past a few hundred conversations a paced loop runs for minutes: the caller times out, and a restart kills the loop halfway with no record of who got the message. Put one queue message per recipient on a Storage queue or Service Bus and let a queue-triggered Azure Function or WebJob do the sending.

## Register and deploy to Azure

The Bot Channels Registration is cheap to get right from the CLI. The F0 SKU is fine for Teams: Teams is a standard channel, so its messages don't count against the premium-channel allowance.

```bash
# 1. Multi-tenant Azure AD app for the bot identity
az ad app create --display-name my-teams-bot --available-to-other-tenants
az ad app credential reset --id <your-app-id> --append

# 2. App Service for the bot code
az group create --name rg-bots --location australiaeast
az appservice plan create --resource-group rg-bots --name plan-bots --sku B1
az webapp create --resource-group rg-bots --plan plan-bots \
    --name <your-bot-webapp> --runtime "DOTNETCORE|3.1"
az webapp config appsettings set --resource-group rg-bots --name <your-bot-webapp> \
    --settings MicrosoftAppId=<your-app-id> MicrosoftAppPassword=<your-app-secret>

# 3. Bot Channels Registration pointing at the App Service, plus the Teams channel
az bot create --resource-group rg-bots --name my-teams-bot \
    --kind registration --sku F0 --appid <your-app-id> \
    --endpoint https://<your-bot-webapp>.azurewebsites.net/api/messages
az bot msteams create --resource-group rg-bots --name my-teams-bot

# 4. Publish the code
dotnet publish -c Release -o ./publish
(cd publish && zip -r ../bot.zip .)
az webapp deployment source config-zip --resource-group rg-bots \
    --name <your-bot-webapp> --src bot.zip
```

Store the secret in Key Vault or at least in App Service settings, never in `appsettings.json` in source control.

## The Teams app manifest

Teams needs an app package before anyone can talk to the bot. Use manifest schema 1.7, the version the Teams documentation describes at the time of writing. The `id` is a GUID for the Teams app, and `botId` is your Azure AD application ID. App Studio inside Teams can generate and validate this for you, which I recommend for a first attempt.

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/teams/v1.7/MicrosoftTeams.schema.json",
  "manifestVersion": "1.7",
  "version": "1.0.0",
  "id": "<your-teams-app-guid>",
  "packageName": "com.example.teamsbot",
  "developer": {
    "name": "Contoso",
    "websiteUrl": "https://example.com",
    "privacyUrl": "https://example.com/privacy",
    "termsOfUseUrl": "https://example.com/terms"
  },
  "name": { "short": "Ops Bot", "full": "Ops Bot for Teams" },
  "description": {
    "short": "Status and help for the ops team",
    "full": "Answers status questions and posts notifications for the operations team."
  },
  "icons": { "outline": "outline.png", "color": "color.png" },
  "accentColor": "#FFFFFF",
  "bots": [
    {
      "botId": "<your-app-id>",
      "scopes": ["personal", "team", "groupchat"],
      "supportsFiles": false,
      "isNotificationOnly": false,
      "commandLists": [
        {
          "scopes": ["personal", "team"],
          "commands": [
            { "title": "help", "description": "Show help" },
            { "title": "status", "description": "Check status" }
          ]
        }
      ]
    }
  ],
  "validDomains": []
}
```

The colour icon is 192x192 and the outline icon is a 32x32 transparent PNG. Zip the three files at the root (no folder) and upload through "Upload a custom app". If that option is missing, your tenant admin has disabled sideloading; it is a policy, not a bug. The [v1.7 manifest schema reference](https://github.com/MicrosoftDocs/msteams-docs/blob/b749b967efa7fcea09af3be32fe1759f3ca376e9/msteams-platform/resources/schema/manifest-schema.md) lists every field.

## Local development with ngrok

The Bot Framework Emulator is useful for logic, but it does not behave like Teams: no mentions, no Teams member details, no team context. Test in Teams early by tunnelling to your machine.

```bash
dotnet run
ngrok http 3978 -host-header="localhost:3978"
```

Point the registration's messaging endpoint at `https://<your-subdomain>.ngrok.io/api/messages` while you develop. On the free ngrok plan the subdomain changes with every restart, so use a separate dev registration and Teams app, used only by you, and keep that churn away from the real bot.

The Teams Toolkit for Visual Studio Code, announced at Build 2020, automates parts of this setup but is still in preview. I'd learn the manual path once so you know what the toolkit is doing for you.

## Where to start

Get the simplest possible echo bot deployed end to end *first*, from local code to channel registration to Teams sideload, before you write a line of business logic. The plumbing is where the time goes.

After that, build in this order: strip mentions, add cards and handle their submits, then persist conversation references for notifications. If your requirement turns out to be one-way notifications, swap the bot for a webhook and save yourself the maintenance.
