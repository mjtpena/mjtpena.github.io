---
title: "Building a Microsoft Teams Bot with Bot Framework"
author: Michael John Peña
draft: false
date: 2020-08-09
tags:
  - Microsoft Teams
  - Bot Framework
  - .NET Core
  - Remote Work

---

I wrote "Building a Microsoft Teams Bot with Bot Framework" to share practical, production-minded guidance on this topic.

## Prerequisites

- .NET Core 3.1 SDK
- Bot Framework SDK v4
- Azure subscription
- Microsoft Teams (for testing)

## Creating the Bot Project

```bash
# Install the Bot Framework templates
dotnet new -i Microsoft.Bot.Framework.CSharp.EchoBot

# Create a new bot
dotnet new echobot -n MyTeamsBot

cd MyTeamsBot
```

## Understanding the Bot Structure

The main bot class handles incoming activities:

```csharp
using Microsoft.Bot.Builder;
using Microsoft.Bot.Builder.Teams;
using Microsoft.Bot.Schema;
using Microsoft.Bot.Schema.Teams;

public class TeamsBot : TeamsActivityHandler
{
    protected override async Task OnMessageActivityAsync(
        ITurnContext<IMessageActivity> turnContext,
        CancellationToken cancellationToken)
    {
        var text = turnContext.Activity.Text?.Trim().ToLower();

        switch (text)
        {
            case "help":
                await SendHelpCardAsync(turnContext, cancellationToken);
                break;
            case "status":
                await SendStatusAsync(turnContext, cancellationToken);
                break;
            default:
                var reply = $"You said: {turnContext.Activity.Text}";
                await turnContext.SendActivityAsync(
                    MessageFactory.Text(reply),
                    cancellationToken);
                break;
        }
    }

    protected override async Task OnMembersAddedAsync(
        IList<ChannelAccount> membersAdded,
        ITurnContext<IConversationUpdateActivity> turnContext,
        CancellationToken cancellationToken)
    {
        foreach (var member in membersAdded)
        {
            if (member.Id != turnContext.Activity.Recipient.Id)
            {
                await turnContext.SendActivityAsync(
                    MessageFactory.Text("Welcome to the team! Type 'help' to get started."),
                    cancellationToken);
            }
        }
    }
}
```

## Building Adaptive Cards

Create rich interactive messages:

```csharp
private async Task SendHelpCardAsync(
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
            new AdaptiveTextBlock
            {
                Text = "Available commands:",
                Wrap = true
            },
            new AdaptiveFactSet
            {
                Facts = new List<AdaptiveFact>
                {
                    new AdaptiveFact("help", "Show this help message"),
                    new AdaptiveFact("status", "Check system status"),
                    new AdaptiveFact("report", "Generate a report")
                }
            }
        },
        Actions = new List<AdaptiveAction>
        {
            new AdaptiveSubmitAction
            {
                Title = "Get Status",
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
```

## Handling Card Actions

```csharp
protected override async Task<InvokeResponse> OnAdaptiveCardInvokeAsync(
    ITurnContext<IInvokeActivity> turnContext,
    AdaptiveCardInvokeValue invokeValue,
    CancellationToken cancellationToken)
{
    var action = invokeValue.Action?.Data?.ToString();
    var data = JsonConvert.DeserializeObject<CardActionData>(action);

    switch (data?.Action)
    {
        case "status":
            await SendStatusAsync(turnContext, cancellationToken);
            break;
    }

    return new InvokeResponse { Status = 200 };
}

public class CardActionData
{
    public string Action { get; set; }
}
```

## Proactive Messages

Send messages without user interaction:

```csharp
public class ProactiveMessageService
{
    private readonly IBotFrameworkHttpAdapter _adapter;
    private readonly string _appId;

    public async Task SendProactiveMessageAsync(
        ConversationReference reference,
        string message)
    {
        await ((BotAdapter)_adapter).ContinueConversationAsync(
            _appId,
            reference,
            async (turnContext, cancellationToken) =>
            {
                await turnContext.SendActivityAsync(message);
            },
            CancellationToken.None);
    }
}
```

## Deploying to Azure

```bash
# Create a Bot Channels Registration
az bot create \
    --resource-group rg-bots \
    --name my-teams-bot \
    --kind registration \
    --sku F0 \
    --endpoint https://my-teams-bot.azurewebsites.net/api/messages

# Deploy the web app
az webapp up \
    --resource-group rg-bots \
    --name my-teams-bot \
    --runtime "DOTNETCORE:3.1"
```

## Teams App Manifest

Create `manifest.json` for Teams:

```json
{
    "$schema": "https://developer.microsoft.com/en-us/json-schemas/teams/v1.7/MicrosoftTeams.schema.json",
    "manifestVersion": "1.7",
    "version": "1.0.0",
    "id": "your-app-id",
    "packageName": "com.company.teamsbot",
    "developer": {
        "name": "Your Company",
        "websiteUrl": "https://example.com",
        "privacyUrl": "https://example.com/privacy",
        "termsOfUseUrl": "https://example.com/terms"
    },
    "name": {
        "short": "My Teams Bot",
        "full": "My Teams Bot for Automation"
    },
    "description": {
        "short": "A helpful bot for your team",
        "full": "This bot helps automate common tasks and provides quick access to information."
    },
    "icons": {
        "outline": "outline.png",
        "color": "color.png"
    },
    "bots": [
        {
            "botId": "your-bot-id",
            "scopes": ["personal", "team", "groupchat"],
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
    ]
}
```

## Testing Locally

Use ngrok for local testing:

```bash
# Start ngrok
ngrok http 3978

# Update bot endpoint in Azure portal to ngrok URL
# https://xxxxx.ngrok.io/api/messages
```

My honest advice for anyone starting a Teams bot project: get the simplest possible echo bot deployed end-to-end *first* — local code → channel registration → Teams sideload — before you write a line of business logic. The plumbing is where the time goes. Once it's wired, the actual bot logic is the easy part.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
