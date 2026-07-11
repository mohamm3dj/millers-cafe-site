# Design QA — Aurora Glass desktop homepage

## Scope

- Selected reference: Aurora Glass desktop direction using the existing Millers palette.
- Implementation scope: desktop homepage at 960px and above.
- Regression scope: existing mobile homepage and all current routes remain intact.

## Visual comparison

- Compared the reference and implementation together at a normalized 1280 × 720 desktop viewport.
- Rechecked the finished page at 1280 × 720, 1024 × 768, and a 390 × 844 mobile frame.
- Desktop hierarchy, split hero, overlapping food imagery, glass navigation, action band, category rail, spacing, radii, and teal/navy colour balance match the selected direction.
- The canonical Millers logo and real generated food photography are used throughout.

## Blocking findings and resolutions

- P0: none found.
- P1: desktop hero assets could be selected on mobile. Resolved with responsive picture sources plus lazy fallbacks; the 390px check loaded no desktop hero sources.
- P1: desktop fonts were initially global. Resolved by scoping the font faces and preloads to the desktop experience; the mobile frame retains its original font stack and does not load the desktop face.
- P2: ordering copy could imply checkout was available while ordering was paused. Resolved with safe default copy and live copy driven by `orders.onlineOrderingEnabled`.
- P2: small utility and glass-card labels were below 12px. Resolved by increasing all new desktop supporting labels to at least 12px.
- P2: the desktop navigation was inside the main landmark. Resolved by moving it to a header landmark and adding a skip-to-content link.
- P2: category link names repeated image alt text. Resolved by treating adjacent category thumbnails as decorative.
- P2: generated PNG masters added deployment weight. Resolved by shipping only optimized WebP assets; the six final food images total about 624KB.

## Functional and accessibility checks

- Primary menu and booking CTAs navigate to the correct existing routes.
- All homepage destinations return successful local responses.
- No broken visible images or duplicate IDs were found.
- Desktop Manrope and Urbanist faces load successfully.
- Visible desktop content has one H1 and no horizontal overflow.
- Core controls have visible focus styles, reduced-motion handling, and at least 44px target height where appropriate.
- Mobile shows the original hero and tile grid, hides all desktop-only UI, and has no horizontal overflow at 390px.
- Automated suite: 119 tests passed; JavaScript syntax and production build passed.

final result: passed
