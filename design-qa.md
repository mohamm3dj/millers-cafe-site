# Design QA — Aurora order flow redesign

## Scope and visual truth

- Source design language: `/private/tmp/millers-order-audit/01-home-entry.png` — the accepted Aurora Glass desktop homepage at 1280 × 720.
- Source flow state: `/private/tmp/millers-order-audit/02-menu-browse.png`, `03-customize-item.png`, `04-basket-filled.png`, `05-checkout-details.png`, and `07-delivery-details.png` — the pre-redesign collection and delivery flow at 1280 × 720.
- Browser-rendered implementation:
  - `/private/tmp/millers-order-redesign/implementation-menu-desktop.jpg`
  - `/private/tmp/millers-order-redesign/implementation-checkout-desktop.jpg`
  - `/private/tmp/millers-order-redesign/implementation-modifier-desktop.jpg`
  - `/private/tmp/millers-order-redesign/implementation-mobile-payment.jpg`
- Combined comparison evidence:
  - `/private/tmp/millers-order-redesign/qa-comparison-desktop.jpg`
  - `/private/tmp/millers-order-redesign/qa-comparison-modifier.jpg`
- Primary desktop viewport: 1280 × 720.
- Responsive viewport: 390 × 844.
- States: populated collection menu and basket, item customisation, collection checkout, delivery checkout, empty-field validation, and mobile secure-payment action.

The accepted homepage and the legacy order screen are different page states. The comparison therefore treats the homepage as the visual-system target and the legacy order captures as the functional/content baseline; layout changes from the legacy flow are intentional.

## Full-view comparison

- The order header now uses the same real Millers logo, Manrope/Urbanist typography, soft teal/navy palette, glass surface, rounded geometry, and low-contrast elevation as the accepted homepage.
- The menu workspace replaces the legacy 27-row category sidebar and single item column with a horizontal category rail, two-column dish grid, and one compact sticky basket action.
- Checkout now keeps the form and a live, sticky order summary in the same view. Collection discount, delivery fee, item price, and the exact Stripe total remain visible.
- Delivery contact fields now occupy a balanced 4/2-column row, while address and fulfilment fields retain their intended hierarchy.
- At 390px the flow has no horizontal page overflow, the three stages fit without truncation, category and basket controls remain usable, and the secure-payment action stays visible at the bottom of the viewport.

## Focused comparison

`qa-comparison-modifier.jpg` compares the same Iced Caramel Latte customisation state before and after the redesign. The old inline expander interrupts the menu grid; the implementation uses a centred, labelled dialog on desktop and a bottom sheet on mobile. The overlay has a stable viewport root, real focus containment, Escape/backdrop close, and trigger-focus restoration. Controls and footer actions remain readable without clipping at both tested viewports.

No additional crop was needed for typography or basket pricing because those details are legible in the full-view comparison and were also verified directly in the browser DOM.

## Required fidelity surfaces

- Fonts and typography: Manrope Desktop is used for UI text and Urbanist Desktop for display hierarchy, matching the accepted homepage. Weights, letter spacing, and small uppercase labels remain readable; there is no material truncation at either tested viewport.
- Spacing and layout rhythm: header, progress, notice, menu cards, basket, form fields, and summary cards use a consistent 12–24px rhythm, 12–26px radii, and restrained elevation. Desktop alignment uses explicit menu/basket and form/summary grids.
- Colors and tokens: the implementation reuses the established teal, navy, mist, white, and warm allergen-warning palette. Focus, selected, error, discount, and disabled states remain semantically distinct.
- Image quality and asset fidelity: the canonical Millers WebP logo and existing Tabler-style SVG icon assets are used. Order items do not have source photography, so the flow does not invent placeholder food images. No emoji, CSS-drawn product art, or approximate branding is used.
- Copy and content: collection/delivery language, live hours, allergen guidance, price breakdowns, consent text, policy links, and “Total due at Stripe” remain accurate. Progress is clearer as Browse menu → Your details → Secure payment.

## Comparison history

### Iteration 1

- [P1] The first fixed customisation overlay was contained by the glass panel and visually centred below the viewport.
  - Fix: move the dialog to a stable `body` overlay root while open.
  - Post-fix evidence: `implementation-modifier-desktop.jpg`; the dialog fills the viewport backdrop and is fully visible.
- [P1] Desktop delivery email remained full width and left a large blank area beside phone because the wide-field selector overrode the delivery span.
  - Fix: exclude `deliveryFieldEmail` from the full-width override and restore the 4/2 contact row.
  - Post-fix evidence: browser measurement recorded email at 519px and phone at 254px in the 1280px checkout grid.
- [P2] Mobile stage three was clipped by the horizontal progress scroller.
  - Fix: use three equal mobile stage segments and hide decorative dividers at that breakpoint.
  - Post-fix evidence: all three labels are visible in the 390 × 844 capture.
- [P2] The broad checkout input rule enlarged the optional-consent checkbox and disrupted its baseline.
  - Fix: restore a specific 20 × 20 checkbox rule and accent token.
  - Post-fix evidence: `implementation-checkout-desktop.jpg` shows aligned consent copy and control.
- [P2] Mobile checkout required scrolling through the entire form before the final action appeared.
  - Fix: add a persistent, amount-aware “Pay securely” action using the real lock icon; the action submits through the existing validation and Stripe handoff.
  - Post-fix evidence: `implementation-mobile-payment.jpg`; invalid activation focuses the first invalid field and leaves the action visible.

### Final pass

- No actionable P0, P1, or P2 visual differences remain.
- Residual P3: the horizontal desktop category rail relies on native scrolling for less-common categories; a subtle edge fade could improve discoverability later without changing the flow.

## Functional and accessibility verification

- Collection and delivery menu browsing, search, category selection, add-to-basket, quantity changes, basket drawer, and both checkout transitions were exercised.
- Desktop dialog and mobile sheet were exercised; Escape closes, backdrop click is supported, Tab is contained, body scroll is locked, and focus returns to the initiating button.
- Empty checkout submission focuses and scrolls to the first invalid visible field. Hidden date/time errors are mirrored to the visible date toggle and slot radiogroup.
- Mobile payment action invokes the existing form submission path; an invalid test focused `orderName` and reported three invalid fields without transmitting an order.
- Desktop and mobile page widths matched their viewports; no duplicate IDs were found; one H1 remained; no visible interactive target under 24px was found in the mobile pass.
- Browser console warnings/errors: none.
- Automated suite: 121/121 passed.
- JavaScript syntax and `git diff --check`: passed.

final result: passed
