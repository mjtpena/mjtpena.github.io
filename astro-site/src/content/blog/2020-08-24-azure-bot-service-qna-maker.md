---
title: "QnA Maker FAQ Bots: Confidence Scores, Follow-ups and Handoff"
description: "How to make a QnA Maker bot on Azure Bot Service decide when to answer, when to offer choices, and when to hand off to a human, with Bot Framework v4 C#."
author: Michael John Peña
draft: false
date: 2020-08-24
tags:
  - Azure
  - Bot Service
  - QnA Maker
  - Cognitive Services
  - Chatbots
---

"Customers ask us the same five questions over and over." Every support team I've worked with has said this. QnA Maker is the practical answer on Azure: point it at the FAQ pages and policy documents you already have, publish a knowledge base, and put it behind a bot on Azure Bot Service. The part most teams get wrong is not building the knowledge base. It's what the bot does when QnA Maker isn't sure.

A bot that confidently answers the wrong question does more damage than one that says "I don't know". The decision logic is what matters: how to read confidence scores, when to show options instead of an answer, how to keep follow-up prompts working across turns, and when to get out of the way and hand the customer to a person.

## What you're actually deploying

QnA Maker (generally available since May 2018) is not one resource, and knowing the parts helps you reason about cost and behaviour. When you create it you get:

| Component | What it does | What it means for you |
|---|---|---|
| QnA Maker resource (Cognitive Services) | Authoring and management APIs, the qnamaker.ai portal | Where you edit, train and publish |
| Azure App Service | Hosts the runtime `generateAnswer` endpoint your bot calls | Scale this for traffic; it's the latency path |
| Azure Cognitive Search | Stores the knowledge bases as indexes and retrieves candidate answers | The tier caps how many knowledge bases you can publish |
| Application Insights (optional) | Logs queries and answers | Turn it on; you'll want the unanswered-question data |

Retrieval happens in two stages. Cognitive Search finds candidate QnA pairs, then QnA Maker's ranker re-scores them and returns a confidence score for each. The search tier matters more than people expect: one index is reserved for testing, so the Free tier publishes two knowledge bases and Basic publishes 14 ([limits](https://learn.microsoft.com/en-us/azure/ai-services/qnamaker/limits)). If you plan one knowledge base per department or per language, size Search for that up front, because you can't change a Search service's tier in place; moving means creating a new service and republishing.

The App Service plan and the Search service are both always-on resources, billed by the hour whether the bot answers a thousand questions or none. The Free Search tier is limited to one per subscription and two published knowledge bases, so for anything beyond a pilot, Basic Search plus a production App Service plan is the realistic minimum. Budget for that fixed monthly cost before you count a single deflected chat.

The building of the knowledge base itself (importing URLs and files, editing pairs, adding alternate phrasings and metadata) is well covered in the portal. I'll focus on the bot.

## Reading the confidence score

Every answer comes back with a score. The REST API reports it from 0 to 100; the Bot Framework SDK's `QnAMaker` class divides by 100, so in C# you work with 0 to 1. The REST API's default threshold is 0, which means "return something, however weak". The SDK applies 0.3 if you don't set `ScoreThreshold` and drops anything weaker ([confidence score guidance](https://learn.microsoft.com/en-us/azure/ai-services/qnamaker/concepts/confidence-score)).

A single threshold gives you two outcomes: answer or don't. That's too blunt. I use three bands:

| Score (SDK, 0–1) | Bot behaviour | Why |
|---|---|---|
| 0.70 and above | Answer directly | High enough that a wrong answer is rare and cheap to recover from |
| 0.30 to 0.70 | Show the top matches as buttons ("Did you mean…?"), even when only one clears 0.30 | The right answer is often in the top three even when the top score is middling |
| Below 0.30, or nothing | Say so, and offer a person | Guessing here loses trust fast |

These numbers are starting points, not truths. Scores depend on how you phrase questions in the knowledge base and how many alternate phrasings you add. Pull a week of real queries from Application Insights, look at the scores of the ones you know are right and wrong, and move the bands. My rule of thumb: if you can't find the boundary in your own data, add more alternate questions before you touch the thresholds.

