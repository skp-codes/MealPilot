// Working out a recipe's cuisine, meals, diet, food types, spice and side dish from its text.
import * as C from "../../public/core.js";

const T = (s) => String(s || "").toLowerCase();

/* ---------- cuisine ---------- */
// Archana's Kitchen "Cuisine" values → MealPilot cuisines.
const ARCHANA = [
  [/indo chinese|indo-chinese/, "Indo-Chinese"],
  [/south indian|kerala|tamil|chettinad|andhra|udupi|karnataka|mangalore|coorg|kongunadu|hyderabad|telangana|coastal karnataka/, "South Indian"],
  [/gujarat|maharashtr|goan|rajasthan|sindhi|parsi|malvani|konkan|kolhapur/, "West Indian"],
  [/bengal|oriya|odia|assam|bihar|jharkhand|north east|nagaland|manipur|sikkim|meghalaya|arunachal/, "East Indian"],
  [/pakistan/, "Pakistani"], [/sri lank/, "Sri Lankan"], [/nepal/, "East Indian"],
  [/north indian|punjab|mughlai|kashmir|lucknow|awadh|himachal|uttarakhand|kumaon|haryana|uttar pradesh|delhi|indian/, "North Indian"],
  [/thai/, "Thai"], [/chinese/, "Chinese"], [/japan/, "Japanese"], [/korea/, "Korean"], [/vietnam/, "Vietnamese"],
  [/malaysia|indonesia|burmese|singapore|asian/, "Southeast Asian"], [/middle eastern|arab|lebanes|turkish|persian/, "Middle Eastern"],
  [/greek|mediterranean/, "Mediterranean"], [/italian/, "Italian"], [/french/, "French"], [/mexican/, "Mexican"], [/african|moroccan/, "African"],
  [/caribbean/, "Caribbean"], [/british|english/, "British"], [/american/, "American"], [/european|continental|fusion/, null],
];
// Rules for any dataset, most specific first. Applied to title + keywords + category.
const RULES = [
  ["Indo-Chinese", /\bindo[\s-]?chinese|\bhakka noodles|\bmanchurian|\bchilli paneer|\bchilli chicken|\bschezwan\b|\bgobi manchurian|\bdragon chicken/],
  ["South Indian", /\bsouth indian|\bdosa|\bdosai|\bidli|\bidly|\bsambar|\bsambhar|\brasam\b|\bkerala|\bchettinad|\btamil|\bandhra|\btelangana|\bkarnataka|\budupi|\bmangalore|\bappam|\buttapam|\bporiyal|\bkootu|\bavial|\baviyal|\bpongal|\bupma|\bmedu vada|\bpayasam|\bputtu|\bkozhukattai|\bbisi bele|\bthoran|\bpachadi|\bkuzhambu|\bkulambu|\bhyderabadi|\bmysore|\bmalabar/],
  ["West Indian", /\bgujarat|\bmaharashtr|\bgoan\b|\bgoa\b|\brajasthan|\bsindhi|\bparsi\b|\bmalvani|\bkonkan|\bkolhapur|\bthepla|\bdhokla|\bkhandvi|\bpoha\b|\bpav bhaji|\bvada pav|\bmisal\b|\bundhiyu|\bdal baati|\bkhakhra|\bhandvo|\bvindaloo|\bxacuti|\bsorpotel/],
  ["East Indian", /\bbengal|\bodia\b|\boriya|\bassam|\bbihar|\bjharkhand|\bmacher|\bmachher|\bshorshe|\blitti\b|\brosogolla|\brasgulla|\bsandesh\b|\bmishti\b|\bnepal|\bmomos?\b/],
  ["Pakistani", /\bpakistan|\blahori|\bkarachi|\bpeshawar/],
  ["Sri Lankan", /\bsri lanka|\bceylon|\bkottu|\bhoppers\b/],
  ["Thai", /\bthai\b|\bthailand|\bpad thai|\btom yum|\btom kha|\blarb\b|\bmassaman|\bpanang|\bsatay/],
  ["Vietnamese", /\bvietnam|\bpho\b|\bbanh mi|\bbun cha|\bnuoc cham|\bspring rolls? vietnam/],
  ["Southeast Asian", /\bmalaysia|\bindonesia|\bfilipin|\bphilippin|\bsingapore|\bburmese|\bmyanmar|\blaotian|\bcambodia|\brendang|\bnasi goreng|\badobo\b|\blaksa|\bsinigang|\bpancit|\blumpia|\bsambal/],
  ["Korean", /\bkorea|\bkimchi|\bbulgogi|\bbibimbap|\bgochujang|\bjapchae|\bgalbi/],
  ["Japanese", /\bjapan|\bteriyaki|\bsushi|\bmiso\b|\bramen|\budon|\bsoba\b|\btempura|\bkatsu|\byakitori|\btonkatsu|\bdonburi|\bokonomiyaki|\bgyoza|\bwasabi|\bedamame/],
  ["Chinese", /\bchinese|\bchina\b|\bszechuan|\bsichuan|\bcantonese|\bhunan|\bwonton|\bdim sum|\bchow mein|\blo mein|\bkung pao|\bsweet and sour|\begg foo|\bmapo|\bchar siu|\bhoisin|\bgeneral tso|\bmoo shu|\bfried rice|\bpotstickers|\bhot and sour/],
  ["Middle Eastern", /\bmiddle east|\blebanes|\bturkish|\bpersian|\biranian|\bisrael|\barab\b|\barabic|\begypt|\bsyria|\bjordan|\biraq|\byemen|\bfalafel|\bhummus|\bshawarma|\btabbouleh|\btabouli|\bfattoush|\bbaba ganoush|\bkofta|\bkibbeh|\bshakshuka|\bza.?atar|\bbaklava|\bdolma/],
  ["African", /\bafrican|\bmoroc|\bethiopi|\bnigeria|\bghana|\bkenya|\btunisia|\balgeria|\bsenegal|\btagine|\btajine|\bjollof|\binjera|\bbobotie|\bharissa|\bpiri piri|\bperi peri|\bberbere|\bbiltong|\bbobotie/],
  ["Mediterranean", /\bgreek|\bgreece|\bmediterranean|\bcyprus|\bcretan|\btzatziki|\bsouvlaki|\bmoussaka|\bspanakopita|\bgyros?\b|\bfeta\b.*\bsalad|\bkalamata|\bdolmades/],
  ["Caribbean", /\bcaribbean|\bjamaica|\bjerk\b|\bcuba|\bpuerto ric|\bdominican|\btrinidad|\bhaiti|\bbahama|\bbarbados|\bwest indian|\bcallaloo|\bjamaican/],
  ["Mexican", /\bmexic|\btex[\s-]?mex|\btacos?\b|\bburrito|\benchilada|\bquesadilla|\bfajita|\bguacamole|\btamale|\bchimichanga|\bnachos?\b|\btostada|\bpozole|\bmole\b|\bchile relleno|\bchipotle|\bcarnitas|\belote|\bchurro|\bhorchata|\btortilla soup|\bsalsa verde|\bpico de gallo|\bqueso/],
  ["Latin American", /\bbrazil|\bperu|\bargentin|\bchilean|\bcolombia|\bvenezuela|\becuador|\bbolivia|\buruguay|\bguatemala|\bsalvador|\bhonduras|\bnicaragua|\bcosta rica|\bpanama|\bsouth america|\blatin america|\bempanada|\bceviche|\bchimichurri|\barepa|\bfeijoada|\bpupusa|\bdulce de leche|\btres leches|\bbrigadeiro/],
  ["Spanish", /\bspanish|\bspain|\bportug|\bpaella|\btapas|\bgazpacho|\btortilla espa|\bpatatas bravas|\bcatalan|\bbasque|\bromesco|\bpastel de nata|\bchorizo/],
  ["French", /\bfrench|\bfrance|\bproven|\bbourguignon|\bcoq au vin|\bratatouille|\bquiche|\bcrepes?|\bcroissant|\bsouffl|\bgratin|\bbechamel|\bbéchamel|\bcassoulet|\bnicoise|\bbouillabaisse|\btarte|\bclafoutis|\bmadeleine|\bcroque|\bbrioche|\bvichyssoise|\bconfit/],
  ["German", /\bgerman|\baustria|\bswiss\b|\bbavarian|\bschnitzel|\bsauerkraut|\bspaetzle|\bspätzle|\bstrudel|\bbratwurst|\bpretzel|\bblack forest|\bsauerbraten|\bstollen|\blebkuchen/],
  ["Eastern European", /\bpolish|\bpoland|\brussia|\bukrain|\bhungar|\bczech|\bromania|\bserbia|\bcroatia|\bbulgaria|\blithuania|\blatvia|\bslovak|\bpierogi|\bborscht|\bborsch|\bgoulash|\bpaprikash|\bstroganoff|\bblini|\bkielbasa|\bpelmeni|\bkolache|\bbabka/],
  ["Scandinavian", /\bscandinavia|\bswedish|\bsweden|\bnorweg|\bdanish|\bdenmark|\bfinnish|\bfinland|\biceland|\bnordic|\bgravlax|\blefse|\bebleskiver|\baebleskiver|\bkanelbullar|\bsmorrebrod|\blingonberr/],
  ["Italian", /\bitalian|\bitaly|\bpasta\b|\brisotto|\blasagn|\bgnocchi|\bpesto|\bparmigiana|\bbruschetta|\bcarbonara|\bmarinara|\balfredo|\bravioli|\btortellini|\bpizza|\bcalzone|\bfocaccia|\bminestrone|\btiramisu|\bbiscotti|\bcacciatore|\bpiccata|\bosso buco|\bpolenta|\bpanzanella|\barancini|\bfrittata|\bcaprese|\bbolognese|\bspaghetti|\bfettuccin|\blinguine|\bpenne|\bziti|\bmanicotti|\bpanna cotta|\bsaltimbocca|\bstromboli|\borzo/],
  ["British", /\bbritish|\benglish|\bscottish|\bscotland|\birish|\bireland|\bwelsh|\bwales|\bshepherd.?s pie|\bcottage pie|\byorkshire|\btoad in the hole|\bbangers|\bbubble and squeak|\bscones?\b|\bcrumpets?|\btrifle|\bsticky toffee|\bcornish|\bpasty|\bbread and butter pudding|\bfish and chips|\bhaggis|\bcolcannon|\bsoda bread|\bploughman|\beton mess|\bvictoria sponge|\baustralian|\bnew zealand|\banzac|\bpavlova|\blamingtons?|\bbanoffee|\bcrumble\b|\bspotted dick|\bcock-a-leekie|\bwelsh rarebit|\bbeef wellington/],
  ["American", /\bamerican|\bsouthern\b|\bcajun|\bcreole|\bsoul food|\bhawaiian|\bcanadian|\bnew england|\bbbq\b|\bbarbecue|\bcasserole|\bmeatloaf|\bmac and cheese|\bmac n cheese|\bcornbread|\bbrownies?|\bcheeseburger|\bsloppy joe|\bbuffalo|\bclam chowder|\bjambalaya|\bgumbo|\bpot roast|\bbiscuits and gravy|\bcobbler|\bpecan pie|\bs.?mores|\bcheesesteak|\bpulled pork|\bcoleslaw|\bpancakes?/],
  ["North Indian", /\bindian\b|\bindia\b|\bpunjab|\bmughlai|\bkashmir|\blucknow|\bawadh|\bdelhi|\bhimachal|\bcurry|\bmasala|\btikka|\btandoor|\bpaneer|\bdal\b|\bdaal\b|\bdhal\b|\bbiryani|\bkorma|\bchana\b|\bchole|\baloo\b|\bgobi\b|\bbhaji|\bpakora|\bsamosa|\bnaan\b|\bchapati|\broti\b|\bparatha|\braita|\bkheer|\bhalwa|\bladoo|\bladdu|\bchutney|\bsabzi|\bsabji|\bkofta curry|\bkeema|\brajma|\bpulao|\bpilau|\bdum\b|\bvindaloo|\bbhuna|\bbalti|\bmadras|\bjalfrezi|\brogan josh|\bsaag|\bpalak|\bmethi|\bgulab jamun|\bjalebi|\bkulfi|\blassi|\bchaat|\bbhel|\bpani puri/],
];
const ALL_INDIAN = new Set(["South Indian", "North Indian", "West Indian", "East Indian", "Indo-Chinese", "Pakistani", "Sri Lankan"]);
export function cuisineOf(r, if101) {
  if (r.src === "ak") {
    const c = T(r.cuisine);
    for (const [re, v] of ARCHANA) if (re.test(c)) { if (v) { if (v === "North Indian") { const more = guessRules(T(r.title)); if (more && ALL_INDIAN.has(more)) return more; } return v; } break; }
    const g = guessRules(T(r.title)); return g || "North Indian";
  }
  const text = T([r.title, r.keywords, r.course, r.cuisine].filter(Boolean).join(" | "));
  let g = guessRules(text);
  // Indian Food 101 knows which state/region many dishes come from.
  if ((g === "North Indian" || !g) && if101) {
    const hit = if101.get(normTitle(r.title));
    if (hit) g = { South: "South Indian", West: "West Indian", East: "East Indian", "North East": "East Indian", North: "North Indian", Central: "North Indian" }[hit.region] || g || "North Indian";
  }
  return g || (r.src === "fc" || r.src === "fr" ? "American" : null);
}
function guessRules(text) { for (const [c, re] of RULES) if (re.test(text)) return c; return null; }

