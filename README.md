# MealPilot

*Plan the week. Shop once. Know what it costs.* A web app where a household plans meals together, turns the menu into a shopping list, and learns real prices from shop bills.

## What it does

- **Plan by saying what you need.** Type or speak a request like “Plan dinners for a family of four next week, Indian and Italian, no more than 30 minutes of cooking per day, £60 budget”. MealPilot shows what it understood (people, meals, days, cuisines, time limits, budget, diet, goals, things to leave out), then builds a menu with 1–3 alternatives for every meal. Everything is also adjustable in **Settings**: start date, days (1–14), meals per day (breakfast, lunch, dinner, snack), who's eating, cuisines, foods to include (the same tick-list as Recipes: vegetarian, eggs, each meat and each kind of seafood, or vegan only; typing “no beef” or “no seafood” ticks these off), prep/cook/total time per meal, kitchen time per day, budget, goals (protein-rich, kid-friendly, low-carb, light, budget-friendly, high-fibre, mild, spicy), things to leave out, automatic rice/roti/sides, and cooking dinner twice for next day's lunch.
- **The week board.** Tap an alternative to swap, lock dishes you like, get “something else” for one meal, choose any dish yourself, add sides, then shuffle the rest. Live totals: estimated cost against the budget, cost per day and per head, longest day in the kitchen, and protein per person.
- **Household review.** Anyone can make a menu and share it. Everyone else can agree, ask for changes, suggest a different dish for a particular meal, and comment. Only the person who made the menu edits it, accepts or declines suggestions, and makes it final.
- **Favourites.** Save a whole week or a single good day under any name, and reuse it any time.
- **Recipes.** About 140 starter recipes (South, North and West Indian, Indo-Chinese, Italian, British, Mexican, Chinese, Thai, Japanese, Korean, Mediterranean, Middle Eastern, Spanish, French, American). Each has exact quantities, prep/cook/total time, cost and nutrition per serving, a **Contains** filter (tick or untick vegetarian, eggs, chicken, lamb, beef, pork and each kind of seafood: fish, salmon, tuna, prawns, mussels, squid, crab), a servings scaler and a step-by-step **cook mode** with timers that keeps the screen on.
- **Add more recipes.** Import from a link (BBC Good Food, Allrecipes and most recipe sites), search **TheMealDB** or **Spoonacular**, paste recipe text, or write your own. Imported recipes are saved privately for the household and credited to their source.
- **Shopping list.** Built from one or more menus. Untick what you have, lower amounts, then add the rest to the shared list. Pantry staples are listed separately. In the shop, items are grouped by aisle and ticks show for everyone. It works offline and syncs later.
- **Bills teach it prices.** Photograph the till receipt (read on the phone, free) or paste an e-receipt. MealPilot matches each line to an ingredient and works out the price per kg/litre/each from the pack size. Fix a match once and it remembers that shop's name for it. The latest prices are used for every menu and recipe cost from then on.
- **People you cook for.** Portion sizes (toddler to big appetite), age, diet, goals and dislikes, used when planning.
- **Per-household currency:** £, ₹, $ or €.
- **Accounts** work as in ChoreWars: households approved by the site admin, household admins, invite links, join requests, password reset by email, show/hide password, and “Contact the site admin”.
- **Installable** on phones (Add to Home Screen).

## Recipe sources and their rules

| Source | How MealPilot uses it |
|---|---|
| Starter library | Written for MealPilot. Always available. |
| Any recipe web page (BBC Good Food, Allrecipes, blogs…) | **Import from a link** reads the page's published recipe data and saves a private copy for your household, credited to the site. Some sites block apps; use **Paste the recipe text** for those. |
| TheMealDB | Search and save. The free test key `1` is for development. Set `MEALDB_API_KEY` to a supporter key for a public app. |
| Spoonacular | Search only (needs `SPOONACULAR_API_KEY`). Spoonacular's terms allow keeping only a recipe's ID, title and image, so picking a result imports the recipe from the **original website** it came from. |
| Edamam | Not used. It's paid only, gives no cooking instructions and forbids keeping recipes. |

## Environment variables (Netlify → Project configuration → Environment variables)

Each needs a **value** for the Production context, and scopes that include **Functions**. Redeploy after changing them.

| Key | Required | Value |
|---|---|---|
| `SESSION_SECRET` | yes | random string, 32+ characters |
| `ADMIN_USERNAME` | yes | site admin login |
| `ADMIN_PASSWORD` | yes | site admin password (always works; your recovery key) |
| `ADMIN_HOUSEHOLD` | no | name of your own household, one word |
| `EMAIL_FROM`, `RESEND_API_KEY` or `BREVO_API_KEY`, `ADMIN_EMAIL`, `SITE_URL`, `VERIFY_EMAIL` | for email | same as ChoreWars |
| `MEALDB_API_KEY` | no | TheMealDB supporter key (otherwise the free test key) |
| `SPOONACULAR_API_KEY` | no | turns on Spoonacular search |

## Deploys are manual

Every commit pushed to this repo must include `[skip netlify]` in its message, so Netlify doesn't build automatically and use build credits. Deploy when you're ready from Netlify → **Deploys → Trigger deploy**, which builds the latest code including all skipped commits.

## Later (commercial version)

- **AI bill reading:** replaces the on-phone reader, and is more accurate with crumpled or abbreviated receipts.
- **AI request understanding:** understands any wording instead of the built-in rules.
- **Optional AI-written recipes:** any dish on request, checked against the ingredient catalogue before saving.

## Project layout

```
public/
  index.html, app.css, app.js       the app shell
  state.js                          shared state, syncing (works offline), helpers
  core.js                           rules shared with the server: units, ingredient matching, nutrition & cost,
                                    the planner, reading requests, shopping lists, reading receipts, data changes
  plan.js, menus.js, recipes.js, shop.js, household.js   the five screens
  data/ingredients.js               ~210 ingredients: aisle, pack sizes, £ and ₹ starter prices, nutrition, other names
  data/recipes-*.js                 the starter recipes
  login.html, admin.html            accounts and administration
netlify/functions/api.mjs           accounts, households, household data, recipe import and search
netlify/edge-functions/auth-gate.js keeps pages behind login
tests/core.test.mjs                 npm test
```

Nutrition figures and starter prices are estimates.
