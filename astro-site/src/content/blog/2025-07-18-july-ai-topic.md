---
title: "Building Conversational AI with Azure Bot Service and GPT-4o"
author: Michael John Peña
draft: false
date: 2025-07-18
tags:
  - Azure Bot Service
  - Conversational AI
  - GPT-4o
  - Teams
  - C#

---

I wrote "Building Conversational AI with Azure Bot Service and GPT-4o" to share practical, production-minded guidance on this topic.

## Bot Framework Integration

The Bot Framework SDK handles channel abstraction while you focus on conversation logic:

```csharp
using Microsoft.Bot.Builder;
using Microsoft.Bot.Schema;
using Azure.AI.OpenAI;

public class IntelligentBot : ActivityHandler
{
    private readonly OpenAIClient _openAIClient;
    private readonly ConversationState _conversationState;
    private readonly IStatePropertyAccessor<ConversationData> _conversationAccessor;

    public IntelligentBot(
        OpenAIClient openAIClient,
        ConversationState conversationState)
    {
        _openAIClient = openAIClient;
        _conversationState = conversationState;
        _conversationAccessor = conversationState.CreateProperty<ConversationData>("ConversationData");
    }

    protected override async Task OnMessageActivityAsync(
        ITurnContext<IMessageActivity> turnContext,
        CancellationToken cancellationToken)
    {
        var conversationData = await _conversationAccessor.GetAsync(
            turnContext,
            () => new ConversationData(),
            cancellationToken);

        // Add user message to history
        conversationData.History.Add(new ChatRequestUserMessage(turnContext.Activity.Text));

        // Build messages for GPT-4o
        var chatMessages = new List<ChatRequestMessage>
        {
            new ChatRequestSystemMessage(
                @"You are a helpful assistant for Contoso Corp.
                Answer questions about products, orders, and support.
                Be concise and professional.")
        };
        chatMessages.AddRange(conversationData.History.TakeLast(10));

        // Get completion
        var response = await _openAIClient.GetChatCompletionsAsync(
            new ChatCompletionsOptions("gpt-4o", chatMessages)
            {
                MaxTokens = 500,
                Temperature = 0.7f
            },
            cancellationToken);

        var reply = response.Value.Choices[0].Message.Content;

        // Store assistant response
        conversationData.History.Add(new ChatRequestAssistantMessage(reply));

        // Send response with typing indicator
        await turnContext.SendActivityAsync(
            MessageFactory.Text(reply),
            cancellationToken);

        // Save state
        await _conversationState.SaveChangesAsync(turnContext, cancellationToken: cancellationToken);
    }
}
```

## Managing Conversation Context

Implement sliding window context to stay within token limits while preserving conversation coherence:

```csharp
public class ConversationData
{
    public List<ChatRequestMessage> History { get; set; } = new();
    public Dictionary<string, object> UserContext { get; set; } = new();

    public void TrimHistory(int maxMessages = 20)
    {
        if (History.Count > maxMessages)
        {
            History = History.TakeLast(maxMessages).ToList();
        }
    }
}
```

## Teams-Specific Features

Leverage Teams-specific capabilities like adaptive cards, task modules, and message extensions to create rich interactive experiences.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