/* ---------- meals ---------- */
const DROP = /\b(beverages?|smoothies?|shakes?|punch|cocktails?|drinks?|lemonade|liqueur|sauces?|salad dressings?|dressing|spreads?|jellies|jams?|canning|condiments?|marinades?|seasoning mix|spice mix|rubs?|baby food|dog food|pet food|homemade dog|play dough|playdough|bath|soap|candle)\b/;
const DESSERT = /\b(dessert|desserts|cakes?|cookies?|cookie & brownie|brownies?|pies?|tarts?|cheesecake|candy|candies|fudge|frozen desserts|ice cream|pudding|puddings|custard|mousse|cupcakes?|bar cookie|drop cookies|tortes?|trifle|sweets?|mithai|halwa|kheer|payasam|ladoo|laddu|barfi|burfi|gulab jamun|jalebi|rasgulla|cobbler|crisp|crumble|meringue|macarons?|doughnuts?|donuts?|muffins? sweet|frosting|icing|truffles?|brittle|toffee|caramel)\b/;
const BREAKFAST = /\b(breakfast|brunch|pancakes?|waffles?|french toast|omelets?|omelettes?|granola|porridge|oatmeal|muesli|scrambled|frittata|eggs benedict|hash browns?|breakfast burrito|smoothie bowl|crepes?|dosa|idli|uttapam|upma|poha|paratha|thepla|chilla|cheela|pesarattu|appam|puttu|pongal|idiyappam)\b/;
const SNACK = /\b(appetizers?|snacks?|starters?|finger food|dips?|lunch\/snacks|chips|nuts|trail mix|popcorn|pakoras?|pakodas?|bhajji|samosas?|vadas?|cutlets?|chaat|bhel|tikki|kebabs? starter|wings|nachos|bruschetta|crostini|deviled eggs|spring rolls?|dumplings|momos?|sandwich(?:es)?)\b/;
const SIDE = /\b(side dish|side dishes|sides?|vegetables?|potato(es)?|rice|beans|greens|corn|salads?|breads?|yeast breads|quick breads|rolls|biscuits|coleslaw|raita|chutney|pickle|poriyal|thoran|kootu|stir fry vegetables|roasted vegetables|mashed|sabzi|sabji|bhaji)\b/;
export function mealsOf(r) {
  const text = T([r.course, r.keywords, r.title].filter(Boolean).join(" | "));
  const title = T(r.title), course = T(r.course);
  if (DROP.test(course) || /\b(beverages|cocktails|smoothies|punch beverage|shakes|sauces|salad dressings|spreads|jellies|canning|chutneys)\b/.test(T(r.keywords)) && !/\b(main|dinner|lunch)\b/.test(text)) return null;
  if (DROP.test(title) && !/\b(with|in)\b/.test(title)) return null;
  if (DESSERT.test(course) || DESSERT.test(title)) return ["dessert"];
  const meals = new Set();
  if (BREAKFAST.test(text) || /breakfast/.test(course)) meals.add("breakfast");
  if (/brunch/.test(text)) { meals.add("breakfast"); meals.add("lunch"); }
  if (/\blunch\b/.test(course) || /lunch\/snacks/.test(text)) meals.add("lunch");
  if (/\bdinner\b|main course|main dish|one dish meal|one pot/.test(text)) { meals.add("lunch"); meals.add("dinner"); }
  if (SNACK.test(course) || /\bappetizer|\bsnack|\bstarter/.test(text)) meals.add("snack");
  if (!meals.size && (SIDE.test(course) || /side dish/.test(text))) return ["side"];
  if (!meals.size) { meals.add("lunch"); meals.add("dinner"); }
  return C.MEALS.filter((m) => meals.has(m));
}

