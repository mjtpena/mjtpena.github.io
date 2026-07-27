---
title: "Azure Immersive Reader: Building Accessible Reading Experiences"
author: Michael John Peña
draft: false
date: 2022-03-08
tags:
  - Azure
  - Cognitive Services
  - Accessibility
  - Education
  - AI

---

I wrote "Azure Immersive Reader: Building Accessible Reading Experiences" to share practical, production-minded guidance on this topic.

## What Immersive Reader Offers

The service provides:
- **Read Aloud**: Text-to-speech with word highlighting
- **Text Preferences**: Font size, spacing, and background colors
- **Grammar Tools**: Syllable breaking, parts of speech highlighting
- **Translation**: 60+ languages for text and UI
- **Picture Dictionary**: Visual representations of words
- **Focus Mode**: Line-by-line reading

## Setting Up Immersive Reader

Create the Azure resource and get your credentials:

```bash
# Create resource
az cognitiveservices account create \
    --name my-immersive-reader \
    --resource-group myResourceGroup \
    --kind ImmersiveReader \
    --sku S0 \
    --location westus \
    --yes

# Get credentials
az cognitiveservices account keys list \
    --name my-immersive-reader \
    --resource-group myResourceGroup
```

## Web Integration

Add Immersive Reader to a web application:

```html
<!DOCTYPE html>
<html>
<head>
    <title>Reading App with Immersive Reader</title>
    <style>
        .content {
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            font-family: Georgia, serif;
            line-height: 1.8;
        }
        .ir-button {
            position: fixed;
            top: 20px;
            right: 20px;
            background: #0078d4;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
        }
        .ir-button:hover {
            background: #106ebe;
        }
    </style>
</head>
<body>
    <button class="ir-button" onclick="launchImmersiveReader()">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
            <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
        </svg>
        Immersive Reader
    </button>

    <div class="content" id="content">
        <h1 id="title">The Science of Reading</h1>
        <p id="article">Reading is a complex cognitive process that involves decoding symbols
        to derive meaning. When we read, our brains perform multiple tasks simultaneously:
        recognizing letters and words, understanding grammar, making inferences, and
        connecting new information to existing knowledge.</p>
        <p>Research shows that different reading strategies work better for different
        types of learners. Some people benefit from hearing text read aloud, while
        others prefer visual cues like highlighting or increased spacing between words.</p>
    </div>

    <script src="https://ircdname.azureedge.net/immersivereadersdk/immersive-reader-sdk.1.4.0.js"></script>
    <script>
        async function getTokenAndSubdomain() {
            const response = await fetch('/api/immersive-reader/token');
            return await response.json();
        }

        async function launchImmersiveReader() {
            const tokenData = await getTokenAndSubdomain();

            const content = {
                title: document.getElementById('title').innerText,
                chunks: [
                    {
                        content: document.getElementById('article').innerText,
                        lang: 'en',
                        mimeType: 'text/plain'
                    }
                ]
            };

            const options = {
                uiLang: 'en',
                timeout: 15000,
                onExit: () => console.log('Immersive Reader closed'),
                customDomain: tokenData.subdomain
            };

            ImmersiveReader.launchAsync(
                tokenData.token,
                tokenData.subdomain,
                content,
                options
            ).catch(function (error) {
                console.error('Error launching Immersive Reader:', error);
            });
        }
    </script>
</body>
</html>
```

## Server-Side Token Generation

Create an API endpoint to generate tokens:

```python
from flask import Flask, jsonify
import requests
import os

app = Flask(__name__)

@app.route('/api/immersive-reader/token')
def get_token():
    tenant_id = os.environ['IR_TENANT_ID']
    client_id = os.environ['IR_CLIENT_ID']
    client_secret = os.environ['IR_CLIENT_SECRET']
    subdomain = os.environ['IR_SUBDOMAIN']

    # Get Azure AD token
    token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/token"

    token_data = {
        'grant_type': 'client_credentials',
        'client_id': client_id,
        'client_secret': client_secret,
        'resource': 'https://cognitiveservices.azure.com/'
    }

    response = requests.post(token_url, data=token_data)
    token_response = response.json()

    return jsonify({
        'token': token_response['access_token'],
        'subdomain': subdomain
    })

if __name__ == '__main__':
    app.run(debug=True)
```

## Node.js/Express Implementation

