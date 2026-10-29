# Assets

- `assets/brand/Zenith_Logo_Original.jpeg`: original Zenith Advisory Services logo artwork (navy and warm gold summit).
- `assets/img/zenith-*.svg`: vector versions traced from that artwork: full logo, horizontal lockup and summit mark, each in navy and light (for dark backgrounds). `favicon.svg` and the PNG favicons are made from the mark.
- `assets/hero/zenith-homepage-hero-desktop.png` and `zenith-homepage-hero-mobile.png`: the supplied hero artwork (Dubai skyline, illuminated limestone staircase, Zenith summit mark). Web versions: `assets/img/hero-desktop.webp` (desktop and landscape screens), `assets/img/hero-mobile.webp` (upright phones and tablets), `assets/img/hero-desktop-1200.webp` (inner page headers) and `assets/img/og-zenith.jpg` (social sharing). To update the mobile hero, replace `hero-mobile.webp` with the new artwork at a similar portrait ratio (about 9:16).
- `assets/img/work/*.webp`: homepage screenshots of the live portfolio websites, captured 29 October 2026.
- Typography: Cormorant Garamond and Jost from Google Fonts. Jost TTF files are bundled in `admin/fonts/` for PDF documents (SIL Open Font License).
- `admin/vendor/`: pdf-lib 1.17.1 and @pdf-lib/fontkit 1.1.1 (MIT).

The approved visual reference from the handoff package is a design reference only; numbers in its invoice and receipt mockups are illustrative and are not used anywhere in the site or documents.

## Page heroes

`assets/img/hero/{page}-laptop.webp` (from 1920 x 1080 PNG) and `{page}-mobile.webp` (from 1080 x 1920 PNG) for advisory, website-design, work, about and contact. The laptop image is used on desktop and landscape screens, the mobile image on upright phones and tablets. The mobile images are separate portrait renderings of each scene, not crops of the laptop images. To replace one, export a new image at the same size and convert it to WebP with the same file name.
