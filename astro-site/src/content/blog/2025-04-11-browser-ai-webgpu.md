---
title: "Browser AI with WebGPU: Running Models in the Browser"
author: Michael John Peña
draft: false
date: 2025-04-11
tags:
  - WebGPU
  - Browser
  - AI
  - JavaScript
  - Web

---

I wrote "Browser AI with WebGPU: Running Models in the Browser" to share practical, production-minded guidance on this topic.

## Browser AI with WebGPU

```javascript
// browser_ai.js - Running AI models in the browser

import { pipeline, env } from '@xenova/transformers';

// Configure for browser execution
env.allowLocalModels = false;
env.useBrowserCache = true;

class BrowserAI {
    constructor() {
        this.models = {};
    }

    async loadModel(task, modelName) {
        // Load model with WebGPU backend when available
        const model = await pipeline(task, modelName, {
            device: navigator.gpu ? 'webgpu' : 'wasm',
            dtype: 'fp16'  // Use half precision for efficiency
        });

        this.models[task] = model;
        return model;
    }

    async embed(texts) {
        if (!this.models['feature-extraction']) {
            await this.loadModel('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        }

        const embeddings = await this.models['feature-extraction'](texts, {
            pooling: 'mean',
            normalize: true
        });

        return embeddings.tolist();
    }

    async classify(text, labels) {
        if (!this.models['zero-shot-classification']) {
            await this.loadModel('zero-shot-classification', 'Xenova/nli-deberta-v3-small');
        }

        return await this.models['zero-shot-classification'](text, labels);
    }

    async summarize(text) {
        if (!this.models['summarization']) {
            await this.loadModel('summarization', 'Xenova/distilbart-cnn-6-6');
        }

        const result = await this.models['summarization'](text, {
            max_length: 150,
            min_length: 30
        });

        return result[0].summary_text;
    }

    async chat(messages) {
        if (!this.models['text-generation']) {
            await this.loadModel('text-generation', 'Xenova/Phi-3-mini-4k-instruct');
        }

        const prompt = this.formatMessages(messages);
        const result = await this.models['text-generation'](prompt, {
            max_new_tokens: 256,
            temperature: 0.7
        });

        return result[0].generated_text;
    }

    formatMessages(messages) {
        return messages.map(m =>
            m.role === 'user' ? `User: ${m.content}` : `Assistant: ${m.content}`
        ).join('\n') + '\nAssistant:';
    }
}

// Usage in a web application
const ai = new BrowserAI();

// Semantic search in browser
async function semanticSearch(query, documents) {
    const queryEmbedding = await ai.embed([query]);
    const docEmbeddings = await ai.embed(documents);

    const similarities = docEmbeddings.map((emb, i) => ({
        document: documents[i],
        score: cosineSimilarity(queryEmbedding[0], emb)
    }));

    return similarities.sort((a, b) => b.score - a.score);
}

function cosineSimilarity(a, b) {
    const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return dot / (magA * magB);
}
```

WebGPU brings near-native AI performance to web applications with zero installation.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
