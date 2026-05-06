import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import DRUGS from "./drugs.json";

// Match App.jsx tokens
const GREEN = "rgb(22, 102, 54)";
const GREEN_SOFT = "rgba(22, 102, 54, 0.08)";
const GREEN_BORDER = "rgba(22, 102, 54, 0.25)";
const RED = "rgb(176, 35, 35)";
const RED_SOFT = "rgba(176, 35, 35, 0.08)";
const INK = "#1a1a1a";
const MUTED = "#6b6b6b";
const PAPER = "#fafaf7";
const CARD = "#ffffff";
const RULE = "#e8e6df";

// Schedule colours (kept distinguishable, but shifted away from blue)
const SCHEDULES = [
  { n: 2, label: "CD2", colour: "rgb(22, 102, 54)" },
  { n: 3, label: "CD3", colour: "rgb(75, 130, 90)" },
  { n: 4, label: "CD4", colour: "rgb(133, 79, 11)" },
  { n: 5, label: "CD5", colour: "rgb(120, 80, 140)" }
];

const SCHEDULE_BY_N = Object.fromEntries(SCHEDULES.map(s => [s.n, s]));

const FREQ_COLOUR = {
  high: GREEN,
  mid: "rgb(133, 79, 11)",
  mep: "rgb(120, 80, 140)",
  low: "rgb(136, 135, 128)"
};

const FREQ_LABEL = {
  high: "high freq",
  mid: "mid freq",
  mep: "MEP example",
  low: "low/possible"
};

const RULE_COLS = [
  { label: "CD register", key: "reg",   colour: "rgb(140, 50, 50)",  check: d => d.r },
  { label: "Safe custody", key: "cust", colour: "rgb(22, 102, 54)",  check: d => d.c },
  { label: "Words & figures", key: "wf", colour: "rgb(75, 130, 90)", check: d => d.wf },
  { label: "No register", key: "noreg", colour: "rgb(133, 79, 11)",  check: d => !d.r },
  { label: "No safe custody", key: "nocust", colour: "rgb(120, 80, 140)", check: d => !d.c }
];

function shuffle(a) {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export default function SchedulesView({ stats, onStatsChange }) {
  const [tab, setTab] = useState("game"); // game | reference | quiz

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Drug schedules</h1>
        <div style={styles.tagline}>
          54 drugs, sorted by exam frequency. Drag to the right column.
        </div>
      </div>

      <div style={styles.tabBar}>
        <TabButton active={tab === "game"} onClick={() => setTab("game")}>Game</TabButton>
        <TabButton active={tab === "reference"} onClick={() => setTab("reference")}>Reference</TabButton>
        <TabButton active={tab === "quiz"} onClick={() => setTab("quiz")}>Quick quiz</TabButton>
      </div>

      {tab === "game" && <GameTab stats={stats} onStatsChange={onStatsChange} />}
      {tab === "reference" && <ReferenceTab />}
      {tab === "quiz" && <QuizTab stats={stats} onStatsChange={onStatsChange} />}
    </div>
  );
}

// ============ GAME TAB ============

