import { useState, useRef, useEffect } from "react";

// ─── Fonts ────────────────────────────────────────────────────────
const fontLink = document.createElement("link");
fontLink.rel = "stylesheet";
fontLink.href = "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap";
document.head.appendChild(fontLink);

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

const DAILY_TARGETS = { calories: 2200, protein: 165, carbs: 200, fat: 70 };
const TODAY_KEY = () => new Date().toISOString().slice(0, 10);
const FONT_BODY = "'DM Sans', sans-serif";
const FONT_DISPLAY = "'Bebas Neue', sans-serif";

// ─── Helpers ──────────────────────────────────────────────────────
function toBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = () => rej(new Error("Read failed"));
    r.readAsDataURL(file);
  });
}

async function callClaude(messages, systemPrompt) {
  const response = await fetch("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt,
      messages,
    }),
  });
  const data = await response.json();
  const text = data.content?.find((b) => b.type === "text")?.text || "{}";
  return text.replace(/```json|```/g, "").trim();
}

async function parseNutritionLabel(imageBase64, mediaType) {
  const text = await callClaude(
    [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
      { type: "text", text: "Extract nutrition facts. Return ONLY JSON: {name, servingSize (grams), calories, protein, carbs, fat}. Use 0 for missing." }
    ]}],
    "You are a nutrition label parser. Return only valid JSON, no markdown."
  );
  return JSON.parse(text);
}

async function estimateMealMacros(description) {
  const text = await callClaude(
    [{ role: "user", content: `Estimate macros for: "${description}"` }],
    `You are a nutrition expert. Return ONLY JSON:
{"name":"short name","calories":0,"protein":0,"carbs":0,"fat":0,"confidence":"low|medium|high","note":"one brief assumption sentence"}
No markdown, no preamble.`
  );
  return JSON.parse(text);
}

async function getRecommendation(remaining, targets, foods, loggedCount) {
  const foodList = foods.map(f => `- ${f.name}: ${f.calories} cal, ${f.protein}g protein, ${f.carbs}g carbs, ${f.fat}g fat per ${f.servingSize}g serving`).join("\n");
  const text = await callClaude(
    [{ role: "user", content:
      `The user has these macros remaining today:
Calories: ${Math.round(remaining.calories)} remaining
Protein: ${Math.round(remaining.protein)}g remaining
Carbs: ${Math.round(remaining.carbs)}g remaining
Fat: ${Math.round(remaining.fat)}g remaining
Meals logged so far today: ${loggedCount}

Their food catalog:
${foodList}

Recommend the best option from their catalog to help them hit their remaining goals. Be specific about how much to eat (in oz) and why.`
    }],
    `You are a nutrition coach. Analyze the remaining macro gaps and recommend a specific food from the catalog with an exact amount in oz.
Return ONLY JSON:
{
  "food": "exact food name from catalog",
  "oz": number,
  "reason": "one punchy sentence explaining why this hits the gap",
  "macrosHit": "e.g. +42g protein, 280 cal"
}
No markdown, no preamble. Pick the food that best bridges the biggest gap without blowing the calorie budget.`
  );
  return JSON.parse(text);
}

function saveDayToStorage(dateKey, totals, targets) {
  try {
    const existing = JSON.parse(localStorage.getItem("mactrax_history") || "{}");
    existing[dateKey] = { ...totals, targets, savedAt: Date.now() };
    localStorage.setItem("mactrax_history", JSON.stringify(existing));
  } catch {}
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem("mactrax_history") || "{}"); }
  catch { return {}; }
}

// ─── Components ───────────────────────────────────────────────────
function MacroBar({ label, current, target, accent, accentBg }) {
  const pct = Math.min((current / target) * 100, 100);
  const over = current > target;
  const remaining = Math.round(target - current);
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 7 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: T.text, fontFamily: FONT_BODY }}>{label}</span>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.03em", color: over ? T.red : T.text, fontFamily: FONT_BODY }}>{Math.round(current)}</span>
          <span style={{ fontSize: 13, color: T.muted, fontFamily: FONT_BODY }}>/ {target}{label === "Calories" ? "" : "g"}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: over ? T.red : T.accentTxt, background: over ? T.redBg : accentBg, padding: "2px 8px", borderRadius: 99, fontFamily: FONT_BODY }}>
            {over ? `+${Math.abs(remaining)} over` : `${remaining} left`}
          </span>
        </div>
      </div>
      <div style={{ height: 6, background: T.border, borderRadius: 99, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: over ? T.red : accent, borderRadius: 99, transition: "width 0.5s cubic-bezier(0.4,0,0.2,1)" }} />
      </div>
    </div>
  );
}

