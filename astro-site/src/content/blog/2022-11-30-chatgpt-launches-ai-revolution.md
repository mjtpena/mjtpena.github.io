---
title: "ChatGPT Launches: The AI Revolution Begins Today"
author: Michael John Peña
draft: false
date: 2022-11-30
tags:
  - AI
  - OpenAI
  - ChatGPT
  - GPT
  - Machine Learning
---

ChatGPT launched on November 30, 2022, and I spent most of that day in a state of barely contained astonishment—not because a chatbot was impressive (I'd been using GPT-3.5 through Azure OpenAI for months), but because the conversational interface made the capability accessible in a way that API access never did. Every person I know who tried it that first day came back with the same reaction: "It's different from what I expected." The technical insight: ChatGPT isn't a fundamentally more capable model than GPT-3.5—it's GPT-3.5 fine-tuned with RLHF (Reinforcement Learning from Human Feedback) to follow conversational norms, refuse harmful requests, and maintain context across a multi-turn dialogue. The interface is the insight. What a chat UX does that a raw completion API doesn't: it makes the multi-turn context management transparent; it sets implicit expectations about interaction style; it exposes the model's capability to non-technical users without requiring them to understand prompt construction. The implication I kept coming back to: the same models we'd been using in Azure OpenAI for months were capable of this. The missing piece was the interface design, not the model capability. The AI product design question just became as important as the AI engineering question.

## What is ChatGPT?

ChatGPT is a conversational AI model built on GPT-3.5, fine-tuned using Reinforcement Learning from Human Feedback (RLHF). Unlike previous GPT models that simply complete text, ChatGPT is designed for dialogue.

What makes it special:
- **Conversational**: It remembers context throughout a conversation
- **Correctable**: You can tell it when it's wrong, and it adjusts
- **Humble**: It can admit mistakes and refuse inappropriate requests
- **Accessible**: Free to use at chat.openai.com

## My First Experiments

### Code Generation

I asked ChatGPT to write an Azure Function that processes images with Cognitive Services:

**Prompt**: "Write a C# Azure Function that triggers on blob storage upload, analyzes the image using Azure Computer Vision, and stores the results in Cosmos DB."

The response was remarkable - complete, compilable code with proper error handling:

```csharp
using System;
using System.IO;
using System.Threading.Tasks;
using Microsoft.Azure.WebJobs;
using Microsoft.Azure.CognitiveServices.Vision.ComputerVision;
using Microsoft.Azure.CognitiveServices.Vision.ComputerVision.Models;
using Microsoft.Azure.Cosmos;
using Microsoft.Extensions.Logging;

public class ImageAnalyzer
{
    private readonly ComputerVisionClient _visionClient;
    private readonly Container _cosmosContainer;

    public ImageAnalyzer(ComputerVisionClient visionClient, CosmosClient cosmosClient)
    {
        _visionClient = visionClient;
        _cosmosContainer = cosmosClient.GetContainer("ImageAnalysis", "Results");
    }

    [FunctionName("AnalyzeImage")]
    public async Task Run(
        [BlobTrigger("images/{name}", Connection = "StorageConnection")] Stream imageStream,
        string name,
        ILogger log)
    {
        log.LogInformation($"Processing image: {name}");

        try
        {
            // Analyze image
            var features = new List<VisualFeatureTypes?>
            {
                VisualFeatureTypes.Categories,
                VisualFeatureTypes.Description,
                VisualFeatureTypes.Tags,
                VisualFeatureTypes.Objects
            };

            var analysis = await _visionClient.AnalyzeImageInStreamAsync(imageStream, features);

            // Create result document
            var result = new ImageAnalysisResult
            {
                Id = Guid.NewGuid().ToString(),
                ImageName = name,
                AnalyzedAt = DateTime.UtcNow,
                Description = analysis.Description?.Captions?.FirstOrDefault()?.Text,
                Tags = analysis.Tags?.Select(t => t.Name).ToList(),
                Objects = analysis.Objects?.Select(o => new DetectedObject
                {
                    Name = o.ObjectProperty,
                    Confidence = o.Confidence
                }).ToList()
            };

            // Store in Cosmos DB
            await _cosmosContainer.CreateItemAsync(result, new PartitionKey(result.ImageName));

            log.LogInformation($"Analysis complete for {name}");
        }
        catch (Exception ex)
        {
            log.LogError(ex, $"Error analyzing {name}");
            throw;
        }
    }
}
```

This is production-quality code that I could use immediately.

### Explaining Complex Concepts

**Prompt**: "Explain event sourcing and CQRS in the context of Azure, like I'm a developer who knows basic concepts but hasn't used these patterns."

The explanation was clear, practical, and included Azure-specific recommendations. It didn't just define the terms - it explained when and why to use them.

### Debugging Assistance

I pasted a stack trace and error message:

**Prompt**: "I'm getting this error in my Azure Function: [stack trace]. What's wrong and how do I fix it?"

ChatGPT identified the issue (a missing connection string configuration), explained why it happened, and provided the fix. It even suggested how to prevent similar issues in the future.

## The Developer Experience

This is different from GitHub Copilot or other AI tools I've used. The key differences:

1. **Dialogue**: I can ask follow-up questions, request modifications, ask for explanations
2. **Context**: It remembers our entire conversation
3. **Teaching**: It doesn't just give answers - it explains its reasoning
4. **Iteration**: I can say "that's good but change X" and it adapts

```
Me: Write a function to calculate Azure blob storage costs.

ChatGPT: [provides function]

Me: Good, but use the pricing for Australia East region.

ChatGPT: [updates with AU pricing]

Me: Also add support for different storage tiers.

ChatGPT: [adds tier support]

Me: Explain how you calculated the hot storage costs.

ChatGPT: [detailed explanation]
```

This iterative workflow is incredibly powerful.

## Limitations I've Found

It's not perfect. Important limitations:

1. **Knowledge cutoff**: Its training data ends in 2021, so it doesn't know about recent Azure features
2. **Confidence in errors**: It can confidently provide incorrect information
3. **No real-time data**: Can't check current prices, docs, or API status
4. **Context limits**: Very long conversations lose earlier context

```python
# Example of incorrect but confident response
# I asked about Azure OpenAI Service features
# It provided plausible but partially incorrect information
# because its training predates some recent updates

# Always verify against current documentation!
```

## Implications for Developers

### Short Term (Now)

- Use it for first-draft code generation
- Get explanations of unfamiliar code
- Generate documentation
- Debug by describing problems
- Learn new technologies faster

### Medium Term (Months)

- Expect IDE integrations
- More sophisticated code review tools
- Automated documentation generation
- Natural language to SQL/code in data tools

### Long Term (Years)

- Fundamental shift in what developers spend time on
- Less boilerplate, more architecture and design
- AI as a standard part of the development workflow
- New skills around AI collaboration

## My Predictions

1. **Microsoft will integrate this everywhere**: Expect ChatGPT-style AI in Visual Studio, VS Code, Azure Portal, Power Platform
2. **Enterprise version coming**: Companies will want private, secure deployment
3. **API access**: Developers will embed this in applications
4. **New job skills**: "Prompt engineering" will become a real discipline

## How to Get Started

1. Go to [chat.openai.com](https://chat.openai.com)
2. Create a free account
3. Start experimenting

Try these prompts:
- "Explain [technology] like I'm a [your background] developer"
- "Write [code] that does [task] using [framework]"
- "Debug this error: [error message]"
- "Review this code and suggest improvements: [code]"
- "Convert this [language A] code to [language B]"

## A Word of Caution

This is powerful, but:

- **Don't trust blindly**: Always review and test generated code
- **Verify facts**: Check documentation for accuracy
- **Security**: Don't paste sensitive code or data
- **Learning**: Use it to learn, not bypass learning

## Conclusion

I've been following AI for years, and this feels different. ChatGPT isn't just an incremental improvement - it's a step change in what's possible. The combination of accessibility (free, web-based), capability (genuinely useful for real work), and usability (natural conversation) creates something new.

We're at the beginning of something big. Start experimenting now.

---

*I'll be writing more about ChatGPT over the coming days and weeks as I explore its capabilities and limitations. Stay tuned.*

## Resources

- [ChatGPT](https://chat.openai.com/)
- [OpenAI Blog Post](https://openai.com/blog/chatgpt)
- [Azure OpenAI Service](https://azure.microsoft.com/en-us/products/cognitive-services/openai-service/) (for enterprise deployment)