```javascript
const express = require('express');
const axios = require('axios');
const router = express.Router();

router.get('/token', async (req, res) => {
    const tenantId = process.env.IR_TENANT_ID;
    const clientId = process.env.IR_CLIENT_ID;
    const clientSecret = process.env.IR_CLIENT_SECRET;
    const subdomain = process.env.IR_SUBDOMAIN;

    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/token`;

    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    params.append('resource', 'https://cognitiveservices.azure.com/');

    try {
        const response = await axios.post(tokenUrl, params);

        res.json({
            token: response.data.access_token,
            subdomain: subdomain
        });
    } catch (error) {
        console.error('Token error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to get token' });
    }
});

module.exports = router;
```

## React Component

Create a reusable React component:

```jsx
import React, { useCallback } from 'react';
import { launchAsync } from '@microsoft/immersive-reader-sdk';

const ImmersiveReaderButton = ({ title, content, language = 'en' }) => {
    const handleLaunch = useCallback(async () => {
        try {
            // Get token from your API
            const response = await fetch('/api/immersive-reader/token');
            const { token, subdomain } = await response.json();

            const irContent = {
                title: title,
                chunks: [{
                    content: content,
                    lang: language,
                    mimeType: 'text/plain'
                }]
            };

            const options = {
                uiLang: language,
                timeout: 15000,
                preferences: {
                    textSize: 'medium',
                    textSpacing: 'normal',
                    hideTranslation: false
                }
            };

            await launchAsync(token, subdomain, irContent, options);
        } catch (error) {
            console.error('Immersive Reader error:', error);
        }
    }, [title, content, language]);

    return (
        <button onClick={handleLaunch} className="ir-button">
            <ImmersiveReaderIcon />
            Open in Immersive Reader
        </button>
    );
};

const ImmersiveReaderIcon = () => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
        <path d="M10 3.75C6.25 3.75 2.94 6.34 1.67 10c1.27 3.66 4.58 6.25 8.33 6.25s7.06-2.59 8.33-6.25c-1.27-3.66-4.58-6.25-8.33-6.25zm0 10.42c-2.3 0-4.17-1.87-4.17-4.17S7.7 5.83 10 5.83s4.17 1.87 4.17 4.17-1.87 4.17-4.17 4.17zm0-6.67c-1.38 0-2.5 1.12-2.5 2.5s1.12 2.5 2.5 2.5 2.5-1.12 2.5-2.5-1.12-2.5-2.5-2.5z"/>
    </svg>
);

export default ImmersiveReaderButton;
```

## Advanced Content Formatting

Support rich content with HTML:

```javascript
const richContent = {
    title: 'Chemistry Lesson',
    chunks: [
        {
            content: '<h2>Water Molecule</h2><p>A water molecule (H<sub>2</sub>O) consists of two hydrogen atoms and one oxygen atom.</p>',
            lang: 'en',
            mimeType: 'text/html'
        },
        {
            content: '<p>The formula can be written as: H<sub>2</sub>O</p>',
            lang: 'en',
            mimeType: 'text/html'
        }
    ]
};

// Launch with HTML content
ImmersiveReader.launchAsync(token, subdomain, richContent, {
    uiLang: 'en',
    // Enable math rendering
    displayOptions: {
        mathType: 'LaTeX'  // or 'MathML'
    }
});
```

## Math Content Support

Display mathematical formulas:

```javascript
const mathContent = {
    title: 'Quadratic Formula',
    chunks: [
        {
            content: 'The quadratic formula is used to solve equations of the form ax² + bx + c = 0',
            lang: 'en',
            mimeType: 'text/plain'
        },
        {
            // LaTeX math content
            content: '$$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$',
            lang: 'en',
            mimeType: 'text/html'
        }
    ]
};
```

## Customizing the Experience

Configure reader options:

```javascript
const options = {
    uiLang: 'en',
    timeout: 15000,

    // UI customization
    uiZIndex: 1000,

    // Callbacks
    onExit: () => {
        console.log('Reader closed');
        trackAnalytics('immersive_reader_exit');
    },

    // Preferences (saved per user)
    preferences: {
        textSize: 'large',          // 'small', 'medium', 'large', 'extraLarge'
        textSpacing: 'wide',        // 'normal', 'wide', 'extraWide'
        hideTranslation: false,
        readerFont: 'Calibri',      // 'Calibri', 'Comic Sans', 'Sitka'
        hideVoiceSpeed: false,
        hideLanguagePicker: false
    },

    // Display options
    displayOptions: {
        mathType: 'LaTeX',          // Math rendering
        imageType: 'none'           // 'none', 'noun', 'verb'
    }
};
```

## Handling Multiple Languages

Support multilingual content:

```javascript
const multilingualContent = {
    title: 'Multilingual Article',
    chunks: [
        {
            content: 'This paragraph is in English.',
            lang: 'en',
            mimeType: 'text/plain'
        },
        {
            content: 'Este párrafo está en español.',
            lang: 'es',
            mimeType: 'text/plain'
        },
        {
            content: '这段是中文。',
            lang: 'zh-Hans',
            mimeType: 'text/plain'
        }
    ]
};

