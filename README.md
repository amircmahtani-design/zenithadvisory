# Zenith Advisory Services — current website source

This repository contains a recoverable copy of the currently published static website at https://zenithadvisory.ae, downloaded from its live Netlify deployment on 29 October 2026. The existing Netlify deployment was a manual upload and had no source repository attached. This repository has been created to establish GitHub as the source of truth going forward.

## Pages
- `index.html` — Home
- `about.html`
- `approach.html`
- `contact.html`
- `industries.html`
- `services.html`
- `privacy.html`
- `terms.html`

The pages currently include their page styles/content inline and continue to reference externally hosted assets already used by the live site. `netlify.toml` sets the repository root as the static publish directory.

## Deployment
Netlify should be connected to this repository on branch `main` with no build command and publish directory `.`. Do not change the production domain or publish a redesigned version until the owner reviews it.
