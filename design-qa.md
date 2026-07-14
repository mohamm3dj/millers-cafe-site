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

## Guided menu option 3 QA — 14 July 2026

### Scope and evidence

- Source visual truth: `/Users/mo/.codex/generated_images/019f4da8-15c7-73e2-a6f3-36cdb5c78784/exec-cb6c0022-2d04-4415-9ffd-e276f55fc0b0.png` at 1487 × 1058.
- Final browser-rendered desktop implementation: `/private/tmp/millers-menu-option3-desktop-final-v3.png` at 1487 × 1058.
- Final browser-rendered mobile implementation: `/private/tmp/millers-menu-option3-mobile-final-v3.png` at 390 × 844.
- Required full-view side-by-side comparison: `/private/tmp/millers-menu-option3-comparison-final.jpg`.
- Required focused centre-workspace comparison: `/private/tmp/millers-menu-option3-focus-comparison-final.jpg`.
- Earlier comparison evidence: `/private/tmp/millers-menu-option3-comparison.jpg` and `/private/tmp/millers-menu-option3-mobile-before-fixes.png`.
- Desktop state: default `Mains & Curries` group, `All` subcategory, no search query, safety rail visible.
- Mobile state: default `Mains & Curries` group, horizontally centred selected category, collapsed subsections, fixed Collection/Delivery actions.

### Findings

- No actionable P0, P1, or P2 differences remain after the iterations below.
- P3 accepted constraint: the concept's decorative star was omitted because the project has no approved matching star asset; no text glyph, CSS drawing, or handcrafted SVG substitute was introduced.
- P3 accepted content deviation: the concept used illustrative combined curry prices and spice glyphs. The implementation intentionally renders the exact canonical 27-category, 177-item catalogue with its verified names, descriptions, base-price labels, and dietary/allergen data.

### Required fidelity surfaces

- Fonts and typography: the implementation reuses the homepage's bundled Manrope and Urbanist families. Display headings, search copy, tab labels, 14px item names/prices, 11.5px descriptions, and the safety copy were checked at original resolution. The final density remains compact but readable, with no unintended truncation of dish names or prices.
- Spacing and layout rhythm: the desktop preserves the selected three-column composition, shallow hero, persistent left category rail, two-column flat dish rows, right ordering/safety rail, low-contrast borders, restrained shadows, and homepage radii. The 390px layout becomes a horizontal category rail plus single-column accordion list without page overflow.
- Colors and visual tokens: the background, white glass panels, navy ink, jade active states, mint accents, subtle dividers, and shadow opacity are inherited from the live homepage rather than a new palette. Selected and focus states remain distinct.
- Image quality and asset fidelity: the 1600 × 560, 159807-byte `menu-favourites-hero.jpg` is a real raster asset matched to the measured slot, with the curry and naan subject weighted right to preserve clean copy space. The crop stays sharp on desktop and mobile. Existing logo and SVG icon assets are used throughout; there is no emoji, inline SVG, CSS illustration, or placeholder imagery.
- Copy and content: browsing, Collection/Delivery, favourites, empty-state, and allergy language are coherent and standalone. The always-visible safety notice states that symbols are a guide, no symbol is not an allergen-free claim, and customers must tell the team before ordering.
- Icons: the existing Millers/Tabler-style icon family is used for the rail, search, ordering actions, and accordion state. The original text-glyph accordion marker was replaced with the real `icon-arrow-right.svg` asset.
- Accessibility and states: semantic buttons/tabs, roving category focus, arrow/Home/End navigation, `aria-current`, `aria-selected`, live search status, explicit labels, descriptive hero alt text, reduced-motion support, focus-visible outlines, and 44px minimum mobile controls were verified.

### Comparison history

#### Iteration 1 — mobile navigation and icon fidelity

- [P2] The selected `Mains & Curries` category initially loaded outside the visible portion of the horizontal mobile rail.
  - Fix: centre the active category within the rail after group and hash state are applied, without moving the page vertically.
  - Post-fix evidence: `/private/tmp/millers-menu-option3-mobile-final-v3.png`; browser metrics reported the active category fully inside the 348px rail and zero page overflow.
- [P2] Mobile accordions inherited triangle text glyphs rather than a real project asset.
  - Fix: use `assets/icon-arrow-right.svg` with a transform for collapsed/expanded state.
  - Post-fix evidence: `/private/tmp/millers-menu-option3-mobile-final-v3.png`; the computed pseudo-element background resolves to the same-origin SVG asset.

