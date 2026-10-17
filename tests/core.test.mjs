// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../public/core.js";
import * as D from "../public/data/index.js";

const cat = C.buildCatalog(D.INGREDIENTS, [], { aisleOrder: D.AISLE_ORDER });
const recipes = D.BUILTIN_RECIPES.map((r) => C.expandBuiltIn(r, cat));
const byId = new Map(recipes.map((r) => [r.id, r]));
const pricer = C.makePricer(cat, {}, "GBP");
const today = "2026-10-17";                                       // a Saturday

test("every starter recipe uses known ingredients and has sensible numbers", () => {
  assert.ok(recipes.length >= 140);
  for (const r of recipes) {
    const f = C.recipeFacts(r, cat, pricer);
    assert.ok(r.steps.length >= 1, r.id);
    assert.ok(f.per.kcal > 30 && f.per.kcal < 1100, `${r.id} kcal ${f.per.kcal}`);
    assert.ok(f.costPer > 0 && f.costPer < 4, `${r.id} cost ${f.costPer}`);
    if (r.with) assert.ok(byId.has(C.SIDE_RECIPES[r.with]), `${r.id} side ${r.with}`);
  }
});

test("reads the example request", () => {
  const { req, understood } = C.parseRequest("Plan dinners for a family of four next week, with Indian and Italian meals, no more than 30 minutes of cooking per day, and a total £60 grocery budget.", { today, cat });
  assert.equal(req.people, 4);
  assert.deepEqual(req.meals, ["dinner"]);
  assert.equal(req.days, 7);
  assert.equal(req.start, "2026-10-19");                          // next Monday
  assert.deepEqual(req.cuisines.sort(), ["East Indian", "Italian", "North Indian", "South Indian", "West Indian"]);
  assert.equal(req.maxDay, 30);
  assert.equal(req.maxTotal, undefined);
  assert.equal(req.budget, 60);
  assert.ok(understood.length >= 6);
});

test("reads a child's protein-rich week", () => {
  const { req } = C.parseRequest("I want to cook for 11 year old protein rich diet this week", { today, cat });
  assert.ok(req.goals.includes("high-protein"));
  assert.ok(req.goals.includes("kid-friendly"));
  assert.equal(req.days, 7);
  assert.equal(req.start, today);
  assert.equal(req.people, undefined);                             // household size stays as set
});

test("reads mixed requests", () => {
  let { req } = C.parseRequest("South Indian and North Indian, all meals, for 3 people for 5 days, under 40 minutes, vegetarian, no mushrooms", { today, cat });
  assert.deepEqual(req.cuisines.sort(), ["North Indian", "South Indian"]);
  assert.deepEqual(req.meals, ["breakfast", "lunch", "dinner"]);
  assert.equal(req.people, 3); assert.equal(req.days, 5); assert.equal(req.maxTotal, 40); assert.equal(req.diet, "veg");
  assert.ok(req.avoid.includes("mushroom"));
  ({ req } = C.parseRequest("2 adults and 2 kids, weekday lunches, cheap, no beef or pork, ₹3000 budget", { today, cat }));
  assert.equal(req.people, 4); assert.deepEqual(req.meals, ["lunch"]); assert.equal(req.days, 5); assert.equal(req.start, "2026-10-19");
  assert.ok(req.goals.includes("budget")); assert.ok(req.avoid.includes("beef_mince") && req.avoid.includes("bacon")); assert.equal(req.budget, 3000);
  ({ req } = C.parseRequest("quick thai and chinese dinners for two this weekend, prep under 15 minutes", { today, cat }));
  assert.equal(req.people, 2); assert.equal(req.days, 2); assert.equal(req.maxPrep, 15); assert.deepEqual(req.cuisines.sort(), ["Chinese", "Thai"]);
  ({ req } = C.parseRequest("indo chinese for 4", { today, cat }));
  assert.deepEqual(req.cuisines, ["Indo-Chinese"]);
});

test("plans within the limits of the example request", () => {
  const { req } = C.parseRequest("Plan dinners for a family of four next week, Indian and Italian, no more than 30 minutes of cooking per day, £60 budget", { today, cat });
  const plan = C.planMenu(req, recipes, { cat, pricer, today });
  assert.equal(plan.slots.length, 7);
  const used = new Set();
  for (const s of plan.slots) {
    const r = byId.get(s.dishes[0].r);
    assert.ok(["South Indian", "North Indian", "West Indian", "East Indian", "Italian"].includes(r.cuisine), r.cuisine);
    assert.ok(Math.max(...s.dishes.map((x) => byId.get(x.r).total)) <= 30 + 3, `${r.id} ${r.total}`);
    assert.ok(s.dishes[0].s === 4);
    assert.ok(s.alts.length >= 1);
    used.add(r.id);
  }
  assert.ok(used.size >= 6, "variety");
  assert.ok(plan.cost <= 60, `cost ${plan.cost}`);
});

