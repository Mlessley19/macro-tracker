import { useState, useRef, useEffect } from "react";

// ─── Fonts ────────────────────────────────────────────────────────
const fontLink = document.createElement("link");
fontLink.rel = "stylesheet";
fontLink.href = "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap";
document.head.appendChild(fontLink);

// ─── Global mobile styles ─────────────────────────────────────────
const globalStyle = document.createElement("style");
globalStyle.textContent = `
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { margin: 0; padding: 0; background: #F7F6F2; overscroll-behavior-y: none; }
  input, select, textarea { font-size: 16px !important; } /* prevents iOS zoom on focus */
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

const DAILY_TARGETS = { calories: 2200, protein: 165, carbs: 200, fat: 70 };
const TODAY_KEY = () => new Date().toISOString().slice(0, 10);
const FONT_BODY    = "'DM Sans', sans-serif";
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
  const foodList = foods.map(f =>
    `- ${f.name}: ${f.calories} cal, ${f.protein}g protein, ${f.carbs}g carbs, ${f.fat}g fat per ${f.servingSize}g serving`
  ).join("\n");
  const text = await callClaude(
    [{ role: "user", content:
`Macros remaining today:
Calories: ${Math.round(remaining.calories)}
Protein: ${Math.round(remaining.protein)}g
Carbs: ${Math.round(remaining.carbs)}g
Fat: ${Math.round(remaining.fat)}g
Meals logged: ${loggedCount}

Catalog:
${foodList}`
    }],
    `You are a nutrition coach. Recommend the single best food from the catalog to bridge the biggest macro gap without blowing the calorie budget.
Return ONLY JSON:
{"food":"exact name from catalog","oz":number,"reason":"one punchy sentence","macrosHit":"e.g. +42g protein, 280 cal"}
No markdown, no preamble.`
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

// ─── MacroBar — mobile-first two-row layout ───────────────────────
function MacroBar({ label, current, target, accent, accentBg }) {
  const pct     = Math.min((current / target) * 100, 100);
  const over     = current > target;
  const remaining = Math.round(Math.abs(target - current));
  return (
    <div style={{ marginBottom: 20 }}>
      {/* Row 1: label + pill */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", color: T.muted, textTransform: "uppercase", fontFamily: FONT_BODY }}>
          {label}
        </span>
        <span style={{
          fontSize: 11, fontWeight: 700,
          color: over ? T.red : T.accentTxt,
          background: over ? T.redBg : accentBg,
          padding: "2px 8px", borderRadius: 99, fontFamily: FONT_BODY,
        }}>
          {over ? `+${remaining} over` : `${remaining} left`}
        </span>
      </div>
      {/* Row 2: big number + target */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.03em", color: over ? T.red : T.text, lineHeight: 1, fontFamily: FONT_BODY }}>
          {Math.round(current)}
        </span>
        <span style={{ fontSize: 13, color: T.faint, fontFamily: FONT_BODY }}>
          / {target}{label === "Calories" ? "" : "g"}
        </span>
      </div>
      {/* Row 3: progress bar */}
      <div style={{ height: 7, background: T.border, borderRadius: 99, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${pct}%`,
          background: over ? T.red : accent,
          borderRadius: 99,
          transition: "width 0.5s cubic-bezier(0.4,0,0.2,1)",
        }} />
      </div>
    </div>
  );
}