#### Iteration 2 — dense-menu readability

- [P2] The first focused comparison showed item names, descriptions, prices, and safety copy materially smaller and lighter than the selected concept.
  - Fix: raise dish names/prices to 14px, descriptions and menu notes to 11.5px, strengthen description colour to the homepage slate token, and increase right-rail supporting copy.
  - Earlier evidence: `/private/tmp/millers-menu-option3-focus-comparison.jpg`.
  - Post-fix evidence: `/private/tmp/millers-menu-option3-focus-comparison-final.jpg` and `/private/tmp/millers-menu-option3-desktop-final-v3.png`.

### Functional, responsive, and browser verification

- Category browsing: selecting `Biryani & Rice` updated the title, visible sections, selected state, and URL hash; ArrowDown moved roving focus and Home returned it to the first group without changing the active group.
- Subcategory browsing: selecting the `Biryani` tab updated `aria-selected`, the visible section, and `#biryani` deep link.
- Search: the 120ms tokenized search returned verified matches for `chicken garlic`; Clear restored the active Biryani state; an impossible query produced the designed empty state and Clear search recovery.
- Dietary controls: opening Dietary key exposed both toggles; hiding the symbol key removed only the legend grid while the allergy notice remained present and visible.
- Responsive ordering: Collection and Delivery links resolve correctly in the context strip, desktop rail, and fixed mobile action bar. The mobile bar is fixed with 48px actions and the page reserves 92px bottom clearance.
- Mobile accordions: the Mild Curries control expanded to expose real menu rows, kept a 54px target, and rotated its real arrow asset.
- Desktop at 1487 × 1058 and mobile at 390 × 844 both reported zero horizontal overflow. The smallest tested interactive height was 44px.
- Browser console errors/warnings: none during the completed desktop and mobile interaction passes.
- Automated suite: 142/142 passed.
- JavaScript syntax, production build, `git diff --check`, cache version alignment, canonical catalogue parity, and the menu image budget: passed.

### Follow-up polish

- P3: add approved per-dish photography only if the canonical catalogue later gains stable image mappings; do not infer imagery from names.

final result: passed

## Quick-order option 2 QA — 13 July 2026

Reference and implementation:

- Selected source: `/Users/mo/.codex/generated_images/019f4da8-15c7-73e2-a6f3-36cdb5c78784/exec-82a1fa13-1919-443b-9623-cc5dabe901f9.png` at 1487 × 1058.
- Final delivery implementation: `/private/tmp/order-redesign-delivery-final.png` at 1487 × 1058.
- Required side-by-side comparison input: `/private/tmp/order-redesign-comparison-final.jpg`.
- Additional states: `/private/tmp/order-redesign-collection-final.png`, `/private/tmp/order-redesign-basket-v2.png`, `/private/tmp/order-redesign-details.png`, `/private/tmp/order-redesign-mobile.png`, and `/private/tmp/order-redesign-mobile-basket-v2.png`.

Fidelity review:

- Layout: the final desktop state reproduces the source's status strip, persistent left category rail, single-column food rows, and right basket while retaining the accepted Millers floating homepage navigation and Aurora canvas.
- Typography and spacing: Manrope/Urbanist, tight navy headings, compact supporting copy, 52px category targets, 56px search/checkout controls, 104px menu media, 24px basket radius, and restrained dividers match the selected density and hierarchy.
- Color and surfaces: homepage navy, teal, mint, icy-blue canvas, white surfaces and low-contrast shadows replace the source's generic treatment without introducing a new palette.
- Imagery: Chilli Paneer, Chicken Tikka Starter and Chicken Biryani use approved existing food assets. Dedicated 768 × 768 Garlic Naan and Mango Lassi photography was created and compressed to 271KB and 90KB. Every image uses an empty alt because its dish name is adjacent, plus explicit dimensions, lazy loading and async decoding.
- Content truth: fictional London address, £15 minimum, target prices, fee and ETA were not copied. All names/prices come from the real catalogue; collection discount, delivery fee, dates, time, address and ETA remain configuration-driven. Chicken Biryani retains its required customisation action.
- Icons: existing Millers Tabler-style assets are used throughout. No inline SVG, emoji, CSS-drawn illustration or placeholder imagery is present.

Resolved findings:

