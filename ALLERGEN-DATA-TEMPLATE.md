# Allergen data verification template

The website can display all 14 UK-regulated allergen categories, but it only publishes a `Contains` label when its code has been explicitly added to the canonical menu data. The existing `D` and `N` entries have not been expanded or used to infer any other claim.

Do not complete this sheet from a dish name, menu description, memory, or an assumption about a cuisine. Check the current recipe, every compound ingredient and garnish, current supplier specifications, substitutions, and the preparation process. Keep `Unknown` as unknown until evidence is available; never turn a blank or `No` into an “allergen-free” claim.

## Code key

| Code | UK-regulated category | Customer display |
|---|---|---|
| `CE` | Celery | Celery |
| `G` | Cereals containing gluten | Cereals containing gluten |
| `CR` | Crustaceans | Crustaceans |
| `E` | Eggs | Eggs |
| `F` | Fish | Fish |
| `L` | Lupin | Lupin |
| `D` | Milk | Dairy (existing site wording) |
| `MO` | Molluscs | Molluscs |
| `MU` | Mustard | Mustard |
| `P` | Peanuts | Peanuts |
| `SE` | Sesame | Sesame |
| `SO` | Soybeans | Soya |
| `SU` | Sulphur dioxide and sulphites | Sulphur dioxide and sulphites |
| `N` | Tree nuts | Nuts (existing site wording) |

For `SU`, confirm whether the legally declarable concentration threshold applies. Peanuts (`P`) and tree nuts (`N`) must be reviewed separately; do not convert an existing generic nut note without supplier or recipe evidence. The category list and sulphite threshold are described in the [Food Standards Agency’s allergen guidance](https://www.food.gov.uk/business-guidance/labelling-guidance-for-prepacked-for-direct-sale-ppds-food-products).

## One row per recipe, variant, and relevant modifier

Use `Yes`, `No`, or `Unknown` in each allergen column. Record cross-contact separately because a `Contains` ingredient declaration and a cross-contact risk are not the same statement.

| Exact menu item | Variant / modifier | Recipe or supplier spec version | Evidence reference | Verified by | Verified date | CE | G | CR | E | F | L | D | MO | MU | P | SE | SO | SU | N | Cross-contact notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `<exact catalogue name>` | `<base recipe or exact option>` | `<version/date>` | `<file, URL, or supplier reference>` | `<name>` | `YYYY-MM-DD` | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | `<shared equipment/process evidence>` |

## Publishing checklist

1. Resolve every `Unknown` for the recipe or deliberately leave that item without a complete online allergen claim.
2. Have a second responsible person compare the sheet with the recipe and current supplier specifications.
3. Add only verified `Yes` codes for the base recipe to that item’s `codes` array in `orders/menu-catalog.js`; do not add codes for `No`, `Unknown`, or cross-contact alone.
4. For a modifier option that adds an allergen, add its verified code to that option’s `allergenCodes` array. Use `removesAllergenCodes` only where evidence verifies that selecting the option removes a base-recipe allergen; never infer removal from words such as “vegan” or “dairy-free”.
5. Apply the same verified base codes and clear option-qualified wording to the matching static menu entry before claiming full-site coverage.
6. Run `npm test`, review the Preview site, and retain the dated evidence. Recheck after any recipe, supplier, substitution, or preparation change.
