---
title: "Setting Up Azure Static Web Apps (Preview) for Your Portfolio"
description: "After committing to writing again, I needed to ensure my blog infrastructure was solid. Azure Static Web Apps, announced at Build 2020 in May, is currently…"
author: Michael John Peña
draft: false
date: 2020-08-27
tags:
  - Azure
  - Static Web Apps
  - Web Development
---

After committing to writing again, I needed to ensure my blog infrastructure was solid. Azure Static Web Apps, announced at Build 2020 in May, is currently in preview but already looks promising for hosting static sites like a Hugo-based blog.

## Why Try Static Web Apps Preview?

Even in preview, the service offers compelling features:

- Free SSL certificates
- Global CDN distribution
- GitHub Actions integration out of the box
- Staging environments for PRs (preview feature)
- Custom domain support

## Getting Started with the Preview

Since this is a preview service, you will need to sign up through the Azure portal. The setup is straightforward:

```bash
# In your Hugo site directory
az staticwebapp create \
    --name mjp-blog \
    --resource-group personal-rg \
    --source https://github.com/mjtpena/blog \
    --location "East US 2" \
    --branch main \
    --app-location "/" \
    --output-location "public"
```

The GitHub Action is created automatically. Every push to main deploys to production.

## Custom Domain

```bash
az staticwebapp hostname set \
    --name mjp-blog \
    --hostname michaeljohnpena.com
```

## Preview Limitations

As with any preview service, there are some considerations:

- Limited region availability (currently Central US and East US 2)
- Some features may change before GA
- Not recommended for production-critical workloads yet
- Free tier only during preview

## Alternative Options for Production

If you need a production-ready solution today, consider:

- **Azure Blob Storage static website hosting** - GA and stable
- **Azure CDN** - For global distribution
- **Azure App Service** - For more complex scenarios
- **GitHub Pages** - Simple and free for public repos

## My Experience

The whole setup took about 15 minutes. The GitHub integration is seamless, and the automatic PR preview environments are a nice touch for a preview feature.

I am keeping an eye on this service for when it reaches GA. For now, my blog infrastructure is ready, and I have no excuses - time to write!

## Resources

- [Azure Static Web Apps Preview Documentation](https://docs.microsoft.com/en-us/azure/static-web-apps/)
- [Build 2020 Announcement](https://azure.microsoft.com/en-us/blog/build-2020-azure-announcements/)