- P1: the first quick-order CSS pass sat before legacy order layers and was being overridden. Moved the complete option-2 layer to the final cascade position and added a regression that enforces this order.
- P1: saved search state initially obscured the default favourites view during browser review. Cleared it through the real search interaction and verified the default five-item order.
- P1: the mobile basket lacked full background inerting and scroll lock. Added reversible inert state, body locking, dialog semantics, Escape close, focus return and `aria-expanded` synchronization.
- P1: the desktop basket footer exposed a cramped, truncated schedule/total sentence. Removed the redundant summary from the basket card; context remains in the top strip and progress/CTA now match the reference more closely.
- P1: three fallback descriptions introduced unverified ingredient wording that was not present in the canonical catalogue. Removed every fallback so dish descriptions now render only when supplied by verified menu data.
- P2: catalogue order initially placed Mango Lassi first. The virtual favourites group now follows the selected presentation order while resolving every item back to its real catalogue entry.
- P2: the generated PNG food assets were 4.5MB combined. Converted them to 768px JPEGs at 361KB combined and removed the unreferenced source PNGs from the build.
- P2: repeated legacy basket wording read “Total due at Stripe” and “Checkout details.” Simplified the visible hierarchy to “Total” and “Continue to checkout” while preserving secure Stripe language at the payment boundary.

Functional, responsive and accessibility verification:

- Collection desktop: favourites render in the intended order; direct add updates the basket, 10% discount, selected badge, count, total and amount-aware CTA; menu → details → Back to dishes works.
- Delivery desktop: persisted basket recalculates with the live £2 fee; the context strip reports address-at-checkout, configured ETA and fee; details expose the required address fields and price summary.
- Mobile at 390 × 844: original accordion menu remains usable, sticky View basket works, the basket opens as a modal dialog with 15 background roots inert, body scroll locked, and Escape closes it and restores the opener state.
- Desktop at 1487 × 1058: no overlapping or clipped rail/menu/basket controls; all five curated dishes remain reachable; the basket stays viewport-contained.
- Focus-visible, keyboard category navigation, roving tab stop, Home/End/arrow behavior, live regions, adjacent image labels, reduced motion and 44px mobile targets remain intact.
- Browser console inspection, semantic snapshots and interaction checks completed without a product-code error.
- Automated suite: 136/136 passed.
- Focused order/design regressions: 31/31 passed.
- JavaScript syntax and `git diff --check`: passed.

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

## Guided menu option 3 QA — final handoff

- Source visual truth: `/Users/mo/.codex/generated_images/019f4da8-15c7-73e2-a6f3-36cdb5c78784/exec-cb6c0022-2d04-4415-9ffd-e276f55fc0b0.png` at 1487 × 1058.
- Browser-rendered implementation: `/private/tmp/millers-menu-option3-desktop-final-v3.png` at 1487 × 1058 and `/private/tmp/millers-menu-option3-mobile-final-v3.png` at 390 × 844.
- State: default `Mains & Curries`, `All` subcategory, no query, visible allergy rail; mobile uses collapsed subsections and the fixed Collection/Delivery bar.
- Full-view comparison: `/private/tmp/millers-menu-option3-comparison-final.jpg`.
- Focused typography/menu comparison: `/private/tmp/millers-menu-option3-focus-comparison-final.jpg`; a focused crop was required because item typography and safety copy were too small to judge reliably in the scaled full view.
- Fonts/typography: bundled Manrope/Urbanist, 14px dish names/prices, 11.5px descriptions, clear display hierarchy, and no dish-name or price truncation.
- Spacing/layout: the selected three-column desktop composition and dense two-column rows are preserved; the 390px layout has no page overflow and keeps all persistent actions clear.
- Colors/tokens: homepage navy, jade, mint, icy canvas, white panels, subtle dividers, and restrained shadows are reused without a new palette.
- Image quality: the sharp 1600 × 560, 159807-byte curry-and-naan raster matches the measured hero crop. All other visible assets use the approved logo/SVG family; there is no fake SVG, CSS art, emoji, or placeholder imagery.
- Copy/content: the exact 27-category, 177-item catalogue, verified base prices/descriptions, qualified dietary claims, and always-visible allergy warning replace the concept's illustrative data.
- Comparison history: P2 mobile active-category visibility and text-glyph accordion markers were fixed by centring the selected rail item and using the real arrow asset. P2 dense-menu readability was fixed by increasing type size/contrast. Earlier evidence is `/private/tmp/millers-menu-option3-mobile-before-fixes.png` and `/private/tmp/millers-menu-option3-focus-comparison.jpg`; the final evidence paths above show the corrections.
- Primary interactions tested: group selection/hash state, roving Arrow/Home navigation, subcategory tabs, token search, state-preserving Clear, no-results recovery, Dietary key toggles with persistent safety notice, mobile accordion expansion, and Collection/Delivery links.
- Accessibility/responsiveness: semantic controls and labels, focus-visible treatment, reduced motion, live search status, descriptive image alt, zero tested horizontal overflow, and a 44px minimum tested control height.
- Browser console errors/warnings: none in the final desktop and mobile passes.
- Verification: 142/142 automated tests, JavaScript syntax, production build, `git diff --check`, cache alignment, catalogue parity, and asset budget all passed.
- Remaining findings: no actionable P0/P1/P2 findings. P3 only: the concept's decorative star remains omitted because no approved matching asset exists.

