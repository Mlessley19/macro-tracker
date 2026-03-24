import { useState, useRef, useEffect } from "react";

// ─── Fonts + Global Styles ────────────────────────────────────────
const fontLink = document.createElement("link");
fontLink.rel = "stylesheet";
fontLink.href = "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap";
document.head.appendChild(fontLink);
const globalStyle = document.createElement("style");
globalStyle.textContent = `
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { margin: 0; padding: 0; background: #F7F6F2; overscroll-behavior-y: none; }
  input, select, textarea { font-size: 16px !important; }
`;
document.head.appendChild(globalStyle);

// ─── Design Tokens ────────────────────────────────────────────────
const T = {
  bg:        "#F7F6F2",
  surface:   "#FFFFFF",
  border:    "#E4E2DC",
  text:      "#1A1A18",
  muted:     "#8A8880",
  faint:     "#C8C5BC",
  accent:    "#4A7C3F",
  accentBg:  "#EBF4E8",
  accentTxt: "#2D5A24",
  yellow:    "#D4840A",
  yellowBg:  "#FEF3DC",
  red:       "#C0392B",
  redBg:     "#FDECEA",
  teal:      "#1A7A6E",
  tealBg:    "#E4F4F2",
  shadow:    "0 1px 3px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.04)",
  shadowMd:  "0 4px 16px rgba(0,0,0,0.09), 0 2px 4px rgba(0,0,0,0.04)",
};

const FONT_BODY    = "'DM Sans', sans-serif";
const FONT_DISPLAY = "'Bebas Neue', sans-serif";
const DAILY_TARGETS = { calories: 2200, protein: 165, carbs: 200, fat: 70 };
const TODAY_KEY = () => new Date().toISOString().slice(0, 10);

const DEFAULT_FOODS = [
  { id: 1, name: "Chicken Breast",      servingSize: 170, calories: 280, protein: 53, carbs: 0,  fat: 6  },
  { id: 2, name: "93/7 Ground Turkey",  servingSize: 112, calories: 160, protein: 22, carbs: 0,  fat: 7  },
  { id: 3, name: "Albacore Tuna (can)", servingSize: 198, calories: 220, protein: 40, carbs: 0,  fat: 5  },
  { id: 4, name: "Egg (large)",          servingSize: 50,  calories: 70,  protein: 6,  carbs: 0,  fat: 5  },
  { id: 5, name: "Pork Tenderloin",     servingSize: 170, calories: 260, protein: 48, carbs: 0,  fat: 6  },
  { id: 6, name: "Eye of Round Steak",  servingSize: 170, calories: 240, protein: 44, carbs: 0,  fat: 7  },
  { id: 7, name: "80/20 Ground Beef",   servingSize: 112, calories: 290, protein: 19, carbs: 0,  fat: 23 },
];

// ─── localStorage helpers ─────────────────────────────────────────
const ls = {
  get: (k, fallback) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  set: (k, v)        => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

function saveDayToHistory(totals, targets) {
  const history = ls.get("mactrax_history", {});
  history[TODAY_KEY()] = { ...totals, targets, savedAt: Date.now() };
  ls.set("mactrax_history", history);
}

// ─── API helpers ──────────────────────────────────────────────────
function toBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = () => rej(new Error("Read failed"));
    r.readAsDataURL(file);
  });
}

async function callClaude(messages, systemPrompt, maxTokens = 1500) {
  const response = await fetch("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: maxTokens, system: systemPrompt, messages }),
  });
  const data = await response.json();
  const text = data.content?.find((b) => b.type === "text")?.text || "{}";
  return text.replace(/```json|```/g, "").trim();
}

async function parseNutritionLabel(b64, mediaType) {
  return JSON.parse(await callClaude(
    [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
      { type: "text", text: "Extract nutrition facts. Return ONLY JSON: {name,servingSize(grams),calories,protein,carbs,fat}. Use 0 for missing." }
    ]}],
    "You are a nutrition label parser. Return only valid JSON, no markdown."
  ));
}

async function estimateMealMacros(description) {
  return JSON.parse(await callClaude(
    [{ role: "user", content: `Estimate macros for: "${description}"` }],
    `You are a nutrition expert. Return ONLY JSON:
{"name":"short name","calories":0,"protein":0,"carbs":0,"fat":0,"confidence":"low|medium|high","note":"one brief assumption sentence"}
No markdown, no preamble.`
  ));
}

async function parseGroceryReceipt(b64, mediaType) {
  return JSON.parse(await callClaude(
    [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
      { type: "text", text: `Extract all food items from this receipt. For each item, estimate nutrition per 100g serving.
For name-brand items use known nutrition data. For generics, estimate realistically.
Return ONLY a JSON array:
[{"name":"item name","brand":"brand if visible or null","servingSize":100,"calories":0,"protein":0,"carbs":0,"fat":0,"isNameBrand":true|false}]
No markdown, no preamble.` }
    ]}],
    "You are a nutrition expert and grocery receipt parser. Return only valid JSON array, no markdown.",
    2000
  ));
}

async function parseGroceryText(text) {
  return JSON.parse(await callClaude(
    [{ role: "user", content: `Extract food items from this list and estimate nutrition per 100g:\n${text}` }],
    `You are a nutrition expert. For each food item, estimate nutrition per 100g serving. For name brands use known data.
Return ONLY a JSON array:
[{"name":"item name","brand":null,"servingSize":100,"calories":0,"protein":0,"carbs":0,"fat":0,"isNameBrand":false}]
No markdown, no preamble.`,
    2000
  ));
}

async function generateMealPlan(groceryItems, targets, days, breakfastCount, lunchCount, dinnerCount) {
  const itemList = groceryItems.map(g => `- ${g.name}${g.brand ? ` (${g.brand})` : ""}: ${g.calories} cal, ${g.protein}g protein, ${g.carbs}g carbs, ${g.fat}g fat per ${g.servingSize}g`).join("\n");
  return JSON.parse(await callClaude(
    [{ role: "user", content:
`Grocery items available this week:
${itemList}

Daily macro targets:
- Calories: ${targets.calories}
- Protein: ${targets.protein}g
- Carbs: ${targets.carbs}g
- Fat: ${targets.fat}g

Plan for: ${days} days
Unique breakfast options needed: ${breakfastCount}
Unique lunch options needed: ${lunchCount}
Unique dinner options needed: ${dinnerCount}

Pantry staples always available: olive oil, butter, garlic, onion, salt, pepper, common spices, eggs, basic condiments.`
    }],
    `You are a meal planning nutritionist and home cook. Create a practical weekly meal plan using the provided groceries.

Rules:
- Try to use ALL grocery items across the plan
- Each recipe should be simple (3-5 ingredients, 3-4 steps max)
- Calculate recommended oz portions to help hit daily macro targets per meal type
- Estimate realistic servings per recipe for leftover planning
- Breakfasts are lighter, lunches moderate, dinners the largest meal
- Portions should be practical and satisfying, not tiny

Return ONLY a JSON object:
{
  "breakfasts": [
    {
      "title": "recipe name",
      "ingredients": ["ingredient with amount"],
      "steps": ["step 1","step 2"],
      "recommendedOz": number,
      "servings": number,
      "macrosPerServing": {"calories":0,"protein":0,"carbs":0,"fat":0},
      "mainItem": "primary grocery item used"
    }
  ],
  "lunches": [...same structure...],
  "dinners": [...same structure...]
}

No markdown, no preamble. Be realistic with portions.`,
    4000
  ));
}

