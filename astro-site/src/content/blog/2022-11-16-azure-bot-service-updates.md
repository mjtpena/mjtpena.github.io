---
title: "Azure Bot Service Updates: Building Intelligent Conversational AI"
author: Michael John Peña
draft: false
date: 2022-11-16
tags:
  - Azure
  - Bot Framework
  - Conversational AI
  - AI
  - Microsoft
---

## Bot Framework Composer Updates

Bot Framework Composer now supports more advanced dialog patterns:

```json
// dialog.schema
{
  "$kind": "Microsoft.AdaptiveDialog",
  "autoEndDialog": true,
  "defaultResultProperty": "dialog.result",
  "triggers": [
    {
      "$kind": "Microsoft.OnConversationUpdateActivity",
      "actions": [
        {
          "$kind": "Microsoft.SendActivity",
          "activity": "${WelcomeMessage()}"
        }
      ]
    },
    {
      "$kind": "Microsoft.OnIntent",
      "intent": "OrderStatus",
      "actions": [
        {
          "$kind": "Microsoft.BeginDialog",
          "dialog": "OrderStatusDialog"
        }
      ]
    }
  ]
}
```

## Building with Bot Framework SDK

### Basic Bot with OpenAI Integration

```csharp
using Microsoft.Bot.Builder;
using Microsoft.Bot.Schema;
using Azure.AI.OpenAI;

public class OpenAIBot : ActivityHandler
{
    private readonly OpenAIClient _openAIClient;
    private readonly ConversationState _conversationState;

    public OpenAIBot(OpenAIClient openAIClient, ConversationState conversationState)
    {
        _openAIClient = openAIClient;
        _conversationState = conversationState;
    }

    protected override async Task OnMessageActivityAsync(
        ITurnContext<IMessageActivity> turnContext,
        CancellationToken cancellationToken)
    {
        var conversationData = await GetConversationDataAsync(turnContext, cancellationToken);

        // Add user message to history
        conversationData.History.Add(new ChatMessage(ChatRole.User, turnContext.Activity.Text));

        // Generate response using OpenAI
        var chatCompletionsOptions = new ChatCompletionsOptions
        {
            DeploymentName = "gpt-35-turbo",
            Messages = {
                new ChatMessage(ChatRole.System, GetSystemPrompt())
            }
        };

        foreach (var message in conversationData.History.TakeLast(10))
        {
            chatCompletionsOptions.Messages.Add(message);
        }

        var response = await _openAIClient.GetChatCompletionsAsync(chatCompletionsOptions, cancellationToken);
        var assistantMessage = response.Value.Choices[0].Message.Content;

        // Add assistant response to history
        conversationData.History.Add(new ChatMessage(ChatRole.Assistant, assistantMessage));

        await turnContext.SendActivityAsync(
            MessageFactory.Text(assistantMessage),
            cancellationToken);

        await _conversationState.SaveChangesAsync(turnContext, false, cancellationToken);
    }

    private string GetSystemPrompt() => """
        You are a helpful customer service assistant for Contoso.
        Be polite, concise, and helpful.
        If you don't know something, say so rather than making things up.
        """;

    private async Task<ConversationData> GetConversationDataAsync(
        ITurnContext turnContext,
        CancellationToken cancellationToken)
    {
        var accessor = _conversationState.CreateProperty<ConversationData>("ConversationData");
        return await accessor.GetAsync(turnContext, () => new ConversationData(), cancellationToken);
    }
}

public class ConversationData
{
    public List<ChatMessage> History { get; set; } = new();
}
```

### Skill Integration

```csharp
// SkillBot.cs - Child skill
public class OrderSkillBot : ActivityHandler
{
    protected override async Task OnMessageActivityAsync(
        ITurnContext<IMessageActivity> turnContext,
        CancellationToken cancellationToken)
    {
        var text = turnContext.Activity.Text.ToLower();

        if (text.Contains("order status"))
        {
            var orderId = ExtractOrderId(text);
            var status = await GetOrderStatusAsync(orderId);

            await turnContext.SendActivityAsync(
                MessageFactory.Text($"Order {orderId}: {status}"),
                cancellationToken);

            // End skill
            await turnContext.SendActivityAsync(
                new Activity { Type = ActivityTypes.EndOfConversation },
                cancellationToken);
        }
    }
}

// ParentBot.cs - Root bot that uses skills
public class ParentBot : ActivityHandler
{
    private readonly SkillHttpClient _skillClient;
    private readonly SkillsConfiguration _skillsConfig;

    protected override async Task OnMessageActivityAsync(
        ITurnContext<IMessageActivity> turnContext,
        CancellationToken cancellationToken)
    {
        var intent = await ClassifyIntentAsync(turnContext.Activity.Text);

        if (intent == "order")
        {
            // Forward to order skill
            var skill = _skillsConfig.Skills["OrderSkill"];

            await _skillClient.PostActivityAsync(
                _skillsConfig.SkillHostEndpoint,
                skill,
                turnContext.Activity.ServiceUrl,
                turnContext.Activity,
                cancellationToken);
        }
        else
        {
            // Handle locally
            await HandleLocallyAsync(turnContext, cancellationToken);
        }
    }
}
```

