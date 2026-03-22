import { useState, useRef, useCallback } from "react";

const DAILY_TARGETS = { calories: 2200, protein: 165, carbs: 200, fat: 70 };

const ACCENT = "#C8F135";
const BG = "#0D0D0D";
const SURFACE = "#161616";
const BORDER = "#2A2A2A";
const MUTED = "#555";
const TEXT = "#E8E8E8";

const style = (obj) => obj;

function toBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = () => rej(new Error("Read failed"));
    r.readAsDataURL(file);
  });
}

async function parseNutritionLabel(imageBase64, mediaType) {
  const response = await fetch("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: imageBase64 },
            },
            {
              type: "text",
              text: `Extract the nutrition facts from this label. Return ONLY a JSON object with NO markdown, NO backticks, NO preamble. The JSON must have these exact keys:
{
  "name": "food name if visible, else 'Unnamed Food'",
  "servingSize": number (in grams, convert if needed),
  "calories": number (per serving),
  "protein": number (grams per serving),
  "carbs": number (grams per serving, total carbohydrates),
  "fat": number (grams per serving, total fat)
}
If a value is not found, use 0. Return only the JSON object.`,
            },
          ],
        },
      ],
    }),
  });
  const data = await response.json();
  const text = data.content?.find((b) => b.type === "text")?.text || "{}";
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

function MacroBar({ label, current, target, color }) {
  const pct = Math.min((current / target) * 100, 100);
  const over = current > target;
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 11, letterSpacing: 2, color: MUTED, textTransform: "uppercase" }}>{label}</span>
        <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
          <span style={{ fontFamily: "'Courier New', monospace", fontSize: 22, fontWeight: 700, color: over ? "#FF4444" : TEXT }}>{Math.round(current)}</span>
          <span style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: MUTED }}>/ {target}{label === "Calories" ? "" : "g"}</span>
          <span style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: over ? "#FF4444" : ACCENT }}>
            {over ? `+${Math.round(current - target)} over` : `${Math.round(target - current)} left`}
          </span>
        </div>
      </div>
      <div style={{ height: 4, background: BORDER, borderRadius: 2, overflow: "hidden" }}>
        <div style={{
          height: "100%",
          width: `${pct}%`,
          background: over ? "#FF4444" : color,
          borderRadius: 2,
          transition: "width 0.4s cubic-bezier(0.4,0,0.2,1)"
        }} />
      </div>
    </div>
  );
}

function UploadZone({ onFile, loading }) {
  const inputRef = useRef();
  const [drag, setDrag] = useState(false);

  const handle = async (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    onFile(file);
  };

  return (
    <div
      onClick={() => inputRef.current.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files[0]); }}
      style={{
        border: `1.5px dashed ${drag ? ACCENT : BORDER}`,
        borderRadius: 8,
        padding: "28px 20px",
        textAlign: "center",
        cursor: "pointer",
        transition: "border-color 0.2s",
        background: drag ? "#1A1F0A" : "transparent",
      }}
    >
      <input ref={inputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handle(e.target.files[0])} />
      {loading ? (
        <div style={{ color: ACCENT, fontFamily: "'Courier New', monospace", fontSize: 12, letterSpacing: 2 }}>SCANNING LABEL...</div>
      ) : (
        <>
          <div style={{ fontSize: 24, marginBottom: 8 }}>📷</div>
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 11, letterSpacing: 2, color: MUTED }}>DROP NUTRITION LABEL IMAGE</div>
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: "#333", marginTop: 4 }}>OR CLICK TO BROWSE</div>
        </>
      )}
    </div>
  );
}