/* ---------- diet, food types and spice from the raw text (covers unmatched ingredients) ---------- */
const MEAT_WORDS = [
  ["chicken", /\b(chicken|hen|poussin)\b(?! of the woods)/], ["turkey", /\b(turkey|duck|goose|quail|pheasant)\b/],
  ["beef", /\b(beef|steak|veal|brisket|sirloin|ground round|chuck|oxtail|corned beef|bison|ground beef|hamburger meat)\b(?!steak tomato)/],
  ["lamb", /\b(lamb|mutton|goat|chevon)\b/], ["pork", /\b(pork|bacon|ham|sausages?|salami|pepperoni|prosciutto|pancetta|chorizo|lard|hot dogs?|frankfurters?|kielbasa|bratwurst|andouille|spare ?ribs|baby back ribs)\b/],
  ["fish", /\b(fish|cod|haddock|tilapia|halibut|sea bass|bass|snapper|mackerel|sardines?|anchov(y|ies)|trout|catfish|pollock|sole|flounder|swordfish|mahi|herring|fish sauce|surimi|hake|pomfret|rohu|hilsa|kingfish|seer)\b/],
  ["salmon", /\bsalmon\b/], ["tuna", /\btuna\b/], ["prawns", /\b(shrimps?|prawns?|scampi)\b/],
  ["shellfish", /\b(mussels?|clams?|oysters?|scallops?|cockles?)\b/], ["squid", /\b(squid|calamari|octopus|cuttlefish)\b/], ["crab", /\b(crab|lobster|crawfish|crayfish)\b/],
  ["othermeat", /\b(venison|rabbit|liver|kidneys?|tripe|offal|gizzards?|veal|game|elk|boar|ostrich|kangaroo|gelatine?|suet|bone marrow|meat)\b/],
];
const EGG = /\b(eggs?|egg yolks?|egg whites?|mayonnaise|mayo|meringue)\b/;
const NOT_MEAT = /\b(vegetable stock|vegetable broth|veg stock|veggie|vegetarian|vegan|meatless|plant[\s-]based|eggplant|egg ?free|mock|soy chunks|fake|imitation crab)\b/;
export function typesFromText(lines) {
  const ft = new Set();
  for (const raw of lines) {
    const l = T(raw).replace(NOT_MEAT, " ");
    for (const [k, re] of MEAT_WORDS) if (re.test(l)) ft.add(k);
    if (/\b(chicken|beef)\s+(stock|broth|bouillon)\b/.test(l)) ft.add(/beef/.test(l) ? "beef" : "chicken");
    if (EGG.test(l) && !/\beggplant\b/.test(l)) ft.add("egg");
  }
  if (ft.has("othermeat") && [...ft].some((t) => t !== "othermeat" && t !== "egg")) ft.delete("othermeat");
  return [...ft];
}
export function dietOfText(ft, archanaDiet) {
  const d = T(archanaDiet);
  if (/vegan/.test(d)) return "vegan";
  if (/non veg|non-veg|nonveg/.test(d)) return "nonveg";
  if (/eggetarian/.test(d)) return "egg";
  if (ft.some((t) => t !== "egg")) return "nonveg";
  if (ft.includes("egg")) return "egg";
  return /vegetarian|sattvic|jain/.test(d) ? "veg" : null;
}
export function spiceOf(ings, servings) {
  const hot = { green_chilli: 6, chilli_powder: 4, dried_chilli: 1, chilli_flakes: 2.5, chilli_sauce: 0.15, curry_paste: 0.2, gochujang: 0.15, taco_seasoning: 0.3, sambar_powder: 1, rasam_powder: 1, garam_masala: 0.3, curry_powder: 0.6 };
  let heat = 0;
  for (const x of ings) if (hot[x.id]) heat += (x.amount || 0) * hot[x.id];
  const per = heat / Math.max(1, servings || 1);
  return per > 6 ? 3 : per > 2.5 ? 2 : per > 0.6 ? 1 : 0;
}
// Indian mains are usually eaten with rice or roti — the planner adds it.
export function sideOf(r, cuisine, meals) {
  if (!ALL_INDIAN.has(cuisine) || !meals.some((m) => m === "lunch" || m === "dinner")) return "";
  const t = T(r.title);
  if (/\b(rice|biryani|pulao|pilaf|khichdi|bath|dosa|idli|uttapam|roti|paratha|naan|chapati|puri|bhatura|kulcha|thepla|pav|noodles|sandwich|wrap|frankie|roll|salad|soup)\b/.test(t)) return "";
  if (/\b(curry|dal|daal|dhal|sambar|rasam|kurma|korma|masala|gravy|kadhi|kootu|kuzhambu|kulambu|sabzi|sabji|stew|keema|rajma|chole|chana|paneer|kofta|vindaloo|makhani|tikka masala|bhuna|xacuti|poriyal|thoran|avial)\b/.test(t))
    return cuisine === "South Indian" || /\b(sambar|rasam|kuzhambu|kulambu|kootu|poriyal|thoran|avial|rajma|kadhi)\b/.test(t) ? "rice" : "roti";
  return "";
}