function Card({ children, style = {} }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 20, boxShadow: T.shadow, marginBottom: 16, ...style }}>
      {children}
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: T.muted, textTransform: "uppercase", marginBottom: 8, paddingLeft: 2, fontFamily: FONT_BODY }}>
      {children}
    </div>
  );
}

function Btn({ children, onClick, variant = "primary", style: s = {}, disabled }) {
  const variants = {
    primary:   { background: T.accent, color: "#fff", border: "none" },
    secondary: { background: T.border, color: T.text, border: "none" },
    ghost:     { background: "transparent", color: T.muted, border: `1px solid ${T.border}` },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{
      ...variants[variant], borderRadius: 8, fontFamily: FONT_BODY,
      fontSize: 13, fontWeight: 700, padding: "10px 18px",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.6 : 1, transition: "opacity 0.15s", ...s,
    }}>{children}</button>
  );
}

function MacroChip({ label, value, color, bg }) {
  return (
    <div style={{ background: bg, borderRadius: 8, padding: "8px 0", textAlign: "center", flex: 1 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color, textTransform: "uppercase", marginBottom: 2, fontFamily: FONT_BODY }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color, letterSpacing: "-0.02em", fontFamily: FONT_BODY }}>{Math.round(value)}{label !== "Cal" ? "g" : ""}</div>
    </div>
  );
}

function UploadZone({ onFile, loading }) {
  const inputRef = useRef();
  const [drag, setDrag] = useState(false);
  const handle = (file) => { if (file?.type.startsWith("image/")) onFile(file); };
  return (
    <div
      onClick={() => inputRef.current.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files[0]); }}
      style={{ border: `2px dashed ${drag ? T.accent : T.border}`, borderRadius: 10, padding: "24px 20px", textAlign: "center", cursor: "pointer", background: drag ? T.accentBg : T.bg, transition: "all 0.2s" }}
    >
      <input ref={inputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handle(e.target.files[0])} />
      {loading
        ? <div style={{ color: T.accent, fontSize: 13, fontWeight: 600, fontFamily: FONT_BODY }}>Scanning label…</div>
        : <>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📷</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 4, fontFamily: FONT_BODY }}>Drop a nutrition label image</div>
            <div style={{ fontSize: 12, color: T.muted, fontFamily: FONT_BODY }}>or click to browse</div>
          </>
      }
    </div>
  );
}