export default function MacroTracker() {
  const [targets, setTargets] = useState(DAILY_TARGETS);
  const [foods, setFoods] = useState([
    { id: 1, name: "Chicken Breast", servingSize: 170, calories: 280, protein: 53, carbs: 0, fat: 6 },
    { id: 2, name: "93/7 Ground Turkey", servingSize: 112, calories: 160, protein: 22, carbs: 0, fat: 7 },
    { id: 3, name: "Albacore Tuna (can)", servingSize: 198, calories: 220, protein: 40, carbs: 0, fat: 5 },
    { id: 4, name: "Egg (large)", servingSize: 50, calories: 70, protein: 6, carbs: 0, fat: 5 },
    { id: 5, name: "Pork Tenderloin", servingSize: 170, calories: 260, protein: 48, carbs: 0, fat: 6 },
  ]);
  const [log, setLog] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [pendingFood, setPendingFood] = useState(null);
  const [view, setView] = useState("dashboard"); // dashboard | catalog | log
  const [logForm, setLogForm] = useState({ foodId: "", oz: "" });
  const [editTargets, setEditTargets] = useState(false);
  const [tempTargets, setTempTargets] = useState(targets);

  const totals = log.reduce(
    (acc, entry) => {
      const food = foods.find((f) => f.id === entry.foodId);
      if (!food) return acc;
      const gramsPerOz = 28.3495;
      const grams = entry.oz * gramsPerOz;
      const ratio = grams / food.servingSize;
      return {
        calories: acc.calories + food.calories * ratio,
        protein: acc.protein + food.protein * ratio,
        carbs: acc.carbs + food.carbs * ratio,
        fat: acc.fat + food.fat * ratio,
      };
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  const handleScan = async (file) => {
    setScanning(true);
    setScanError("");
    try {
      const b64 = await toBase64(file);
      const result = await parseNutritionLabel(b64, file.type);
      setPendingFood({ ...result, id: Date.now() });
    } catch (e) {
      setScanError("Couldn't read that label. Try a clearer image.");
    }
    setScanning(false);
  };

  const addPending = () => {
    if (!pendingFood) return;
    setFoods((f) => [...f, pendingFood]);
    setPendingFood(null);
  };

  const addLog = () => {
    if (!logForm.foodId || !logForm.oz || isNaN(parseFloat(logForm.oz))) return;
    setLog((l) => [...l, { id: Date.now(), foodId: parseInt(logForm.foodId), oz: parseFloat(logForm.oz), time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }]);
    setLogForm({ foodId: "", oz: "" });
  };

  const removeLog = (id) => setLog((l) => l.filter((e) => e.id !== id));

  const macroBarProps = [
    { label: "Calories", current: totals.calories, target: targets.calories, color: "#FFD166" },
    { label: "Protein", current: totals.protein, target: targets.protein, color: ACCENT },
    { label: "Carbs", current: totals.carbs, target: targets.carbs, color: "#06D6A0" },
    { label: "Fat", current: totals.fat, target: targets.fat, color: "#FF6B6B" },
  ];

  const navBtn = (id, label) => (
    <button
      onClick={() => setView(id)}
      style={{
        background: view === id ? ACCENT : "transparent",
        color: view === id ? BG : MUTED,
        border: "none",
        fontFamily: "'Courier New', monospace",
        fontSize: 10,
        letterSpacing: 2,
        padding: "8px 14px",
        cursor: "pointer",
        borderRadius: 4,
        fontWeight: view === id ? 700 : 400,
        transition: "all 0.15s",
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ minHeight: "100vh", background: BG, color: TEXT, fontFamily: "Georgia, serif", padding: "0 0 60px" }}>
      {/* Header */}
      <div style={{ borderBottom: `1px solid ${BORDER}`, padding: "20px 24px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, letterSpacing: 4, color: MUTED, marginBottom: 2 }}>DAILY MACRO TRACKER</div>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.5 }}>
              <span style={{ color: ACCENT }}>M</span>ACROS
            </div>
          </div>
          <button
            onClick={() => { setEditTargets(true); setTempTargets(targets); }}
            style={{ background: "transparent", border: `1px solid ${BORDER}`, color: MUTED, fontFamily: "'Courier New', monospace", fontSize: 9, letterSpacing: 2, padding: "6px 12px", cursor: "pointer", borderRadius: 4 }}
          >
            EDIT TARGETS
          </button>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {navBtn("dashboard", "DASHBOARD")}
          {navBtn("log", "LOG MEAL")}
          {navBtn("catalog", "CATALOG")}
        </div>
      </div>

      <div style={{ padding: "24px 24px 0" }}>

        {/* Edit Targets Modal */}
        {editTargets && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 28, width: 320 }}>
              <div style={{ fontFamily: "'Courier New', monospace", fontSize: 11, letterSpacing: 3, color: MUTED, marginBottom: 20 }}>DAILY TARGETS</div>
              {["calories", "protein", "carbs", "fat"].map((k) => (
                <div key={k} style={{ marginBottom: 14 }}>
                  <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, letterSpacing: 2, color: MUTED, marginBottom: 5, textTransform: "uppercase" }}>{k}</div>
                  <input
                    type="number"
                    value={tempTargets[k]}
                    onChange={(e) => setTempTargets((t) => ({ ...t, [k]: parseFloat(e.target.value) || 0 }))}
                    style={{ width: "100%", background: BG, border: `1px solid ${BORDER}`, color: TEXT, fontFamily: "'Courier New', monospace", fontSize: 16, padding: "8px 12px", borderRadius: 6, boxSizing: "border-box" }}
                  />
                </div>
              ))}
              <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                <button onClick={() => { setTargets(tempTargets); setEditTargets(false); }} style={{ flex: 1, background: ACCENT, color: BG, border: "none", fontFamily: "'Courier New', monospace", fontSize: 11, letterSpacing: 2, padding: "10px 0", borderRadius: 6, cursor: "pointer", fontWeight: 700 }}>SAVE</button>
                <button onClick={() => setEditTargets(false)} style={{ flex: 1, background: "transparent", color: MUTED, border: `1px solid ${BORDER}`, fontFamily: "'Courier New', monospace", fontSize: 11, letterSpacing: 2, padding: "10px 0", borderRadius: 6, cursor: "pointer" }}>CANCEL</button>
              </div>
            </div>
          </div>
        )}

        {/* Dashboard */}
        {view === "dashboard" && (
          <div>
            <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "20px 20px 8px", marginBottom: 20 }}>
              {macroBarProps.map((p) => <MacroBar key={p.label} {...p} />)}
            </div>
            {log.length === 0 ? (
              <div style={{ textAlign: "center", color: MUTED, fontFamily: "'Courier New', monospace", fontSize: 11, letterSpacing: 2, padding: "40px 0" }}>NO MEALS LOGGED TODAY</div>
            ) : (
              <div>
                <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, letterSpacing: 3, color: MUTED, marginBottom: 12 }}>TODAY'S MEALS</div>
                {log.map((entry) => {
                  const food = foods.find((f) => f.id === entry.foodId);
                  if (!food) return null;
                  const grams = entry.oz * 28.3495;
                  const ratio = grams / food.servingSize;
                  return (
                    <div key={entry.id} style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "12px 14px", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: 14, marginBottom: 4 }}>{food.name}</div>
                        <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: MUTED }}>
                          {entry.oz} oz · {Math.round(food.calories * ratio)} cal · {Math.round(food.protein * ratio)}g P · {Math.round(food.carbs * ratio)}g C · {Math.round(food.fat * ratio)}g F
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: MUTED }}>{entry.time}</span>
                        <button onClick={() => removeLog(entry.id)} style={{ background: "transparent", border: "none", color: "#555", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Log Meal */}
        {view === "log" && (
          <div>
            <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 20, marginBottom: 20 }}>
              <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, letterSpacing: 3, color: MUTED, marginBottom: 16 }}>LOG A MEAL</div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, letterSpacing: 2, color: MUTED, marginBottom: 6 }}>FOOD</div>
                <select
                  value={logForm.foodId}
                  onChange={(e) => setLogForm((f) => ({ ...f, foodId: e.target.value }))}
                  style={{ width: "100%", background: BG, border: `1px solid ${BORDER}`, color: TEXT, fontFamily: "Georgia, serif", fontSize: 15, padding: "10px 12px", borderRadius: 6, boxSizing: "border-box", appearance: "none" }}
                >
                  <option value="">Select a food...</option>
                  {foods.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, letterSpacing: 2, color: MUTED, marginBottom: 6 }}>AMOUNT (OZ)</div>
                <input
                  type="number"
                  step="0.1"
                  placeholder="e.g. 6"
                  value={logForm.oz}
                  onChange={(e) => setLogForm((f) => ({ ...f, oz: e.target.value }))}
                  style={{ width: "100%", background: BG, border: `1px solid ${BORDER}`, color: TEXT, fontFamily: "'Courier New', monospace", fontSize: 18, padding: "10px 12px", borderRadius: 6, boxSizing: "border-box" }}
                />
              </div>
              {logForm.foodId && logForm.oz && !isNaN(parseFloat(logForm.oz)) && (() => {
                const food = foods.find((f) => f.id === parseInt(logForm.foodId));
                if (!food) return null;
                const ratio = (parseFloat(logForm.oz) * 28.3495) / food.servingSize;
                return (
                  <div style={{ background: "#1A1F0A", border: `1px solid ${ACCENT}22`, borderRadius: 8, padding: "10px 14px", marginBottom: 16, display: "flex", gap: 20 }}>
                    {[["Cal", Math.round(food.calories * ratio)], ["Protein", `${Math.round(food.protein * ratio)}g`], ["Carbs", `${Math.round(food.carbs * ratio)}g`], ["Fat", `${Math.round(food.fat * ratio)}g`]].map(([k, v]) => (
                      <div key={k}>
                        <div style={{ fontFamily: "'Courier New', monospace", fontSize: 9, letterSpacing: 2, color: MUTED }}>{k}</div>
                        <div style={{ fontFamily: "'Courier New', monospace", fontSize: 16, color: ACCENT, fontWeight: 700 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}
              <button
                onClick={addLog}
                style={{ width: "100%", background: ACCENT, color: BG, border: "none", fontFamily: "'Courier New', monospace", fontSize: 11, letterSpacing: 3, padding: "13px 0", borderRadius: 6, cursor: "pointer", fontWeight: 700 }}
              >
                LOG MEAL
              </button>
            </div>
          </div>
        )}

        {/* Catalog */}
        {view === "catalog" && (
          <div>
            {/* Scanner */}
            <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 20, marginBottom: 20 }}>
              <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, letterSpacing: 3, color: MUTED, marginBottom: 14 }}>SCAN NUTRITION LABEL</div>
              <UploadZone onFile={handleScan} loading={scanning} />
              {scanError && <div style={{ color: "#FF4444", fontFamily: "'Courier New', monospace", fontSize: 11, marginTop: 10 }}>{scanError}</div>}
              {pendingFood && (
                <div style={{ marginTop: 16, background: "#1A1F0A", border: `1px solid ${ACCENT}44`, borderRadius: 8, padding: "14px 16px" }}>
                  <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, letterSpacing: 2, color: ACCENT, marginBottom: 12 }}>SCANNED — CONFIRM TO ADD</div>
                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>{pendingFood.name}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px", fontFamily: "'Courier New', monospace", fontSize: 11, color: MUTED }}>
                    {[["Serving", `${pendingFood.servingSize}g`], ["Calories", pendingFood.calories], ["Protein", `${pendingFood.protein}g`], ["Carbs", `${pendingFood.carbs}g`], ["Fat", `${pendingFood.fat}g`]].map(([k, v]) => (
                      <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>{k}</span><span style={{ color: TEXT }}>{v}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                    <button onClick={addPending} style={{ flex: 1, background: ACCENT, color: BG, border: "none", fontFamily: "'Courier New', monospace", fontSize: 10, letterSpacing: 2, padding: "9px 0", borderRadius: 6, cursor: "pointer", fontWeight: 700 }}>ADD TO CATALOG</button>
                    <button onClick={() => setPendingFood(null)} style={{ flex: 1, background: "transparent", border: `1px solid ${BORDER}`, color: MUTED, fontFamily: "'Courier New', monospace", fontSize: 10, letterSpacing: 2, padding: "9px 0", borderRadius: 6, cursor: "pointer" }}>DISCARD</button>
                  </div>
                </div>
              )}
            </div>

            {/* Food list */}
            <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, letterSpacing: 3, color: MUTED, marginBottom: 12 }}>FOOD CATALOG ({foods.length})</div>
            {foods.map((f) => (
              <div key={f.id} style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "14px 16px", marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{f.name}</div>
                  <span style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: MUTED }}>per {f.servingSize}g</span>
                </div>
                <div style={{ display: "flex", gap: 20, fontFamily: "'Courier New', monospace", fontSize: 11 }}>
                  <div><span style={{ color: MUTED }}>Cal </span><span style={{ color: "#FFD166" }}>{f.calories}</span></div>
                  <div><span style={{ color: MUTED }}>P </span><span style={{ color: ACCENT }}>{f.protein}g</span></div>
                  <div><span style={{ color: MUTED }}>C </span><span style={{ color: "#06D6A0" }}>{f.carbs}g</span></div>
                  <div><span style={{ color: MUTED }}>F </span><span style={{ color: "#FF6B6B" }}>{f.fat}g</span></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
