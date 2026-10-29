# Zenith Advisory Services — current website source

This repository contains a recoverable copy of the currently published static website at https://zenithadvisory.ae, downloaded from its live Netlify deployment on 29 October 2026. The previous Netlify deploy was a manual upload and had no source repository attached. This repository establishes GitHub as the source of truth going forward.

## Pages
- `index.html` — Home
- `about.html`
- `approach.html`
- `contact.html`
- `industries.html`
- `services.html`
- `privacy.html`
- `terms.html`

The captured pages include page content and styles inline. The live page currently loads its hero image from Unsplash and typography from Google Fonts. The original Zenith logo is included at `assets/brand/Zenith_Logo_Original.jpeg`. See `ASSETS.md` for details. `netlify.toml` sets the repository root as the static publish directory.

## Netlify deployment settings
Connect this repository on branch `main`, use no build command, and set publish directory to `.`. Keep the existing production domain. Do not publish a redesigned version until the owner reviews it.