// ─── Recommendation Card ──────────────────────────────────────────
function RecommendationCard({ totals, targets, foods, logCount }) {
  const [rec, setRec] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState(false);

  const remaining = {
    calories: targets.calories - totals.calories,
    protein:  targets.protein  - totals.protein,
    carbs:    targets.carbs    - totals.carbs,
    fat:      targets.fat      - totals.fat,
  };

  // Only show if there's meaningful protein left to hit
  const proteinLeft = remaining.protein;
  const allGoalsMet = Object.values(remaining).every(v => v <= 0);

  if (dismissed || allGoalsMet) return null;

  const fetch = async () => {
    setLoading(true); setError(""); setRec(null);
    try { setRec(await getRecommendation(remaining, targets, foods, logCount)); }
    catch { setError("Couldn't generate a recommendation right now."); }
    setLoading(false);
  };

  return (
    <div style={{
      background: `linear-gradient(135deg, ${T.accentBg} 0%, #F0F8ED 100%)`,
      border: `1.5px solid ${T.accent}44`,
      borderRadius: 12, padding: 18, marginBottom: 16,
      boxShadow: T.shadow, position: "relative",
    }}>
      {/* Dismiss */}
      <button onClick={() => setDismissed(true)} style={{
        position: "absolute", top: 12, right: 12,
        background: "transparent", border: "none", color: T.faint,
        cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 4,
      }}>×</button>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 18 }}>🎯</span>
        <span style={{ fontFamily: FONT_DISPLAY, fontSize: 17, letterSpacing: "0.04em", color: T.accentTxt }}>
          What to eat next
        </span>
      </div>

      {/* Remaining summary */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {[
          { label: "Cal left",  value: Math.max(0, Math.round(remaining.calories)), color: T.yellow,    bg: T.yellowBg },
          { label: "Pro left",  value: Math.max(0, Math.round(remaining.protein)),  color: T.accentTxt, bg: "#fff" },
          { label: "Carb left", value: Math.max(0, Math.round(remaining.carbs)),    color: T.teal,      bg: T.tealBg },
          { label: "Fat left",  value: Math.max(0, Math.round(remaining.fat)),      color: T.red,       bg: T.redBg },
        ].map(({ label, value, color, bg }) => (
          <div key={label} style={{ flex: 1, background: bg, borderRadius: 8, padding: "6px 0", textAlign: "center" }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", color, textTransform: "uppercase", marginBottom: 2, fontFamily: FONT_BODY }}>{label}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color, fontFamily: FONT_BODY }}>{value}{label !== "Cal left" ? "g" : ""}</div>
          </div>
        ))}
      </div>

      {/* Recommendation result */}
      {rec && (
        <div style={{ background: T.surface, borderRadius: 10, padding: "12px 14px", marginBottom: 12, border: `1px solid ${T.border}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text, fontFamily: FONT_BODY }}>{rec.food}</div>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, color: T.accent, letterSpacing: "0.04em", whiteSpace: "nowrap", marginLeft: 10 }}>{rec.oz} oz</div>
          </div>
          <div style={{ fontSize: 12, color: T.muted, fontFamily: FONT_BODY, marginBottom: 6, lineHeight: 1.5 }}>{rec.reason}</div>
          <div style={{ display: "inline-flex", background: T.accentBg, borderRadius: 6, padding: "3px 8px" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: T.accentTxt, fontFamily: FONT_BODY }}>{rec.macrosHit}</span>
          </div>
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: T.red, marginBottom: 10, fontFamily: FONT_BODY }}>{error}</div>}

      <Btn onClick={fetch} disabled={loading} style={{ width: "100%" }}>
        {loading ? "Analyzing your gaps…" : rec ? "Refresh recommendation" : "Get recommendation"}
      </Btn>
    </div>
  );
}

// ─── Calendar Component ───────────────────────────────────────────
function CalendarView({ targets }) {
  const [history, setHistory] = useState({});
  const [selectedDay, setSelectedDay] = useState(null);
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  useEffect(() => { setHistory(loadHistory()); }, []);

  const { year, month } = viewMonth;
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const dayNames = ["Su","Mo","Tu","We","Th","Fr","Sa"];
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = TODAY_KEY();

  const prevMonth = () => setViewMonth(({ year: y, month: m }) => m === 0 ? { year: y-1, month: 11 } : { year: y, month: m-1 });
  const nextMonth = () => setViewMonth(({ year: y, month: m }) => m === 11 ? { year: y+1, month: 0 } : { year: y, month: m+1 });
  const getDayKey = (d) => `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;

  const getDayScore = (dayData) => {
    if (!dayData) return null;
    const tgt = dayData.targets || targets;
    const proteinPct = Math.min(dayData.protein / tgt.protein, 1);
    const calPct = dayData.calories / tgt.calories;
    if (calPct > 1.1) return "over";
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
      <Card style={{ padding: "16px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <button onClick={prevMonth} style={{ background: T.border, border: "none", borderRadius: 8, width: 32, height: 32, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>
          <span style={{ fontFamily: FONT_DISPLAY, fontSize: 22, letterSpacing: "0.04em", color: T.text }}>{monthNames[month]} {year}</span>
          <button onClick={nextMonth} style={{ background: T.border, border: "none", borderRadius: 8, width: 32, height: 32, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>›</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
          {dayNames.map(d => (
            <div key={d} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: T.faint, letterSpacing: "0.06em", fontFamily: FONT_BODY, padding: "4px 0" }}>{d}</div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
          {cells.map((d, i) => {
            if (!d) return <div key={`e-${i}`} />;
            const key = getDayKey(d);
            const dayData = history[key];
            const score = getDayScore(dayData);
            const colors = score ? scoreColors[score] : null;
            const isToday = key === todayStr;
            const isSelected = selectedDay === d;
            return (
              <button key={key} onClick={() => setSelectedDay(isSelected ? null : d)}
                style={{
                  background: isSelected ? T.accent : colors ? colors.bg : "transparent",
                  border: isToday ? `2px solid ${T.accent}` : "2px solid transparent",
                  borderRadius: 8, padding: "6px 2px", cursor: dayData ? "pointer" : "default",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 3, transition: "all 0.15s",
                }}>
                <span style={{ fontSize: 13, fontWeight: isToday ? 700 : 500, color: isSelected ? "#fff" : T.text, fontFamily: FONT_BODY }}>{d}</span>
                {score && <div style={{ width: 5, height: 5, borderRadius: "50%", background: isSelected ? "rgba(255,255,255,0.8)" : colors.dot }} />}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 14, justifyContent: "center" }}>
          {[["good","Hit protein"],["partial","Partial"],["over","Over calories"],["low","Low intake"]].map(([score, label]) => (
            <div key={score} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: scoreColors[score].dot }} />
              <span style={{ fontSize: 10, color: T.muted, fontFamily: FONT_BODY }}>{label}</span>
            </div>
          ))}
        </div>
      </Card>

      {selectedDay && (
        <Card>
          {selected ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
                <span style={{ fontFamily: FONT_DISPLAY, fontSize: 20, color: T.text, letterSpacing: "0.04em" }}>{monthNames[month]} {selectedDay}</span>
                <span style={{ fontSize: 11, color: T.muted, fontFamily: FONT_BODY }}>{year}</span>
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
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
                const pct = Math.min((val/tgt)*100, 100);
                const over = val > tgt;
                return (
                  <div key={label} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: T.muted, fontFamily: FONT_BODY }}>{label}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: over ? T.red : T.text, fontFamily: FONT_BODY }}>{Math.round(val)} / {tgt}{label==="Calories"?"":"g"}</span>
                    </div>
                    <div style={{ height: 5, background: T.border, borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: over ? T.red : accent, borderRadius: 99 }} />
                    </div>
                  </div>
                );
              })}
            </>
          ) : (
            <div style={{ textAlign: "center", color: T.faint, fontSize: 13, padding: "16px 0", fontFamily: FONT_BODY }}>
              No data logged for {monthNames[month]} {selectedDay}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────
const inputStyle = {
  width: "100%", boxSizing: "border-box",
  background: T.bg, border: `1px solid ${T.border}`,
  borderRadius: 8, padding: "10px 14px",
  fontSize: 15, color: T.text, fontFamily: FONT_BODY,
  outline: "none", appearance: "none",
};

export default function MacroTracker() {
  const [targets, setTargets]           = useState(DAILY_TARGETS);
  const [foods, setFoods]               = useState([
    { id: 1, name: "Chicken Breast",      servingSize: 170, calories: 280, protein: 53, carbs: 0, fat: 6 },
    { id: 2, name: "93/7 Ground Turkey",  servingSize: 112, calories: 160, protein: 22, carbs: 0, fat: 7 },
    { id: 3, name: "Albacore Tuna (can)", servingSize: 198, calories: 220, protein: 40, carbs: 0, fat: 5 },
    { id: 4, name: "Egg (large)",          servingSize: 50,  calories: 70,  protein: 6,  carbs: 0, fat: 5 },
    { id: 5, name: "Pork Tenderloin",     servingSize: 170, calories: 260, protein: 48, carbs: 0, fat: 6 },
    { id: 6, name: "Eye of Round Steak",  servingSize: 170, calories: 240, protein: 44, carbs: 0, fat: 7 },
    { id: 7, name: "80/20 Ground Beef",   servingSize: 112, calories: 290, protein: 19, carbs: 0, fat: 23 },
  ]);
  const [log, setLog]                   = useState([]);
  const [view, setView]                 = useState("dashboard");
  const [logForm, setLogForm]           = useState({ foodId: "", oz: "" });
  const [scanning, setScanning]         = useState(false);
  const [scanError, setScanError]       = useState("");
  const [pendingFood, setPendingFood]   = useState(null);
  const [editTargets, setEditTargets]   = useState(false);
  const [tempTargets, setTempTargets]   = useState(targets);
  const [mealDesc, setMealDesc]         = useState("");
  const [estimating, setEstimating]     = useState(false);
  const [estimateError, setEstimateError] = useState("");
  const [pendingEstimate, setPendingEstimate] = useState(null);

  const totals = log.reduce((acc, entry) => {
    if (entry.type === "estimate") {
      return { calories: acc.calories+entry.calories, protein: acc.protein+entry.protein, carbs: acc.carbs+entry.carbs, fat: acc.fat+entry.fat };
    }
    const food = foods.find((f) => f.id === entry.foodId);
    if (!food) return acc;
    const ratio = (entry.oz * 28.3495) / food.servingSize;
    return { calories: acc.calories+food.calories*ratio, protein: acc.protein+food.protein*ratio, carbs: acc.carbs+food.carbs*ratio, fat: acc.fat+food.fat*ratio };
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

  useEffect(() => {
    if (log.length > 0) saveDayToStorage(TODAY_KEY(), totals, targets);
  }, [log]);

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
    setLog((l) => [...l, { id: Date.now(), type: "estimate", ...pendingEstimate, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }]);
    setPendingEstimate(null); setMealDesc("");
  };

  const addLog = () => {
    if (!logForm.foodId || !logForm.oz || isNaN(parseFloat(logForm.oz))) return;
    setLog((l) => [...l, { id: Date.now(), type: "weighed", foodId: parseInt(logForm.foodId), oz: parseFloat(logForm.oz), time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }]);
    setLogForm({ foodId: "", oz: "" });
  };

  const navTabs = [
    { id: "dashboard", label: "Today" },
    { id: "log",       label: "Log" },
    { id: "history",   label: "History" },
    { id: "catalog",   label: "Catalog" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: FONT_BODY, maxWidth: 480, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, padding: "14px 20px 0", position: "sticky", top: 0, zIndex: 50, boxShadow: T.shadow }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 30, letterSpacing: "0.06em", color: T.text, lineHeight: 1 }}>MAC</span>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 30, letterSpacing: "0.06em", color: T.accent, lineHeight: 1 }}>TRAX</span>
          </div>
          <button onClick={() => { setEditTargets(true); setTempTargets(targets); }}
            style={{ background: T.border, border: "none", color: T.text, fontSize: 12, fontWeight: 600, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontFamily: FONT_BODY }}>
            Targets
          </button>
        </div>
        <div style={{ display: "flex", marginBottom: -1 }}>
          {navTabs.map(({ id, label }) => (
            <button key={id} onClick={() => setView(id)} style={{
              flex: 1, background: "transparent", border: "none",
              borderBottom: `2px solid ${view === id ? T.accent : "transparent"}`,
              color: view === id ? T.accent : T.muted,
              fontFamily: FONT_BODY, fontSize: 13, fontWeight: view === id ? 700 : 500,
              padding: "8px 0 10px", cursor: "pointer", transition: "all 0.15s",
            }}>{label}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: "20px 16px" }}>

        {/* Targets Modal */}
        {editTargets && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div style={{ background: T.surface, borderRadius: 16, padding: 24, width: "100%", maxWidth: 360, boxShadow: T.shadowMd }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, letterSpacing: "0.04em", marginBottom: 20 }}>Daily Targets</div>
              {["calories","protein","carbs","fat"].map((k) => (
                <div key={k} style={{ marginBottom: 16 }}>
                  <SectionLabel>{k}</SectionLabel>
                  <input type="number" value={tempTargets[k]}
                    onChange={(e) => setTempTargets((t) => ({ ...t, [k]: parseFloat(e.target.value) || 0 }))}
                    style={inputStyle} />
                </div>
              ))}
              <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
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

          {/* Recommendation card — always visible on dashboard */}
          <RecommendationCard
            totals={totals}
            targets={targets}
            foods={foods}
            logCount={log.length}
          />

          {log.length === 0
            ? <div style={{ textAlign: "center", color: T.faint, fontSize: 13, padding: "24px 0" }}>No meals logged today</div>
            : <>
                <SectionLabel>Today's Meals</SectionLabel>
                {log.map((entry) => {
                  let cal, pro, carb, fat, name;
                  if (entry.type === "estimate") {
                    ({ calories: cal, protein: pro, carbs: carb, fat, name } = entry);
                  } else {
                    const food = foods.find((f) => f.id === entry.foodId);
                    if (!food) return null;
                    const r = (entry.oz * 28.3495) / food.servingSize;
                    [cal, pro, carb, fat, name] = [food.calories*r, food.protein*r, food.carbs*r, food.fat*r, food.name];
                  }
                  return (
                    <Card key={entry.id} style={{ padding: "14px 16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{name}</div>
                          {entry.type === "estimate"
                            ? <span style={{ fontSize: 11, background: T.yellowBg, color: T.yellow, padding: "2px 7px", borderRadius: 4, fontWeight: 600 }}>AI estimate · {entry.confidence} confidence</span>
                            : <span style={{ fontSize: 12, color: T.muted }}>{entry.oz} oz</span>
                          }
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 11, color: T.faint }}>{entry.time}</span>
                          <button onClick={() => setLog((l) => l.filter((e) => e.id !== entry.id))}
                            style={{ background: T.redBg, border: "none", color: T.red, width: 24, height: 24, borderRadius: 6, cursor: "pointer", fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <MacroChip label="Cal"  value={cal}  color={T.yellow}    bg={T.yellowBg} />
                        <MacroChip label="Pro"  value={pro}  color={T.accentTxt} bg={T.accentBg} />
                        <MacroChip label="Carb" value={carb} color={T.teal}      bg={T.tealBg} />
                        <MacroChip label="Fat"  value={fat}  color={T.red}       bg={T.redBg} />
                      </div>
                      {entry.note && <div style={{ fontSize: 11, color: T.muted, marginTop: 8, fontStyle: "italic" }}>{entry.note}</div>}
                    </Card>
                  );
                })}
              </>
          }
        </>}

        {/* ── LOG ── */}
        {view === "log" && <>
          <Card>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Describe a meal</div>
            <div style={{ fontSize: 12, color: T.muted, marginBottom: 14 }}>Don't want to weigh it? Describe what you ate and MACTRAX estimates the macros.</div>
            <textarea value={mealDesc} onChange={(e) => setMealDesc(e.target.value)}
              placeholder="e.g. Two scrambled eggs, two strips of bacon, and sourdough toast with butter"
              rows={3} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5, fontSize: 14 }}
            />
            {estimateError && <div style={{ color: T.red, fontSize: 12, marginTop: 6 }}>{estimateError}</div>}
            {pendingEstimate && (
              <div style={{ background: T.accentBg, border: `1px solid ${T.accent}33`, borderRadius: 10, padding: 14, marginTop: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.accentTxt, marginBottom: 8 }}>{pendingEstimate.name}</div>
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  <MacroChip label="Cal"  value={pendingEstimate.calories} color={T.yellow}    bg={T.yellowBg} />
                  <MacroChip label="Pro"  value={pendingEstimate.protein}  color={T.accentTxt} bg="#fff" />
                  <MacroChip label="Carb" value={pendingEstimate.carbs}    color={T.teal}      bg={T.tealBg} />
                  <MacroChip label="Fat"  value={pendingEstimate.fat}      color={T.red}       bg={T.redBg} />
                </div>
                {pendingEstimate.note && <div style={{ fontSize: 11, color: T.muted, fontStyle: "italic", marginBottom: 10 }}>{pendingEstimate.note}</div>}
                <div style={{ display: "flex", gap: 8 }}>
                  <Btn onClick={confirmEstimate} style={{ flex: 1 }}>Log this meal</Btn>
                  <Btn variant="ghost" onClick={() => setPendingEstimate(null)} style={{ flex: 1 }}>Discard</Btn>
                </div>
              </div>
            )}
            {!pendingEstimate && (
              <Btn onClick={handleEstimate} disabled={estimating || !mealDesc.trim()} style={{ width: "100%", marginTop: 10 }}>
                {estimating ? "Estimating…" : "Estimate Macros"}
              </Btn>
            )}
          </Card>

          <Card>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Log by weight</div>
            <div style={{ fontSize: 12, color: T.muted, marginBottom: 14 }}>For catalog foods you weighed out.</div>
            <div style={{ marginBottom: 12 }}>
              <SectionLabel>Food</SectionLabel>
              <select value={logForm.foodId} onChange={(e) => setLogForm((f) => ({ ...f, foodId: e.target.value }))} style={inputStyle}>
                <option value="">Select a food…</option>
                {foods.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 12 }}>
              <SectionLabel>Amount (oz)</SectionLabel>
              <input type="number" step="0.1" placeholder="e.g. 6" value={logForm.oz}
                onChange={(e) => setLogForm((f) => ({ ...f, oz: e.target.value }))} style={inputStyle} />
            </div>
            {logForm.foodId && logForm.oz && !isNaN(parseFloat(logForm.oz)) && (() => {
              const food = foods.find((f) => f.id === parseInt(logForm.foodId));
              if (!food) return null;
              const ratio = (parseFloat(logForm.oz) * 28.3495) / food.servingSize;
              return (
                <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                  <MacroChip label="Cal"  value={food.calories*ratio} color={T.yellow}    bg={T.yellowBg} />
                  <MacroChip label="Pro"  value={food.protein*ratio}  color={T.accentTxt} bg={T.accentBg} />
                  <MacroChip label="Carb" value={food.carbs*ratio}    color={T.teal}      bg={T.tealBg} />
                  <MacroChip label="Fat"  value={food.fat*ratio}      color={T.red}       bg={T.redBg} />
                </div>
              );
            })()}
            <Btn onClick={addLog} style={{ width: "100%" }}>Log Meal</Btn>
          </Card>
        </>}

        {/* ── HISTORY ── */}
        {view === "history" && <CalendarView targets={targets} />}

        {/* ── CATALOG ── */}
        {view === "catalog" && <>
          <Card>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Scan a nutrition label</div>
            <div style={{ fontSize: 12, color: T.muted, marginBottom: 14 }}>Upload a photo and MACTRAX adds it to your catalog automatically.</div>
            <UploadZone onFile={handleScan} loading={scanning} />
            {scanError && <div style={{ color: T.red, fontSize: 12, marginTop: 8 }}>{scanError}</div>}
            {pendingFood && (
              <div style={{ background: T.accentBg, border: `1px solid ${T.accent}33`, borderRadius: 10, padding: 14, marginTop: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: T.accentTxt, textTransform: "uppercase", marginBottom: 8 }}>Confirm to add</div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>{pendingFood.name}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 24px", fontSize: 13, marginBottom: 12 }}>
                  {[["Serving size",`${pendingFood.servingSize}g`],["Calories",pendingFood.calories],["Protein",`${pendingFood.protein}g`],["Carbs",`${pendingFood.carbs}g`],["Fat",`${pendingFood.fat}g`]].map(([k,v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${T.border}` }}>
                      <span style={{ color: T.muted }}>{k}</span><span style={{ fontWeight: 600 }}>{v}</span>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Btn onClick={() => { setFoods((f) => [...f, pendingFood]); setPendingFood(null); }} style={{ flex: 1 }}>Add to Catalog</Btn>
                  <Btn variant="ghost" onClick={() => setPendingFood(null)} style={{ flex: 1 }}>Discard</Btn>
                </div>
              </div>
            )}
          </Card>

          <SectionLabel>Food Catalog ({foods.length})</SectionLabel>
          {foods.map((f) => (
            <Card key={f.id} style={{ padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{f.name}</span>
                <span style={{ fontSize: 11, color: T.muted }}>per {f.servingSize}g</span>
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

      </div>
    </div>
  );
}