test("budget squeeze picks cheaper meals and warns when impossible", () => {
  const base = { days: 7, meals: ["dinner"], people: 4, seed: 3 };
  const free = C.planMenu(base, recipes, { cat, pricer, today });
  const tight = C.planMenu(Object.assign({}, base, { budget: Math.round(free.cost * 0.6) }), recipes, { cat, pricer, today });
  assert.ok(tight.cost < free.cost);
  const impossible = C.planMenu(Object.assign({}, base, { budget: 1 }), recipes, { cat, pricer, today });
  assert.ok(impossible.warnings.some((w) => /over your budget/.test(w)));
});

test("diet, avoid, protein goal and leftovers are respected", () => {
  const plan = C.planMenu({ days: 7, meals: ["breakfast", "lunch", "dinner"], people: 2, diet: "veg", avoid: ["paneer"], goals: ["high-protein"], leftovers: true, seed: 9 }, recipes, { cat, pricer, today });
  let protein = 0, n = 0;
  for (const s of plan.slots) for (const x of s.dishes) {
    const r = byId.get(x.r);
    assert.ok(["veg", "vegan"].includes(r.diet), r.id);
    assert.ok(!r.ingredients.some((i) => i.id === "paneer" && !i.opt), r.id);
    if (!x.side) { protein += C.recipeFacts(r, cat, pricer).per.protein; n++; }
  }
  assert.ok(protein / n > 12, `avg protein ${protein / n}`);
  const lunches = plan.slots.filter((s) => s.m === "lunch" && s.d > 0);
  assert.ok(lunches.every((s) => s.leftover));
  const dinner0 = plan.slots.find((s) => s.d === 0 && s.m === "dinner");
  assert.equal(dinner0.dishes[0].s, 4);                            // cooked double for tomorrow's lunch
});

test("shopping list adds up a menu", () => {
  const plan = C.planMenu({ days: 3, meals: ["dinner"], people: 4, cuisines: ["North Indian"], seed: 5 }, recipes, { cat, pricer, today });
  const items = C.shoppingNeeds(plan.slots, byId, cat, pricer);
  assert.ok(items.length > 8);
  const onion = items.find((i) => i.id === "onion");
  assert.ok(onion && onion.amount > 100);
  assert.ok(items.filter((i) => i.staple).every((i, k, a) => items.indexOf(i) >= items.length - a.length), "staples last");
  const total = items.reduce((a, i) => a + (i.cost || 0), 0);
  assert.ok(Math.abs(total - plan.cost) < plan.cost * 0.2 + 1, `${total} vs ${plan.cost}`);
});

test("reads imported ingredient lines", () => {
  const p = (s) => C.parseIngredientLine(s, cat);
  let x = p("2 large onions, finely chopped"); assert.equal(x.id, "onion"); assert.equal(x.q, 2); assert.equal(x.amount, 300);
  x = p("1 x 400g tin chopped tomatoes"); assert.equal(x.id, "chopped_tomatoes"); assert.equal(x.amount, 400);
  x = p("1 tin (400ml) coconut milk"); assert.equal(x.id, "coconut_milk"); assert.equal(x.amount, 400);
  x = p("½ tsp ground turmeric"); assert.equal(x.id, "turmeric"); assert.equal(x.q, 0.5);
  x = p("1 1/2 cups basmati rice"); assert.equal(x.id, "basmati"); assert.ok(Math.abs(x.amount - 306) < 2);
  x = p("3 garlic cloves, crushed"); assert.equal(x.id, "garlic");
  x = p("500g boneless chicken thighs, cut into chunks"); assert.equal(x.id, "chicken_thigh"); assert.equal(x.amount, 500);
  x = p("Salt to taste"); assert.equal(x.id, "salt"); assert.equal(x.q, null);
  x = p("2 tbsp Greek yoghurt"); assert.equal(x.id, "greek_yogurt");
  x = p("a handful of coriander leaves"); assert.equal(x.id, "coriander");
  x = p("1 tsp kashmiri chilli powder"); assert.equal(x.id, "chilli_powder");
  x = p("200g paneer, cubed"); assert.equal(x.id, "paneer");
  x = p("1 tbsp dragonfruit essence"); assert.equal(x.id, null);
});