// ─── Shared UI Components ─────────────────────────────────────────
function Card({ children, style = {} }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 18, boxShadow: T.shadow, marginBottom: 12, ...style }}>
      {children}
    </div>
  );
}

function SectionLabel({ children, style = {} }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: T.muted, textTransform: "uppercase", marginBottom: 8, paddingLeft: 2, fontFamily: FONT_BODY, ...style }}>
      {children}
    </div>
  );
}

function Btn({ children, onClick, variant = "primary", style: s = {}, disabled }) {
  const variants = {
    primary:   { background: T.accent,       color: "#fff",   border: "none" },
    secondary: { background: T.border,       color: T.text,   border: "none" },
    ghost:     { background: "transparent",  color: T.muted,  border: `1px solid ${T.border}` },
    danger:    { background: T.redBg,        color: T.red,    border: `1px solid ${T.red}33` },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{
      ...variants[variant], borderRadius: 10, fontFamily: FONT_BODY,
      fontSize: 15, fontWeight: 700, padding: "13px 18px", minHeight: 44,
      cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1,
      transition: "opacity 0.15s", ...s,
    }}>{children}</button>
  );
}

function MacroChip({ label, value, color, bg }) {
  return (
    <div style={{ background: bg, borderRadius: 8, padding: "10px 0", textAlign: "center", flex: 1 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color, textTransform: "uppercase", marginBottom: 3, fontFamily: FONT_BODY }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color, letterSpacing: "-0.02em", fontFamily: FONT_BODY }}>
        {Math.round(value)}{label !== "Cal" ? "g" : ""}
      </div>
    </div>
  );
}

function MacroBar({ label, current, target, accent, accentBg }) {
  const pct  = Math.min((current / target) * 100, 100);
  const over = current > target;
  const rem  = Math.round(Math.abs(target - current));
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", color: T.muted, textTransform: "uppercase", fontFamily: FONT_BODY }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: over ? T.red : T.accentTxt, background: over ? T.redBg : accentBg, padding: "2px 8px", borderRadius: 99, fontFamily: FONT_BODY }}>
          {over ? `+${rem} over` : `${rem} left`}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.03em", color: over ? T.red : T.text, lineHeight: 1, fontFamily: FONT_BODY }}>{Math.round(current)}</span>
        <span style={{ fontSize: 13, color: T.faint, fontFamily: FONT_BODY }}>/ {target}{label === "Calories" ? "" : "g"}</span>
      </div>
      <div style={{ height: 7, background: T.border, borderRadius: 99, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: over ? T.red : accent, borderRadius: 99, transition: "width 0.5s cubic-bezier(0.4,0,0.2,1)" }} />
      </div>
    </div>
  );
}

function UploadZone({ onFile, loading, label = "Drop an image" }) {
  const inputRef = useRef();
  const [drag, setDrag] = useState(false);
  const handle = (file) => { if (file?.type.startsWith("image/")) onFile(file); };
  return (
    <div
      onClick={() => inputRef.current.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files[0]); }}
      style={{ border: `2px dashed ${drag ? T.accent : T.border}`, borderRadius: 12, padding: "24px 20px", textAlign: "center", cursor: "pointer", background: drag ? T.accentBg : T.bg, transition: "all 0.2s" }}
    >
      <input ref={inputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handle(e.target.files[0])} />
      {loading
        ? <div style={{ color: T.accent, fontSize: 15, fontWeight: 600, fontFamily: FONT_BODY }}>Scanning…</div>
        : <>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📷</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 3, fontFamily: FONT_BODY }}>{label}</div>
            <div style={{ fontSize: 12, color: T.muted, fontFamily: FONT_BODY }}>or tap to browse</div>
          </>
      }
    </div>
  );
}

const inputStyle = { width: "100%", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, padding: "13px 14px", color: T.text, fontFamily: FONT_BODY, outline: "none", appearance: "none", minHeight: 44 };

// ─── Recipe Card ──────────────────────────────────────────────────
function RecipeCard({ recipe, onLog, type }) {
  const [expanded, setExpanded] = useState(false);
  const [oz, setOz] = useState(recipe.recommendedOz || 6);

  const typeColors = {
    breakfast: { color: T.yellow,    bg: T.yellowBg,  label: "Breakfast" },
    lunch:     { color: T.teal,      bg: T.tealBg,    label: "Lunch"     },
    dinner:    { color: T.accentTxt, bg: T.accentBg,  label: "Dinner"    },
  };
  const tc = typeColors[type];

  const adjustOz = (delta) => setOz(prev => Math.max(0.25, Math.round((prev + delta) * 4) / 4));

  return (
    <Card style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ flex: 1, paddingRight: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: tc.color, background: tc.bg, padding: "2px 7px", borderRadius: 4, fontFamily: FONT_BODY }}>{tc.label}</span>
            <span style={{ fontSize: 10, color: T.muted, fontFamily: FONT_BODY }}>{recipe.servings} servings</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, fontFamily: FONT_BODY, color: T.text }}>{recipe.title}</div>
        </div>
        <button onClick={() => setExpanded(e => !e)} style={{ background: T.border, border: "none", borderRadius: 8, width: 32, height: 32, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {expanded ? "▲" : "▼"}
        </button>
      </div>

      {/* Macro chips */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <MacroChip label="Cal"  value={recipe.macrosPerServing?.calories || 0} color={T.yellow}    bg={T.yellowBg} />
        <MacroChip label="Pro"  value={recipe.macrosPerServing?.protein  || 0} color={T.accentTxt} bg={T.accentBg} />
        <MacroChip label="Carb" value={recipe.macrosPerServing?.carbs    || 0} color={T.teal}      bg={T.tealBg} />
        <MacroChip label="Fat"  value={recipe.macrosPerServing?.fat      || 0} color={T.red}       bg={T.redBg} />
      </div>

      {/* Expanded recipe details */}
      {expanded && (
        <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 12, marginBottom: 12 }}>
          <SectionLabel>Ingredients</SectionLabel>
          {recipe.ingredients?.map((ing, i) => (
            <div key={i} style={{ fontSize: 13, color: T.text, fontFamily: FONT_BODY, paddingLeft: 10, marginBottom: 4, lineHeight: 1.4 }}>· {ing}</div>
          ))}
          <SectionLabel style={{ marginTop: 12 }}>Steps</SectionLabel>
          {recipe.steps?.map((step, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <span style={{ fontFamily: FONT_DISPLAY, fontSize: 16, color: T.accent, minWidth: 20 }}>{i + 1}</span>
              <span style={{ fontSize: 13, color: T.text, fontFamily: FONT_BODY, lineHeight: 1.5 }}>{step}</span>
            </div>
          ))}
        </div>
      )}

      {/* Log this meal */}
      <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: T.muted, textTransform: "uppercase", marginBottom: 8, fontFamily: FONT_BODY }}>Log this meal</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <button onClick={() => adjustOz(-0.25)} style={{ background: T.border, border: "none", borderRadius: 8, width: 36, height: 36, cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
          <div style={{ flex: 1, textAlign: "center" }}>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 24, color: T.text, letterSpacing: "0.02em" }}>{oz}</span>
            <span style={{ fontSize: 13, color: T.muted, fontFamily: FONT_BODY, marginLeft: 4 }}>oz</span>
          </div>
          <button onClick={() => adjustOz(0.25)} style={{ background: T.border, border: "none", borderRadius: 8, width: 36, height: 36, cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
        </div>
        <Btn onClick={() => onLog(recipe, oz, type)} style={{ width: "100%" }}>Log Meal</Btn>
      </div>
    </Card>
  );
}

