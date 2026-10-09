---
title: "Azure Bot Service: Build Conversational AI"
description: "Azure Bot Service bridges AI and conversation."
author: Michael John Peña
draft: false
date: 2020-10-26
tags:
  - Azure
  - Bot Service
  - AI
  - Conversational
---

## Bot Framework SDK

```csharp
// Basic echo bot
public class EchoBot : ActivityHandler
{
    protected override async Task OnMessageActivityAsync(
        ITurnContext<IMessageActivity> turnContext,
        CancellationToken cancellationToken)
    {
        var userMessage = turnContext.Activity.Text;
        await turnContext.SendActivityAsync($"You said: {userMessage}");
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
                await turnContext.SendActivityAsync("Welcome! How can I help you?");
            }
        }
    }
}
```

## Dialog System

```csharp
public class OrderDialog : ComponentDialog
{
    public OrderDialog() : base(nameof(OrderDialog))
    {
        var waterfallSteps = new WaterfallStep[]
        {
            AskProductAsync,
            AskQuantityAsync,
            ConfirmOrderAsync,
            ProcessOrderAsync
        };

        AddDialog(new WaterfallDialog(nameof(WaterfallDialog), waterfallSteps));
        AddDialog(new TextPrompt(nameof(TextPrompt)));
        AddDialog(new NumberPrompt<int>(nameof(NumberPrompt<int>)));
        AddDialog(new ConfirmPrompt(nameof(ConfirmPrompt)));

        InitialDialogId = nameof(WaterfallDialog);
    }

    private async Task<DialogTurnResult> AskProductAsync(
        WaterfallStepContext stepContext, CancellationToken cancellationToken)
    {
        return await stepContext.PromptAsync(
            nameof(TextPrompt),
            new PromptOptions { Prompt = MessageFactory.Text("What product would you like?") },
            cancellationToken);
    }

    private async Task<DialogTurnResult> AskQuantityAsync(
        WaterfallStepContext stepContext, CancellationToken cancellationToken)
    {
        stepContext.Values["product"] = (string)stepContext.Result;

        return await stepContext.PromptAsync(
            nameof(NumberPrompt<int>),
            new PromptOptions { Prompt = MessageFactory.Text("How many?") },
            cancellationToken);
    }

    private async Task<DialogTurnResult> ConfirmOrderAsync(
        WaterfallStepContext stepContext, CancellationToken cancellationToken)
    {
        stepContext.Values["quantity"] = (int)stepContext.Result;

        var product = stepContext.Values["product"];
        var quantity = stepContext.Values["quantity"];

        return await stepContext.PromptAsync(
            nameof(ConfirmPrompt),
            new PromptOptions
            {
                Prompt = MessageFactory.Text($"Order {quantity}x {product}. Confirm?")
            },
            cancellationToken);
    }

    private async Task<DialogTurnResult> ProcessOrderAsync(
        WaterfallStepContext stepContext, CancellationToken cancellationToken)
    {
        if ((bool)stepContext.Result)
        {
            await stepContext.Context.SendActivityAsync("Order placed! Thank you.");
        }
        else
        {
            await stepContext.Context.SendActivityAsync("Order cancelled.");
        }

        return await stepContext.EndDialogAsync(cancellationToken: cancellationToken);
    }
}
```

## LUIS Integration

```csharp
public class LuisBot : ActivityHandler
{
    private readonly IRecognizer _recognizer;

    public LuisBot(IRecognizer recognizer)
    {
        _recognizer = recognizer;
    }

    protected override async Task OnMessageActivityAsync(
        ITurnContext<IMessageActivity> turnContext,
        CancellationToken cancellationToken)
    {
        var result = await _recognizer.RecognizeAsync(turnContext, cancellationToken);
        var topIntent = result.GetTopScoringIntent();

        switch (topIntent.intent)
        {
            case "OrderProduct":
                var product = result.Entities["product"]?.FirstOrDefault()?.ToString();
                await turnContext.SendActivityAsync($"I'll help you order {product}");
                break;

            case "CheckStatus":
                await turnContext.SendActivityAsync("Let me check your order status...");
                break;

            default:
                await turnContext.SendActivityAsync("I'm not sure what you mean.");
                break;
        }
    }
}
```

## Adaptive Cards

```csharp
var card = new AdaptiveCard(new AdaptiveSchemaVersion(1, 3))
{
    Body = new List<AdaptiveElement>
    {
        new AdaptiveTextBlock
        {
            Text = "Order Confirmation",
            Size = AdaptiveTextSize.Large,
            Weight = AdaptiveTextWeight.Bolder
        },
        new AdaptiveFactSet
        {
            Facts = new List<AdaptiveFact>
            {
                new AdaptiveFact("Product", "Widget"),
                new AdaptiveFact("Quantity", "5"),
                new AdaptiveFact("Total", "$49.95")
            }
        }
    },
    Actions = new List<AdaptiveAction>
    {
        new AdaptiveSubmitAction
        {
            Title = "Confirm",
            Data = new { action = "confirm" }
        },
        new AdaptiveSubmitAction
        {
            Title = "Cancel",
            Data = new { action = "cancel" }
        }
    }
};

var attachment = new Attachment
{
    ContentType = AdaptiveCard.ContentType,
    Content = card
};

await turnContext.SendActivityAsync(MessageFactory.Attachment(attachment));
```

## Channels

Deploy to multiple platforms:
- Microsoft Teams
- Web Chat
- Slack
- Facebook Messenger
- SMS (Twilio)

Azure Bot Service bridges AI and conversation.