## Adaptive Cards with Dynamic Content

```csharp
public class CardFactory
{
    public static Attachment CreateOrderStatusCard(Order order)
    {
        var card = new AdaptiveCard(new AdaptiveSchemaVersion(1, 4))
        {
            Body = new List<AdaptiveElement>
            {
                new AdaptiveTextBlock
                {
                    Text = $"Order #{order.OrderId}",
                    Size = AdaptiveTextSize.Large,
                    Weight = AdaptiveTextWeight.Bolder
                },
                new AdaptiveFactSet
                {
                    Facts = new List<AdaptiveFact>
                    {
                        new AdaptiveFact("Status", order.Status),
                        new AdaptiveFact("Date", order.OrderDate.ToShortDateString()),
                        new AdaptiveFact("Total", order.Total.ToString("C"))
                    }
                },
                new AdaptiveContainer
                {
                    Items = order.Items.Select(item => new AdaptiveColumnSet
                    {
                        Columns = new List<AdaptiveColumn>
                        {
                            new AdaptiveColumn
                            {
                                Width = "stretch",
                                Items = new List<AdaptiveElement>
                                {
                                    new AdaptiveTextBlock { Text = item.Name }
                                }
                            },
                            new AdaptiveColumn
                            {
                                Width = "auto",
                                Items = new List<AdaptiveElement>
                                {
                                    new AdaptiveTextBlock { Text = item.Price.ToString("C") }
                                }
                            }
                        }
                    }).ToList<AdaptiveElement>()
                }
            },
            Actions = new List<AdaptiveAction>
            {
                new AdaptiveSubmitAction
                {
                    Title = "Track Package",
                    Data = new { action = "track", orderId = order.OrderId }
                },
                new AdaptiveOpenUrlAction
                {
                    Title = "View Details",
                    Url = new Uri($"https://contoso.com/orders/{order.OrderId}")
                }
            }
        };

        return new Attachment
        {
            ContentType = AdaptiveCard.ContentType,
            Content = card
        };
    }
}
```

## Multi-channel Deployment

```csharp
// Program.cs
var builder = WebApplication.CreateBuilder(args);

// Bot configuration
builder.Services.AddSingleton<IBotFrameworkHttpAdapter, AdapterWithErrorHandler>();
builder.Services.AddSingleton<IBot, OpenAIBot>();

// Channel-specific configuration
builder.Services.Configure<TeamsChannelOptions>(options =>
{
    options.AllowedTenants = new[] { "tenant-id" };
});

builder.Services.Configure<SlackChannelOptions>(options =>
{
    options.VerificationToken = builder.Configuration["Slack:VerificationToken"];
});

var app = builder.Build();

// Bot endpoints
app.MapPost("/api/messages", async (IBotFrameworkHttpAdapter adapter, IBot bot, HttpContext context) =>
{
    await adapter.ProcessAsync(context.Request, context.Response, bot);
});

// Teams-specific endpoint
app.MapPost("/api/teams", async (TeamsAdapter adapter, IBot bot, HttpContext context) =>
{
    await adapter.ProcessAsync(context.Request, context.Response, bot);
});

app.Run();
```

## Proactive Messaging