// The reader will detect and handle each language appropriately
ImmersiveReader.launchAsync(token, subdomain, multilingualContent, {
    uiLang: 'en'  // UI language
});
```

## Analytics and Tracking

Track usage for insights:

```javascript
const analyticsOptions = {
    onExit: (exitReason) => {
        // exitReason: 'CloseButton', 'Timeout', 'Error', etc.
        trackEvent('immersive_reader_session', {
            exitReason: exitReason,
            duration: sessionDuration,
            contentLength: content.length
        });
    },

    onPreferencesChanged: (preferences) => {
        // Track preference changes to understand user needs
        trackEvent('immersive_reader_preferences', preferences);
    }
};
```

## Accessibility Compliance

Ensure your implementation is accessible:

```html
<!-- Accessible button implementation -->
<button
    class="ir-button"
    onclick="launchImmersiveReader()"
    aria-label="Open in Immersive Reader for enhanced reading experience"
    title="Opens a reading tool with text-to-speech, translation, and visual aids">
    <svg aria-hidden="true" focusable="false">...</svg>
    <span>Immersive Reader</span>
</button>

<!-- Provide alternative for users who can't use Immersive Reader -->
<noscript>
    <p>JavaScript is required for the Immersive Reader feature.
    Please enable JavaScript or use the print-friendly version.</p>
</noscript>
```

## Mobile Considerations

Optimize for mobile devices:

```javascript
const mobileOptions = {
    // Full screen on mobile
    uiZIndex: 9999,

    // Responsive sizing
    hideExitButton: false,  // Keep visible on mobile

    preferences: {
        textSize: window.innerWidth < 768 ? 'medium' : 'large',
        textSpacing: 'normal'  // Save screen space on mobile
    }
};

// Detect mobile and adjust
function getImmersiveReaderOptions() {
    const isMobile = window.innerWidth < 768;

    return {
        ...baseOptions,
        preferences: {
            ...baseOptions.preferences,
            textSize: isMobile ? 'medium' : 'large'
        }
    };
}
```

## Error Handling

Handle errors gracefully:

```javascript
async function launchImmersiveReaderSafe(content) {
    try {
        const tokenData = await getToken();

        await ImmersiveReader.launchAsync(
            tokenData.token,
            tokenData.subdomain,
            content,
            options
        );
    } catch (error) {
        if (error.code === 'TokenExpired') {
            // Refresh token and retry
            await refreshToken();
            return launchImmersiveReaderSafe(content);
        } else if (error.code === 'Timeout') {
            showNotification('Connection timeout. Please try again.');
        } else if (error.code === 'ContentTooLong') {
            // Split content into smaller chunks
            showNotification('Content is too long. Showing first section.');
            const truncated = truncateContent(content);
            return launchImmersiveReaderSafe(truncated);
        } else {
            console.error('Immersive Reader error:', error);
            showNotification('Unable to open Immersive Reader. Please try again later.');
        }
    }
}
```

## Conclusion

Azure Immersive Reader democratizes reading by providing tools that adapt to each reader's needs. Whether building educational applications, content platforms, or accessibility features, Immersive Reader offers a powerful, ready-to-use solution that genuinely helps users engage with text.

Key benefits:
- Improves reading comprehension for all users
- Supports learning differences like dyslexia
- Enables multilingual content consumption
- Requires minimal implementation effort

## Resources

- [Immersive Reader Documentation](https://docs.microsoft.com/en-us/azure/cognitive-services/immersive-reader/)
- [SDK Reference](https://docs.microsoft.com/en-us/azure/cognitive-services/immersive-reader/reference)
- [Accessibility Best Practices](https://docs.microsoft.com/en-us/azure/cognitive-services/immersive-reader/accessibility)