function GameTab({ stats, onStatsChange }) {
  const [mode, setMode] = useState("schedule"); // schedule | rules
  const [activeSchedules, setActiveSchedules] = useState(new Set([2, 3, 4, 5]));
  const [activeFreqs, setActiveFreqs] = useState(new Set(["high", "mid", "mep", "low"]));
  const [poolDrugs, setPoolDrugs] = useState([]);     // names still in pool
  const [placedDrugs, setPlacedDrugs] = useState({}); // {drugName: columnKey}
  const [checked, setChecked] = useState(false);
  const [score, setScore] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [resultMsg, setResultMsg] = useState(null);
  const [infoDrug, setInfoDrug] = useState(null);

  const filtered = useMemo(
    () => DRUGS.filter(d => activeSchedules.has(d.s) && activeFreqs.has(d.f)),
    [activeSchedules, activeFreqs]
  );

  // Timer
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  // Deal 12 random cards on first load and whenever filters change
  const dealRound = useCallback((all = false) => {
    const drugs = all ? shuffle(filtered) : shuffle(filtered).slice(0, 12);
    setPoolDrugs(drugs.map(d => d.n));
    setPlacedDrugs({});
    setChecked(false);
    setScore(0);
    setElapsed(0);
    setRunning(false);
    setResultMsg(null);
    setInfoDrug(null);
  }, [filtered]);

  useEffect(() => { dealRound(false); }, [dealRound]);

  const toggleSchedule = (n) => {
    setActiveSchedules(prev => {
      const next = new Set(prev);
      if (next.has(n)) {
        if (next.size > 1) next.delete(n);
      } else {
        next.add(n);
      }
      return next;
    });
  };

  const toggleFreq = (f) => {
    setActiveFreqs(prev => {
      const next = new Set(prev);
      if (next.has(f)) {
        if (next.size > 1) next.delete(f);
      } else {
        next.add(f);
      }
      return next;
    });
  };

  const handleDrop = (drugName, columnKey) => {
    if (!running) setRunning(true);
    setPoolDrugs(prev => prev.filter(n => n !== drugName));
    setPlacedDrugs(prev => ({ ...prev, [drugName]: columnKey }));
    setChecked(false);
    setResultMsg(null);
  };

  // Allow re-dragging a placed card back to pool or to another column
  const handleReturnToPool = (drugName) => {
    setPoolDrugs(prev => prev.includes(drugName) ? prev : [...prev, drugName]);
    setPlacedDrugs(prev => {
      const next = { ...prev };
      delete next[drugName];
      return next;
    });
    setChecked(false);
    setResultMsg(null);
  };

  const checkAnswers = () => {
    let correct = 0;
    let total = 0;
    Object.entries(placedDrugs).forEach(([name, colKey]) => {
      const drug = DRUGS.find(d => d.n === name);
      if (!drug) return;
      total++;
      const isRight = mode === "schedule"
        ? drug.s === Number(colKey)
        : (RULE_COLS.find(c => c.key === colKey) || { check: () => false }).check(drug);
      if (isRight) correct++;
    });
    setScore(correct);
    setChecked(true);
    setRunning(false);

    const totalCards = poolDrugs.length + Object.keys(placedDrugs).length;
    if (correct === totalCards && total === totalCards && total > 0) {
      setResultMsg({ kind: "win", text: `All ${correct} correct in ${elapsed}s.` });
      // Build new stats: bump rounds, possibly update best
      const key = mode === "schedule" ? "scheduleBest" : "rulesBest";
      const best = stats[key];
      const newStats = {
        ...stats,
        roundsCompleted: (stats.roundsCompleted || 0) + 1
      };
      if (!best || elapsed < best.time || (elapsed === best.time && total > best.cards)) {
        newStats[key] = { time: elapsed, cards: total, ts: Date.now() };
      }
      onStatsChange(newStats);
    } else {
      setResultMsg({ kind: "part", text: `${correct}/${total} correct. Red cards are wrong — move them and recheck.` });
    }
  };

  const columns = mode === "schedule"
    ? SCHEDULES.map(s => ({ label: s.label, key: String(s.n), colour: s.colour }))
    : RULE_COLS;

  const inPoolCount = poolDrugs.length;
  const placedCount = Object.keys(placedDrugs).length;
  const totalCards = inPoolCount + placedCount;

  return (
    <div>
      {/* Stats row */}
      <div style={styles.statsRow}>
        <Stat label="score" value={score} />
        <Stat label="time" value={`${elapsed}s`} />
        <Stat label="placed" value={`${placedCount}/${totalCards}`} />
        <Stat label="filtered" value={filtered.length} />
        {stats.scheduleBest && mode === "schedule" && (
          <Stat label="best" value={`${stats.scheduleBest.time}s`} small />
        )}
        {stats.rulesBest && mode === "rules" && (
          <Stat label="best" value={`${stats.rulesBest.time}s`} small />
        )}
      </div>

      {/* Mode toggle */}
      <div style={styles.modeRow}>
        <ModeButton active={mode === "schedule"} onClick={() => setMode("schedule")}>
          By schedule (CD2–CD5)
        </ModeButton>
        <ModeButton active={mode === "rules"} onClick={() => setMode("rules")}>
          By legal rules
        </ModeButton>
      </div>

      {/* Filters */}
      <div style={styles.filterRow}>
        <span style={styles.filterLabel}>Schedule</span>
        {SCHEDULES.map(s => (
          <FilterChip
            key={s.n}
            active={activeSchedules.has(s.n)}
            colour={s.colour}
            onClick={() => toggleSchedule(s.n)}
          >
            {s.label}
          </FilterChip>
        ))}
      </div>
      <div style={styles.filterRow}>
        <span style={styles.filterLabel}>Frequency</span>
        {Object.entries(FREQ_LABEL).map(([f, label]) => (
          <FilterChip
            key={f}
            active={activeFreqs.has(f)}
            colour={FREQ_COLOUR[f]}
            onClick={() => toggleFreq(f)}
          >
            {f === "mep" ? "MEP" : f}
          </FilterChip>
        ))}
      </div>

      {/* Pool */}
      <div style={styles.poolLabel}>Drag cards into the columns below</div>
      <DropZone onDrop={handleReturnToPool} style={styles.pool}>
        {poolDrugs.length === 0 ? (
          <div style={styles.emptyPool}>Pool is empty. Drag back here to remove from a column.</div>
        ) : (
          poolDrugs.map(name => {
            const drug = DRUGS.find(d => d.n === name);
            if (!drug) return null;
            return (
              <DraggableCard
                key={name}
                drug={drug}
                onTap={() => setInfoDrug(drug)}
                state={null}
              />
            );
          })
        )}
      </DropZone>

      {/* Columns */}
      <div style={mode === "schedule" ? styles.gridSchedule : styles.gridRules}>
        {columns.map(col => (
          <ColumnHeader key={`h-${col.key}`} colour={col.colour}>{col.label}</ColumnHeader>
        ))}
        {columns.map(col => {
          const cardsInCol = Object.entries(placedDrugs)
            .filter(([_, ck]) => ck === col.key)
            .map(([n]) => DRUGS.find(d => d.n === n))
            .filter(Boolean);
          return (
            <DropZone
              key={`z-${col.key}`}
              onDrop={(name) => handleDrop(name, col.key)}
              style={{ ...styles.dropzone, borderColor: col.colour }}
            >
              {cardsInCol.map(drug => {
                let cardState = null;
                if (checked) {
                  const right = mode === "schedule"
                    ? drug.s === Number(col.key)
                    : (RULE_COLS.find(c => c.key === col.key) || { check: () => false }).check(drug);
                  cardState = right ? "correct" : "wrong";
                }
                return (
                  <DraggableCard
                    key={drug.n}
                    drug={drug}
                    onTap={() => setInfoDrug(drug)}
                    state={cardState}
                  />
                );
              })}
            </DropZone>
          );
        })}
      </div>

      {/* Result message */}
      {resultMsg && (
        <div style={resultMsg.kind === "win" ? styles.winMsg : styles.partMsg}>
          {resultMsg.text}
        </div>
      )}

      {/* Action buttons */}
      <div style={styles.actionRow}>
        <button onClick={checkAnswers} style={styles.primaryBtn} disabled={placedCount === 0}>
          Check answers
        </button>
        <button onClick={() => dealRound(false)} style={styles.secondaryBtn}>
          New round (12)
        </button>
        <button onClick={() => dealRound(true)} style={styles.secondaryBtn}>
          Deal all filtered
        </button>
      </div>

      {/* Info panel */}
      {infoDrug && <InfoPanel drug={infoDrug} onClose={() => setInfoDrug(null)} />}
    </div>
  );
}

