---
title: "Windows AI Features: Building for the AI PC"
description: "Windows AI brings powerful on-device intelligence to every application."
author: Michael John Peña
draft: false
date: 2025-04-03
tags:
  - Windows
  - AI
  - NPU
  - On-Device
  - Microsoft
---

## Windows AI Development

```csharp
// Windows AI APIs for on-device inference

using Microsoft.Windows.AI;
using Microsoft.Windows.AI.MachineLearning;

public class WindowsAIService
{
    private readonly AIModelSession _session;

    public async Task InitializeAsync()
    {
        // Check for AI hardware capabilities
        var capabilities = await AIDeviceCapabilities.GetCapabilitiesAsync();

        if (capabilities.HasNPU)
        {
            Console.WriteLine($"NPU available: {capabilities.NPUName}");
            Console.WriteLine($"NPU TOPS: {capabilities.NPUPerformance}");
        }

        // Load model optimized for Windows AI
        var modelPath = "ms-appx:///Models/phi-3-mini.onnx";
        _session = await AIModelSession.CreateFromPathAsync(
            modelPath,
            new AIModelSessionOptions
            {
                DeviceType = AIDeviceType.NPU,
                EnableCaching = true
            }
        );
    }

    public async Task<string> GenerateResponseAsync(string prompt)
    {
        var input = new AIModelInput
        {
            Text = prompt,
            MaxTokens = 500,
            Temperature = 0.7f
        };

        var result = await _session.GenerateAsync(input);
        return result.Text;
    }

    public async Task<float[]> GetEmbeddingAsync(string text)
    {
        // Use Windows AI for local embeddings
        var embeddingModel = await AIEmbeddingModel.CreateAsync();
        return await embeddingModel.EmbedTextAsync(text);
    }
}

// XAML integration
public class AITextBox : TextBox
{
    public bool EnableAIAssist { get; set; } = true;

    protected override async void OnTextChanged(TextChangedEventArgs e)
    {
        base.OnTextChanged(e);

        if (EnableAIAssist && Text.EndsWith("?"))
        {
            var suggestion = await GetAISuggestion(Text);
            ShowSuggestionPopup(suggestion);
        }
    }
}
```

## Key Windows AI Capabilities

| Feature | Description | Use Case |
|---------|-------------|----------|
| NPU Inference | Hardware-accelerated AI | Local LLM, embeddings |
| Windows Copilot Runtime | System-level AI services | App integration |
| Recall | AI-powered memory | Semantic search |
| Live Captions | Real-time transcription | Accessibility |

Windows AI brings powerful on-device intelligence to every application.
