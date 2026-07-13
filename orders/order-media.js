export const POPULAR_ITEM_NAMES = Object.freeze([
  "Chilli Paneer",
  "Chicken Tikka Starter",
  "Chicken Biryani",
  "Garlic Naan",
  "Mango Lassi"
]);

const ORDER_ITEM_MEDIA = Object.freeze({
  "Chilli Paneer": "../assets/desktop-category-chilli-paneer.webp",
  "Chicken Tikka Starter": "../assets/desktop-hero-tikka.webp",
  "Chicken Biryani": "../assets/desktop-category-biryani.webp",
  "Garlic Naan": "../assets/order-item-garlic-naan.jpg",
  "Mango Lassi": "../assets/order-item-mango-lassi.jpg"
});

export function getOrderItemImage(itemName) {
  return ORDER_ITEM_MEDIA[String(itemName || "").trim()] || "";
}

export function getOrderItemDescription(_itemName, catalogueDescription = "") {
  return String(catalogueDescription || "").trim();
}