/* ---------- Food.com quantities have no units: recover them ---------- */
// From a matching RecipeNLG / Recipe1M copy of the same Food.com page when there is one, else a sensible guess.
export function linesWithUnits(r, alt, cat) {
  const out = []; let guessed = 0;
  const altParsed = alt ? alt.map((l) => ({ l, p: C.parseIngredientLine(l, cat) })).filter((x) => x.p) : [];
  r.parts.forEach((part, i) => {
    const q = r.qtys[i];
    const qn = C.parseLeadingQty(String(q || "")).q;
    const base = C.parseIngredientLine(part, cat) || { name: part, id: null };
    // 1. the same ingredient in the full-text copy
    const hit = altParsed.find((x) => x.p.id && x.p.id === base.id) || altParsed.find((x) => C.norm(x.l).includes(C.norm(part)));
    if (hit && hit.p.q != null) { out.push(Object.assign({}, hit.p, { text: hit.l })); return; }
    if (qn == null) { out.push(Object.assign({}, base, { q: null, text: part })); return; }
    // 2. a guess from the kind of ingredient
    const ing = base.id && cat.byId.get(base.id);
    let u = ing ? guessUnit(ing, qn, part) : "pc";
    // Implausible as cups/pounds/spoons (e.g. "200 flour") — it was grams or millilitres.
    if (ing && qn > 12 && ["cup", "lb", "tbsp", "tsp", "oz"].includes(u)) u = ing.unit === "ml" ? "ml" : ing.unit === "pc" ? "pc" : "g";
    guessed++;
    out.push(Object.assign({}, base, { q: qn, u, amount: ing ? Math.round(C.toBase(qn, u, ing) * 100) / 100 : 0, text: `${q} ${u === "pc" ? "" : u + " "}${part}`.replace(/\s+/g, " ").trim(), guessed: true }));
  });
  return { lines: out, guessed };
}
function guessUnit(ing, q, part) {
  const p = T(part);
  if (/\bcloves?\b/.test(p)) return "clove";
  if (ing.unit === "pc") return "pc";
  if (ing.tin && /\b(beans|chickpeas|tomatoes|soup|coconut milk|pumpkin|corn|tuna|pineapple)\b/.test(p) && q <= 4 && ["pulses", "pantry", "meat", "frozen"].includes(ing.aisle)) return "tin";
  if (ing.aisle === "spices" || ["baking_powder", "baking_soda", "vanilla", "yeast", "salt", "pepper", "nutmeg"].includes(ing.id)) return q <= 3 ? "tsp" : "tbsp";
  if (ing.aisle === "meat") return /\b(breasts?|thighs?|fillets?|chops?|wings?|drumsticks?|legs?|steaks?)\b/.test(p) ? (ing.pc ? "pc" : "lb") : q <= 6 ? "lb" : "oz";
  if (["soy_sauce", "worcestershire", "vinegar", "fish_sauce", "oil", "olive_oil", "sesame_oil", "coconut_oil", "honey", "maple_syrup", "ketchup", "mustard", "chilli_sauce", "oyster_sauce", "tomato_puree", "lemon_juice", "mayonnaise", "peanut_butter"].includes(ing.id)) return q <= 4 ? "tbsp" : "ml";
  if (ing.id === "butter") return q <= 1 ? "cup" : "tbsp";
  if (["pasta", "pasta_short", "lasagne", "egg_noodles", "rice_noodles"].includes(ing.id)) return q <= 2 ? "lb" : "oz";
  if (["coriander", "parsley", "mint", "basil", "dill"].includes(ing.id)) return q <= 4 ? "tbsp" : "cup";
  if (ing.pc && ["produce"].includes(ing.aisle) && Number.isInteger(q) && !/\b(chopped|sliced|diced|shredded|grated|cups?)\b/.test(p)) return "pc";
  return "cup";
}

/* ---------- duplicates ---------- */
const TITLE_NOISE = new Set("the a an my our best easy quick simple homemade home made recipe style perfect delicious ultimate classic authentic moms mom grandmas grandma nanas aunt copycat healthy healthier lighter light low fat lowfat skinny super really very amazing awesome yummy tasty famous favorite favourite world s and with".split(" "));
export function normTitle(t) { return C.norm(t).split(" ").filter((w) => w && !TITLE_NOISE.has(w)).join(" "); }
export function dedupeKey(r) {
  const words = (r.ner && r.ner.length ? r.ner : (r.parts && r.parts.length ? r.parts : r.lines)).map((l) => { const w = C.norm(String(l).replace(/\([^)]*\)/g, "")).split(" ").filter((x) => x.length > 2 && !/^\d/.test(x)); return w[w.length - 1] || ""; }).filter(Boolean);
  return normTitle(r.title) + "|" + [...new Set(words)].sort().slice(0, 12).join(",");
}
export const hash52 = C.hash52;
export const titleTokens = C.searchTokens;
