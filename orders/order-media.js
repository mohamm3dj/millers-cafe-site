export const POPULAR_ITEM_NAMES = Object.freeze([
  "Chilli Paneer",
  "Chicken Tikka Starter",
  "Chicken Biryani",
  "Garlic Naan",
  "Mango Lassi"
]);

export function getOrderItemDescription(_itemName, catalogueDescription = "") {
  return String(catalogueDescription || "").trim();
}
