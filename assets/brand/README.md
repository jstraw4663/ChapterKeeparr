# ChapterKeeparr brand assets

Original artwork supplied by Jeremy in `ChapterKeeparr-Brand-Kit.zip` on 2026-10-20. Logos retain their supplied colors and outlined wordmarks. Source guidance is in BRAND-KIT.md; its paths describe the original ZIP, not this curated integration.

- App: local theme-specific simplified marks (<=32px) and outlined wordmarks in `app/static/brand`. The app theme, including an explicit preference over system theme, selects the matching asset.
- Browser/PWA: supplied favicon, Apple 180px and normal 192/512px icons, with separate safe-zone maskable 192/512px icons. No full-size icon is incorrectly declared maskable.
- Container: `container-icon.png` (256px) is referenced by both Unraid templates. Existing installed containers may need their Icon field refreshed from the updated template; replacing a Docker image alone does not change the Unraid template.
- README: original theme-specific horizontal SVG logos. The supplied social preview is available for manual upload in GitHub repository Settings; no repository setting is changed automatically.
- Social card: the supplied `og-image.png` is available under `/static/brand/`; app metadata describes current audiobook repair capabilities, not unimplemented integrations.

Jeremy approved the full palette and Manrope typography, including a Paper save button, on 2026-10-20. Supplied Medium 500 and ExtraBold 800 faces are converted without subsetting to local WOFF2 (body and heading weight ranges); app/static/fonts/OFL.txt retains their license/copyright. Tokens live in app/static/tokens.css and docs/design/tokens.css. Warning text uses a darker amber on light surfaces for AA contrast; green/red status semantics are retained. No runtime font or asset download from an external host is added. Consent gating stays unchanged.