The middle band does a second job. When a customer picks one of the suggested questions, that's a labelled training signal: "this user query meant this QnA pair". QnA Maker's [active learning](https://learn.microsoft.com/en-us/azure/ai-services/qnamaker/how-to/improve-knowledge-base) accepts that feedback through the Train API, and with active learning enabled the suggestions appear in the portal for an editor to accept or reject. Nothing changes in the knowledge base without a human approving it, which is the right default for customer-facing content.

## Follow-up prompts need state

Multi-turn prompts let one answer lead to the next ("Which plan are you asking about? Personal / Business"). In the knowledge base, a QnA pair carries a list of prompts, each pointing at another pair. The catch is that the runtime is stateless. To resolve the customer's next message in the context of the previous answer, the bot must send back the previous QnA id and question in the `context` of the next request ([multi-turn conversations](https://learn.microsoft.com/en-us/azure/ai-services/qnamaker/how-to/multi-turn)). If it doesn't, "Business" gets scored against the whole knowledge base and usually loses.

So the bot needs conversation state for four things: the previous answer's id and query (for follow-ups), the follow-up prompts it just showed, and the suggestions it just offered (so it can send active learning feedback when the customer picks one). Each prompt in the knowledge base carries the id of the pair it points to, so the bot can store that id and resolve a button click exactly, rather than relying on context re-scoring to land on the right pair.

## The bot

This is a complete `ActivityHandler` for Bot Framework SDK v4 (`Microsoft.Bot.Builder.AI.QnA` 4.9 or later) on ASP.NET Core 3.1. It implements the three bands, follow-up prompts and feedback, and it logs a failed Train call instead of letting it block the answer the customer picked. I've used hero cards rather than suggested actions because, at the time of writing, Microsoft Teams doesn't render suggested actions, and Teams is where most internal FAQ bots end up. Teams is also why the handler calls `RemoveRecipientMention()` before it reads the text: in a Teams channel or group chat the message text includes the bot's @mention, which would break the keyword and button matching and get sent to QnA Maker as part of the question.

```csharp
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Bot.Builder;
using Microsoft.Bot.Builder.AI.QnA;
using Microsoft.Bot.Schema;
using Microsoft.Extensions.Logging;

public class FaqState
{
    public int PreviousQnAId { get; set; }
    public string PreviousUserQuery { get; set; } = string.Empty;
    public string PendingUserQuestion { get; set; }
    public Dictionary<string, int> PendingSuggestions { get; set; } = new Dictionary<string, int>();
    public Dictionary<string, int> PendingPrompts { get; set; } = new Dictionary<string, int>();
}

public class FaqBot : ActivityHandler
{
    private const float AnswerThreshold = 0.7f;
    private const float SuggestThreshold = 0.3f;

    private readonly QnAMaker _qnaMaker;
    private readonly ConversationState _conversationState;
    private readonly IStatePropertyAccessor<FaqState> _stateAccessor;
    private readonly ILogger<FaqBot> _logger;

    public FaqBot(QnAMaker qnaMaker, ConversationState conversationState, ILogger<FaqBot> logger)
    {
        _qnaMaker = qnaMaker;
        _conversationState = conversationState;
        _logger = logger;
        _stateAccessor = conversationState.CreateProperty<FaqState>(nameof(FaqState));
    }

    public override async Task OnTurnAsync(ITurnContext turnContext, CancellationToken cancellationToken = default)
    {
        await base.OnTurnAsync(turnContext, cancellationToken);
        await _conversationState.SaveChangesAsync(turnContext, false, cancellationToken);
    }

    protected override async Task OnMessageActivityAsync(
        ITurnContext<IMessageActivity> turnContext,
        CancellationToken cancellationToken)
    {
        var state = await _stateAccessor.GetAsync(turnContext, () => new FaqState(), cancellationToken);

        // In Teams channels and group chats, Text starts with the bot's @mention. Strip it first.
        turnContext.Activity.RemoveRecipientMention();
        var text = turnContext.Activity.Text?.Trim() ?? string.Empty;

        // Handoff keyword: from "None of these" or typed after the no-answer prompt.
        if (string.Equals(text, "agent", StringComparison.OrdinalIgnoreCase))
        {
            ResetContext(state);
            state.PendingSuggestions.Clear();
            state.PendingPrompts.Clear();
            await turnContext.SendActivityAsync(
                MessageFactory.Text("Connecting you with someone from the support team."),
                cancellationToken);
            // Raise your handoff here: notify the live-chat queue with the transcript and state.
            return;
        }

        // The customer picked one of our "Did you mean" suggestions.
        if (state.PendingSuggestions.TryGetValue(text, out var chosenId))
        {
            await SendFeedbackAsync(turnContext, state.PendingUserQuestion, chosenId);
            state.PendingUserQuestion = null;
            state.PendingSuggestions.Clear();
            state.PendingPrompts.Clear();
            await AnswerAsync(turnContext, state, new QnAMakerOptions { Top = 1, QnAId = chosenId }, text, cancellationToken);
            return;
        }

        // The customer clicked a follow-up prompt: go straight to the pair it points at.
        if (state.PendingPrompts.TryGetValue(text, out var promptId))
        {
            state.PendingPrompts.Clear();
            await AnswerAsync(turnContext, state, new QnAMakerOptions { Top = 1, QnAId = promptId }, text, cancellationToken);
            return;
        }

        state.PendingSuggestions.Clear();
        state.PendingPrompts.Clear();

        var options = new QnAMakerOptions
        {
            Top = 3,
            ScoreThreshold = SuggestThreshold,
            Context = state.PreviousQnAId > 0
                ? new QnARequestContext { PreviousQnAId = state.PreviousQnAId, PreviousUserQuery = state.PreviousUserQuery }
                : null,
        };

        await AnswerAsync(turnContext, state, options, text, cancellationToken);
    }

    private async Task AnswerAsync(
        ITurnContext turnContext,
        FaqState state,
        QnAMakerOptions options,
        string userText,
        CancellationToken cancellationToken)
    {
        var results = await _qnaMaker.GetAnswersAsync(turnContext, options);

        if (results == null || results.Length == 0)
        {
            ResetContext(state);
            await turnContext.SendActivityAsync(
                MessageFactory.Text("I don't have a good answer for that. Type 'agent' and I'll connect you with someone from the support team."),
                cancellationToken);
            return;
        }

        var top = results[0];
        var isDirectPick = options.QnAId > 0;

        if (isDirectPick || top.Score >= AnswerThreshold)
        {
            state.PreviousQnAId = top.Id;
            state.PreviousUserQuery = userText;

            var prompts = top.Context?.Prompts;
            if (prompts != null && prompts.Length > 0)
            {
                state.PendingPrompts = prompts
                    .GroupBy(p => p.DisplayText)
                    .ToDictionary(g => g.Key, g => g.First().QnaId);

                var card = new HeroCard
                {
                    Text = top.Answer,
                    Buttons = prompts
                        .Select(p => new CardAction(ActionTypes.ImBack, p.DisplayText, value: p.DisplayText))
                        .GroupBy(a => a.Title)
                        .Select(g => g.First())
                        .ToList(),
                };
                await turnContext.SendActivityAsync(MessageFactory.Attachment(card.ToAttachment()), cancellationToken);
            }
            else
            {
                await turnContext.SendActivityAsync(MessageFactory.Text(top.Answer), cancellationToken);
            }

            return;
        }

        // Middle band: offer the top matches and remember them for feedback.
        ResetContext(state);
        state.PendingUserQuestion = userText;
        foreach (var result in results)
        {
            var question = result.Questions.FirstOrDefault();
            if (!string.IsNullOrEmpty(question) && !state.PendingSuggestions.ContainsKey(question))
            {
                state.PendingSuggestions[question] = result.Id;
            }
        }

        var suggestionCard = new HeroCard
        {
            Text = "I found a few possible matches. Did you mean one of these?",
            Buttons = state.PendingSuggestions.Keys
                .Select(q => new CardAction(ActionTypes.ImBack, q, value: q))
                .Append(new CardAction(ActionTypes.MessageBack, "None of these", text: "agent", displayText: "None of these"))
                .ToList(),
        };
        await turnContext.SendActivityAsync(MessageFactory.Attachment(suggestionCard.ToAttachment()), cancellationToken);
    }

    private async Task SendFeedbackAsync(ITurnContext turnContext, string userQuestion, int qnaId)
    {
        if (string.IsNullOrEmpty(userQuestion))
        {
            return;
        }

        var feedback = new FeedbackRecords
        {
            Records = new[]
            {
                new FeedbackRecord
                {
                    UserId = turnContext.Activity.From.Id,
                    UserQuestion = userQuestion,
                    QnaId = qnaId,
                },
            },
        };

        try
        {
            await _qnaMaker.CallTrainAsync(feedback);
        }
        catch (Exception ex)
        {
            // Feedback is a nice-to-have. Never let it stop the customer getting their answer.
            _logger.LogWarning(ex, "QnA Maker Train call failed for QnA id {QnaId}", qnaId);
        }
    }

    private static void ResetContext(FaqState state)
    {
        state.PreviousQnAId = 0;
        state.PreviousUserQuery = string.Empty;
    }
}
```

Register the dependencies in `Startup.ConfigureServices`. The host is your QnA Maker App Service with `/qnamaker` on the end, and the endpoint key comes from the Publish page in the portal. Keep it in configuration (Key Vault or App Service settings), not in source.

```csharp
// Fragment: inside Startup.ConfigureServices(IServiceCollection services)
services.AddSingleton<IStorage, MemoryStorage>(); // swap for CosmosDbPartitionedStorage or AzureBlobStorage in production
services.AddSingleton<ConversationState>();

services.AddSingleton(sp => new QnAMaker(new QnAMakerEndpoint
{
    KnowledgeBaseId = Configuration["QnAMaker:KnowledgeBaseId"], // <your-kb-id>
    EndpointKey = Configuration["QnAMaker:EndpointKey"],         // <your-endpoint-key>
    Host = Configuration["QnAMaker:Host"],                       // https://<your-app-service>.azurewebsites.net/qnamaker
}));

services.AddTransient<IBot, FaqBot>();
```

A note on the "agent" keyword: the bot intercepts it before anything reaches QnA Maker, so "None of these" and a typed "agent" never get scored against the knowledge base and bounced back as another "I don't know". What it doesn't do is the actual queue integration, which I've left to you because it depends on what your support team uses. Scope it before launch, not after. If the customer can't reach a person, the low-confidence band is just a polite dead end.

Whatever the target, pass the human enough to avoid making the customer repeat themselves: the conversation transcript, the original question, and the answers and scores the bot saw. If you're on Dynamics 365 Omnichannel for Customer Service, it can take an Azure bot as the first responder and accept a handoff: the bot sends a `handoff.initiate` event activity (the Bot Framework SDK's `EventFactory.CreateHandoffInitiation` builds one, transcript included) and Omnichannel routes the conversation to an agent queue. Otherwise, the usual option is a custom relay that uses Direct Line to forward messages between the customer's conversation and an agent console. Also log every "None of these" click to Application Insights as a custom event with the query and the suggestions offered. It's a clean negative signal: those are the queries where your knowledge base has a gap or your phrasings miss.