// ─── Groceries Tab ────────────────────────────────────────────────
function GroceriesTab({ mealPlan, setMealPlan, targets }) {
  const [groceries,      setGroceries]      = useState(() => ls.get("mactrax_groceries", []));
  const [step,           setStep]           = useState(() => ls.get("mactrax_groceries", []).length > 0 ? (ls.get("mactrax_mealplan", null) ? "plan" : "prefs") : "input");
  const [scanLoading,    setScanLoading]    = useState(false);
  const [manualText,     setManualText]     = useState("");
  const [manualLoading,  setManualLoading]  = useState(false);
  const [pendingItems,   setPendingItems]   = useState([]);
  const [scanError,      setScanError]      = useState("");
  const [days,           setDays]           = useState(7);
  const [bfastCount,     setBfastCount]     = useState(1);
  const [lunchCount,     setLunchCount]     = useState(2);
  const [dinnerCount,    setDinnerCount]    = useState(3);
  const [generating,     setGenerating]     = useState(false);
  const [genError,       setGenError]       = useState("");

  const handleReceiptScan = async (file) => {
    setScanLoading(true); setScanError("");
    try {
      const b64 = await toBase64(file);
      const items = await parseGroceryReceipt(b64, file.type);
      setPendingItems(items.map((item, i) => ({ ...item, id: Date.now() + i, confirmed: false })));
    } catch { setScanError("Couldn't read that receipt — try a clearer photo."); }
    setScanLoading(false);
  };

  const handleManualParse = async () => {
    if (!manualText.trim()) return;
    setManualLoading(true); setScanError("");
    try {
      const items = await parseGroceryText(manualText);
      setPendingItems(items.map((item, i) => ({ ...item, id: Date.now() + i, confirmed: false })));
    } catch { setScanError("Couldn't parse that list — try again."); }
    setManualLoading(false);
  };

  const confirmItems = () => {
    const confirmed = pendingItems.map(i => ({ ...i, confirmed: true }));
    const updated   = [...groceries, ...confirmed];
    setGroceries(updated);
    ls.set("mactrax_groceries", updated);
    setPendingItems([]);
    setManualText("");
    setStep("prefs");
  };

  const removeGroceryItem = (id) => {
    const updated = groceries.filter(g => g.id !== id);
    setGroceries(updated);
    ls.set("mactrax_groceries", updated);
  };

  const handleGenerate = async () => {
    setGenerating(true); setGenError("");
    try {
      const plan = await generateMealPlan(groceries, targets, days, bfastCount, lunchCount, dinnerCount);
      setMealPlan(plan);
      ls.set("mactrax_mealplan", plan);
      setStep("plan");
    } catch { setGenError("Couldn't generate a plan — try again."); }
    setGenerating(false);
  };

  const handleReset = () => {
    setGroceries([]); setMealPlan(null); setPendingItems([]);
    ls.set("mactrax_groceries", []); ls.set("mactrax_mealplan", null);
    setStep("input");
  };

  const StepCounter = ({ label, value, onChange, min = 1, max = 7 }) => (
    <div style={{ marginBottom: 16 }}>
      <SectionLabel>{label}</SectionLabel>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <button onClick={() => onChange(Math.max(min, value - 1))} style={{ background: T.border, border: "none", borderRadius: 8, width: 40, height: 40, cursor: "pointer", fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
        <span style={{ fontFamily: FONT_DISPLAY, fontSize: 28, color: T.text, minWidth: 32, textAlign: "center" }}>{value}</span>
        <button onClick={() => onChange(Math.min(max, value + 1))} style={{ background: T.border, border: "none", borderRadius: 8, width: 40, height: 40, cursor: "pointer", fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
      </div>
    </div>
  );

  return (
    <div>
      {/* ── STEP: Input ── */}
      {step === "input" && <>
        <Card>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4, fontFamily: FONT_BODY }}>Scan a receipt</div>
          <div style={{ fontSize: 13, color: T.muted, marginBottom: 14, lineHeight: 1.5, fontFamily: FONT_BODY }}>Photo of your grocery receipt and MACTRAX will extract the items automatically.</div>
          <UploadZone onFile={handleReceiptScan} loading={scanLoading} label="Drop your receipt image" />
          {scanError && <div style={{ color: T.red, fontSize: 13, marginTop: 8, fontFamily: FONT_BODY }}>{scanError}</div>}
        </Card>

        <Card>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4, fontFamily: FONT_BODY }}>Type your list</div>
          <div style={{ fontSize: 13, color: T.muted, marginBottom: 14, lineHeight: 1.5, fontFamily: FONT_BODY }}>List what you bought, one item per line or comma separated.</div>
          <textarea
            value={manualText} onChange={(e) => setManualText(e.target.value)}
            placeholder={"e.g.\nChicken breast\nGround beef 80/20\nBrown rice\nBroccoli\nGreek yogurt"}
            rows={5} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }}
          />
          <Btn onClick={handleManualParse} disabled={manualLoading || !manualText.trim()} style={{ width: "100%", marginTop: 10 }}>
            {manualLoading ? "Parsing…" : "Parse List"}
          </Btn>
        </Card>

        {/* Pending items to confirm */}
        {pendingItems.length > 0 && (
          <Card>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4, fontFamily: FONT_BODY }}>Confirm items</div>
            <div style={{ fontSize: 13, color: T.muted, marginBottom: 14, fontFamily: FONT_BODY }}>Review before adding to your grocery list.</div>
            {pendingItems.map((item, i) => (
              <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: i < pendingItems.length - 1 ? `1px solid ${T.border}` : "none" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, fontFamily: FONT_BODY }}>{item.name}{item.brand ? ` · ${item.brand}` : ""}</div>
                  <div style={{ fontSize: 12, color: T.muted, fontFamily: FONT_BODY }}>
                    {item.calories} cal · {item.protein}g P · {item.carbs}g C · {item.fat}g F per {item.servingSize}g
                    {item.isNameBrand && <span style={{ marginLeft: 6, background: T.accentBg, color: T.accentTxt, padding: "1px 5px", borderRadius: 4, fontSize: 10, fontWeight: 700 }}>NAME BRAND</span>}
                  </div>
                </div>
                <button onClick={() => setPendingItems(p => p.filter(x => x.id !== item.id))}
                  style={{ background: T.redBg, border: "none", color: T.red, width: 30, height: 30, borderRadius: 6, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>×</button>
              </div>
            ))}
            <Btn onClick={confirmItems} style={{ width: "100%", marginTop: 14 }}>Add {pendingItems.length} Items to List</Btn>
          </Card>
        )}

        {/* Current grocery list */}
        {groceries.length > 0 && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, paddingLeft: 2 }}>
              <SectionLabel style={{ marginBottom: 0 }}>This Week's Groceries ({groceries.length})</SectionLabel>
              <Btn variant="ghost" onClick={() => setStep("prefs")} style={{ padding: "6px 12px", fontSize: 12, minHeight: 32 }}>Plan Meals →</Btn>
            </div>
            {groceries.map((g) => (
              <Card key={g.id} style={{ padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, fontFamily: FONT_BODY }}>{g.name}</div>
                    <div style={{ fontSize: 12, color: T.muted, fontFamily: FONT_BODY }}>{g.calories} cal · {g.protein}g P · {g.carbs}g C · {g.fat}g F per {g.servingSize}g</div>
                  </div>
                  <button onClick={() => removeGroceryItem(g.id)}
                    style={{ background: T.redBg, border: "none", color: T.red, width: 30, height: 30, borderRadius: 6, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>×</button>
                </div>
              </Card>
            ))}
          </>
        )}
      </>}

      {/* ── STEP: Preferences ── */}
      {step === "prefs" && <>
        <Card>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, letterSpacing: "0.04em", marginBottom: 4 }}>Plan Your Week</div>
          <div style={{ fontSize: 13, color: T.muted, marginBottom: 20, lineHeight: 1.5, fontFamily: FONT_BODY }}>Tell MACTRAX how many days and meal options you want, and it'll build your plan.</div>

          <StepCounter label="Days to plan for" value={days} onChange={setDays} min={1} max={7} />
          <StepCounter label="Breakfast options" value={bfastCount} onChange={setBfastCount} min={1} max={5} />
          <StepCounter label="Lunch options" value={lunchCount} onChange={setLunchCount} min={1} max={5} />
          <StepCounter label="Dinner options" value={dinnerCount} onChange={setDinnerCount} min={1} max={5} />

          {genError && <div style={{ color: T.red, fontSize: 13, marginBottom: 10, fontFamily: FONT_BODY }}>{genError}</div>}

          <Btn onClick={handleGenerate} disabled={generating} style={{ width: "100%", marginTop: 8 }}>
            {generating ? "Building your meal plan…" : "Generate Meal Plan"}
          </Btn>
          <Btn variant="ghost" onClick={() => setStep("input")} style={{ width: "100%", marginTop: 8 }}>
            ← Back to Groceries
          </Btn>
        </Card>

        <SectionLabel>Your {groceries.length} items</SectionLabel>
        {groceries.map((g) => (
          <Card key={g.id} style={{ padding: "10px 14px" }}>
            <div style={{ fontSize: 13, fontWeight: 600, fontFamily: FONT_BODY }}>{g.name}</div>
            <div style={{ fontSize: 11, color: T.muted, fontFamily: FONT_BODY }}>{g.calories} cal · {g.protein}g P per {g.servingSize}g</div>
          </Card>
        ))}
      </>}

      {/* ── STEP: Plan view ── */}
      {step === "plan" && mealPlan && <>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 24, letterSpacing: "0.04em", color: T.text }}>Your Meal Plan</div>
          <Btn variant="ghost" onClick={() => setStep("prefs")} style={{ padding: "6px 12px", fontSize: 12, minHeight: 32 }}>← Edit</Btn>
        </div>

        {mealPlan.breakfasts?.length > 0 && <>
          <SectionLabel>Breakfasts</SectionLabel>
          {mealPlan.breakfasts.map((r, i) => (
            <Card key={i} style={{ padding: "14px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: T.yellow, background: T.yellowBg, padding: "2px 7px", borderRadius: 4, fontFamily: FONT_BODY }}>Breakfast</span>
                <span style={{ fontSize: 10, color: T.muted, fontFamily: FONT_BODY }}>{r.servings} servings</span>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, fontFamily: FONT_BODY, marginBottom: 10 }}>{r.title}</div>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <MacroChip label="Cal"  value={r.macrosPerServing?.calories || 0} color={T.yellow}    bg={T.yellowBg} />
                <MacroChip label="Pro"  value={r.macrosPerServing?.protein  || 0} color={T.accentTxt} bg={T.accentBg} />
                <MacroChip label="Carb" value={r.macrosPerServing?.carbs    || 0} color={T.teal}      bg={T.tealBg} />
                <MacroChip label="Fat"  value={r.macrosPerServing?.fat      || 0} color={T.red}       bg={T.redBg} />
              </div>
              <SectionLabel>Ingredients</SectionLabel>
              {r.ingredients?.map((ing, j) => <div key={j} style={{ fontSize: 13, color: T.text, fontFamily: FONT_BODY, paddingLeft: 10, marginBottom: 3 }}>· {ing}</div>)}
              <SectionLabel style={{ marginTop: 10 }}>Steps</SectionLabel>
              {r.steps?.map((step, j) => (
                <div key={j} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontFamily: FONT_DISPLAY, fontSize: 16, color: T.accent, minWidth: 20 }}>{j + 1}</span>
                  <span style={{ fontSize: 13, color: T.text, fontFamily: FONT_BODY, lineHeight: 1.5 }}>{step}</span>
                </div>
              ))}
            </Card>
          ))}
        </>}

        {mealPlan.lunches?.length > 0 && <>
          <SectionLabel>Lunches</SectionLabel>
          {mealPlan.lunches.map((r, i) => (
            <Card key={i} style={{ padding: "14px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: T.teal, background: T.tealBg, padding: "2px 7px", borderRadius: 4, fontFamily: FONT_BODY }}>Lunch</span>
                <span style={{ fontSize: 10, color: T.muted, fontFamily: FONT_BODY }}>{r.servings} servings</span>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, fontFamily: FONT_BODY, marginBottom: 10 }}>{r.title}</div>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <MacroChip label="Cal"  value={r.macrosPerServing?.calories || 0} color={T.yellow}    bg={T.yellowBg} />
                <MacroChip label="Pro"  value={r.macrosPerServing?.protein  || 0} color={T.accentTxt} bg={T.accentBg} />
                <MacroChip label="Carb" value={r.macrosPerServing?.carbs    || 0} color={T.teal}      bg={T.tealBg} />
                <MacroChip label="Fat"  value={r.macrosPerServing?.fat      || 0} color={T.red}       bg={T.redBg} />
              </div>
              <SectionLabel>Ingredients</SectionLabel>
              {r.ingredients?.map((ing, j) => <div key={j} style={{ fontSize: 13, color: T.text, fontFamily: FONT_BODY, paddingLeft: 10, marginBottom: 3 }}>· {ing}</div>)}
              <SectionLabel style={{ marginTop: 10 }}>Steps</SectionLabel>
              {r.steps?.map((step, j) => (
                <div key={j} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontFamily: FONT_DISPLAY, fontSize: 16, color: T.accent, minWidth: 20 }}>{j + 1}</span>
                  <span style={{ fontSize: 13, color: T.text, fontFamily: FONT_BODY, lineHeight: 1.5 }}>{step}</span>
                </div>
              ))}
            </Card>
          ))}
        </>}

        {mealPlan.dinners?.length > 0 && <>
          <SectionLabel>Dinners</SectionLabel>
          {mealPlan.dinners.map((r, i) => (
            <Card key={i} style={{ padding: "14px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: T.accentTxt, background: T.accentBg, padding: "2px 7px", borderRadius: 4, fontFamily: FONT_BODY }}>Dinner</span>
                <span style={{ fontSize: 10, color: T.muted, fontFamily: FONT_BODY }}>{r.servings} servings</span>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, fontFamily: FONT_BODY, marginBottom: 10 }}>{r.title}</div>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <MacroChip label="Cal"  value={r.macrosPerServing?.calories || 0} color={T.yellow}    bg={T.yellowBg} />
                <MacroChip label="Pro"  value={r.macrosPerServing?.protein  || 0} color={T.accentTxt} bg={T.accentBg} />
                <MacroChip label="Carb" value={r.macrosPerServing?.carbs    || 0} color={T.teal}      bg={T.tealBg} />
                <MacroChip label="Fat"  value={r.macrosPerServing?.fat      || 0} color={T.red}       bg={T.redBg} />
              </div>
              <SectionLabel>Ingredients</SectionLabel>
              {r.ingredients?.map((ing, j) => <div key={j} style={{ fontSize: 13, color: T.text, fontFamily: FONT_BODY, paddingLeft: 10, marginBottom: 3 }}>· {ing}</div>)}
              <SectionLabel style={{ marginTop: 10 }}>Steps</SectionLabel>
              {r.steps?.map((step, j) => (
                <div key={j} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontFamily: FONT_DISPLAY, fontSize: 16, color: T.accent, minWidth: 20 }}>{j + 1}</span>
                  <span style={{ fontSize: 13, color: T.text, fontFamily: FONT_BODY, lineHeight: 1.5 }}>{step}</span>
                </div>
              ))}
            </Card>
          ))}
        </>}

        <Btn variant="danger" onClick={handleReset} style={{ width: "100%", marginTop: 8 }}>
          Clear Groceries & Reset Plan
        </Btn>
      </>}

      {/* Reset button always visible at bottom if data exists */}
      {step !== "plan" && groceries.length > 0 && (
        <Btn variant="danger" onClick={handleReset} style={{ width: "100%", marginTop: 8 }}>
          Clear Groceries & Reset Plan
        </Btn>
      )}
    </div>
  );
}

