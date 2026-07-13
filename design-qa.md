# Design QA — Millers Aurora Glass ordering

## Scope and visual truth

- Source layout target: `/Users/mo/.codex/generated_images/019f4da8-15c7-73e2-a6f3-36cdb5c78784/exec-ccc1b618-2d9b-4026-b148-547cef6eee3d.png` — the selected glass desktop ordering direction.
- Source brand target: `/private/tmp/millers-order-audit/01-home-entry.png` — the accepted Millers desktop homepage and its Aurora Glass visual system.
- Browser-rendered implementation:
  - `/private/tmp/millers-order-glass/implementation-menu-desktop.png`
  - `/private/tmp/millers-order-glass/implementation-checkout-desktop.png`
  - `/private/tmp/millers-order-glass/implementation-menu-mobile.png`
  - `/private/tmp/millers-order-glass/implementation-modifier-mobile.png`
- Primary viewport: 1440 × 1024.
- Responsive viewport: 390 × 844.
- Primary state: collection menu with a populated basket and 10% collection discount.
- Additional states: collection checkout, delivery menu/checkout, search results, item customiser, responsive menu, responsive basket, and return-to-menu.

The user explicitly made the live homepage the source of truth for colour and glass treatment. The generated ordering mock remains the layout and interaction reference; its warm photographic canvas is intentionally replaced by the homepage's exact icy Aurora gradients, navy ink, Millers teal, mint, glass borders, and restrained logo-gold.

## Full-view comparison evidence

The layout target, homepage brand source, and browser-rendered implementation were opened together in one original-resolution comparison input. The implementation preserves the target's major composition: compact brand header, oversized menu heading, three-step progress control, frosted search, horizontal category rail, elevated menu rows, persistent dark basket, pricing breakdown, and one luminous checkout action.

The implementation deliberately follows the homepage for:

- `#0f172a` display ink and `#0f766e → #0d9488` action gradient.
- The homepage's blue/mint Aurora background gradients.
- White glass fills, bright 1px edges, low-contrast navy shadows, 18–24px radii, and Manrope/Urbanist typography.
- The real Millers logo and the existing Tabler-style icon family.

The menu catalogue exposes no item-image URL. The implementation therefore uses real, category-appropriate Tabler icons instead of inventing or repeating inaccurate product photography. This is an intentional data constraint, not a missing placeholder.

## Focused comparison evidence

An additional crop was not required: the 1440 × 1024 source and implementation were inspected at original resolution, where header type, progress numbers, search icon, category states, item prices, add/customise controls, basket quantity controls, discount, total, and CTA label were all readable. The checkout and mobile customiser captures provide focused evidence for the dense form and interaction states that are not present in the single menu mock.

## Required fidelity surfaces

- Fonts and typography: the implementation uses the same bundled Manrope Desktop and Urbanist Desktop files as the homepage. The headline scale, tight display tracking, progress microcopy, item hierarchy, price weight, and dark-panel typography remain readable without truncation at the tested desktop viewport.
- Spacing and layout rhythm: the desktop frame uses the homepage's 1500px shell, 4vw outer gutter, 24px header radius, 22px section gap, and disciplined 18–32px glass radii. Menu and basket proportions stay balanced; the basket action remains visible above the fold.
- Colors and visual tokens: order ink, teal, mint, button gradient, background glows, glass fills, edge opacity, and shadow colour are mapped directly to the homepage system. Gold is limited to the active progress marker and small count accents.
- Image quality and asset fidelity: the canonical WebP logo and real SVG icon assets are used. No emoji, inline SVG, CSS-drawn product art, or fake item imagery is present. The lack of individual item photography is explicitly tied to the live catalogue data model.
- Copy and content: collection/delivery language, allergen guidance, basket quantities, collection discount, delivery fee, Stripe total, checkout labels, consent copy, and policy links remain accurate. The CTA is amount-aware on desktop and explicit on mobile.
- Accessibility and states: focus-visible treatment remains intact; 44px mobile targets are preserved; progress exposes full step labels through `aria-label`; the customiser retains dialog semantics, focus management, Escape handling, and trigger-focus restoration; reduced-motion handling remains in place.

## Comparison history

### Iteration 1 — rejected flat direction

- [P1] The first option-2 implementation was editorial and flat rather than glass.
  - Fix: generated a new glass target and rebuilt the visual layer around the accepted homepage's Aurora design system.
  - Post-fix evidence: `implementation-menu-desktop.png` shows the frosted header, search, category rail, item rows, smoked basket, and teal CTA.

### Iteration 2 — glass cascade and hierarchy

- [P1] The first glass rules appeared before the editorial foundation, so later flat rules won for menu cards and header surfaces.
  - Fix: move the Aurora Glass refinement after the complete layout foundation and bump the versioned stylesheet asset.
  - Post-fix evidence: `implementation-menu-desktop.png`; computed desktop card radius was 22px, header radius 24px, and the homepage glass background was active.
- [P1] Checkout summary rows had no explicit layout, collapsing labels and prices together.
  - Fix: add grid/flex structure, spacing, a distinct glass total panel, and a stable review row.
  - Post-fix evidence: `implementation-checkout-desktop.png`; subtotal, discount/fee, total, item name, and price align in separate columns.
- [P2] The progress control used compressed sentence labels and did not carry the selected target's visual signature.
  - Fix: render numbered circles with concise Menu, Details, and Payment labels while retaining full accessible names.
  - Post-fix evidence: `implementation-menu-desktop.png` and `implementation-checkout-desktop.png`.

### Iteration 3 — order-flow usability