// ============ DRAGGABLE CARD (with mobile touch fallback) ============

function DraggableCard({ drug, onTap, state }) {
  const cardRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const touchData = useRef({ moved: false, ghost: null, startX: 0, startY: 0 });

  // HTML5 DnD (desktop)
  const handleDragStart = (e) => {
    e.dataTransfer.setData("drug", drug.n);
    e.dataTransfer.effectAllowed = "move";
    setIsDragging(true);
  };
  const handleDragEnd = () => setIsDragging(false);

  // Touch fallback (mobile)
  const handleTouchStart = (e) => {
    const t = e.touches[0];
    touchData.current.moved = false;
    touchData.current.startX = t.clientX;
    touchData.current.startY = t.clientY;
  };

  const handleTouchMove = (e) => {
    const t = e.touches[0];
    const dx = Math.abs(t.clientX - touchData.current.startX);
    const dy = Math.abs(t.clientY - touchData.current.startY);
    if (!touchData.current.moved && (dx > 6 || dy > 6)) {
      touchData.current.moved = true;
      // Create ghost
      const rect = cardRef.current.getBoundingClientRect();
      const ghost = cardRef.current.cloneNode(true);
      ghost.style.position = "fixed";
      ghost.style.pointerEvents = "none";
      ghost.style.opacity = "0.85";
      ghost.style.zIndex = "9999";
      ghost.style.left = `${rect.left}px`;
      ghost.style.top = `${rect.top}px`;
      ghost.style.transform = "scale(1.05)";
      ghost.style.boxShadow = "0 8px 18px rgba(0,0,0,0.18)";
      document.body.appendChild(ghost);
      touchData.current.ghost = ghost;
      setIsDragging(true);
      // Prevent scroll while dragging
      document.body.style.touchAction = "none";
    }
    if (touchData.current.ghost) {
      e.preventDefault();
      const rect = cardRef.current.getBoundingClientRect();
      const offsetX = touchData.current.startX - rect.left;
      const offsetY = touchData.current.startY - rect.top;
      touchData.current.ghost.style.left = `${t.clientX - offsetX}px`;
      touchData.current.ghost.style.top = `${t.clientY - offsetY}px`;
    }
  };

  const handleTouchEnd = (e) => {
    document.body.style.touchAction = "";
    if (touchData.current.ghost) {
      touchData.current.ghost.remove();
      touchData.current.ghost = null;
      setIsDragging(false);
      // Find the drop target under the touch point
      const t = e.changedTouches[0];
      const target = document.elementFromPoint(t.clientX, t.clientY);
      const dropZone = target ? target.closest("[data-dropzone]") : null;
      if (dropZone) {
        // Fire a synthetic drop event
        const customEvent = new CustomEvent("touchdrop", {
          detail: { drug: drug.n },
          bubbles: true
        });
        dropZone.dispatchEvent(customEvent);
      }
    }
    if (!touchData.current.moved) {
      // Pure tap
      onTap();
    }
  };

  let bg = CARD;
  let border = RULE;
  let colour = INK;
  if (state === "correct") {
    bg = "rgba(22, 102, 54, 0.1)";
    border = GREEN;
    colour = GREEN;
  } else if (state === "wrong") {
    bg = RED_SOFT;
    border = RED;
    colour = RED;
  }

  return (
    <div
      ref={cardRef}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClick={(e) => {
        // Only trigger tap if we didn't drag
        if (!touchData.current.moved) onTap();
      }}
      style={{
        ...styles.card,
        backgroundColor: bg,
        borderColor: border,
        color: colour,
        opacity: isDragging ? 0.4 : 1,
        cursor: "grab"
      }}
    >
      <span>{drug.n}</span>
      <span style={{ ...styles.freqDot, backgroundColor: FREQ_COLOUR[drug.f] }} />
    </div>
  );
}

