// Everything the app needs to know about ingredients and the starter recipes, ready to use.
import { INGREDIENTS, AISLES, AISLE_ORDER, CURRENCIES, FX_FROM_GBP } from "./ingredients.js";
import { RECIPES_INDIAN } from "./recipes-indian.js";
import { RECIPES_WORLD } from "./recipes-world.js";
export { INGREDIENTS, AISLES, AISLE_ORDER, CURRENCIES, FX_FROM_GBP };
export const BUILTIN_RECIPES = [...RECIPES_INDIAN, ...RECIPES_WORLD];
