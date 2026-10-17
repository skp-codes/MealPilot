#!/usr/bin/env node
// Makes small sample files in the same formats as the real datasets, for testing the builder:
//   node tools/library/sample.mjs <folder> [copies]
import fs from "node:fs";
import path from "node:path";
import * as C from "../../public/core.js";
import { INGREDIENTS, BUILTIN_RECIPES } from "../../public/data/index.js";

const OUT = process.argv[2] || "sample-data", COPIES = Number(process.argv[3] || 20);
fs.mkdirSync(OUT, { recursive: true });
const cat = C.buildCatalog(INGREDIENTS);
const recs = BUILTIN_RECIPES.map((r) => C.expandBuiltIn(r, cat)).filter((r) => !(r.meals.length === 1 && r.meals[0] === "side"));
const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
const rv = (a) => (a.length ? `c(${a.map((x) => `"${String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(", ")})` : "character(0)");
const ing = (x) => cat.byId.get(x.id);
const lineOf = (x) => `${x.q != null ? C.fmtQty(x.q, x.u) : ""} ${ing(x).name.toLowerCase()}${x.note ? ", " + x.note : ""}`.trim();
const ADJ = ["Easy", "Best", "Quick", "Spicy", "Mom's", "Homestyle", "Classic", "Weeknight", "Simple", "Creamy", "Authentic", "Healthy", "Smoky", "Zesty", "Hearty", "Lemony", "Garlicky", "Rustic", "Crispy", "Golden"];
const KW = { "South Indian": "Indian", "North Indian": "Indian", "West Indian": "Indian", "Indo-Chinese": "Chinese", Mediterranean: "Greek", "Middle Eastern": "Lebanese" };

// 1. Food.com Recipes and Reviews (irkaal)
let id = 100000, rows = [];
const fcHead = "RecipeId,Name,AuthorId,AuthorName,CookTime,PrepTime,TotalTime,DatePublished,Description,Images,RecipeCategory,Keywords,RecipeIngredientQuantities,RecipeIngredientParts,AggregatedRating,ReviewCount,Calories,FatContent,SaturatedFatContent,CholesterolContent,SodiumContent,CarbohydrateContent,FiberContent,SugarContent,ProteinContent,RecipeServings,RecipeYield,RecipeInstructions";
const nlRows = [], rmRecs = [], rawRows = [];
for (let c = 0; c < COPIES; c++) for (const r of recs) {
  id++;
  const name = c ? `${ADJ[c % ADJ.length]} ${r.name}${c >= ADJ.length ? " " + Math.floor(c / ADJ.length + 1) : ""}` : r.name;
  const lines = r.ingredients.filter((x) => !x.opt).map(lineOf);
  const qtys = r.ingredients.filter((x) => !x.opt).map((x) => (x.q != null ? String(C.fmtNum(x.q)).replace("½", "1/2").replace("¼", "1/4").replace("¾", "3/4") : "NA"));
  const parts = r.ingredients.filter((x) => !x.opt).map((x) => ing(x).name.toLowerCase());
  const f = C.recipeFacts(r, cat, C.makePricer(cat, {}, "GBP"));
  const category = r.meals.includes("breakfast") && r.meals.length === 1 ? "Breakfast" : r.meals.includes("snack") ? "Lunch/Snacks" : "One Dish Meal";
  rows.push([id, q(name), 1, q("Tester"), `PT${r.cook}M`, `PT${r.prep}M`, `PT${r.prep + r.cook}M`, "2005-01-01T00:00:00Z", q(`A ${r.cuisine} favourite.`), q(rv([`https://img.example.com/${id}.jpg`])),
    q(category), q(rv([KW[r.cuisine] || r.cuisine, "< 60 Mins"])), q(rv(qtys)), q(rv(parts)), (3.5 + (id % 15) / 10).toFixed(1), 1 + (id % 40), f.per.kcal, f.per.fat, 1, 1, 1, f.per.carbs, f.per.fibre, 1, f.per.protein, r.servings, q(`${r.servings} servings`), q(rv(r.steps))].join(","));
  // a full-text copy of every third one in RecipeNLG and Recipe1M (with the units), pointing back to Food.com
  if (id % 2 === 0) nlRows.push([nlRows.length, q(name), q(JSON.stringify(lines)), q(JSON.stringify(r.steps)), q(`www.food.com/recipe/${C.norm(name).replace(/ /g, "-")}-${id}`), "Gathered", q(JSON.stringify(parts))].join(","));
  if (id % 2 === 1) rmRecs.push({ id: "rm" + id, title: name, ingredients: lines.map((text) => ({ text })), instructions: r.steps.map((text) => ({ text })), partition: "train", url: `http://www.food.com/recipe/${C.norm(name).replace(/ /g, "-")}-${id}` });
  if (id % 4 === 0) rawRows.push([q(name.toLowerCase()), id, r.prep + r.cook, 1, "2005-01-01", q(JSON.stringify([C.norm(r.cuisine)]).replace(/"/g, "'")), q("[1,1,1,1,1,1,1]"), r.steps.length, q(JSON.stringify(r.steps).replace(/"/g, "'")), q(""), q(JSON.stringify(parts).replace(/"/g, "'")), parts.length].join(","));
}
fs.writeFileSync(path.join(OUT, "recipes.csv"), fcHead + "\n" + rows.join("\n") + "\n");
// extra RecipeNLG-only recipes (other websites) so the archive has link-only entries
for (let k = 0; k < recs.length * 3; k++) { const r = recs[k % recs.length]; nlRows.push([nlRows.length, q(`${r.name} from a blog ${k}`), q(JSON.stringify(r.ingredients.map(lineOf))), q(JSON.stringify(r.steps)), q(`www.someblog${k}.com/recipe/${k}`), "Gathered", q(JSON.stringify(r.ingredients.map((x) => ing(x).name.toLowerCase())))].join(",")); }
fs.writeFileSync(path.join(OUT, "full_dataset.csv"), ",title,ingredients,directions,link,source,NER\n" + nlRows.join("\n") + "\n");
fs.mkdirSync(path.join(OUT, "recipe1M"), { recursive: true });
fs.writeFileSync(path.join(OUT, "recipe1M", "layer1.json"), JSON.stringify(rmRecs));
fs.writeFileSync(path.join(OUT, "RAW_recipes.csv"), "name,id,minutes,contributor_id,submitted,tags,nutrition,n_steps,steps,description,ingredients,n_ingredients\n" + rawRows.join("\n") + "\n");

// 2. Archana's Kitchen (Indian)
const ak = recs.filter((r) => /Indian|Indo/.test(r.cuisine));
const akRows = [];
let n = 0;
for (let c = 0; c < COPIES; c++) for (const r of ak) {
  n++;
  const name = `${c ? ADJ[c % ADJ.length] + " " : ""}${r.name} Recipe`;
  const ingText = r.ingredients.map((x) => `${x.q != null ? C.fmtQty(x.q, x.u).replace("½", "1/2").replace("¼", "1/4") + " " : ""}${ing(x).name}${x.note ? " - " + x.note : ""}`).join(",");
  const cuisine = { "South Indian": "South Indian Recipes", "North Indian": "North Indian Recipes", "West Indian": "Gujarati Recipes", "Indo-Chinese": "Indo Chinese" }[r.cuisine] || "Indian";
  akRows.push([n, q(name), q(name), q(ingText), q(ingText), r.prep, r.cook, r.prep + r.cook, r.servings, q(cuisine), q(r.meals.includes("breakfast") ? "South Indian Breakfast" : "Lunch"), q({ vegan: "Vegan", veg: "Vegetarian", egg: "Eggetarian", nonveg: "Non Vegeterian" }[r.diet]), q(r.steps.join(" ")), q(r.steps.join(" ")), q(`https://www.archanaskitchen.com/${n}`)].join(","));
}
fs.writeFileSync(path.join(OUT, "IndianFoodDatasetCSV.csv"), "Srno,RecipeName,TranslatedRecipeName,Ingredients,TranslatedIngredients,PrepTimeInMins,CookTimeInMins,TotalTimeInMins,Servings,Cuisine,Course,Diet,Instructions,TranslatedInstructions,URL\n" + akRows.join("\n") + "\n");

// 3. Indian Food 101
fs.writeFileSync(path.join(OUT, "indian_food.csv"), "name,ingredients,diet,prep_time,cook_time,flavor_profile,course,state,region\n" +
  [["Bisi bele bath", "Rice, toor dal, vegetables", "vegetarian", 15, 40, "spicy", "main course", "Karnataka", "South"], ["Litti chokha", "Wheat flour, sattu, brinjal", "vegetarian", 20, 30, "spicy", "main course", "Bihar", "East"]].map((r) => r.map(q).join(",")).join("\n") + "\n");
console.log(`Sample data in ${OUT}: ${rows.length} Food.com, ${akRows.length} Indian, ${nlRows.length} RecipeNLG, ${rmRecs.length} Recipe1M, ${rawRows.length} interactions`);