// ============ DROPZONE ============

function DropZone({ children, onDrop, style }) {
  const [over, setOver] = useState(false);
  const ref = useRef(null);

  // Listen for synthetic touch drop events
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e) => {
      onDrop(e.detail.drug);
    };
    el.addEventListener("touchdrop", handler);
    return () => el.removeEventListener("touchdrop", handler);
  }, [onDrop]);

  return (
    <div
      ref={ref}
      data-dropzone="true"
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const drugName = e.dataTransfer.getData("drug");
        if (drugName) onDrop(drugName);
      }}
      style={{
        ...style,
        backgroundColor: over ? GREEN_SOFT : style.backgroundColor || "transparent"
      }}
    >
      {children}
    </div>
  );
}

// ============ INFO PANEL ============

function InfoPanel({ drug, onClose }) {
  const sched = SCHEDULE_BY_N[drug.s];
  return (
    <div style={styles.infoPanel}>
      <div style={styles.infoHeader}>
        <div style={styles.infoTitle}>
          {drug.n}
          <span style={{ ...styles.miniBadge, backgroundColor: sched ? sched.colour : MUTED }}>
            CD{drug.s}
          </span>
          <span style={{ ...styles.miniBadge, backgroundColor: FREQ_COLOUR[drug.f] }}>
            {FREQ_LABEL[drug.f]}
          </span>
        </div>
        <button onClick={onClose} style={styles.infoCloseBtn}>×</button>
      </div>
      <div style={styles.infoRow}>
        Register
        <Badge yes={drug.r}>{drug.r ? "Required" : "Not required"}</Badge>
      </div>
      <div style={styles.infoRow}>
        Safe custody
        <Badge yes={drug.c}>{drug.c ? "Required" : "Not required"}</Badge>
      </div>
      <div style={styles.infoRow}>
        Words & figures
        <Badge yes={drug.wf}>{drug.wf ? "Required" : "Not required"}</Badge>
      </div>
      <div style={styles.infoRow}>
        Witnessed destruction (stock)
        <Badge yes={drug.w}>{drug.w ? "Required" : "Not required"}</Badge>
      </div>
      <div style={styles.infoNote}>{drug.note}</div>
    </div>
  );
}

// ============ REFERENCE TAB ============