```csharp
public class ProactiveMessagingService
{
    private readonly IBotFrameworkHttpAdapter _adapter;
    private readonly IConversationReferenceStore _referenceStore;

    public ProactiveMessagingService(
        IBotFrameworkHttpAdapter adapter,
        IConversationReferenceStore referenceStore)
    {
        _adapter = adapter;
        _referenceStore = referenceStore;
    }

    public async Task SendOrderUpdateAsync(string userId, Order order)
    {
        var reference = await _referenceStore.GetReferenceAsync(userId);

        if (reference == null)
        {
            return; // User hasn't talked to bot
        }

        await ((BotAdapter)_adapter).ContinueConversationAsync(
            reference.BotId,
            reference,
            async (turnContext, cancellationToken) =>
            {
                var card = CardFactory.CreateOrderStatusCard(order);

                await turnContext.SendActivityAsync(
                    MessageFactory.Attachment(card),
                    cancellationToken);
            },
            CancellationToken.None);
    }

    public async Task SendBroadcastAsync(string message)
    {
        var references = await _referenceStore.GetAllReferencesAsync();

        var tasks = references.Select(reference =>
            ((BotAdapter)_adapter).ContinueConversationAsync(
                reference.BotId,
                reference,
                async (turnContext, cancellationToken) =>
                {
                    await turnContext.SendActivityAsync(
                        MessageFactory.Text(message),
                        cancellationToken);
                },
                CancellationToken.None));

        await Task.WhenAll(tasks);
    }
}
```

## QnA Maker Integration

```csharp
public class QnADialog : ComponentDialog
{
    private readonly QnAMakerClient _qnaClient;

    public QnADialog(QnAMakerClient qnaClient) : base(nameof(QnADialog))
    {
        _qnaClient = qnaClient;

        var waterfallSteps = new WaterfallStep[]
        {
            GetAnswerAsync,
            ProcessFeedbackAsync
        };

        AddDialog(new WaterfallDialog(nameof(WaterfallDialog), waterfallSteps));
        AddDialog(new ConfirmPrompt(nameof(ConfirmPrompt)));
    }

    private async Task<DialogTurnResult> GetAnswerAsync(
        WaterfallStepContext stepContext,
        CancellationToken cancellationToken)
    {
        var question = stepContext.Context.Activity.Text;

        var response = await _qnaClient.GetAnswersAsync(
            stepContext.Context,
            new QnAMakerOptions
            {
                Top = 1,
                ScoreThreshold = 0.5f
            });

        if (response?.FirstOrDefault() != null)
        {
            var answer = response.First();

            await stepContext.Context.SendActivityAsync(
                MessageFactory.Text(answer.Answer),
                cancellationToken);

            return await stepContext.PromptAsync(
                nameof(ConfirmPrompt),
                new PromptOptions
                {
                    Prompt = MessageFactory.Text("Was this helpful?")
                },
                cancellationToken);
        }

        await stepContext.Context.SendActivityAsync(
            MessageFactory.Text("I don't have information about that. Let me connect you with a human agent."),
            cancellationToken);

        return await stepContext.EndDialogAsync(null, cancellationToken);
    }

    private async Task<DialogTurnResult> ProcessFeedbackAsync(
        WaterfallStepContext stepContext,
        CancellationToken cancellationToken)
    {
        var helpful = (bool)stepContext.Result;

        if (!helpful)
        {
            // Log for improvement
            await LogNegativeFeedbackAsync(stepContext.Context.Activity.Text);
        }

        return await stepContext.EndDialogAsync(null, cancellationToken);
    }
}
```

## Testing Bots

```csharp
using Microsoft.Bot.Builder.Testing;
using Xunit;

public class BotTests
{
    [Fact]
    public async Task Welcome_Message_On_Conversation_Start()
    {
        var adapter = new TestAdapter();
        var bot = new OpenAIBot(CreateMockOpenAIClient(), new ConversationState(new MemoryStorage()));

        await adapter
            .Send(new Activity { Type = ActivityTypes.ConversationUpdate, MembersAdded = new[] { new ChannelAccount("user") } })
            .AssertReply(activity =>
            {
                Assert.Contains("Welcome", activity.AsMessageActivity().Text);
            })
            .StartTestAsync();
    }

    [Fact]
    public async Task Handles_Order_Status_Intent()
    {
        var adapter = new TestAdapter();
        var bot = CreateBot();

        await adapter
            .Send("What's the status of my order 12345?")
            .AssertReply(activity =>
            {
                var text = activity.AsMessageActivity().Text;
                Assert.Contains("12345", text);
                Assert.Contains("status", text.ToLower());
            })
            .StartTestAsync();
    }
}
```

## Conclusion

Azure Bot Service provides a comprehensive platform for building conversational AI. With OpenAI integration, multi-channel support, and robust SDK features, you can create intelligent bots that provide real value to users. The key is combining structured dialog flows with AI-powered natural language understanding.

## Resources

- [Bot Framework Documentation](https://docs.microsoft.com/en-us/azure/bot-service/)
- [Bot Framework Composer](https://docs.microsoft.com/en-us/composer/)
- [Adaptive Cards](https://adaptivecards.io/)
- [Bot Framework SDK](https://github.com/Microsoft/botframework-sdk)