final result: passed

## Collection and Delivery image-removal QA — 14 July 2026

Reference and rendered evidence:

- Source visual truth: `/var/folders/zj/pv7s71zx7rv52p0xf2sm8_pw0000gn/T/TemporaryItems/NSIRD_screencaptureui_6JgAIB/Screenshot 2026-07-14 at 09.51.57.png` at 1824 × 1464. This is a bug-state reference: image-free rows are shifted right while the photographed Chilli Paneer row starts at the intended left edge.
- Browser-rendered implementation: `/private/tmp/order-image-free-collection.png` and `/private/tmp/order-image-free-delivery.png` at 1824 × 1464; `/private/tmp/order-image-free-mobile.png` at 390 × 844.
- State: `Starters · Veg` selected on desktop, empty basket for the comparison capture, then direct-add exercised to verify the basket row; a Starters mobile accordion is expanded.
- Full-view comparison evidence: `/private/tmp/order-image-free-comparison-full.jpg`.
- Focused row-alignment comparison evidence: `/private/tmp/order-image-free-comparison-focused.jpg`. A focused comparison was required because the source capture isolates and enlarges the broken menu region while the final capture includes the complete ordering workspace.

Findings and fidelity review:

- No actionable P0, P1, or P2 findings remain.
- Fonts and typography: the existing bundled Manrope/Urbanist hierarchy, weights, line heights, badges, prices, and descriptions are unchanged. The final rows preserve the selected homepage design language.
- Spacing and layout rhythm: all seven visible Collection rows and all seven Delivery rows resolve to the same two-track grid (`772px 44px`) at the tested viewport. Every text block begins at x=428, every add action begins at x=1220, and the measured alignment spread is 0px. Desktop and mobile horizontal overflow are both 0px.
- Colors and visual tokens: the existing navy, jade, mint, icy canvas, dividers, white surfaces, and add-button gradient are unchanged.
- Image quality and asset fidelity: dish photography is intentionally absent from both menu cards and basket rows. Browser inspection reports 0 food-image nodes in Collection, Delivery, and the tested basket state. Existing navigation and action icons remain because they are interface controls, not dish photography.
- Copy and content: category names, dish names, prices, dietary badges, descriptions, allergens, service details, and checkout language remain catalogue/configuration-driven and unchanged.

Comparison history:

- P1 source finding: image-free menu cards inherited explicit second/third grid-column placement, which created an implicit empty first track and pushed their copy to the right. The photographed row happened to have a real first track, so it aligned differently.
- Fix: removed dish-media generation from menu and basket rendering, removed the order-image lookup and obsolete media CSS, and explicitly placed menu copy in column 1 and actions in column 2 in the active desktop ordering layer.
- Post-fix evidence: `/private/tmp/order-image-free-comparison-focused.jpg` shows Papadom, Condiments, Onion Bhaji, Chilli Paneer, Garlic Mushroom Chaat, and Aloo Chaat on one consistent left edge with no photography.

Functional, responsive, and technical verification:

- Primary interactions tested: Collection and Delivery category selection, direct add, basket rendering, desktop list scanning, and mobile accordion expansion.
- Collection and Delivery both report 0 menu food images, 0 basket food images, 0px horizontal overflow, and a 0px row-alignment spread at 1824 × 1464. Mobile reports 0 menu food images, 0px overflow, and a single 276px card track at 390 × 844.
- No browser page errors occurred. The only console/network messages came from the intentionally static local preview server lacking `/api/site-config`, `/api/account/me`, and `/api/analytics`; deployed Cloudflare Functions provide those routes.
- Automated suite: 143/143 passed. JavaScript syntax, production build, `git diff --check`, cache-version alignment, and image-free source guards passed.

final result: passed
