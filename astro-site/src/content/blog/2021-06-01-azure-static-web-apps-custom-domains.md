---
title: Azure Static Web Apps Custom Domains Configuration
author: Michael John Peña
draft: false
date: 2021-06-01
url: /blog/azure-static-web-apps-custom-domains/
tags:
  - Azure
  - Static Web Apps
  - Web Development

---

I wrote "2021-06-01-azure-static-web-apps-custom-domains" to share practical, production-minded guidance on this topic.

## Prerequisites

Before you begin, ensure you have:
- An Azure subscription
- An existing Azure Static Web App deployed
- Access to your domain's DNS settings
- Azure CLI installed (optional but recommended)

## Understanding Domain Configuration Options

Azure Static Web Apps supports two types of custom domains:

1. **Root domains** (e.g., `example.com`)
2. **Subdomains** (e.g., `www.example.com` or `blog.example.com`)

## Configuring a Subdomain

Subdomains are the simplest to configure. You'll create a CNAME record pointing to your Static Web App's default hostname.

### Step 1: Get Your Default Hostname

```bash
# Using Azure CLI
az staticwebapp show \
  --name my-static-web-app \
  --resource-group my-resource-group \
  --query "defaultHostname" \
  --output tsv
```

This returns something like: `blue-sand-0a1b2c3d4.azurestaticapps.net`

### Step 2: Create CNAME Record

In your DNS provider, create a CNAME record:

| Type  | Name | Value |
|-------|------|-------|
| CNAME | www  | blue-sand-0a1b2c3d4.azurestaticapps.net |

### Step 3: Add Domain in Azure Portal

```bash
# Using Azure CLI
az staticwebapp hostname set \
  --name my-static-web-app \
  --resource-group my-resource-group \
  --hostname "www.example.com"
```

## Configuring a Root Domain (Apex Domain)

Root domains require a different approach since CNAME records aren't supported at the apex level.

### Option 1: Using ALIAS Records (Recommended)

If your DNS provider supports ALIAS or ANAME records:

```
Type: ALIAS
Name: @
Value: blue-sand-0a1b2c3d4.azurestaticapps.net
```

### Option 2: Using Azure DNS

Azure DNS supports alias records natively:

```bash
# Create DNS Zone
az network dns zone create \
  --resource-group my-resource-group \
  --name example.com

# Create alias record
az network dns record-set a create \
  --resource-group my-resource-group \
  --zone-name example.com \
  --name "@" \
  --target-resource "/subscriptions/{sub-id}/resourceGroups/{rg}/providers/Microsoft.Web/staticSites/my-static-web-app"
```

## SSL/TLS Certificates

Azure Static Web Apps automatically provisions and manages free SSL certificates for custom domains. The process is:

1. Domain validation occurs automatically
2. Certificate is provisioned (may take up to 48 hours)
3. Auto-renewal is handled by Azure

### Checking Certificate Status

```bash
az staticwebapp hostname list \
  --name my-static-web-app \
  --resource-group my-resource-group \
  --output table
```

## Configuring Multiple Domains

You can configure multiple custom domains for a single Static Web App:

```bash
# Add primary domain
az staticwebapp hostname set \
  --name my-static-web-app \
  --resource-group my-resource-group \
  --hostname "example.com"

# Add www subdomain
az staticwebapp hostname set \
  --name my-static-web-app \
  --resource-group my-resource-group \
  --hostname "www.example.com"

# Add another subdomain
az staticwebapp hostname set \
  --name my-static-web-app \
  --resource-group my-resource-group \
  --hostname "app.example.com"
```

## Implementing WWW to Root Redirect

Create a `staticwebapp.config.json` file in your app's root:

```json
{
  "routes": [
    {
      "route": "/*",
      "headers": {
        "Cache-Control": "public, max-age=3600"
      }
    }
  ],
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/images/*.{png,jpg,gif}", "/css/*"]
  },
  "responseOverrides": {
    "404": {
      "rewrite": "/404.html"
    }
  }
}
```

For URL canonicalization, implement client-side redirects in your application.

## Troubleshooting Common Issues

### Domain Validation Failed

```bash
# Check DNS propagation
nslookup www.example.com

# Verify CNAME record
dig CNAME www.example.com
```

### Certificate Provisioning Delayed

1. Ensure DNS records are correctly configured
2. Wait up to 48 hours for propagation
3. Check for CAA records that might block certificate issuance

### Adding CAA Record for Azure

```
Type: CAA
Name: @
Value: 0 issue "digicert.com"
```

## Best Practices

1. **Use HTTPS-only**: Azure Static Web Apps enforces HTTPS by default
2. **Configure both root and www**: Redirect one to the other for consistency
3. **Monitor certificate expiration**: Though auto-renewed, set up alerts
4. **Test DNS changes**: Use tools like `dig` or online DNS checkers

## Conclusion

Custom domains transform your Azure Static Web App from a development prototype to a production-ready application. The automatic SSL certificate management removes one of the most tedious aspects of domain configuration. With Azure CLI, you can automate the entire process as part of your infrastructure as code strategy.

## References

- [Azure Static Web Apps Custom Domains Documentation](https://docs.microsoft.com/en-us/azure/static-web-apps/custom-domain)
- [Azure DNS Documentation](https://docs.microsoft.com/en-us/azure/dns/)

