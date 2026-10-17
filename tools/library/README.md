# MealPilot recipe library

Builds the shared recipe library that every household gets, from public recipe datasets:

- **The default library:** about 50,000 complete recipes, spread across cuisines by quota. Each has quantities, a method, prep and cook times and servings, with duplicates removed. Phones load a compact index and fetch each recipe's full text when it's opened.
- **The archive:** every other recipe, de-duplicated, searchable from **Recipes → All**. Picking one copies it into the household's own recipes.

## 1. Download the datasets into one folder

| Dataset | Where | File(s) needed |
|---|---|---|
| Food.com Recipes and Reviews | kaggle.com/datasets/irkaal/foodcom-recipes-and-reviews | `recipes.csv` |
| Food.com Recipes and Interactions | kaggle.com/datasets/shuyangli94/food-com-recipes-and-user-interactions | `RAW_recipes.csv` |
| 6000+ Indian Food Recipes | data.mendeley.com/datasets/xsphgmmh7b/1 | the CSV (`IndianFoodDatasetCSV.csv`) |
| Indian Food 101 | kaggle.com/datasets/nehaprabhavalkar/indian-food-101 | `indian_food.csv` |
| RecipeNLG | recipenlg.cs.put.poznan.pl (form) | `full_dataset.csv` |
| Recipe1M+ | im2recipe.csail.mit.edu (registration) | `layer1.json` |

File names don't matter: the builder recognises each file by its columns, in any subfolder. Any dataset can be left out.

## 2. Build

Needs Node 18 or later, about 8 GB of disk space and 4 GB of memory. It takes roughly 20–60 minutes with everything.

```
node tools/library/build.mjs "C:\Users\<you>\Documents\MealPilot-data" "C:\Users\<you>\Documents\MealPilot-library"
```

Options:
- `--target 50000`: size of the default library.
- `--limit 20000`: read only that many recipes from each dataset, for a quick trial run.

The output folder gets `library/`, `archive/` and `meta.json`. The log reports how many recipes each cuisine got, and why others were left out.

## 3. Upload to the live site

Run `npm install` once in the project folder (it installs `@netlify/blobs`), then:

```
set NETLIFY_SITE_ID=<Project ID from Netlify → Project configuration → General>
set NETLIFY_AUTH_TOKEN=<User settings → Applications → Personal access tokens>
node tools/library/upload.mjs "C:\Users\<you>\Documents\MealPilot-library"
```

On Mac or Linux, use `export` instead of `set`. If the upload stops, run it again and it continues where it left off. The site switches to the new library only once everything is uploaded. Add `--delete-old` to remove earlier versions. No redeploy is needed.

## How recipes are treated

- **Food.com quantities have no units** in the Kaggle file. Where RecipeNLG or Recipe1M has a full-text copy of the same Food.com page, the units come from there; otherwise they're inferred from the ingredient (spices in teaspoons, flour in cups, meat in pounds…), and those recipes rank lower.
- **Cuisine** comes from the dataset's own label, keywords and dish names (dosa → South Indian, dhokla → West Indian…). Indian Food 101 adds which region a dish is from.
- **Diet and food types** (meats, eggs, each kind of seafood) come from the matched ingredients *and* the raw ingredient text, so unusual meats still count as non-vegetarian.
- **RecipeNLG and Recipe1M** are research-only datasets that forbid redistribution, so their method text is never stored. Search shows their title and ingredients, and the method is imported from the original website when someone adds the recipe.
- **Food.com and Archana's Kitchen** content is included in full. Remove it before MealPilot is ever sold, or replace it with licensed content.

## Testing

`node tools/library/sample.mjs sample-data 25` writes small files in every dataset format. Then `node tools/library/build.mjs sample-data out --target 2000 --post-shards 64` runs the whole pipeline in seconds.
