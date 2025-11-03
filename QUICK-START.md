# Quick Start Guide - Creating New Blog Posts

## Create a New Blog Post

```bash
# Using the blog archetype (recommended for blog posts)
hugo new content/blog/2025/my-awesome-post.md --kind blog

# Using default archetype
hugo new content/blog/2025/my-post.md
```

## Essential Frontmatter Template

```yaml
---
title: "Your Compelling Title (Under 60 Characters)"
date: 2025-11-03T10:00:00+10:00
draft: false
author: "Michael John Peña"
description: "SEO description: 150-160 characters that will appear in search results and social shares"
summary: "Brief summary for post listings and RSS feeds"
tags: ["Azure", "AI", "Cloud"]
categories: ["Technology"]
cover:
  image: "/2025/11/featured-image.jpg"
  alt: "Descriptive alt text for accessibility"
  caption: "Optional image caption"
  relative: false
  hidden: false
ShowToc: true
TocOpen: false
---
```

## Frontmatter Field Reference

| Field | Required | Purpose | Example |
|-------|----------|---------|---------|
| `title` | ✅ | Post title (SEO) | "Getting Started with Azure OpenAI" |
| `date` | ✅ | Publication date | `2025-11-03T10:00:00+10:00` |
| `draft` | ✅ | Draft status | `false` to publish |
| `description` | ⭐ | SEO meta description | 150-160 characters |
| `summary` | ⭐ | Post preview | Brief excerpt |
| `tags` | ⭐ | Specific keywords | `["Azure", "OpenAI"]` |
| `categories` | ⭐ | Broad topics | `["Cloud", "AI"]` |
| `cover.image` | ⭐ | Featured image | `/2025/11/image.jpg` |
| `cover.alt` | ⭐ | Image alt text | "Azure OpenAI dashboard" |
| `author` | Recommended | Author name | "Michael John Peña" |
| `ShowToc` | Optional | Show table of contents | `true` for long posts |

⭐ = Highly recommended for SEO

## Image Guidelines

### Featured Images (cover.image)
- **Size**: 1200x630px (optimal for social sharing)
- **Format**: JPG or PNG (WebP recommended)
- **Location**: `/static/2025/11/image-name.jpg`
- **Reference**: `/2025/11/image-name.jpg`

### In-Post Images
```markdown
![Alt text describing the image](/2025/11/screenshot.png "Optional caption")
```

## Markdown Tips

### Headers
```markdown
## Main Section (H2)
### Subsection (H3)
#### Detail (H4)
```

### Code Blocks
````markdown
```python
def hello_world():
    print("Hello, World!")
```
````

### Links
```markdown
[Link text](https://example.com)
[Internal link](/blog/other-post/)
```

### Lists
```markdown
- Bullet point
- Another point

1. Numbered item
2. Another item
```

### Callouts/Quotes
```markdown
> This is a blockquote
> Can span multiple lines
```

## Local Development

```bash
# Start development server (shows drafts)
hugo server -D

# Start without drafts
hugo server

# Build for production
hugo

# Create new post
hugo new content/blog/2025/$(date +%Y-%m-%d)-my-post.md --kind blog
```

## Publishing Checklist

Before publishing (setting `draft: false`):

- [ ] Title is compelling and under 60 characters
- [ ] Description is 150-160 characters
- [ ] Summary is written
- [ ] At least 3 relevant tags added
- [ ] Category assigned
- [ ] Featured image added (1200x630px)
- [ ] Alt text for featured image
- [ ] All images have alt text
- [ ] Internal links added where relevant
- [ ] Code blocks have language specified
- [ ] Spell check completed
- [ ] Preview looks good locally

## Category Suggestions

- **Cloud** - Azure, AWS, GCP content
- **AI** - Machine learning, AI tools
- **Development** - Coding, tools, practices
- **Career** - Professional development
- **Productivity** - Tips and workflows
- **Data** - Data engineering, analytics
- **Tutorial** - How-to guides

## Tag Best Practices

- Use 3-7 tags per post
- Be specific (e.g., "Azure OpenAI" not just "AI")
- Check existing tags: `/tags/` on your site
- Use lowercase for consistency
- Combine broad and specific tags

## Example Complete Post

```markdown
---
title: "How to Deploy Azure OpenAI in Production"
date: 2025-11-03T10:00:00+10:00
draft: false
author: "Michael John Peña"
description: "Complete guide to deploying Azure OpenAI in production environments with security best practices and cost optimization tips"
summary: "Learn how to deploy and scale Azure OpenAI in production with proper security, monitoring, and cost management"
tags: ["Azure", "OpenAI", "Cloud", "Production", "AI"]
categories: ["Cloud", "AI"]
cover:
  image: "/2025/11/azure-openai-production.jpg"
  alt: "Azure OpenAI architecture diagram"
  caption: "Production deployment architecture"
  relative: false
  hidden: false
ShowToc: true
TocOpen: false
---

## Introduction

Brief introduction to the topic...

## Prerequisites

- Azure subscription
- Basic knowledge of Azure

## Step 1: Setup

Detailed steps...

## Conclusion

Summary and key takeaways...
```

## Getting Help

- Hugo docs: https://gohugo.io/documentation/
- PaperMod theme: https://github.com/adityatelange/hugo-PaperMod
- Markdown guide: https://www.markdownguide.org/

---

**Happy blogging! 🚀**