const TESCO = `TESCO
Express 1234
Some Street Edinburgh
TESCO BSMTI RICE 1KG      2.10
CHKN BRST FILLETS 650G    4.75
TESCO ONIONS 1KG          0.95
SEMI SKIMMED MILK 4PT     1.45
CORIANDER 30G             0.60
Clubcard Price Saving    -0.20
2 x £0.85
CHOPPED TOMATOES 400G     1.70
BANANAS LOOSE
0.812 kg @ £0.88/kg       0.71
SUBTOTAL                  12.26
TOTAL                     12.26
VISA                      12.26
17/10/2026 14:32`;

test("reads a shop receipt", () => {
  const r = C.parseReceipt(TESCO);
  assert.equal(r.store, "Tesco");
  assert.equal(r.date, "2026-10-17");
  assert.equal(r.total, 12.26);
  const texts = r.lines.map((l) => l.text);
  assert.equal(r.lines.length, 7, JSON.stringify(texts));
  assert.equal(r.lines.find((l) => /CORIANDER/.test(l.text)).price, 0.4);              // after the saving
  const toms = r.lines.find((l) => /CHOPPED/.test(l.text));
  assert.equal(toms.price, 1.7);
  const m = C.matchReceipt(r, cat, {}, ["onion"]);
  const get = (re) => m.find((x) => re.test(x.text));
  assert.equal(get(/BSMTI/).id, "basmati"); assert.equal(get(/BSMTI/).qty, 1000);
  assert.equal(get(/CHKN/).id, "chicken_breast"); assert.equal(get(/CHKN/).qty, 650);
  assert.equal(get(/ONIONS/).id, "onion");
  assert.equal(get(/MILK/).id, "milk"); assert.equal(get(/MILK/).qty, 2272);
  assert.equal(get(/CORIANDER/).id, "coriander");
});

test("learned receipt names are remembered", () => {
  const doc = C.freshDoc();
  const user = { username: "sharath", displayName: "Sharath", role: "admin" };
  const r = C.parseReceipt("LIDL\nDELUXE PNR BLK 400G 3.49\nTOTAL 3.49");
  let m = C.matchReceipt(r, cat, doc.aliases);
  const line = m[0];
  C.applyOp(doc, { type: "applyReceipt", store: "Lidl", date: "2026-10-17", lines: [{ key: line.key, text: line.text, id: "paneer", price: line.price, qty: 400, count: 1 }] }, user);
  assert.ok(doc.prices.paneer && Math.abs(doc.prices.paneer[0].pb - 3.49 / 400) < 1e-6);
  m = C.matchReceipt(C.parseReceipt("LIDL\nDELUXE PNR BLK 400G 3.29\nTOTAL 3.29"), cat, doc.aliases);
  assert.equal(m[0].id, "paneer"); assert.equal(m[0].how, "learned"); assert.equal(m[0].use, true);
  const p2 = C.makePricer(C.buildCatalog(D.INGREDIENTS), doc.prices, "GBP");
  assert.equal(p2.per("paneer").src, "bill");
});

test("Indian receipt columns", () => {
  const r = C.parseReceipt(`DMART\nToor Dal 1kg   1   165.00   165.00\nAmul Butter 500g  1  280.00  280.00\nOnion 2 40.00 80.00\nNet Amount 525.00`);
  assert.equal(r.lines.length, 3);
  assert.equal(r.lines[2].count, 2);
  const m = C.matchReceipt(r, cat);
  assert.equal(m[0].id, "toor_dal"); assert.equal(m[1].id, "butter"); assert.equal(m[1].qty, 500); assert.equal(m[2].id, "onion");
});