// ─── Calendar ─────────────────────────────────────────────────────
function CalendarView({ targets }) {
  const [history,     setHistory]     = useState({});
  const [selectedDay, setSelectedDay] = useState(null);
  const [viewMonth,   setViewMonth]   = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });

  useEffect(() => { setHistory(ls.get("mactrax_history", {})); }, []);

  const { year, month } = viewMonth;
  const monthNames  = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const dayNames    = ["Su","Mo","Tu","We","Th","Fr","Sa"];
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr    = TODAY_KEY();

  const prevMonth = () => setViewMonth(({ year: y, month: m }) => m === 0 ? { year: y-1, month: 11 } : { year: y, month: m-1 });
  const nextMonth = () => setViewMonth(({ year: y, month: m }) => m === 11 ? { year: y+1, month: 0 } : { year: y, month: m+1 });
  const getDayKey = (d) => `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;

  const getDayScore = (data) => {
    if (!data) return null;
    const tgt        = data.targets || targets;
    const proteinPct = data.protein / tgt.protein;
    const calPct     = data.calories / tgt.calories;
    if (calPct > 1.1)      return "over";
    if (proteinPct >= 0.8) return "good";
    if (proteinPct >= 0.5) return "partial";
    return "low";
  };

  const scoreColors = {
    good:    { dot: T.accent, bg: T.accentBg },
    partial: { dot: T.yellow, bg: T.yellowBg },
    over:    { dot: T.red,    bg: T.redBg },
    low:     { dot: T.faint,  bg: T.bg },
  };

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const selected = selectedDay ? history[getDayKey(selectedDay)] : null;

  return (
    <div>
      <Card style={{ padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <button onClick={prevMonth} style={{ background: T.border, border: "none", borderRadius: 10, width: 40, height: 40, cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>
          <span style={{ fontFamily: FONT_DISPLAY, fontSize: 22, letterSpacing: "0.04em", color: T.text }}>{monthNames[month]} {year}</span>
          <button onClick={nextMonth} style={{ background: T.border, border: "none", borderRadius: 10, width: 40, height: 40, cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>›</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3, marginBottom: 3 }}>
          {dayNames.map(d => <div key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: T.faint, letterSpacing: "0.04em", fontFamily: FONT_BODY, padding: "4px 0" }}>{d}</div>)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
          {cells.map((d, i) => {
            if (!d) return <div key={`e-${i}`} />;
            const key    = getDayKey(d);
            const data   = history[key];
            const score  = getDayScore(data);
            const colors = score ? scoreColors[score] : null;
            const isToday = key === todayStr;
            const isSel   = selectedDay === d;
            return (
              <button key={key} onClick={() => setSelectedDay(isSel ? null : d)}
                style={{ background: isSel ? T.accent : colors ? colors.bg : "transparent", border: isToday ? `2px solid ${T.accent}` : "2px solid transparent", borderRadius: 10, minHeight: 44, cursor: data ? "pointer" : "default", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, transition: "all 0.15s", padding: 0 }}>
                <span style={{ fontSize: 14, fontWeight: isToday ? 700 : 500, color: isSel ? "#fff" : T.text, fontFamily: FONT_BODY }}>{d}</span>
                {score && <div style={{ width: 5, height: 5, borderRadius: "50%", background: isSel ? "rgba(255,255,255,0.8)" : colors.dot }} />}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", marginTop: 16, justifyContent: "center" }}>
          {[["good","Hit protein"],["partial","Partial"],["over","Over calories"],["low","Low intake"]].map(([score, label]) => (
            <div key={score} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: scoreColors[score].dot }} />
              <span style={{ fontSize: 11, color: T.muted, fontFamily: FONT_BODY }}>{label}</span>
            </div>
          ))}
        </div>
      </Card>

      {selectedDay && (
        <Card>
          {selected ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
                <span style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: T.text, letterSpacing: "0.04em" }}>{monthNames[month]} {selectedDay}</span>
                <span style={{ fontSize: 12, color: T.muted, fontFamily: FONT_BODY }}>{year}</span>
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
                <MacroChip label="Cal"  value={selected.calories} color={T.yellow}    bg={T.yellowBg} />
                <MacroChip label="Pro"  value={selected.protein}  color={T.accentTxt} bg={T.accentBg} />
                <MacroChip label="Carb" value={selected.carbs}    color={T.teal}      bg={T.tealBg} />
                <MacroChip label="Fat"  value={selected.fat}      color={T.red}       bg={T.redBg} />
              </div>
              {[
                { label: "Calories", val: selected.calories, tgt: (selected.targets||targets).calories, accent: T.yellow },
                { label: "Protein",  val: selected.protein,  tgt: (selected.targets||targets).protein,  accent: T.accent },
                { label: "Carbs",    val: selected.carbs,    tgt: (selected.targets||targets).carbs,    accent: T.teal },
                { label: "Fat",      val: selected.fat,      tgt: (selected.targets||targets).fat,      accent: T.red },
              ].map(({ label, val, tgt, accent }) => {
                const pct  = Math.min((val/tgt)*100, 100);
                const over = val > tgt;
                return (
                  <div key={label} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ fontSize: 13, color: T.muted, fontFamily: FONT_BODY }}>{label}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: over ? T.red : T.text, fontFamily: FONT_BODY }}>{Math.round(val)} / {tgt}{label==="Calories"?"":"g"}</span>
                    </div>
                    <div style={{ height: 6, background: T.border, borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: over ? T.red : accent, borderRadius: 99 }} />
                    </div>
                  </div>
                );
              })}
            </>
          ) : (
            <div style={{ textAlign: "center", color: T.faint, fontSize: 14, padding: "20px 0", fontFamily: FONT_BODY }}>No data for {monthNames[month]} {selectedDay}</div>
          )}
        </Card>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────
export default function MacroTracker() {
  const [targets,         setTargets]         = useState(() => ls.get("mactrax_targets",  DAILY_TARGETS));
  const [foods,           setFoods]           = useState(() => ls.get("mactrax_catalog",  DEFAULT_FOODS));
  const [log,             setLog]             = useState(() => ls.get("mactrax_log_" + TODAY_KEY(), []));
  const [mealPlan,        setMealPlan]        = useState(() => ls.get("mactrax_mealplan", null));
  const [view,            setView]            = useState("dashboard");
  const [editTargets,     setEditTargets]     = useState(false);
  const [tempTargets,     setTempTargets]     = useState(targets);
  const [logForm,         setLogForm]         = useState({ foodId: "", oz: "" });
  const [scanning,        setScanning]        = useState(false);
  const [scanError,       setScanError]       = useState("");
  const [pendingFood,     setPendingFood]     = useState(null);
  const [mealDesc,        setMealDesc]        = useState("");
  const [estimating,      setEstimating]      = useState(false);
  const [estimateError,   setEstimateError]   = useState("");
  const [pendingEstimate, setPendingEstimate] = useState(null);

  const totals = log.reduce((acc, entry) => {
    if (entry.type === "estimate" || entry.type === "recipe") {
      return { calories: acc.calories+entry.calories, protein: acc.protein+entry.protein, carbs: acc.carbs+entry.carbs, fat: acc.fat+entry.fat };
    }
    const food = foods.find((f) => f.id === entry.foodId);
    if (!food) return acc;
    const ratio = (entry.oz * 28.3495) / food.servingSize;
    return { calories: acc.calories+food.calories*ratio, protein: acc.protein+food.protein*ratio, carbs: acc.carbs+food.carbs*ratio, fat: acc.fat+food.fat*ratio };
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

  useEffect(() => { ls.set("mactrax_targets",  targets); },               [targets]);
  useEffect(() => { ls.set("mactrax_catalog",  foods); },                 [foods]);
  useEffect(() => { ls.set("mactrax_log_" + TODAY_KEY(), log); if (log.length > 0) saveDayToHistory(totals, targets); }, [log]);

  const handleScan = async (file) => {
    setScanning(true); setScanError("");
    try { setPendingFood({ ...(await parseNutritionLabel(await toBase64(file), file.type)), id: Date.now() }); }
    catch { setScanError("Couldn't read that label — try a clearer photo."); }
    setScanning(false);
  };

  const handleEstimate = async () => {
    if (!mealDesc.trim()) return;
    setEstimating(true); setEstimateError(""); setPendingEstimate(null);
    try { setPendingEstimate(await estimateMealMacros(mealDesc)); }
    catch { setEstimateError("Couldn't estimate — try describing it differently."); }
    setEstimating(false);
  };

  const confirmEstimate = () => {
    setLog(l => [...l, { id: Date.now(), type: "estimate", ...pendingEstimate, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }]);
    setPendingEstimate(null); setMealDesc("");
  };

  const addLog = () => {
    if (!logForm.foodId || !logForm.oz || isNaN(parseFloat(logForm.oz))) return;
    setLog(l => [...l, { id: Date.now(), type: "weighed", foodId: parseInt(logForm.foodId), oz: parseFloat(logForm.oz), time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }]);
    setLogForm({ foodId: "", oz: "" });
  };

  const logRecipe = (recipe, oz, type) => {
    const gramsPerOz = 28.3495;
    const grams      = oz * gramsPerOz;
    const ratio      = recipe.macrosPerServing ? 1 : grams / 170;
    setLog(l => [...l, {
      id: Date.now(), type: "recipe",
      name: recipe.title, oz,
      calories: recipe.macrosPerServing?.calories || 0,
      protein:  recipe.macrosPerServing?.protein  || 0,
      carbs:    recipe.macrosPerServing?.carbs     || 0,
      fat:      recipe.macrosPerServing?.fat       || 0,
      mealType: type,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }]);
  };

  const navTabs = [
    { id: "dashboard", label: "Today"     },
    { id: "log",       label: "Log"       },
    { id: "groceries", label: "Groceries" },
    { id: "history",   label: "History"   },
  ];

  const mealTypeColors = { breakfast: T.yellow, lunch: T.teal, dinner: T.accentTxt, estimate: T.yellow, weighed: T.muted, recipe: T.accent };

  return (
    <div style={{ minHeight: "100dvh", background: T.bg, color: T.text, fontFamily: FONT_BODY, width: "100%", paddingBottom: "env(safe-area-inset-bottom, 16px)" }}>

      {/* Header */}
      <div style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, padding: "14px 20px 0", position: "sticky", top: 0, zIndex: 50, boxShadow: T.shadow, paddingTop: "max(14px, env(safe-area-inset-top))" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, maxWidth: 480, margin: "0 auto 12px" }}>
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 32, letterSpacing: "0.06em", color: T.text, lineHeight: 1 }}>MAC</span>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 32, letterSpacing: "0.06em", color: T.accent, lineHeight: 1 }}>TRAX</span>
          </div>
          <button onClick={() => { setEditTargets(true); setTempTargets(targets); }}
            style={{ background: T.border, border: "none", color: T.text, fontSize: 13, fontWeight: 600, padding: "9px 16px", borderRadius: 10, cursor: "pointer", fontFamily: FONT_BODY, minHeight: 44 }}>
            Targets
          </button>
        </div>
        <div style={{ display: "flex", marginBottom: -1, maxWidth: 480, margin: "0 auto" }}>
          {navTabs.map(({ id, label }) => (
            <button key={id} onClick={() => setView(id)} style={{
              flex: 1, background: "transparent", border: "none",
              borderBottom: `2px solid ${view === id ? T.accent : "transparent"}`,
              color: view === id ? T.accent : T.muted,
              fontFamily: FONT_BODY, fontSize: 13, fontWeight: view === id ? 700 : 500,
              padding: "10px 0 12px", cursor: "pointer", transition: "all 0.15s", minHeight: 44,
            }}>{label}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: "16px 14px", maxWidth: 480, margin: "0 auto" }}>

        {/* Targets modal — bottom sheet */}
        {editTargets && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
            <div style={{ background: T.surface, borderRadius: "20px 20px 0 0", padding: "24px 20px 32px", width: "100%", maxWidth: 480, boxShadow: T.shadowMd }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 24, letterSpacing: "0.04em", marginBottom: 20 }}>Daily Targets</div>
              {["calories","protein","carbs","fat"].map((k) => (
                <div key={k} style={{ marginBottom: 16 }}>
                  <SectionLabel>{k}</SectionLabel>
                  <input type="number" value={tempTargets[k]} onChange={(e) => setTempTargets(t => ({ ...t, [k]: parseFloat(e.target.value) || 0 }))} style={inputStyle} />
                </div>
              ))}
              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <Btn onClick={() => { setTargets(tempTargets); setEditTargets(false); }} style={{ flex: 1 }}>Save</Btn>
                <Btn variant="ghost" onClick={() => setEditTargets(false)} style={{ flex: 1 }}>Cancel</Btn>
              </div>
            </div>
          </div>
        )}

        {/* ── TODAY ── */}
        {view === "dashboard" && <>
          <Card>
            <MacroBar label="Calories" current={totals.calories} target={targets.calories} accent={T.yellow}  accentBg={T.yellowBg} />
            <MacroBar label="Protein"  current={totals.protein}  target={targets.protein}  accent={T.accent}  accentBg={T.accentBg} />
            <MacroBar label="Carbs"    current={totals.carbs}    target={targets.carbs}    accent={T.teal}    accentBg={T.tealBg} />
            <MacroBar label="Fat"      current={totals.fat}      target={targets.fat}      accent={T.red}     accentBg={T.redBg} />
          </Card>

          {log.length === 0
            ? <div style={{ textAlign: "center", color: T.faint, fontSize: 14, padding: "32px 0", fontFamily: FONT_BODY }}>No meals logged today</div>
            : <>
                <SectionLabel>Today's Meals</SectionLabel>
                {log.map((entry) => {
                  let cal, pro, carb, fat, name;
                  if (entry.type === "estimate" || entry.type === "recipe") {
                    ({ calories: cal, protein: pro, carbs: carb, fat, name } = entry);
                  } else {
                    const food = foods.find(f => f.id === entry.foodId);
                    if (!food) return null;
                    const r = (entry.oz * 28.3495) / food.servingSize;
                    [cal, pro, carb, fat, name] = [food.calories*r, food.protein*r, food.carbs*r, food.fat*r, food.name];
                  }
                  return (
                    <Card key={entry.id} style={{ padding: "14px 16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                        <div style={{ flex: 1, paddingRight: 12 }}>
                          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 5, fontFamily: FONT_BODY }}>{name}</div>
                          <div style={{ fontSize: 12, color: T.muted, fontFamily: FONT_BODY }}>
                            {entry.type === "estimate" && <span style={{ background: T.yellowBg, color: T.yellow, padding: "2px 7px", borderRadius: 4, fontWeight: 600 }}>AI estimate · {entry.confidence}</span>}
                            {entry.type === "recipe"   && <span style={{ background: T.accentBg, color: T.accentTxt, padding: "2px 7px", borderRadius: 4, fontWeight: 600, textTransform: "capitalize" }}>{entry.mealType} · {entry.oz} oz</span>}
                            {entry.type === "weighed"  && `${entry.oz} oz`}
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 11, color: T.faint, fontFamily: FONT_BODY }}>{entry.time}</span>
                          <button onClick={() => setLog(l => l.filter(e => e.id !== entry.id))}
                            style={{ background: T.redBg, border: "none", color: T.red, width: 32, height: 32, borderRadius: 8, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <MacroChip label="Cal"  value={cal}  color={T.yellow}    bg={T.yellowBg} />
                        <MacroChip label="Pro"  value={pro}  color={T.accentTxt} bg={T.accentBg} />
                        <MacroChip label="Carb" value={carb} color={T.teal}      bg={T.tealBg} />
                        <MacroChip label="Fat"  value={fat}  color={T.red}       bg={T.redBg} />
                      </div>
                      {entry.note && <div style={{ fontSize: 12, color: T.muted, marginTop: 8, fontStyle: "italic", fontFamily: FONT_BODY }}>{entry.note}</div>}
                    </Card>
                  );
                })}
              </>
          }
        </>}

        {/* ── LOG (combined) ── */}
        {view === "log" && <>

          {/* This week's meal plan */}
          {mealPlan ? (
            <>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, letterSpacing: "0.04em", color: T.text, marginBottom: 12 }}>This Week's Meals</div>
              {mealPlan.breakfasts?.length > 0 && <>
                <SectionLabel>Breakfasts</SectionLabel>
                {mealPlan.breakfasts.map((r, i) => <RecipeCard key={`b-${i}`} recipe={r} type="breakfast" onLog={logRecipe} />)}
              </>}
              {mealPlan.lunches?.length > 0 && <>
                <SectionLabel>Lunches</SectionLabel>
                {mealPlan.lunches.map((r, i) => <RecipeCard key={`l-${i}`} recipe={r} type="lunch" onLog={logRecipe} />)}
              </>}
              {mealPlan.dinners?.length > 0 && <>
                <SectionLabel>Dinners</SectionLabel>
                {mealPlan.dinners.map((r, i) => <RecipeCard key={`d-${i}`} recipe={r} type="dinner" onLog={logRecipe} />)}
              </>}
              <div style={{ height: 1, background: T.border, margin: "20px 0" }} />
            </>
          ) : (
            <Card style={{ background: T.accentBg, border: `1px solid ${T.accent}33` }}>
              <div style={{ fontSize: 15, fontWeight: 700, fontFamily: FONT_BODY, marginBottom: 4 }}>No meal plan yet</div>
              <div style={{ fontSize: 13, color: T.muted, fontFamily: FONT_BODY, marginBottom: 12 }}>Scan your groceries to generate a weekly meal plan with portion recommendations.</div>
              <Btn onClick={() => setView("groceries")} style={{ width: "100%" }}>Set Up Groceries →</Btn>
            </Card>
          )}

          {/* Describe a meal */}
          <Card>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4, fontFamily: FONT_BODY }}>Describe a meal</div>
            <div style={{ fontSize: 13, color: T.muted, marginBottom: 14, lineHeight: 1.5, fontFamily: FONT_BODY }}>Don't want to weigh it? Describe what you ate and MACTRAX estimates the macros.</div>
            <textarea value={mealDesc} onChange={(e) => setMealDesc(e.target.value)}
              placeholder="e.g. Two scrambled eggs, two strips of bacon, and sourdough toast with butter"
              rows={3} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
            />
            {estimateError && <div style={{ color: T.red, fontSize: 13, marginTop: 8, fontFamily: FONT_BODY }}>{estimateError}</div>}
            {pendingEstimate && (
              <div style={{ background: T.accentBg, border: `1px solid ${T.accent}33`, borderRadius: 12, padding: 16, marginTop: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.accentTxt, marginBottom: 10, fontFamily: FONT_BODY }}>{pendingEstimate.name}</div>
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  <MacroChip label="Cal"  value={pendingEstimate.calories} color={T.yellow}    bg={T.yellowBg} />
                  <MacroChip label="Pro"  value={pendingEstimate.protein}  color={T.accentTxt} bg="#fff" />
                  <MacroChip label="Carb" value={pendingEstimate.carbs}    color={T.teal}      bg={T.tealBg} />
                  <MacroChip label="Fat"  value={pendingEstimate.fat}      color={T.red}       bg={T.redBg} />
                </div>
                {pendingEstimate.note && <div style={{ fontSize: 12, color: T.muted, fontStyle: "italic", marginBottom: 12, lineHeight: 1.5, fontFamily: FONT_BODY }}>{pendingEstimate.note}</div>}
                <div style={{ display: "flex", gap: 8 }}>
                  <Btn onClick={confirmEstimate} style={{ flex: 1 }}>Log this meal</Btn>
                  <Btn variant="ghost" onClick={() => setPendingEstimate(null)} style={{ flex: 1 }}>Discard</Btn>
                </div>
              </div>
            )}
            {!pendingEstimate && (
              <Btn onClick={handleEstimate} disabled={estimating || !mealDesc.trim()} style={{ width: "100%", marginTop: 12 }}>
                {estimating ? "Estimating…" : "Estimate Macros"}
              </Btn>
            )}
          </Card>

          {/* Log by weight */}
          <Card>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4, fontFamily: FONT_BODY }}>Log by weight</div>
            <div style={{ fontSize: 13, color: T.muted, marginBottom: 16, lineHeight: 1.5, fontFamily: FONT_BODY }}>For catalog foods you weighed out.</div>
            <div style={{ marginBottom: 14 }}>
              <SectionLabel>Food</SectionLabel>
              <select value={logForm.foodId} onChange={(e) => setLogForm(f => ({ ...f, foodId: e.target.value }))} style={inputStyle}>
                <option value="">Select a food…</option>
                {foods.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 14 }}>
              <SectionLabel>Amount (oz)</SectionLabel>
              <input type="number" step="0.1" placeholder="e.g. 6" value={logForm.oz} onChange={(e) => setLogForm(f => ({ ...f, oz: e.target.value }))} style={inputStyle} />
            </div>
            {logForm.foodId && logForm.oz && !isNaN(parseFloat(logForm.oz)) && (() => {
              const food  = foods.find(f => f.id === parseInt(logForm.foodId));
              if (!food) return null;
              const ratio = (parseFloat(logForm.oz) * 28.3495) / food.servingSize;
              return (
                <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                  <MacroChip label="Cal"  value={food.calories*ratio} color={T.yellow}    bg={T.yellowBg} />
                  <MacroChip label="Pro"  value={food.protein*ratio}  color={T.accentTxt} bg={T.accentBg} />
                  <MacroChip label="Carb" value={food.carbs*ratio}    color={T.teal}      bg={T.tealBg} />
                  <MacroChip label="Fat"  value={food.fat*ratio}      color={T.red}       bg={T.redBg} />
                </div>
              );
            })()}
            <Btn onClick={addLog} style={{ width: "100%" }}>Log Meal</Btn>
          </Card>

          {/* Scan a label */}
          <Card>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4, fontFamily: FONT_BODY }}>Scan a nutrition label</div>
            <div style={{ fontSize: 13, color: T.muted, marginBottom: 14, lineHeight: 1.5, fontFamily: FONT_BODY }}>Add new foods to your catalog by scanning their label.</div>
            <UploadZone onFile={handleScan} loading={scanning} label="Drop a nutrition label image" />
            {scanError && <div style={{ color: T.red, fontSize: 13, marginTop: 10, fontFamily: FONT_BODY }}>{scanError}</div>}
            {pendingFood && (
              <div style={{ background: T.accentBg, border: `1px solid ${T.accent}33`, borderRadius: 12, padding: 16, marginTop: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: T.accentTxt, textTransform: "uppercase", marginBottom: 10, fontFamily: FONT_BODY }}>Confirm to add</div>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, fontFamily: FONT_BODY }}>{pendingFood.name}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 24px", marginBottom: 14 }}>
                  {[["Serving size",`${pendingFood.servingSize}g`],["Calories",pendingFood.calories],["Protein",`${pendingFood.protein}g`],["Carbs",`${pendingFood.carbs}g`],["Fat",`${pendingFood.fat}g`]].map(([k,v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${T.border}` }}>
                      <span style={{ color: T.muted, fontSize: 13, fontFamily: FONT_BODY }}>{k}</span>
                      <span style={{ fontWeight: 600, fontSize: 13, fontFamily: FONT_BODY }}>{v}</span>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Btn onClick={() => { setFoods(f => [...f, pendingFood]); setPendingFood(null); }} style={{ flex: 1 }}>Add to Catalog</Btn>
                  <Btn variant="ghost" onClick={() => setPendingFood(null)} style={{ flex: 1 }}>Discard</Btn>
                </div>
              </div>
            )}
          </Card>

          {/* Catalog */}
          <SectionLabel>Food Catalog ({foods.length})</SectionLabel>
          {foods.map(f => (
            <Card key={f.id} style={{ padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 15, fontWeight: 600, fontFamily: FONT_BODY }}>{f.name}</span>
                <span style={{ fontSize: 12, color: T.muted, fontFamily: FONT_BODY }}>per {f.servingSize}g</span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <MacroChip label="Cal"  value={f.calories} color={T.yellow}    bg={T.yellowBg} />
                <MacroChip label="Pro"  value={f.protein}  color={T.accentTxt} bg={T.accentBg} />
                <MacroChip label="Carb" value={f.carbs}    color={T.teal}      bg={T.tealBg} />
                <MacroChip label="Fat"  value={f.fat}      color={T.red}       bg={T.redBg} />
              </div>
            </Card>
          ))}
        </>}

        {/* ── GROCERIES ── */}
        {view === "groceries" && <GroceriesTab mealPlan={mealPlan} setMealPlan={setMealPlan} targets={targets} />}

        {/* ── HISTORY ── */}
        {view === "history" && <CalendarView targets={targets} />}

      </div>
    </div>
  );
}