## Why not just use QnAMakerDialog?

The SDK ships `QnAMakerDialog`, and the [Bot Framework QnA Maker how-to](https://learn.microsoft.com/en-us/azure/bot-service/bot-builder-howto-qna) uses it. It handles multi-turn context and active learning cards for you, with a single threshold (default 0.3), a top-N (default 3) and a "Did you mean:" card. If your bot is only an FAQ bot and those defaults suit you, use it. It's less code and fewer chances to get state wrong.

I write the logic by hand when the bot does more than FAQ, for example when QnA Maker sits alongside LUIS and a dispatcher, or when the confidence bands and handoff wording need to be tuned by the support team. The explicit version above makes every decision visible in one place, which is easier to review with people who don't read dialog stacks.

## Getting it in front of customers

The quickest path is the **Create Bot** button on the QnA Maker Publish page, which provisions a Web App Bot already wired to your knowledge base. That's fine for a demo. For anything you'll maintain, deploy your own code to an App Service with a Bot Channels Registration so the bot lives in source control and a pipeline, then turn on the channels you need from the Azure Bot Service blade ([Azure Bot Service documentation](https://learn.microsoft.com/en-us/azure/bot-service/)). For Teams you'll also need an app manifest; I covered that in [building a Teams bot with Bot Framework v4](/blog/2020-08-09-teams-bot-development/).

## When QnA Maker is the wrong tool

- **Answers depend on who's asking.** "What's my order status?" isn't an FAQ. That's an API call behind authentication, and QnA Maker can't help.
- **Content changes daily.** Every edit needs a publish. If your source of truth is a fast-moving system, you'll fight stale answers.
- **You need answers drawn from long, unstructured documents.** QnA Maker extracts question-and-answer pairs well from FAQ-shaped pages and structured manuals. It does poorly with dense prose, and you'll spend the savings on hand-editing.
- **There are only ten questions.** A static FAQ page with good search may be all you need.

## The measure that matters

At one client, deflection from a well-tuned QnA bot landed around 30–40% of inbound chats, and that was on a narrow FAQ the support team kept up to date every week. In my experience, expect closer to a third than most of it. Useful, but a long way from "replace the support team". Treat the bot as a top-of-funnel filter, not a replacement. Spend your effort on the middle confidence band and the handoff path, and make the "talk to a human" option obvious. Before go-live, put a 30-minute weekly review of active learning suggestions and unanswered queries in the support lead's calendar.