test("menu review: only the owner edits and decides; others vote and suggest", () => {
  const doc = C.freshDoc();
  const owner = { username: "sharath", displayName: "Sharath", role: "member" };
  const other = { username: "priya", displayName: "Priya", role: "member" };
  const id = C.applyOp(doc, { type: "createMenu", menu: { name: "Week 43", start: today, days: 2, meals: ["dinner"], people: 4, slots: [{ d: 0, m: "dinner", dishes: [{ r: "b:rajma", s: 4 }], alts: [] }] } }, owner);
  assert.throws(() => C.applyOp(doc, { type: "voteMenu", id, vote: "agree" }, other), /hasn't been shared/);
  C.applyOp(doc, { type: "setMenuStatus", id, status: "review" }, owner);
  assert.throws(() => C.applyOp(doc, { type: "updateMenu", id, menu: { name: "x" } }, other), /Only the person who made/);
  C.applyOp(doc, { type: "voteMenu", id, vote: "agree" }, other);
  const sid = C.applyOp(doc, { type: "suggest", id, d: 0, m: "dinner", r: "b:butter-chicken", text: "Kids want this" }, other);
  assert.equal(doc.menus[0].votes.priya.v, "change");
  assert.throws(() => C.applyOp(doc, { type: "resolveSuggestion", id, sid, accept: true }, other), /decides/);
  C.applyOp(doc, { type: "resolveSuggestion", id, sid, accept: true, sides: ["b:chapati"] }, owner);
  assert.equal(doc.menus[0].slots[0].dishes[0].r, "b:butter-chicken");
  assert.equal(doc.menus[0].slots[0].dishes[1].r, "b:chapati");
  assert.ok(doc.menus[0].slots[0].alts.includes("b:rajma"));
  C.applyOp(doc, { type: "setMenuStatus", id, status: "final" }, owner);
  C.applyOp(doc, { type: "saveFavorite", name: "Kids' favourite week", kind: "week", days: 2, meals: ["dinner"], people: 4, slots: doc.menus[0].slots, fromMenu: id }, other);
  assert.equal(doc.favorites.length, 1);
});

test("shopping list merges and ticks", () => {
  const doc = C.freshDoc(), u = { username: "a", role: "member" };
  C.applyOp(doc, { type: "listAdd", items: [{ id: "onion", amount: 300 }, { name: "Birthday candles" }], menuId: "m1" }, u);
  C.applyOp(doc, { type: "listAdd", items: [{ id: "onion", amount: 200 }] }, u);
  assert.equal(doc.list.items.length, 2);
  assert.equal(doc.list.items[0].amount, 500);
  C.applyOp(doc, { type: "listUpdate", id: doc.list.items[0].id, checked: true }, u);
  C.applyOp(doc, { type: "listClear" }, u);
  assert.equal(doc.list.items.length, 1);
});

test("food types filter", () => {
  const t = (id) => [...C.foodTypes(byId.get(id))].sort().join(",");
  assert.equal(t("b:butter-chicken"), "chicken");
  assert.equal(t("b:rajma"), "veg");
  assert.equal(t("b:egg-bhurji"), "egg");
  assert.equal(t("b:thai-green-curry"), "chicken,fish");            // fish sauce
  assert.equal(t("b:full-english"), "egg,pork");
  assert.equal(t("b:pad-thai"), "egg,fish,prawns");
  const noBeef = recipes.filter((r) => C.typesAllowed(r, new Set(["beef"])));
  assert.ok(!noBeef.some((r) => r.ingredients.some((i) => i.id === "beef_mince")));
  const vegOnly = recipes.filter((r) => C.typesAllowed(r, new Set(C.FOOD_TYPES.filter((x) => x.k !== "veg").map((x) => x.k))));
  assert.ok(vegOnly.length > 40 && vegOnly.every((r) => ["veg", "vegan"].includes(r.diet)), vegOnly.filter((r) => !["veg", "vegan"].includes(r.diet)).map((r) => r.id).join());
  const m = C.parseIngredientLine("500g fresh mussels, cleaned", cat); assert.equal(m.id, "mussels");
});

test("planner respects the foods tick-list", () => {
  const off = ["beef", "pork", "prawns", "fish", "salmon", "tuna", "shellfish", "squid", "crab"];
  const plan = C.planMenu({ days: 14, meals: ["breakfast", "lunch", "dinner"], people: 3, off, seed: 11 }, recipes, { cat, pricer, today });
  const offS = new Set(off);
  for (const s of plan.slots) for (const x of s.dishes) assert.ok(C.typesAllowed(byId.get(x.r), offS), x.r);
  const meatOnly = C.planMenu({ days: 5, meals: ["dinner"], people: 2, off: ["veg"], seed: 4 }, recipes, { cat, pricer, today });
  for (const s of meatOnly.slots) { assert.ok(!C.foodTypes(byId.get(s.dishes[0].r)).has("veg"), s.dishes[0].r); }
  assert.ok(meatOnly.slots.some((s) => s.dishes.some((x) => x.side)), "rice/roti sides still allowed when vegetarian dishes are off");
});
