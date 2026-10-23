# ChapterKeeparr brand kit

The mark is the **Chapter C**: a C for Chapter holding a sound wave, with one bar turned into a bookmark (Keep). Audio first, book second.

Open `PREVIEW.png` for everything at a glance.

## What goes where

| Need | File |
|---|---|
| Browser tab | `favicon/favicon.svg` + `favicon/favicon.ico` |
| iOS home screen | `pwa/apple-touch-icon.png` (180, square; iOS rounds it) |
| PWA install (Android/desktop) | `pwa/icon-192.png`, `pwa/icon-512.png`, `pwa/icon-maskable-192/512.png` |
| Windows tile | `pwa/mstile-310.png` |
| App icon, any size | `icons/png/dark/` (default) or `icons/png/light/`, 16 to 1024 |
| Mark with no tile | `icons/svg/mark-on-dark.svg`, `mark-on-light.svg` |
| One-color uses (stamps, embroidery, watermark) | `icons/svg/mark-mono-black.svg`, `mark-mono-white.svg` |
| App sidebar / header | `logos/svg/nav-lockup-on-dark.svg` (32px tall) |
| Logo with name | `logos/svg/logo-horizontal-on-{light,dark}.svg` |
| Square-ish spaces (login screen, about page) | `logos/svg/logo-stacked-on-{light,dark}.svg` |
| Name only | `logos/svg/wordmark-on-{light,dark}.svg` |
| GitHub README header | `banners/readme-banner-dark.png` + `-light.png`, snippet in `web/readme-header.md` |
| Link previews (Discord, Slack, iMessage) | `banners/og-image.png` (1200×630) |
| GitHub repo social preview | `banners/github-social-preview.png` (1280×640) |
| Web wiring | `web/head-snippet.html`, `web/site.webmanifest`, `web/brand-tokens.css` |

"on-light" means the file is meant to sit on a light background; "on-dark" on a dark one.

## Small sizes

At 32px and below the icon switches to a **simplified mark**: a heavier C, two bars and the bookmark. The full five-bar version turns to mush that small. The PNGs and favicon already handle this; if you scale an SVG yourself, use `icon-*-small.svg` at 32px and under.

## Palette

| Token | Hex | Use |
|---|---|---|
| Ink | `#1F1D1A` | Primary dark background, icon tile |
| Ink raised | `#2B2925` | Icon tile when it sits on a dark UI |
| Cream | `#F3EDE2` | Bars and text on dark |
| Paper | `#F7F2E8` | Light background, light icon tile |
| Amber | `#E0A83E` | Bookmark accent on dark |
| Amber deep | `#B8801C` | Bookmark accent on light |
| Stone | `#7D766B` | The C on dark |
| Stone light | `#C2B6A0` | The C on light |

Amber is the only accent. Use it for the bookmark and, in the app UI, sparingly for the primary action. No blue, teal or gradients.

## Type

**Manrope** (free, SIL Open Font License), included in `fonts/`. ExtraBold 800 for the name, Medium 500 for supporting text. All logo SVGs have the text converted to outlines, so they render correctly without the font installed.

## Rules

- Keep clear space around the logo equal to the height of the bookmark.
- Don't recolor the C, swap the bookmark to another bar, add effects or put the full-color mark on busy photos (use mono instead).
- The name is always one word, one color: **ChapterKeeparr**.