- [P1] Returning from checkout could leave the forced-open desktop basket panel hidden.
  - Fix: reopen the basket whenever desktop returns to step one.
  - Post-fix browser evidence: checkout → Back to dishes returned `basketHidden: false` and `aria-expanded: true`, with focus on menu search.
- [P1] Direct mobile adds and customiser confirmation opened the basket and moved focus away from menu browsing.
  - Fix: keep direct adds in context, announce the added item, quantity and total through the live cart status, update the sticky summary, and open the basket only from View basket.
  - Post-fix browser evidence: direct add left `basketHidden: true`; customiser confirmation restored focus to Customize and left the basket closed.
- [P1] The mobile sticky basket bar could cover a customiser control and remained visible behind an open basket sheet.
  - Fix: reserve scroll clearance for menu actions, mark the basket-open state, hide the redundant sticky bar while open, reset the sheet to its header, and expose the sheet as a focus-trapped mobile dialog with expanded/control semantics on its real opener.
  - Post-fix browser evidence: the customiser trigger worked through the semantic button locator; the open sheet set `isBasketOpen`, hid the sticky bar, and focused Close.
- [P2] Desktop CTA copy was generic and mobile allowed an empty basket action.
  - Fix: use amount-aware `Checkout details · £x.xx`, explicit `View basket`, and disable the mobile basket action until dishes exist.
  - Post-fix evidence: menu and delivery captures show the correct amount-aware actions and totals.

### Iteration 4 — final accessibility and resilience review

- [P1] A transient mobile drawer-open state could be restored on load without moving focus into the sheet.
  - Fix: stop persisting drawer visibility; persist basket contents only. Breakpoint changes now close the transient mobile sheet, reopen the desktop basket, and restore focus to a visible equivalent control.
- [P1] The mobile sticky bar and desktop summary needed explicit viewport safeguards.
  - Fix: add safe-area-aware mobile edges, cap the desktop summary to the viewport with contained scrolling, and consolidate the basket minimum height.
- [P2] Final brand details used near-match teal/gold values and a more opaque basket than the homepage glass system.
  - Fix: normalize all new icon strokes to `#0f766e`, consolidate progress gold to `#c7a24e` with dark ink, soften the smoked-glass alpha, reduce menu-row shadow density, and add an intentional category-overflow fade.
- [P2] A superseded 1,380-line order-workspace block remained commented in the stylesheet and made future cascade edits error-prone.
  - Fix: remove the dead block and retain one Editorial layout foundation followed by one active Aurora Glass refinement layer.

## Functional and accessibility verification

- Collection: search-by-Enter, direct add, customisation, populated basket, quantity display, 10% discount, checkout transition, and Back to dishes were exercised.
- Delivery: persisted items, £2 delivery fee, £10 total, email/phone/address/town/postcode fields, slot selection, and checkout summary were exercised.
- Responsive: 390 × 844 menu, numbered progress, filtered single-item result, bottom-sheet customiser, sticky View basket state, and basket focus restoration were exercised.
- The mobile basket opener now owns `aria-controls`/`aria-expanded`; the open sheet switches to `role="dialog"` with `aria-modal="true"`, traps Tab/Shift+Tab, closes on Escape, and returns focus to the visible opener.
- Search Enter remained on `isOrderMenuStep` and returned only the matching item.
- Checkout focused `orderName` for collection and `orderEmail` for delivery.
- Browser console warnings/errors: none during the completed collection, delivery, checkout, search, and customiser passes.
- Automated suite: 125/125 passed.
- JavaScript syntax, `git diff --check`, and service-worker cache versioning: passed.

## Follow-up polish

- P3: add individual menu photography only after the live catalogue gains approved per-item image assets and mappings.

final result: passed

## Unified public-site QA — 13 July 2026

Reference: the existing Millers Café desktop homepage at 1440 × 900.

Implementation reviewed:

- Menu at 1440 × 900 and 390 × 844.
- Collection ordering at 1440 × 900 and 390 × 844.
- Bookings at 1440 × 900.
- Account at 1440 × 900 and 390 × 844.
- Privacy at 1440 × 900.
- Desktop and mobile overflow checks across all public routes.

Comparison evidence:

- `/private/tmp/millers-design-evidence/qa-home-menu.png`
- `/private/tmp/millers-design-evidence/qa-home-bookings.png`
- `/private/tmp/millers-design-evidence/qa-home-collection.png`
- `/private/tmp/millers-design-evidence/qa-home-account.png`

Resolved findings:

- P0: Removed route-level design drift by reusing the homepage navigation, canvas, typography, mint/ink palette, white glass surfaces, radii, and CTA treatment.
- P1: Fixed the account sign-in and summary overlap at desktop widths.
- P1: Replaced the dark navy/gold order basket and checkout sidebar with the homepage light Aurora hierarchy.
- P1: Removed repeated backdrop blur from cards, fields, menu sections, order results, basket content, and modals. Browser inspection reports one active blur surface per desktop page: the shared navigation.
- P1: Removed horizontal overflow at 1440px and 390px across every public route.
- P2: Compacted the menu tools and jump navigation, widened form workspaces, normalized headings, and restored 44px minimum targets on small navigation/calendar controls.
- P2: Added active-route navigation states and skip links to all customer-facing pages.

Functional checks:

- Menu search returns the expected filtered items and sections after the new debounce.
- Order search returns the expected filtered cards and live status message.
- No duplicate element IDs were found on any public route.
- Browser diagnostics reported no JavaScript console errors during the reviewed states.
- Automated suite: 129/129 passed.
- JavaScript syntax, build, `git diff --check`, and service-worker cache versioning: passed.

final result: passed