// ─── Shared primitives ────────────────────────────────────────────
function Card({ children, style = {} }) {
  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`,
      borderRadius: 14, padding: 20, boxShadow: T.shadow,
      marginBottom: 12, ...style,
    }}>
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
      ...variants[variant],
      borderRadius: 10, fontFamily: FONT_BODY,
      fontSize: 15, fontWeight: 700,
      padding: "13px 18px",           // taller touch target (44px+)
      minHeight: 44,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.6 : 1,
      transition: "opacity 0.15s",
      ...s,
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
      style={{
        border: `2px dashed ${drag ? T.accent : T.border}`,
        borderRadius: 12, padding: "28px 20px", textAlign: "center",
        cursor: "pointer", background: drag ? T.accentBg : T.bg,
        transition: "all 0.2s", minHeight: 44,
      }}
    >
      <input ref={inputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handle(e.target.files[0])} />
      {loading
        ? <div style={{ color: T.accent, fontSize: 15, fontWeight: 600, fontFamily: FONT_BODY }}>Scanning label…</div>
        : <>
            <div style={{ fontSize: 32, marginBottom: 10 }}>📷</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: T.text, marginBottom: 4, fontFamily: FONT_BODY }}>Drop a nutrition label image</div>
            <div style={{ fontSize: 13, color: T.muted, fontFamily: FONT_BODY }}>or tap to browse</div>
          </>
      }
    </div>
  );
}

// inputs: font-size 16px enforced by global style to prevent iOS zoom
const inputStyle = {
  width: "100%",
  background: T.bg, border: `1px solid ${T.border}`,
  borderRadius: 10, padding: "13px 14px",
  color: T.text, fontFamily: FONT_BODY,
  outline: "none", appearance: "none",
  minHeight: 44,
};

// ─── Recommendation Card ──────────────────────────────────────────
function RecommendationCard({ totals, targets, foods, logCount }) {
  const [rec,       setRec]       = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState("");
  const [dismissed, setDismissed] = useState(false);

  const remaining = {
    calories: targets.calories - totals.calories,
    protein:  targets.protein  - totals.protein,
    carbs:    targets.carbs    - totals.carbs,
    fat:      targets.fat      - totals.fat,
  };

  const allGoalsMet = Object.values(remaining).every(v => v <= 0);
  if (dismissed || allGoalsMet) return null;

  const fetchRec = async () => {
    setLoading(true); setError(""); setRec(null);
    try { setRec(await getRecommendation(remaining, targets, foods, logCount)); }
    catch { setError("Couldn't generate a recommendation right now."); }
    setLoading(false);
  };

  return (
    <div style={{
      background: `linear-gradient(135deg, ${T.accentBg} 0%, #F0F8ED 100%)`,
      border: `1.5px solid ${T.accent}44`,
      borderRadius: 14, padding: 18, marginBottom: 12,
      boxShadow: T.shadow, position: "relative",
    }}>
      <button onClick={() => setDismissed(true)} style={{
        position: "absolute", top: 14, right: 14,
        background: "transparent", border: "none", color: T.faint,
        cursor: "pointer", fontSize: 20, lineHeight: 1,
        width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
      }}>×</button>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 20 }}>🎯</span>
        <span style={{ fontFamily: FONT_DISPLAY, fontSize: 19, letterSpacing: "0.04em", color: T.accentTxt }}>
          What to eat next
        </span>
      </div>

      {/* Remaining chips */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {[
          { label: "Cal",  value: Math.max(0, Math.round(remaining.calories)), color: T.yellow,    bg: T.yellowBg },
          { label: "Pro",  value: Math.max(0, Math.round(remaining.protein)),  color: T.accentTxt, bg: "#fff" },
          { label: "Carb", value: Math.max(0, Math.round(remaining.carbs)),    color: T.teal,      bg: T.tealBg },
          { label: "Fat",  value: Math.max(0, Math.round(remaining.fat)),      color: T.red,       bg: T.redBg },
        ].map(({ label, value, color, bg }) => (
          <div key={label} style={{ flex: 1, background: bg, borderRadius: 8, padding: "8px 0", textAlign: "center" }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", color, textTransform: "uppercase", marginBottom: 2, fontFamily: FONT_BODY }}>{label} left</div>
            <div style={{ fontSize: 14, fontWeight: 700, color, fontFamily: FONT_BODY }}>{value}{label !== "Cal" ? "g" : ""}</div>
          </div>
        ))}
      </div>

      {rec && (
        <div style={{ background: T.surface, borderRadius: 10, padding: "14px 16px", marginBottom: 12, border: `1px solid ${T.border}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text, fontFamily: FONT_BODY, flex: 1, paddingRight: 12 }}>{rec.food}</div>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, color: T.accent, letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{rec.oz} oz</div>
          </div>
          <div style={{ fontSize: 13, color: T.muted, fontFamily: FONT_BODY, marginBottom: 8, lineHeight: 1.5 }}>{rec.reason}</div>
          <div style={{ display: "inline-flex", background: T.accentBg, borderRadius: 6, padding: "4px 10px" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: T.accentTxt, fontFamily: FONT_BODY }}>{rec.macrosHit}</span>
          </div>
        </div>
      )}

      {error && <div style={{ fontSize: 13, color: T.red, marginBottom: 10, fontFamily: FONT_BODY }}>{error}</div>}

      <Btn onClick={fetchRec} disabled={loading} style={{ width: "100%" }}>
        {loading ? "Analyzing your gaps…" : rec ? "Refresh recommendation" : "Get recommendation"}
      </Btn>
    </div>
  );
}

// ─── Calendar ─────────────────────────────────────────────────────
function CalendarView({ targets }) {
  const [history,     setHistory]     = useState({});
  const [selectedDay, setSelectedDay] = useState(null);
  const [viewMonth,   setViewMonth]   = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  useEffect(() => { setHistory(loadHistory()); }, []);

  const { year, month } = viewMonth;
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const dayNames   = ["Su","Mo","Tu","We","Th","Fr","Sa"];
  const firstDay   = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr   = TODAY_KEY();

  const prevMonth = () => setViewMonth(({ year: y, month: m }) => m === 0 ? { year: y-1, month: 11 } : { year: y, month: m-1 });
  const nextMonth = () => setViewMonth(({ year: y, month: m }) => m === 11 ? { year: y+1, month: 0 } : { year: y, month: m+1 });
  const getDayKey = (d) => `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;

  const getDayScore = (dayData) => {
    if (!dayData) return null;
    const tgt = dayData.targets || targets;
    const proteinPct = dayData.protein / tgt.protein;
    const calPct     = dayData.calories / tgt.calories;
    if (calPct > 1.1)       return "over";
    if (proteinPct >= 0.8)  return "good";
    if (proteinPct >= 0.5)  return "partial";
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
      <Card style={{ padding: "16px" }}>
        {/* Month nav */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <button onClick={prevMonth} style={{ background: T.border, border: "none", borderRadius: 10, width: 40, height: 40, cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>
          <span style={{ fontFamily: FONT_DISPLAY, fontSize: 22, letterSpacing: "0.04em", color: T.text }}>{monthNames[month]} {year}</span>
          <button onClick={nextMonth} style={{ background: T.border, border: "none", borderRadius: 10, width: 40, height: 40, cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>›</button>
        </div>

        {/* Day headers */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3, marginBottom: 3 }}>
          {dayNames.map(d => (
            <div key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: T.faint, letterSpacing: "0.04em", fontFamily: FONT_BODY, padding: "4px 0" }}>{d}</div>
          ))}
        </div>

        {/* Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
          {cells.map((d, i) => {
            if (!d) return <div key={`e-${i}`} />;
            const key      = getDayKey(d);
            const dayData  = history[key];
            const score    = getDayScore(dayData);
            const colors   = score ? scoreColors[score] : null;
            const isToday  = key === todayStr;
            const isSel    = selectedDay === d;
            return (
              <button key={key} onClick={() => setSelectedDay(isSel ? null : d)}
                style={{
                  background: isSel ? T.accent : colors ? colors.bg : "transparent",
                  border: isToday ? `2px solid ${T.accent}` : "2px solid transparent",
                  borderRadius: 10,
                  minHeight: 44,           // proper touch target
                  cursor: dayData ? "pointer" : "default",
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
                  transition: "all 0.15s", padding: 0,
                }}>
                <span style={{ fontSize: 14, fontWeight: isToday ? 700 : 500, color: isSel ? "#fff" : T.text, fontFamily: FONT_BODY }}>{d}</span>
                {score && (
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: isSel ? "rgba(255,255,255,0.8)" : colors.dot }} />
                )}
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", marginTop: 16, justifyContent: "center" }}>
          {[["good","Hit protein"],["partial","Partial"],["over","Over calories"],["low","Low intake"]].map(([score, label]) => (
            <div key={score} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: scoreColors[score].dot }} />
              <span style={{ fontSize: 11, color: T.muted, fontFamily: FONT_BODY }}>{label}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Selected day detail */}
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
                const pct  = Math.min((val / tgt) * 100, 100);
                const over = val > tgt;
                return (
                  <div key={label} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ fontSize: 13, color: T.muted, fontFamily: FONT_BODY }}>{label}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: over ? T.red : T.text, fontFamily: FONT_BODY }}>
                        {Math.round(val)} / {tgt}{label === "Calories" ? "" : "g"}
                      </span>
                    </div>
                    <div style={{ height: 6, background: T.border, borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: over ? T.red : accent, borderRadius: 99 }} />
                    </div>
                  </div>
                );
              })}
            </>
          ) : (
            <div style={{ textAlign: "center", color: T.faint, fontSize: 14, padding: "20px 0", fontFamily: FONT_BODY }}>
              No data logged for {monthNames[month]} {selectedDay}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────
export default function MacroTracker() {
  const [targets,          setTargets]          = useState(DAILY_TARGETS);
  const [foods, setFoods] = useState(() => {
  try {
    const saved = localStorage.getItem("mactrax_catalog");
    return saved ? JSON.parse(saved) : [
      { id: 1, name: "Chicken Breast",      servingSize: 170, calories: 280, protein: 53, carbs: 0, fat: 6 },
      { id: 2, name: "93/7 Ground Turkey",  servingSize: 112, calories: 160, protein: 22, carbs: 0, fat: 7 },
      { id: 3, name: "Albacore Tuna (can)", servingSize: 198, calories: 220, protein: 40, carbs: 0, fat: 5 },
      { id: 4, name: "Egg (large)",          servingSize: 50,  calories: 70,  protein: 6,  carbs: 0, fat: 5 },
      { id: 5, name: "Pork Tenderloin",     servingSize: 170, calories: 260, protein: 48, carbs: 0, fat: 6 },
      { id: 6, name: "Eye of Round Steak",  servingSize: 170, calories: 240, protein: 44, carbs: 0, fat: 7 },
      { id: 7, name: "80/20 Ground Beef",   servingSize: 112, calories: 290, protein: 19, carbs: 0, fat: 23 },
    ];
  } catch { return []; }
});
  const [log, setLog] = useState(() => {
  try {
    const saved = localStorage.getItem("mactrax_log_" + TODAY_KEY());
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
});
  const [view,             setView]             = useState("dashboard");
  const [logForm,          setLogForm]          = useState({ foodId: "", oz: "" });
  const [scanning,         setScanning]         = useState(false);
  const [scanError,        setScanError]        = useState("");
  const [pendingFood,      setPendingFood]      = useState(null);
  const [editTargets,      setEditTargets]      = useState(false);
  const [tempTargets,      setTempTargets]      = useState(targets);
  const [mealDesc,         setMealDesc]         = useState("");
  const [estimating,       setEstimating]       = useState(false);
  const [estimateError,    setEstimateError]    = useState("");
  const [pendingEstimate,  setPendingEstimate]  = useState(null);

  const totals = log.reduce((acc, entry) => {
    if (entry.type === "estimate") {
      return { calories: acc.calories+entry.calories, protein: acc.protein+entry.protein, carbs: acc.carbs+entry.carbs, fat: acc.fat+entry.fat };
    }
    const food = foods.find((f) => f.id === entry.foodId);
    if (!food) return acc;
    const ratio = (entry.oz * 28.3495) / food.servingSize;
    return { calories: acc.calories+food.calories*ratio, protein: acc.protein+food.protein*ratio, carbs: acc.carbs+food.carbs*ratio, fat: acc.fat+food.fat*ratio };
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

  // Save totals to history whenever log changes
useEffect(() => {
  if (log.length > 0) saveDayToStorage(TODAY_KEY(), totals, targets);
}, [log]);

// Save full meal log to localStorage
useEffect(() => {
  try {
    localStorage.setItem("mactrax_log_" + TODAY_KEY(), JSON.stringify(log));
  } catch {}
}, [log]);

// Save catalog whenever it changes
useEffect(() => {
  try {
    localStorage.setItem("mactrax_catalog", JSON.stringify(foods));
  } catch {}
}, [foods]);

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
    { id: "dashboard", label: "Today"   },
    { id: "log",       label: "Log"     },
    { id: "history",   label: "History" },
    { id: "catalog",   label: "Catalog" },
  ];

  return (
    <div style={{
      minHeight: "100dvh",
      background: T.bg,
      color: T.text,
      fontFamily: FONT_BODY,
      width: "100%",
      paddingBottom: "env(safe-area-inset-bottom, 16px)",

    }}>

      {/* ── Header ── */}
      <div style={{
        background: T.surface,
        borderBottom: `1px solid ${T.border}`,
        padding: "14px 20px 0",
        position: "sticky", top: 0, zIndex: 50,
        boxShadow: T.shadow,
        paddingTop: "max(14px, env(safe-area-inset-top))", // respect notch
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 32, letterSpacing: "0.06em", color: T.text, lineHeight: 1 }}>MAC</span>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 32, letterSpacing: "0.06em", color: T.accent, lineHeight: 1 }}>TRAX</span>
          </div>
          <button
            onClick={() => { setEditTargets(true); setTempTargets(targets); }}
            style={{ background: T.border, border: "none", color: T.text, fontSize: 13, fontWeight: 600, padding: "9px 16px", borderRadius: 10, cursor: "pointer", fontFamily: FONT_BODY, minHeight: 44 }}
          >
            Targets
          </button>
        </div>

        {/* Nav tabs */}
        <div style={{ display: "flex", marginBottom: -1 }}>
          {navTabs.map(({ id, label }) => (
            <button key={id} onClick={() => setView(id)} style={{
              flex: 1, background: "transparent", border: "none",
              borderBottom: `2px solid ${view === id ? T.accent : "transparent"}`,
              color: view === id ? T.accent : T.muted,
              fontFamily: FONT_BODY, fontSize: 13, fontWeight: view === id ? 700 : 500,
              padding: "10px 0 12px", cursor: "pointer", transition: "all 0.15s",
              minHeight: 44,
            }}>{label}</button>
          ))}
        </div>
      </div>

      {/* ── Page content ── */}
      <div style={{ padding: "16px 14px" }}>

        {/* Targets modal */}
        {editTargets && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "0 0 env(safe-area-inset-bottom, 0)" }}>
            <div style={{ background: T.surface, borderRadius: "20px 20px 0 0", padding: "24px 20px 32px", width: "100%", maxWidth: 480, boxShadow: T.shadowMd }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 24, letterSpacing: "0.04em", marginBottom: 20 }}>Daily Targets</div>
              {["calories","protein","carbs","fat"].map((k) => (
                <div key={k} style={{ marginBottom: 16 }}>
                  <SectionLabel>{k}</SectionLabel>
                  <input type="number" value={tempTargets[k]}
                    onChange={(e) => setTempTargets((t) => ({ ...t, [k]: parseFloat(e.target.value) || 0 }))}
                    style={inputStyle} />
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

          <RecommendationCard totals={totals} targets={targets} foods={foods} logCount={log.length} />

          {log.length === 0
            ? <div style={{ textAlign: "center", color: T.faint, fontSize: 14, padding: "32px 0", fontFamily: FONT_BODY }}>No meals logged today</div>
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
                        <div style={{ flex: 1, paddingRight: 12 }}>
                          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 5 }}>{name}</div>
                          {entry.type === "estimate"
                            ? <span style={{ fontSize: 11, background: T.yellowBg, color: T.yellow, padding: "3px 8px", borderRadius: 4, fontWeight: 600, fontFamily: FONT_BODY }}>AI estimate · {entry.confidence} confidence</span>
                            : <span style={{ fontSize: 13, color: T.muted, fontFamily: FONT_BODY }}>{entry.oz} oz</span>
                          }
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 11, color: T.faint, fontFamily: FONT_BODY }}>{entry.time}</span>
                          <button onClick={() => setLog((l) => l.filter((e) => e.id !== entry.id))}
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

        {/* ── LOG ── */}
        {view === "log" && <>
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

          <Card>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4, fontFamily: FONT_BODY }}>Log by weight</div>
            <div style={{ fontSize: 13, color: T.muted, marginBottom: 16, lineHeight: 1.5, fontFamily: FONT_BODY }}>For catalog foods you weighed out.</div>
            <div style={{ marginBottom: 14 }}>
              <SectionLabel>Food</SectionLabel>
              <select value={logForm.foodId} onChange={(e) => setLogForm((f) => ({ ...f, foodId: e.target.value }))} style={inputStyle}>
                <option value="">Select a food…</option>
                {foods.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 14 }}>
              <SectionLabel>Amount (oz)</SectionLabel>
              <input type="number" step="0.1" placeholder="e.g. 6" value={logForm.oz}
                onChange={(e) => setLogForm((f) => ({ ...f, oz: e.target.value }))} style={inputStyle} />
            </div>
            {logForm.foodId && logForm.oz && !isNaN(parseFloat(logForm.oz)) && (() => {
              const food = foods.find((f) => f.id === parseInt(logForm.foodId));
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
        </>}

        {/* ── HISTORY ── */}
        {view === "history" && <CalendarView targets={targets} />}

        {/* ── CATALOG ── */}
        {view === "catalog" && <>
          <Card>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4, fontFamily: FONT_BODY }}>Scan a nutrition label</div>
            <div style={{ fontSize: 13, color: T.muted, marginBottom: 14, lineHeight: 1.5, fontFamily: FONT_BODY }}>Upload a photo and MACTRAX adds it to your catalog automatically.</div>
            <UploadZone onFile={handleScan} loading={scanning} />
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

      </div>
    </div>
  );
}