function ReferenceTab() {
  const sortedDrugs = useMemo(
    () => [...DRUGS].sort((a, b) => a.s - b.s || a.n.localeCompare(b.n)),
    []
  );

  return (
    <div style={styles.refWrap}>
      <div style={styles.refTableScroll}>
        <table style={styles.refTable}>
          <thead>
            <tr>
              <th style={styles.refTh}>Drug</th>
              <th style={styles.refTh}>Sched</th>
              <th style={styles.refTh}>Freq</th>
              <th style={styles.refTh}>Reg</th>
              <th style={styles.refTh}>Custody</th>
              <th style={styles.refTh}>W&F</th>
              <th style={styles.refTh}>Wit dest</th>
              <th style={styles.refTh}>Note</th>
            </tr>
          </thead>
          <tbody>
            {sortedDrugs.map(d => {
              const sched = SCHEDULE_BY_N[d.s];
              return (
                <tr key={d.n}>
                  <td style={styles.refTd}>{d.n}</td>
                  <td style={styles.refTd}>
                    <span style={{ ...styles.miniBadge, backgroundColor: sched ? sched.colour : MUTED }}>
                      CD{d.s}
                    </span>
                  </td>
                  <td style={styles.refTd}>
                    <span style={{ ...styles.miniBadge, backgroundColor: FREQ_COLOUR[d.f] }}>
                      {d.f}
                    </span>
                  </td>
                  <td style={styles.refTd}><Badge yes={d.r}>{d.r ? "Yes" : "No"}</Badge></td>
                  <td style={styles.refTd}><Badge yes={d.c}>{d.c ? "Yes" : "No"}</Badge></td>
                  <td style={styles.refTd}><Badge yes={d.wf}>{d.wf ? "Yes" : "No"}</Badge></td>
                  <td style={styles.refTd}><Badge yes={d.w}>{d.w ? "Yes" : "No"}</Badge></td>
                  <td style={{ ...styles.refTd, ...styles.refNote }}>{d.note}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============ QUIZ TAB ============

function QuizTab({ stats, onStatsChange }) {
  const [questions, setQuestions] = useState([]);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState(null);
  const [score, setScore] = useState(0);
  const [total, setTotal] = useState(0);

  const buildQuestions = () => {
    const qs = [];
    DRUGS.forEach(d => {
      // Schedule question
      const otherSchedules = ["CD2", "CD3", "CD4", "CD5"].filter(x => x !== `CD${d.s}`);
      qs.push({
        q: `Which schedule is ${d.n} in?`,
        ans: `CD${d.s}`,
        opts: shuffle([`CD${d.s}`, ...otherSchedules]).slice(0, 4),
        d
      });
      // Yes/no rule questions for CD2/3
      if (d.s <= 3) {
        qs.push({
          q: `Does ${d.n} require a CD register entry when dispensed?`,
          ans: d.r ? "Yes" : "No",
          opts: ["Yes", "No"],
          d
        });
        qs.push({
          q: `Does ${d.n} require safe custody?`,
          ans: d.c ? "Yes" : "No",
          opts: ["Yes", "No"],
          d
        });
        if (d.s === 3) {
          qs.push({
            q: `Does ${d.n} require quantity in words and figures?`,
            ans: d.wf ? "Yes" : "No",
            opts: ["Yes", "No"],
            d
          });
        }
      }
      // Specific gotchas
      if (d.n === "Quinalbarbitone") {
        qs.push({
          q: "Quinalbarbitone is CD2. Does it require safe custody?",
          ans: "No",
          opts: ["Yes", "No"],
          d
        });
      }
      if (d.n === "Sativex") {
        qs.push({
          q: "Sativex (cannabis oromucosal spray) is in which schedule?",
          ans: "CD4",
          opts: ["CD1", "CD2", "CD3", "CD4"],
          d
        });
      }
      if (d.n === "Oramorph 10mg/5ml") {
        qs.push({
          q: "Oramorph oral solution 10mg/5ml is which schedule?",
          ans: "CD5",
          opts: ["CD2", "CD3", "CD4", "CD5"],
          d
        });
      }
      if (d.n === "Ketamine") {
        qs.push({
          q: "Ketamine was reclassified from CD3 to CD2 in which year?",
          ans: "2014",
          opts: ["2012", "2013", "2014", "2015"],
          d
        });
      }
      if (d.n === "Tramadol") {
        qs.push({
          q: "Tramadol is CD3. Is it exempt from safe custody?",
          ans: "Yes",
          opts: ["Yes", "No"],
          d
        });
      }
      if (d.n === "Phenobarbital") {
        qs.push({
          q: "Which CD allows emergency supply to a patient for epilepsy?",
          ans: "Phenobarbital",
          opts: shuffle(["Phenobarbital", "Midazolam", "Tramadol", "Diazepam"]),
          d
        });
      }
    });
    return shuffle(qs);
  };

  const startQuiz = () => {
    setQuestions(buildQuestions());
    setIdx(0);
    setPicked(null);
    setScore(0);
    setTotal(0);
  };

  useEffect(() => { startQuiz(); }, []);

  // Track when the user has finished, and update best score
  useEffect(() => {
    if (questions.length === 0) return;
    if (idx < questions.length) return;
    const pct = total > 0 ? Math.round((score / total) * 100) : 0;
    if (!stats.quizBest || pct > stats.quizBest.pct) {
      onStatsChange({ ...stats, quizBest: { pct, score, total, ts: Date.now() } });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, questions.length]);

  if (questions.length === 0) {
    return <div style={{ padding: 20, color: MUTED }}>Loading quiz…</div>;
  }
  if (idx >= questions.length) {
    const pct = total > 0 ? Math.round((score / total) * 100) : 0;
    return (
      <div>
        <div style={styles.quizDone}>Done! Final score: {score}/{total} ({pct}%)</div>
        <button onClick={startQuiz} style={styles.primaryBtn}>Start new quiz</button>
      </div>
    );
  }

  const item = questions[idx];

  const handlePick = (opt) => {
    if (picked !== null) return;
    setPicked(opt);
    const isRight = opt === item.ans;
    setTotal(t => t + 1);
    if (isRight) setScore(s => s + 1);
  };

  const handleNext = () => {
    setPicked(null);
    setIdx(i => i + 1);
  };

  return (
    <div>
      <div style={styles.quizProgress}>
        Question {idx + 1} of {Math.min(questions.length, 30)} · Score {score}/{total}
        {stats.quizBest && <span style={{ marginLeft: 10 }}>· Best {stats.quizBest.pct}%</span>}
      </div>
      <div style={styles.quizQuestion}>{item.q}</div>
      <div style={styles.quizOpts}>
        {item.opts.map(opt => {
          let bg = CARD;
          let border = RULE;
          let colour = INK;
          if (picked !== null) {
            if (opt === item.ans) {
              bg = "rgba(22, 102, 54, 0.1)";
              border = GREEN;
              colour = GREEN;
            } else if (opt === picked) {
              bg = RED_SOFT;
              border = RED;
              colour = RED;
            }
          }
          return (
            <button
              key={opt}
              onClick={() => handlePick(opt)}
              disabled={picked !== null}
              style={{
                ...styles.quizOpt,
                backgroundColor: bg,
                borderColor: border,
                color: colour,
                cursor: picked !== null ? "default" : "pointer"
              }}
            >
              {opt}
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <div style={picked === item.ans ? styles.quizFbWin : styles.quizFbLose}>
          {picked === item.ans ? "Correct. " : `Incorrect — answer was ${item.ans}. `}
          {item.d.n} is CD{item.d.s}. {item.d.note}
        </div>
      )}
      <div style={styles.actionRow}>
        {picked !== null && idx < questions.length - 1 && (
          <button onClick={handleNext} style={styles.primaryBtn}>Next question</button>
        )}
        {picked !== null && idx >= questions.length - 1 && (
          <button onClick={() => setIdx(questions.length)} style={styles.primaryBtn}>Finish</button>
        )}
        {idx < questions.length - 1 && (
          <button onClick={() => { setIdx(questions.length); }} style={styles.secondaryBtn}>End quiz</button>
        )}
      </div>
    </div>
  );
}

// ============ SHARED COMPONENTS ============

function Stat({ label, value, small }) {
  return (
    <div style={small ? styles.statSmall : styles.stat}>
      <div style={styles.statValue}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={active ? styles.tabBtnActive : styles.tabBtn}>
      {children}
    </button>
  );
}

function ModeButton({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={active ? styles.modeBtnActive : styles.modeBtn}>
      {children}
    </button>
  );
}

function FilterChip({ active, colour, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...styles.filterChip,
        backgroundColor: active ? colour : "transparent",
        color: active ? "#fff" : MUTED,
        borderColor: active ? colour : RULE
      }}
    >
      {children}
    </button>
  );
}

function ColumnHeader({ colour, children }) {
  return (
    <div style={{ ...styles.colHeader, backgroundColor: colour }}>{children}</div>
  );
}

function Badge({ yes, children }) {
  return (
    <span style={yes ? styles.badgeYes : styles.badgeNo}>{children}</span>
  );
}

// ============ STYLES ============

const styles = {
  container: {
    padding: "16px 14px 28px"
  },
  header: {
    marginBottom: 14
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    margin: 0,
    color: INK,
    letterSpacing: "-0.01em"
  },
  tagline: {
    fontSize: 13,
    color: MUTED,
    marginTop: 4
  },
  tabBar: {
    display: "flex",
    gap: 6,
    marginBottom: 14,
    borderBottom: `1px solid ${RULE}`,
    paddingBottom: 8
  },
  tabBtn: {
    padding: "6px 14px",
    fontSize: 13,
    fontWeight: 500,
    border: "none",
    background: "transparent",
    color: MUTED,
    cursor: "pointer",
    fontFamily: "inherit",
    borderRadius: 6
  },
  tabBtnActive: {
    padding: "6px 14px",
    fontSize: 13,
    fontWeight: 600,
    border: "none",
    background: GREEN_SOFT,
    color: GREEN,
    cursor: "pointer",
    fontFamily: "inherit",
    borderRadius: 6
  },
  // Stats row
  statsRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 12
  },
  stat: {
    flex: "1 1 64px",
    minWidth: 64,
    background: PAPER,
    border: `1px solid ${RULE}`,
    borderRadius: 8,
    padding: "6px 10px",
    textAlign: "center"
  },
  statSmall: {
    flex: "1 1 64px",
    minWidth: 64,
    background: GREEN_SOFT,
    border: `1px solid ${GREEN_BORDER}`,
    borderRadius: 8,
    padding: "6px 10px",
    textAlign: "center"
  },
  statValue: {
    fontSize: 16,
    fontWeight: 600,
    color: INK
  },
  statLabel: {
    fontSize: 10,
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginTop: 2
  },
  // Mode toggle
  modeRow: {
    display: "flex",
    gap: 6,
    marginBottom: 12
  },
  modeBtn: {
    flex: 1,
    padding: "8px 10px",
    fontSize: 12,
    border: `1px solid ${RULE}`,
    background: CARD,
    color: MUTED,
    borderRadius: 8,
    cursor: "pointer",
    fontFamily: "inherit",
    fontWeight: 500
  },
  modeBtnActive: {
    flex: 1,
    padding: "8px 10px",
    fontSize: 12,
    border: `1px solid ${GREEN}`,
    background: GREEN,
    color: "#fff",
    borderRadius: 8,
    cursor: "pointer",
    fontFamily: "inherit",
    fontWeight: 600
  },
  // Filters
  filterRow: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
    alignItems: "center",
    marginBottom: 8
  },
  filterLabel: {
    fontSize: 11,
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginRight: 4
  },
  filterChip: {
    padding: "4px 10px",
    fontSize: 11,
    fontWeight: 600,
    border: "1px solid",
    borderRadius: 16,
    cursor: "pointer",
    fontFamily: "inherit",
    textTransform: "capitalize"
  },
  // Pool
  poolLabel: {
    fontSize: 11,
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginTop: 12,
    marginBottom: 4
  },
  pool: {
    display: "flex",
    flexWrap: "wrap",
    gap: 5,
    minHeight: 56,
    padding: 8,
    border: `1px dashed ${RULE}`,
    borderRadius: 8,
    background: PAPER
  },
  emptyPool: {
    color: MUTED,
    fontSize: 11,
    fontStyle: "italic",
    padding: "8px 4px"
  },
  // Cards
  card: {
    padding: "5px 10px",
    borderRadius: 8,
    border: "1.5px solid",
    fontSize: 12,
    fontWeight: 600,
    userSelect: "none",
    whiteSpace: "nowrap",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontFamily: "inherit",
    touchAction: "none"
  },
  freqDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    flexShrink: 0
  },
  // Grid
  gridSchedule: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 5,
    marginTop: 12
  },
  gridRules: {
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr)",
    gap: 5,
    marginTop: 12
  },
  colHeader: {
    textAlign: "center",
    fontSize: 11,
    fontWeight: 700,
    color: "#fff",
    padding: "6px 2px",
    borderRadius: 6,
    textTransform: "uppercase",
    letterSpacing: "0.04em"
  },
  dropzone: {
    minHeight: 90,
    border: "1.5px dashed",
    borderRadius: 8,
    padding: 4,
    display: "flex",
    flexDirection: "column",
    gap: 3,
    background: PAPER
  },
  // Result messages
  winMsg: {
    marginTop: 10,
    padding: "8px 12px",
    background: GREEN_SOFT,
    color: GREEN,
    border: `1px solid ${GREEN_BORDER}`,
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600
  },
  partMsg: {
    marginTop: 10,
    padding: "8px 12px",
    background: "rgba(133, 79, 11, 0.08)",
    color: "rgb(133, 79, 11)",
    border: "1px solid rgba(133, 79, 11, 0.25)",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500
  },
  // Action buttons
  actionRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginTop: 14
  },
  primaryBtn: {
    padding: "8px 16px",
    background: GREEN,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit"
  },
  secondaryBtn: {
    padding: "8px 16px",
    background: CARD,
    color: INK,
    border: `1px solid ${RULE}`,
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "inherit"
  },
  // Info panel
  infoPanel: {
    marginTop: 14,
    padding: "12px 14px",
    background: CARD,
    border: `1px solid ${RULE}`,
    borderRadius: 10
  },
  infoHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 8,
    gap: 6
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: INK,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 5
  },
  infoCloseBtn: {
    width: 24,
    height: 24,
    background: "transparent",
    border: "none",
    color: MUTED,
    fontSize: 18,
    cursor: "pointer",
    padding: 0,
    lineHeight: 1
  },
  miniBadge: {
    fontSize: 9,
    fontWeight: 700,
    color: "#fff",
    padding: "2px 6px",
    borderRadius: 10,
    textTransform: "uppercase",
    letterSpacing: "0.04em"
  },
  infoRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    color: MUTED,
    padding: "4px 0",
    flexWrap: "wrap"
  },
  infoNote: {
    fontSize: 12,
    color: INK,
    background: GREEN_SOFT,
    border: `1px solid ${GREEN_BORDER}`,
    borderRadius: 6,
    padding: "8px 10px",
    marginTop: 8,
    lineHeight: 1.5
  },
  // Badges
  badgeYes: {
    fontSize: 10,
    fontWeight: 600,
    background: GREEN_SOFT,
    color: GREEN,
    padding: "2px 7px",
    borderRadius: 10
  },
  badgeNo: {
    fontSize: 10,
    fontWeight: 600,
    background: "#f0f0f0",
    color: "#555",
    padding: "2px 7px",
    borderRadius: 10
  },
  // Reference table
  refWrap: {
    marginTop: 4
  },
  refTableScroll: {
    overflowX: "auto",
    border: `1px solid ${RULE}`,
    borderRadius: 8
  },
  refTable: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 11
  },
  refTh: {
    textAlign: "left",
    padding: "6px 8px",
    borderBottom: `1.5px solid ${RULE}`,
    color: MUTED,
    fontWeight: 600,
    whiteSpace: "nowrap",
    textTransform: "uppercase",
    fontSize: 9,
    letterSpacing: "0.05em",
    background: PAPER
  },
  refTd: {
    padding: "6px 8px",
    borderBottom: `1px solid ${RULE}`,
    color: INK,
    verticalAlign: "top"
  },
  refNote: {
    fontSize: 10,
    color: MUTED,
    maxWidth: 200,
    lineHeight: 1.4
  },
  // Quiz
  quizProgress: {
    fontSize: 11,
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: 10
  },
  quizQuestion: {
    fontSize: 15,
    fontWeight: 600,
    color: INK,
    lineHeight: 1.5,
    marginBottom: 14,
    padding: "12px 14px",
    background: PAPER,
    border: `1px solid ${RULE}`,
    borderRadius: 8
  },
  quizOpts: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginBottom: 12
  },
  quizOpt: {
    padding: "10px 14px",
    fontSize: 13,
    fontWeight: 500,
    border: "1.5px solid",
    borderRadius: 8,
    textAlign: "left",
    fontFamily: "inherit"
  },
  quizFbWin: {
    fontSize: 12,
    color: GREEN,
    background: GREEN_SOFT,
    border: `1px solid ${GREEN_BORDER}`,
    borderRadius: 8,
    padding: "10px 12px",
    lineHeight: 1.5,
    marginBottom: 12
  },
  quizFbLose: {
    fontSize: 12,
    color: RED,
    background: RED_SOFT,
    border: `1px solid rgba(176, 35, 35, 0.25)`,
    borderRadius: 8,
    padding: "10px 12px",
    lineHeight: 1.5,
    marginBottom: 12
  },
  quizDone: {
    fontSize: 16,
    fontWeight: 600,
    color: GREEN,
    background: GREEN_SOFT,
    border: `1px solid ${GREEN_BORDER}`,
    borderRadius: 8,
    padding: "14px 16px",
    marginBottom: 12,
    textAlign: "center"
  }
};
