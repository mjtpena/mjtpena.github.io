---
title: "Azure Static Web Apps Preview Auth: Roles, Invites and Limits"
description: "How auth really works in the Azure Static Web Apps preview: five managed providers, invitation-based roles, routes.json rules and hard limits."
author: Michael John Pena
draft: false
date: 2021-01-16
url: /blog/azure-static-web-apps-custom-authentication/
tags:
  - Azure
  - Static Web Apps
  - Authentication
  - Serverless
  - Security
---

Azure Static Web Apps has been in public preview since Build 2020, and the built-in authentication is one of the main reasons to use it over hand-rolled hosting. It is also where teams get caught out. People arrive expecting App Service-style "bring your own identity provider" and find a managed, opinionated system with a short list of knobs. If you know where those limits are before you design your app, you will make better choices about what to host here and what not to.

If you haven't stood up a Static Web App yet, start with my [portfolio setup walkthrough](/blog/2020-08-27-setting-up-azure-static-web-apps/), and see the [managed Functions post](/blog/2020-10-27-azure-static-web-apps-functions/) for the API side.

## What the platform manages for you

Every Static Web App gets authentication with no configuration. The [authentication and authorisation docs](https://learn.microsoft.com/azure/static-web-apps/authentication-authorization) for the preview list five providers, all enabled by default:

| Provider | Login route | Identifies the user by |
|---|---|---|
| Azure Active Directory | `/.auth/login/aad` | Email address |
| Facebook | `/.auth/login/facebook` | Email address |
| GitHub | `/.auth/login/github` | Username |
| Google | `/.auth/login/google` | Email address |
| Twitter | `/.auth/login/twitter` | Username |

Logout is `/.auth/logout`, and both login and logout accept `post_login_redirect_uri` and `post_logout_redirect_uri` query string parameters so you can send users back to a specific page.

The key word is *managed*. During the preview, you don't register an app in Azure AD, you don't supply a client ID or secret, and you can't add an OpenID Connect provider of your own. The platform owns those registrations. That is the whole value proposition: zero identity plumbing. It is also the whole constraint.

One consequence I want to call out because it trips people up: the `aad` provider isn't tied to your tenant. Signing in with Azure AD proves the user has an account; it does not prove they belong to your organisation. Authentication tells you *who*. Authorisation, through roles, is what keeps strangers out.

## Roles come from invitations, not from your identity provider

Every visitor belongs to the built-in `anonymous` role, and every signed-in user also belongs to `authenticated`. Anything beyond that is a custom role you invent, and users get custom roles in exactly one way during the preview: an invitation.

In the portal, under **Role Management**, you pick a provider, enter the user's email address or username (depending on the provider, per the table above), choose the domain, list the roles, and set an expiry of up to 168 hours. The portal generates a link; you send it. When the user follows it and signs in with that provider, they're assigned those roles.

Three details matter for design:

- **Invitations are per provider.** Invite someone as a GitHub user and they get the role only when they sign in with GitHub. If they come back through Google, they're just `authenticated`.
- **There's a hard cap.** The [preview quotas](https://learn.microsoft.com/azure/static-web-apps/quotas) allow a maximum of 25 end users invited and assigned roles per app. When the limit is hit, sign-ups fail with `Unauthorized_TooManyUsers`.
- **Roles don't come from claims.** Your Azure AD group memberships and app roles aren't read. There's no hook to look roles up from a database at sign-in, either.

That last point is where effort gets wasted. A common mistake is storing role assignments in Cosmos DB and expecting the platform to read them. It won't. `userRoles` in the client principal only ever reflects the built-ins plus invitations. You can keep your own permissions table and enforce it inside your API code, but route rules will never see it.

## Shaping access with routes.json

All of the authorisation configuration lives in `routes.json`, which must sit at the root of your build output (`public` for React and Vue, `assets` for Angular, `wwwroot` for Blazor). The [routes docs](https://learn.microsoft.com/azure/static-web-apps/routes) explain the rules: they're evaluated in order, matching stops at the first hit, and `allowedRoles` is an OR list. (The preview-era `routes.json` reference has since been folded into the configuration docs, so that link now lands on the newer format.)

This is the file I start from for an internal tool:

```json
{
  "routes": [
    {
      "route": "/.auth/login/twitter",
      "statusCode": "404"
    },
    {
      "route": "/.auth/login/facebook",
      "statusCode": "404"
    },
    {
      "route": "/.auth/login/google",
      "statusCode": "404"
    },
    {
      "route": "/.auth/login/github",
      "statusCode": "404"
    },
    {
      "route": "/login",
      "serve": "/.auth/login/aad"
    },
    {
      "route": "/logout",
      "serve": "/.auth/logout"
    },
    {
      "route": "/admin/*",
      "serve": "/index.html",
      "allowedRoles": ["administrator"]
    },
    {
      "route": "/api/admin/*",
      "allowedRoles": ["administrator"]
    },
    {
      "route": "/api/*",
      "allowedRoles": ["authenticated"]
    },
    {
      "route": "/*",
      "serve": "/index.html",
      "statusCode": 200
    }
  ],
  "platformErrorOverrides": [
    {
      "errorType": "Unauthenticated",
      "statusCode": "302",
      "serve": "/login"
    },
    {
      "errorType": "Unauthorized_MissingRoles",
      "serve": "/forbidden.html"
    }
  ]
}
```

What each block is doing, and why:

- **Blocking providers.** Returning a 404 on a provider's login route is the only way to turn it off. I block everything except Azure AD, the one provider my invitations use, so nobody can sign in through a side door and wonder why they have no roles. Be careful here: block the provider your invitations rely on and nobody can accept them.
- **Friendly routes.** `/login` and `/logout` hide the `/.auth` system folder and make it easy to switch the default provider later.
- **Specific before general.** `/api/admin/*` must appear before `/api/*`, and the SPA fallback goes last. Order is the most common bug in these files. Rules don't chain either: once `/admin/*` matches, evaluation stops, so it needs its own `serve` of `/index.html` or a deep link such as `/admin/reports` returns a 404 instead of reaching the SPA fallback.
- **Error overrides.** Without the `Unauthenticated` override, anonymous users hitting a protected page get a bare 401. Redirecting them to `/login` is almost always what you want for pages. The trade-off is that the override also applies to `/api/*`, so an anonymous `fetch('/api/...')` follows the redirect into the sign-in flow instead of getting a 401 it can handle, which usually surfaces as a failed fetch or a non-JSON body. Check `/.auth/me` before calling the API, or treat a redirected, failed or non-JSON response as "signed out" in your client code. `Unauthorized_MissingRoles` gives signed-in users without the role a page that explains what to do.

Note that route rules for API paths only support role checks and redirects, and `routes.json` is limited to 100 KB and 50 distinct roles.

## Reading the user in the front end and API

The browser can ask `/.auth/me` for the current client principal. It returns `{ "clientPrincipal": null }` for anonymous users, and it doesn't involve a function cold start, so use it for UI state:

```javascript
async function getClientPrincipal() {
  const response = await fetch("/.auth/me");
  const payload = await response.json();
  return payload.clientPrincipal;
}

getClientPrincipal().then((principal) => {
  const label = principal
    ? `Signed in as ${principal.userDetails} (${principal.userRoles.join(", ")})`
    : "Not signed in";
  document.getElementById("user-status").textContent = label;
});
```

Treat that as display logic only. Hiding a button doesn't secure anything; the route rules and your API do. Role removal isn't instant either: the docs warn that removing a user can take a few minutes to propagate worldwide, so the server-side check below is the real gate.

In managed Functions, the platform passes the same principal as a Base64-encoded JSON string in the `x-ms-client-principal` header, as described in the [user information docs](https://learn.microsoft.com/azure/static-web-apps/user-information). The routes file already gates `/api/admin/*`, but I still check in code. Route files get edited, rules get reordered, and a second check costs a few lines. This is the `index.js` half of a standard HTTP-trigger function:

```javascript
// api/admin-report/index.js
function getClientPrincipal(req) {
  const header = req.headers["x-ms-client-principal"];
  if (!header) {
    return null;
  }
  const decoded = Buffer.from(header, "base64").toString("utf8");
  return JSON.parse(decoded);
}

module.exports = async function (context, req) {
  const principal = getClientPrincipal(req);

  if (!principal || !principal.userRoles.includes("administrator")) {
    context.res = { status: 403, body: { error: "Administrator role required" } };
    return;
  }

  context.res = {
    status: 200,
    body: {
      requestedBy: principal.userDetails,
      provider: principal.identityProvider,
      generatedAt: new Date().toISOString()
    }
  };
};
```

And the `function.json` beside it, which binds the trigger and gives it the `/api/admin/report` route:

```json
{
  "bindings": [
    {
      "authLevel": "anonymous",
      "type": "httpTrigger",
      "direction": "in",
      "name": "req",
      "methods": ["get"],
      "route": "admin/report"
    },
    {
      "type": "http",
      "direction": "out",
      "name": "res"
    }
  ]
}
```

Key anything you store on `userId`, not `userDetails`. The `userId` is unique per app and stable for that user, while usernames and emails change. Be aware, though, that if you remove a user and invite them back, they get a new `userId`.

## Where "custom" authentication stops

Here's the honest list of what you can't do in the preview:

- Use your own Azure AD app registration, restrict sign-in to one tenant, or use Azure AD B2C, Auth0, Okta or any other OpenID Connect provider.
- Map identity provider claims or groups to roles.
- Assign roles from code or a database at sign-in.
- Go past 25 users with custom roles.
- Get a production SLA. The service is still preview and the docs say it isn't intended for production use.

You can work around some of this. A SPA can acquire tokens from your own identity provider with a library like MSAL.js and send them to an API that validates them itself. But then `routes.json` and `/.auth/me` know nothing about that identity, so you're running two auth systems side by side. At that point I'd rather host the API somewhere I control the authentication end to end, such as a standalone Function App or App Service with its own Azure AD registration.

## When I'd use it, and when I wouldn't

My rule of thumb: the built-in auth is a strong fit when the audience is small and known, or when "signed in with GitHub" is all the authorisation you need. That covers internal dashboards for a team, admin areas on a marketing site, community tools, and docs gated to contributors. For those, you get working sign-in, roles and protected APIs with one JSON file and no secrets to rotate, which is a good trade.

I wouldn't use it, during the preview, for anything that needs tenant-restricted sign-in, more than 25 privileged users, roles driven by your directory, or a customer-facing identity experience. Those needs aren't edge cases you can configure around. They mean you need an identity layer the preview doesn't offer yet. Pick the host based on that early, rather than discovering it after the front end is built.
