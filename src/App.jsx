import React, { useState, useEffect, useMemo, useCallback } from "react";
import QUESTIONS from "./questions.json";
import SchedulesView from "./SchedulesView.jsx";

// === COLOURS & STYLE ===
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

// === PERSISTENCE LAYER ===
// Browser localStorage. Keys are namespaced per user: gphc:<userKey>:<keyType>
// Active user is stored at gphc:activeUser, list of all users at gphc:users
const ROOT_KEYS = {
  ACTIVE_USER: "gphc:activeUser",
  USERS: "gphc:users"
};

function userKeys(userKey) {
  return {
    MASTERY: `gphc:${userKey}:mastery`,
    HISTORY: `gphc:${userKey}:history`,
    GENERATION: `gphc:${userKey}:gen`,
    PREFS: `gphc:${userKey}:prefs`,
    SCHEDULES: `gphc:${userKey}:schedules`
  };
}

function nameToKey(name) {
  return (name || "").trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "user";
}

async function storageGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

async function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error("storage set failed", key, e);
  }
}

async function storageDelete(key) {
  try {
    localStorage.removeItem(key);
  } catch (e) { /* ignore */ }
}

// === MASTERY / RESURFACING LOGIC ===
// Score interpretation: lower score = needs review sooner
// wrong = -3, guessed-correct = -1, confident-correct = +2
function masteryScore(m) {
  if (!m) return 0;
  return (m.correct || 0) * 2 - (m.wrong || 0) * 3 - (m.guessedCorrect || 0) * 1;
}

function pickNext(allQuestions, mastery, seenInPass, topicFilter) {
  // Filter by topic
  let pool = topicFilter === "All"
    ? allQuestions
    : allQuestions.filter(q => q.topic === topicFilter);
  // Drop already seen in this pass
  pool = pool.filter(q => !seenInPass.includes(q.id));
  if (pool.length === 0) return null;
  // Sort by mastery score ascending (lowest = most needs review)
  pool.sort((a, b) => {
    const sa = masteryScore(mastery[a.id]);
    const sb = masteryScore(mastery[b.id]);
    if (sa !== sb) return sa - sb;
    // Tiebreak: prefer never-seen questions
    const seenA = mastery[a.id] ? 1 : 0;
    const seenB = mastery[b.id] ? 1 : 0;
    return seenA - seenB;
  });
  // From the top quartile, pick randomly to add some variety
  const topSlice = pool.slice(0, Math.max(1, Math.ceil(pool.length / 4)));
  return topSlice[Math.floor(Math.random() * topSlice.length)];
}

// === MAIN APP ===
export default function App() {
  // Profile state
  const [activeUserKey, setActiveUserKey] = useState(null);
  const [activeUserName, setActiveUserName] = useState(null);
  const [allUsers, setAllUsers] = useState([]);
  const [showProfilePicker, setShowProfilePicker] = useState(false);

  const [view, setView] = useState("home"); // home, session, insights, complete
  const [sessionMode, setSessionMode] = useState(null); // 'daily' or 'continuous'
  const [topicFilter, setTopicFilter] = useState("All");
  const [timerOn, setTimerOn] = useState(false);
  const [mastery, setMastery] = useState({});
  const [history, setHistory] = useState([]);
  const [seenInPass, setSeenInPass] = useState([]);
  const [scheduleStats, setScheduleStats] = useState({ roundsCompleted: 0 });
  const [loading, setLoading] = useState(true);

  // Session state
  const [currentQ, setCurrentQ] = useState(null);
  const [selected, setSelected] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [guessed, setGuessed] = useState(false);
  const [sessionScore, setSessionScore] = useState({ correct: 0, wrong: 0, guessed: 0, total: 0 });
  const [sessionTarget, setSessionTarget] = useState(5);
  const [timeLeft, setTimeLeft] = useState(60);
  const [showCompleteBank, setShowCompleteBank] = useState(false);

  // Initial bootstrap: load active user list and the active user's data
  useEffect(() => {
    (async () => {
      const users = await storageGet(ROOT_KEYS.USERS, []);
      const active = await storageGet(ROOT_KEYS.ACTIVE_USER, null);
      setAllUsers(users);
      if (active && users.find(u => u.key === active.key)) {
        await loadUserData(active.key, active.displayName);
      } else {
        // No active user yet — show welcome/picker
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load a user's data from storage
  async function loadUserData(userKey, displayName) {
    const k = userKeys(userKey);
    const m = await storageGet(k.MASTERY, {});
    const h = await storageGet(k.HISTORY, []);
    const g = await storageGet(k.GENERATION, { currentBatch: 1, seenIds: [] });
    const p = await storageGet(k.PREFS, { timerOn: false, topic: "All" });
    const ss = await storageGet(k.SCHEDULES, { roundsCompleted: 0 });
    setMastery(m);
    setHistory(h);
    setSeenInPass(g.seenIds || []);
    setTimerOn(p.timerOn || false);
    setTopicFilter(p.topic || "All");
    setScheduleStats(ss);
    setActiveUserKey(userKey);
    setActiveUserName(displayName);
    setLoading(false);
  }

  // Persist schedule stats whenever they change
  const handleScheduleStatsChange = useCallback((newStats) => {
    if (!activeUserKey) return;
    const resolved = typeof newStats === "function" ? newStats(scheduleStats) : newStats;
    setScheduleStats(resolved);
    const k = userKeys(activeUserKey);
    storageSet(k.SCHEDULES, resolved);
  }, [activeUserKey, scheduleStats]);

  // Create a new user profile
  async function createUser(displayName) {
    const trimmed = (displayName || "").trim();
    if (!trimmed) return;
    const key = nameToKey(trimmed);
    const existing = allUsers.find(u => u.key === key);
    let updated;
    if (existing) {
      // User already exists — just switch
      updated = allUsers;
    } else {
      const newUser = { key, displayName: trimmed, createdAt: Date.now() };
      updated = [...allUsers, newUser];
      await storageSet(ROOT_KEYS.USERS, updated);
    }
    setAllUsers(updated);
    await storageSet(ROOT_KEYS.ACTIVE_USER, { key, displayName: trimmed });
    await loadUserData(key, trimmed);
    setShowProfilePicker(false);
  }

  async function switchUser(userKey) {
    const u = allUsers.find(x => x.key === userKey);
    if (!u) return;
    await storageSet(ROOT_KEYS.ACTIVE_USER, { key: u.key, displayName: u.displayName });
    await loadUserData(u.key, u.displayName);
    setShowProfilePicker(false);
    setView("home");
  }

  async function deleteUser(userKey) {
    const u = allUsers.find(x => x.key === userKey);
    if (!u) return;
    if (!confirm(`Delete ${u.displayName} and all their progress? This cannot be undone.`)) return;
    const k = userKeys(userKey);
    await storageDelete(k.MASTERY);
    await storageDelete(k.HISTORY);
    await storageDelete(k.GENERATION);
    await storageDelete(k.PREFS);
    await storageDelete(k.SCHEDULES);
    const updated = allUsers.filter(x => x.key !== userKey);
    await storageSet(ROOT_KEYS.USERS, updated);
    setAllUsers(updated);
    if (activeUserKey === userKey) {
      // Active user deleted — clear active and reset
      await storageDelete(ROOT_KEYS.ACTIVE_USER);
      setActiveUserKey(null);
      setActiveUserName(null);
      setMastery({});
      setHistory([]);
      setSeenInPass([]);
      setScheduleStats({ roundsCompleted: 0 });
      setShowProfilePicker(false);
    }
  }

  // Timer
  useEffect(() => {
    if (!timerOn || !currentQ || submitted || view !== "session") return;
    setTimeLeft(60);
    const interval = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(interval);
          // Auto-submit on timeout (count as wrong if no answer)
          handleSubmit(true);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQ, submitted, timerOn, view]);

  // === DERIVED VALUES ===
  const allTopics = useMemo(() => {
    const set = new Set(QUESTIONS.map(q => q.topic));
    return ["All", ...Array.from(set).sort()];
  }, []);

  const totalSeen = seenInPass.length;
  const totalAvailable = QUESTIONS.length;
  const allSeen = totalSeen >= totalAvailable;

  // === HANDLERS ===
  const startSession = (mode) => {
    if (allSeen) {
      setShowCompleteBank(true);
      return;
    }
    setSessionMode(mode);
    setSessionTarget(mode === "daily" ? 5 : 999);
    setSessionScore({ correct: 0, wrong: 0, guessed: 0, total: 0 });
    nextQuestion(seenInPass);
    setView("session");
  };

  const nextQuestion = (currentSeenList) => {
    const next = pickNext(QUESTIONS, mastery, currentSeenList, topicFilter);
    if (!next) {
      setView("complete");
      return;
    }
    setCurrentQ(next);
    setSelected(null);
    setSubmitted(false);
    setGuessed(false);
    setTimeLeft(60);
  };

  const handleSubmit = useCallback(async (isTimeout = false) => {
    if (submitted || !currentQ || !activeUserKey) return;
    if (!selected && !isTimeout) return;

    const isCorrect = selected === currentQ.correct;
    setSubmitted(true);

    const k = userKeys(activeUserKey);

    // Update mastery
    const newMastery = { ...mastery };
    const m = newMastery[currentQ.id] || { correct: 0, wrong: 0, guessedCorrect: 0, lastSeen: null };
    if (isCorrect) {
      m.correct += 1;
      if (guessed) m.guessedCorrect += 1;
    } else {
      m.wrong += 1;
    }
    m.lastSeen = Date.now();
    newMastery[currentQ.id] = m;
    setMastery(newMastery);
    await storageSet(k.MASTERY, newMastery);

    // Update history
    const newHistory = [...history, {
      ts: Date.now(),
      questionId: currentQ.id,
      correct: isCorrect,
      guessed: guessed,
      topic: currentQ.topic,
      difficulty: currentQ.difficulty
    }];
    setHistory(newHistory);
    await storageSet(k.HISTORY, newHistory);

    // Update seen-in-pass
    const newSeen = [...seenInPass, currentQ.id];
    setSeenInPass(newSeen);
    await storageSet(k.GENERATION, { currentBatch: 1, seenIds: newSeen });

    // Update session score
    setSessionScore(s => ({
      correct: s.correct + (isCorrect ? 1 : 0),
      wrong: s.wrong + (isCorrect ? 0 : 1),
      guessed: s.guessed + (guessed ? 1 : 0),
      total: s.total + 1
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted, currentQ, selected, guessed, mastery, history, seenInPass, activeUserKey]);

  const handleNext = () => {
    const newTotal = sessionScore.total;
    if (sessionMode === "daily" && newTotal >= sessionTarget) {
      setView("complete");
      return;
    }
    nextQuestion(seenInPass);
  };

  const stopSession = () => {
    setView("complete");
  };

  const resetBank = async () => {
    if (!confirm("Reset all your progress and start fresh? This will clear your mastery, history, and seen list for this profile.")) return;
    if (!activeUserKey) return;
    const k = userKeys(activeUserKey);
    setMastery({});
    setHistory([]);
    setSeenInPass([]);
    await storageSet(k.MASTERY, {});
    await storageSet(k.HISTORY, []);
    await storageSet(k.GENERATION, { currentBatch: 1, seenIds: [] });
    setShowCompleteBank(false);
    setView("home");
  };

  const continueAfterBank = () => {
    if (!activeUserKey) return;
    const k = userKeys(activeUserKey);
    setSeenInPass([]);
    storageSet(k.GENERATION, { currentBatch: 2, seenIds: [] });
    setShowCompleteBank(false);
  };

  // Save preferences when they change
  useEffect(() => {
    if (loading || !activeUserKey) return;
    const k = userKeys(activeUserKey);
    storageSet(k.PREFS, { timerOn, topic: topicFilter });
  }, [timerOn, topicFilter, loading, activeUserKey]);

  if (loading) {
    return (
      <div style={styles.shell}>
        <div style={{ padding: "60px 20px", textAlign: "center", color: MUTED }}>Loading...</div>
      </div>
    );
  }

  // No active user — show welcome / profile picker
  if (!activeUserKey) {
    return (
      <div style={styles.shell}>
        <WelcomeView
          allUsers={allUsers}
          onCreateUser={createUser}
          onSwitchUser={switchUser}
          onDeleteUser={deleteUser}
        />
      </div>
    );
  }

  return (
    <div style={styles.shell}>
      <Header
        view={view}
        setView={setView}
        userName={activeUserName}
        onOpenProfile={() => setShowProfilePicker(true)}
      />

      {showProfilePicker && (
        <ProfilePickerOverlay
          allUsers={allUsers}
          activeUserKey={activeUserKey}
          onCreateUser={createUser}
          onSwitchUser={switchUser}
          onDeleteUser={deleteUser}
          onClose={() => setShowProfilePicker(false)}
        />
      )}

      {showCompleteBank && (
        <BankCompleteOverlay
          onContinue={continueAfterBank}
          onReset={resetBank}
          onClose={() => setShowCompleteBank(false)}
        />
      )}

      <main style={styles.main}>
        {view === "home" && (
          <HomeView
            userName={activeUserName}
            allTopics={allTopics}
            topicFilter={topicFilter}
            setTopicFilter={setTopicFilter}
            timerOn={timerOn}
            setTimerOn={setTimerOn}
            startSession={startSession}
            totalSeen={totalSeen}
            totalAvailable={totalAvailable}
            allSeen={allSeen}
            triggerComplete={() => setShowCompleteBank(true)}
            openSchedules={() => setView("schedules")}
            scheduleStats={scheduleStats}
          />
        )}

        {view === "session" && currentQ && (
          <SessionView
            q={currentQ}
            selected={selected}
            setSelected={setSelected}
            submitted={submitted}
            guessed={guessed}
            setGuessed={setGuessed}
            onSubmit={() => handleSubmit(false)}
            onNext={handleNext}
            onStop={stopSession}
            sessionScore={sessionScore}
            sessionMode={sessionMode}
            sessionTarget={sessionTarget}
            timerOn={timerOn}
            timeLeft={timeLeft}
          />
        )}

        {view === "complete" && (
          <CompleteView
            sessionScore={sessionScore}
            onReturnHome={() => setView("home")}
            onContinue={() => startSession(sessionMode)}
          />
        )}

        {view === "insights" && (
          <InsightsView
            userName={activeUserName}
            mastery={mastery}
            history={history}
            allQuestions={QUESTIONS}
            seenInPass={seenInPass}
            onReset={resetBank}
            onOpenProfile={() => setShowProfilePicker(true)}
          />
        )}

        {view === "schedules" && (
          <SchedulesView
            stats={scheduleStats}
            onStatsChange={handleScheduleStatsChange}
          />
        )}
      </main>
    </div>
  );
}

// === COMPONENTS ===

function Header({ view, setView, userName, onOpenProfile }) {
  const initial = (userName || "").trim().charAt(0).toUpperCase() || "?";
  return (
    <header style={styles.header}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <div style={styles.logoMark}>℞</div>
        <div>
          <div style={styles.brand}>CRA Law</div>
          <div style={styles.tagline}>Pharmacy Law & Governance</div>
        </div>
      </div>
      <nav style={styles.nav}>
        <button
          onClick={() => setView("home")}
          style={view === "home" ? styles.navBtnActive : styles.navBtn}
        >
          Home
        </button>
        <button
          onClick={() => setView("insights")}
          style={view === "insights" ? styles.navBtnActive : styles.navBtn}
        >
          Insights
        </button>
        <button
          onClick={onOpenProfile}
          style={styles.profileBtn}
          aria-label="Switch profile"
          title={userName || "Profile"}
        >
          {initial}
        </button>
      </nav>
    </header>
  );
}

function HomeView({ userName, allTopics, topicFilter, setTopicFilter, timerOn, setTimerOn, startSession, totalSeen, totalAvailable, allSeen, triggerComplete, openSchedules, scheduleStats }) {
  const progressPct = Math.round((totalSeen / totalAvailable) * 100);
  const firstName = (userName || "").split(/\s+/)[0];
  const bestTime = scheduleStats?.scheduleBest?.time;
  const bestQuiz = scheduleStats?.quizBest?.pct;
  const rounds = scheduleStats?.roundsCompleted || 0;
  return (
    <div style={styles.homeContainer}>
      <section style={styles.heroCard}>
        <div style={styles.eyebrow}>{firstName ? `Hello, ${firstName}` : "Practise"}</div>
        <h1 style={styles.h1}>Build the law muscle.</h1>
        <p style={styles.lede}>
          Daily questions on UK pharmacy law and governance, mapped to GPhC CRA style. Wrong answers and guesses resurface first.
        </p>
        <div style={styles.progressRow}>
          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: `${progressPct}%` }} />
          </div>
          <div style={styles.progressLabel}>
            {totalSeen} / {totalAvailable} seen this pass
          </div>
        </div>
      </section>

      <section style={styles.controlsCard}>
        <label style={styles.label}>
          Topic
          <select
            value={topicFilter}
            onChange={e => setTopicFilter(e.target.value)}
            style={styles.select}
          >
            {allTopics.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>

        <label style={styles.toggleRow}>
          <span>60-second timer</span>
          <button
            onClick={() => setTimerOn(!timerOn)}
            style={{
              ...styles.toggle,
              backgroundColor: timerOn ? GREEN : "#d4d2cb"
            }}
          >
            <div style={{
              ...styles.toggleKnob,
              transform: timerOn ? "translateX(22px)" : "translateX(2px)"
            }} />
          </button>
        </label>
      </section>

      <section style={styles.modeGrid}>
        <button
          onClick={() => startSession("daily")}
          style={styles.modeCardPrimary}
          disabled={allSeen}
        >
          <div style={styles.modeKicker}>Recommended</div>
          <div style={styles.modeTitle}>Daily Five</div>
          <div style={styles.modeDesc}>5 questions, weighted to your weak spots.</div>
          <div style={styles.modeArrow}>→</div>
        </button>

        <button
          onClick={() => startSession("continuous")}
          style={styles.modeCardSecondary}
          disabled={allSeen}
        >
          <div style={styles.modeKicker}>Marathon</div>
          <div style={styles.modeTitle}>Continuous</div>
          <div style={styles.modeDesc}>Keep going until you stop.</div>
          <div style={styles.modeArrow}>→</div>
        </button>
      </section>

      <section style={styles.schedulesCard} onClick={openSchedules}>
        <div style={styles.schedulesCardKicker}>Schedule drilling</div>
        <div style={styles.schedulesCardTitle}>Drug Schedules</div>
        <div style={styles.schedulesCardDesc}>
          54 drugs sorted by exam frequency. Drag-and-drop game, reference table, quick quiz.
        </div>
        <div style={styles.schedulesCardStats}>
          <div style={styles.schedulesCardStat}>
            <div style={styles.schedulesCardStatVal}>{rounds}</div>
            <div style={styles.schedulesCardStatLbl}>rounds</div>
          </div>
          <div style={styles.schedulesCardStat}>
            <div style={styles.schedulesCardStatVal}>{bestTime ? `${bestTime}s` : "—"}</div>
            <div style={styles.schedulesCardStatLbl}>best time</div>
          </div>
          <div style={styles.schedulesCardStat}>
            <div style={styles.schedulesCardStatVal}>{bestQuiz != null ? `${bestQuiz}%` : "—"}</div>
            <div style={styles.schedulesCardStatLbl}>best quiz</div>
          </div>
        </div>
        <div style={styles.modeArrow}>→</div>
      </section>

      {allSeen && (
        <div style={styles.bankNotice} onClick={triggerComplete}>
          You've seen every question in this bank.{" "}
          <span style={{ textDecoration: "underline" }}>Tap to choose what's next.</span>
        </div>
      )}
    </div>
  );
}

function SessionView({ q, selected, setSelected, submitted, guessed, setGuessed, onSubmit, onNext, onStop, sessionScore, sessionMode, sessionTarget, timerOn, timeLeft }) {
  const stemParts = q.stem.split("\n\n");
  const scenario = stemParts.length > 1 ? stemParts.slice(0, -1).join("\n\n") : null;
  const leadIn = stemParts[stemParts.length - 1];

  return (
    <div style={styles.sessionContainer}>
      <div style={styles.sessionTopBar}>
        <button onClick={onStop} style={styles.stopBtn}>← Stop</button>
        <div style={styles.sessionMeta}>
          <span style={styles.metaPill}>{q.topic}</span>
          <span style={styles.metaPill}>{q.format}</span>
          <span style={styles.metaPill}>{q.difficulty}</span>
        </div>
        <div style={styles.sessionProgress}>
          {sessionMode === "daily"
            ? `Q ${sessionScore.total + (submitted ? 0 : 1)} / ${sessionTarget}`
            : `Q ${sessionScore.total + (submitted ? 0 : 1)}`}
        </div>
      </div>

      {timerOn && !submitted && (
        <div style={styles.timer}>
          <div style={{
            ...styles.timerBar,
            width: `${(timeLeft / 60) * 100}%`,
            backgroundColor: timeLeft < 15 ? RED : GREEN
          }} />
          <div style={styles.timerLabel}>{timeLeft}s</div>
        </div>
      )}

      <article style={styles.questionCard}>
        {scenario && <div style={styles.scenario}>{scenario}</div>}
        <div style={styles.leadIn}>{leadIn}</div>

        <div style={styles.guessRow}>
          <label style={styles.guessLabel}>
            <input
              type="checkbox"
              checked={guessed}
              onChange={e => setGuessed(e.target.checked)}
              disabled={submitted}
              style={styles.guessCheck}
            />
            <span>I'm guessing this one</span>
          </label>
        </div>

        <div style={styles.options}>
          {q.options.map(opt => {
            const isSelected = selected === opt.label;
            const isCorrect = opt.label === q.correct;
            let optStyle = { ...styles.option };

            if (submitted) {
              if (isCorrect) {
                optStyle = { ...optStyle, ...styles.optionCorrect };
              } else if (isSelected) {
                optStyle = { ...optStyle, ...styles.optionWrong };
              } else {
                optStyle = { ...optStyle, ...styles.optionDimmed };
              }
            } else if (isSelected) {
              optStyle = { ...optStyle, ...styles.optionSelected };
            }

            return (
              <button
                key={opt.label}
                onClick={() => !submitted && setSelected(opt.label)}
                disabled={submitted}
                style={optStyle}
              >
                <span style={styles.optionLabel}>{opt.label}</span>
                <span style={styles.optionText}>{opt.text}</span>
              </button>
            );
          })}
        </div>

        {!submitted && (
          <button
            onClick={onSubmit}
            disabled={!selected}
            style={{
              ...styles.submitBtn,
              opacity: selected ? 1 : 0.4,
              cursor: selected ? "pointer" : "not-allowed"
            }}
          >
            Submit answer
          </button>
        )}

        {submitted && (
          <ExplanationPanel q={q} selected={selected} guessed={guessed} onNext={onNext} />
        )}
      </article>

      <div style={styles.scorePeek}>
        ✓ {sessionScore.correct} · ✗ {sessionScore.wrong}
        {sessionScore.guessed > 0 && ` · ? ${sessionScore.guessed} guessed`}
      </div>
    </div>
  );
}

function ExplanationPanel({ q, selected, guessed, onNext }) {
  const isCorrect = selected === q.correct;
  const wrongOptions = q.options.filter(o => o.label !== q.correct);

  return (
    <div style={styles.explanation}>
      <div style={{
        ...styles.verdict,
        backgroundColor: isCorrect ? GREEN_SOFT : RED_SOFT,
        color: isCorrect ? GREEN : RED,
        borderColor: isCorrect ? GREEN_BORDER : "rgba(176, 35, 35, 0.25)"
      }}>
        <div style={styles.verdictTitle}>
          {isCorrect ? (guessed ? "Correct — but you guessed" : "Correct") : "Not quite"}
        </div>
        <div style={styles.verdictBody}>
          The answer is {q.correct}.
        </div>
      </div>

      <section style={styles.explainSection}>
        <h3 style={styles.explainHeading}>Why {q.correct} is right</h3>
        <p style={styles.explainBody}>{q.explain_correct || "—"}</p>
        {q.citation && (
          <div style={styles.citation}>
            <span style={styles.citationLabel}>Source</span>
            {q.citation}
          </div>
        )}
      </section>

      {Object.keys(q.explain_wrong || {}).length > 0 && (
        <section style={styles.explainSection}>
          <h3 style={styles.explainHeading}>Why the others aren't</h3>
          {wrongOptions.map(opt => {
            const reason = q.explain_wrong[opt.label];
            if (!reason) return null;
            return (
              <div key={opt.label} style={styles.wrongReason}>
                <span style={styles.wrongLabel}>{opt.label}</span>
                <span style={styles.wrongText}>{reason}</span>
              </div>
            );
          })}
        </section>
      )}

      <button onClick={onNext} style={styles.nextBtn}>
        Next question →
      </button>
    </div>
  );
}

function CompleteView({ sessionScore, onReturnHome, onContinue }) {
  const accuracy = sessionScore.total > 0
    ? Math.round((sessionScore.correct / sessionScore.total) * 100)
    : 0;
  return (
    <div style={styles.completeContainer}>
      <div style={styles.completeBig}>{accuracy}%</div>
      <div style={styles.completeLabel}>Session accuracy</div>
      <div style={styles.completeStats}>
        <div style={styles.completeStat}>
          <div style={styles.completeStatValue}>{sessionScore.correct}</div>
          <div style={styles.completeStatLabel}>correct</div>
        </div>
        <div style={styles.completeStat}>
          <div style={styles.completeStatValue}>{sessionScore.wrong}</div>
          <div style={styles.completeStatLabel}>wrong</div>
        </div>
        <div style={styles.completeStat}>
          <div style={styles.completeStatValue}>{sessionScore.guessed}</div>
          <div style={styles.completeStatLabel}>guessed</div>
        </div>
      </div>
      <div style={styles.completeButtons}>
        <button onClick={onContinue} style={styles.bigPrimaryBtn}>Another session</button>
        <button onClick={onReturnHome} style={styles.bigSecondaryBtn}>Home</button>
      </div>
    </div>
  );
}

function InsightsView({ userName, mastery, history, allQuestions, seenInPass, onReset, onOpenProfile }) {
  const totalAnswered = history.length;
  const totalCorrect = history.filter(h => h.correct).length;
  const totalGuessed = history.filter(h => h.guessed).length;
  const totalGuessedCorrect = history.filter(h => h.guessed && h.correct).length;
  const accuracy = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

  // By topic
  const byTopic = {};
  history.forEach(h => {
    if (!byTopic[h.topic]) byTopic[h.topic] = { total: 0, correct: 0, guessed: 0, guessedCorrect: 0 };
    byTopic[h.topic].total += 1;
    if (h.correct) byTopic[h.topic].correct += 1;
    if (h.guessed) byTopic[h.topic].guessed += 1;
    if (h.guessed && h.correct) byTopic[h.topic].guessedCorrect += 1;
  });
  const topicRows = Object.entries(byTopic).map(([topic, s]) => ({
    topic,
    total: s.total,
    accuracy: Math.round((s.correct / s.total) * 100),
    guessRate: s.total > 0 ? Math.round((s.guessed / s.total) * 100) : 0,
    guessedCorrectRate: s.guessed > 0 ? Math.round((s.guessedCorrect / s.guessed) * 100) : 0
  })).sort((a, b) => a.accuracy - b.accuracy);

  const weakest = topicRows.slice(0, 3);
  const strongest = [...topicRows].sort((a, b) => b.accuracy - a.accuracy).slice(0, 3);

  // By difficulty
  const byDiff = { high: { total: 0, correct: 0 }, medium: { total: 0, correct: 0 }, low: { total: 0, correct: 0 } };
  history.forEach(h => {
    if (byDiff[h.difficulty]) {
      byDiff[h.difficulty].total += 1;
      if (h.correct) byDiff[h.difficulty].correct += 1;
    }
  });

  // Last 7 sessions (group history by day)
  const byDay = {};
  history.forEach(h => {
    const day = new Date(h.ts).toISOString().slice(0, 10);
    if (!byDay[day]) byDay[day] = { total: 0, correct: 0 };
    byDay[day].total += 1;
    if (h.correct) byDay[day].correct += 1;
  });
  const days = Object.entries(byDay)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 7)
    .reverse();

  // Streak (consecutive correct from most recent)
  let streak = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].correct) streak += 1;
    else break;
  }

  // High guessed-correct rate flags
  const flags = topicRows.filter(t => t.guessedCorrectRate >= 50 && t.guessed >= 2);

  return (
    <div style={styles.insightsContainer}>
      {userName && (
        <div style={styles.userBanner}>
          <div>
            <div style={styles.userBannerLabel}>Profile</div>
            <div style={styles.userBannerName}>{userName}</div>
          </div>
          <button onClick={onOpenProfile} style={styles.userBannerBtn}>Switch</button>
        </div>
      )}

      <div style={styles.insightsTopRow}>
        <StatCard big={`${accuracy}%`} label="Overall accuracy" />
        <StatCard big={totalAnswered} label="Total answered" />
        <StatCard big={streak} label="Current streak" />
      </div>

      <div style={styles.insightsTopRow}>
        <StatCard big={totalGuessed} label="Total guessed" sub={totalGuessed > 0 ? `${Math.round(totalGuessedCorrect/totalGuessed*100)}% lucky` : null} />
        <StatCard big={seenInPass.length} label="Seen this pass" sub={`of ${allQuestions.length}`} />
      </div>

      {totalAnswered === 0 ? (
        <div style={styles.emptyInsights}>
          Answer a few questions to see insights here.
        </div>
      ) : (
        <>
          <Section title="Weakest topics">
            {weakest.length === 0 ? <div style={styles.muted}>—</div> : weakest.map(t => (
              <TopicRow key={t.topic} t={t} flavour="weak" />
            ))}
          </Section>

          <Section title="Strongest topics">
            {strongest.length === 0 ? <div style={styles.muted}>—</div> : strongest.map(t => (
              <TopicRow key={t.topic} t={t} flavour="strong" />
            ))}
          </Section>

          {flags.length > 0 && (
            <Section title="Flagged: high guess-correct rate">
              <div style={styles.flagNote}>
                Topics where you got more than half right while guessing — that's luck, not knowledge. Review the underlying material.
              </div>
              {flags.map(t => (
                <TopicRow key={t.topic} t={t} flavour="flag" />
              ))}
            </Section>
          )}

          <Section title="By difficulty">
            {Object.entries(byDiff).map(([k, v]) => (
              v.total > 0 && (
                <div key={k} style={styles.diffRow}>
                  <span style={styles.diffLabel}>{k}</span>
                  <span style={styles.diffStat}>
                    {Math.round((v.correct / v.total) * 100)}% · {v.correct}/{v.total}
                  </span>
                </div>
              )
            ))}
          </Section>

          <Section title="Last 7 days">
            {days.length === 0 ? <div style={styles.muted}>—</div> : (
              <div style={styles.daysGrid}>
                {days.map(([day, s]) => (
                  <div key={day} style={styles.dayCell}>
                    <div style={styles.dayDate}>{day.slice(5)}</div>
                    <div style={styles.dayBar}>
                      <div style={{
                        ...styles.dayBarFill,
                        height: `${Math.round((s.correct / s.total) * 100)}%`
                      }} />
                    </div>
                    <div style={styles.dayStat}>{s.correct}/{s.total}</div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </>
      )}

      <button onClick={onReset} style={styles.resetBtn}>
        Reset all progress
      </button>
    </div>
  );
}

function StatCard({ big, label, sub }) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statBig}>{big}</div>
      <div style={styles.statLabel}>{label}</div>
      {sub && <div style={styles.statSub}>{sub}</div>}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section style={styles.insightsSection}>
      <h2 style={styles.sectionTitle}>{title}</h2>
      <div>{children}</div>
    </section>
  );
}

function TopicRow({ t, flavour }) {
  const accent = flavour === "weak" ? RED : flavour === "flag" ? "#a86b00" : GREEN;
  return (
    <div style={styles.topicRow}>
      <div style={styles.topicName}>{t.topic}</div>
      <div style={styles.topicStats}>
        <span style={{ ...styles.topicAccuracy, color: accent }}>{t.accuracy}%</span>
        <span style={styles.topicCount}>{t.total} answered</span>
        {flavour === "flag" && (
          <span style={styles.topicFlag}>{t.guessedCorrectRate}% lucky</span>
        )}
      </div>
    </div>
  );
}

function BankCompleteOverlay({ onContinue, onReset, onClose }) {
  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.overlayCard} onClick={e => e.stopPropagation()}>
        <h2 style={styles.overlayTitle}>You've seen every question in this bank</h2>
        <p style={styles.overlayText}>
          To get more questions, ask Claude to generate a new batch of 100 — keep your existing mastery data and add the new bank.
        </p>
        <p style={styles.overlayText}>
          Or recycle this bank: questions reset, but your mastery scores stay so the resurfacing logic still favours your weak spots.
        </p>
        <div style={styles.overlayButtons}>
          <button onClick={onContinue} style={styles.bigPrimaryBtn}>Recycle this bank</button>
          <button onClick={onClose} style={styles.bigSecondaryBtn}>Close</button>
        </div>
        <button onClick={onReset} style={styles.dangerBtn}>Reset all progress</button>
      </div>
    </div>
  );
}

function WelcomeView({ allUsers, onCreateUser, onSwitchUser, onDeleteUser }) {
  const [name, setName] = useState("");
  const [showAdd, setShowAdd] = useState(allUsers.length === 0);

  const submit = () => {
    if (!name.trim()) return;
    onCreateUser(name.trim());
  };

  return (
    <div style={styles.welcomeShell}>
      <div style={styles.welcomeCard}>
        <div style={styles.welcomeLogo}>℞</div>
        <div style={styles.welcomeBrand}>CRA Law</div>
        <div style={styles.welcomeTagline}>Pharmacy Law & Governance</div>

        {allUsers.length > 0 && !showAdd && (
          <>
            <div style={styles.welcomeHeading}>Who's revising?</div>
            <div style={styles.profileList}>
              {allUsers.map(u => (
                <div key={u.key} style={styles.profileRow}>
                  <button
                    onClick={() => onSwitchUser(u.key)}
                    style={styles.profileSelectBtn}
                  >
                    <div style={styles.profileAvatar}>
                      {u.displayName.charAt(0).toUpperCase()}
                    </div>
                    <span style={styles.profileNameText}>{u.displayName}</span>
                  </button>
                  <button
                    onClick={() => onDeleteUser(u.key)}
                    style={styles.profileDeleteBtn}
                    aria-label={`Delete ${u.displayName}`}
                    title="Delete profile"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button onClick={() => setShowAdd(true)} style={styles.welcomeAddBtn}>
              + Add new profile
            </button>
          </>
        )}

        {(allUsers.length === 0 || showAdd) && (
          <>
            <div style={styles.welcomeHeading}>
              {allUsers.length === 0 ? "What's your name?" : "New profile"}
            </div>
            <p style={styles.welcomeBlurb}>
              Your scores and insights are saved under this name. You can add more profiles later.
            </p>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") submit(); }}
              placeholder="Your name"
              autoFocus
              style={styles.welcomeInput}
            />
            <button
              onClick={submit}
              disabled={!name.trim()}
              style={{
                ...styles.welcomePrimaryBtn,
                opacity: name.trim() ? 1 : 0.4,
                cursor: name.trim() ? "pointer" : "not-allowed"
              }}
            >
              Continue
            </button>
            {allUsers.length > 0 && (
              <button onClick={() => { setShowAdd(false); setName(""); }} style={styles.welcomeBackBtn}>
                Back to profiles
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ProfilePickerOverlay({ allUsers, activeUserKey, onCreateUser, onSwitchUser, onDeleteUser, onClose }) {
  const [name, setName] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const submit = () => {
    if (!name.trim()) return;
    onCreateUser(name.trim());
    setName("");
    setShowAdd(false);
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.overlayCard} onClick={e => e.stopPropagation()}>
        <h2 style={styles.overlayTitle}>Switch profile</h2>

        <div style={styles.profileList}>
          {allUsers.map(u => (
            <div key={u.key} style={styles.profileRow}>
              <button
                onClick={() => onSwitchUser(u.key)}
                style={{
                  ...styles.profileSelectBtn,
                  ...(u.key === activeUserKey ? styles.profileSelectBtnActive : {})
                }}
              >
                <div style={styles.profileAvatar}>
                  {u.displayName.charAt(0).toUpperCase()}
                </div>
                <span style={styles.profileNameText}>{u.displayName}</span>
                {u.key === activeUserKey && (
                  <span style={styles.profileActiveTag}>Active</span>
                )}
              </button>
              {allUsers.length > 1 && (
                <button
                  onClick={() => onDeleteUser(u.key)}
                  style={styles.profileDeleteBtn}
                  aria-label={`Delete ${u.displayName}`}
                  title="Delete profile"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>

        {showAdd ? (
          <>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") submit(); }}
              placeholder="New profile name"
              autoFocus
              style={styles.welcomeInput}
            />
            <button
              onClick={submit}
              disabled={!name.trim()}
              style={{
                ...styles.bigPrimaryBtn,
                opacity: name.trim() ? 1 : 0.4,
                cursor: name.trim() ? "pointer" : "not-allowed"
              }}
            >
              Add profile
            </button>
            <button onClick={() => { setShowAdd(false); setName(""); }} style={styles.bigSecondaryBtn}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setShowAdd(true)} style={styles.bigPrimaryBtn}>
              + Add new profile
            </button>
            <button onClick={onClose} style={styles.bigSecondaryBtn}>Close</button>
          </>
        )}
      </div>
    </div>
  );
}

// === STYLES ===
const styles = {
  shell: {
    minHeight: "100vh",
    backgroundColor: PAPER,
    color: INK,
    fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
    fontSize: 16,
    lineHeight: 1.5,
    paddingBottom: 60
  },
  header: {
    position: "sticky",
    top: 0,
    zIndex: 5,
    backgroundColor: PAPER,
    borderBottom: `1px solid ${RULE}`,
    padding: "14px 20px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center"
  },
  logoMark: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: GREEN,
    color: "#ffffff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 20,
    fontWeight: 700
  },
  brand: {
    fontWeight: 700,
    fontSize: 18,
    letterSpacing: "-0.01em",
    lineHeight: 1
  },
  tagline: {
    fontSize: 11,
    color: MUTED,
    marginTop: 2,
    letterSpacing: "0.04em",
    textTransform: "uppercase"
  },
  nav: {
    display: "flex",
    gap: 4
  },
  navBtn: {
    padding: "8px 14px",
    borderRadius: 6,
    border: "none",
    background: "transparent",
    color: MUTED,
    fontFamily: "inherit",
    fontSize: 14,
    cursor: "pointer",
    fontWeight: 500
  },
  navBtnActive: {
    padding: "8px 14px",
    borderRadius: 6,
    border: "none",
    background: GREEN_SOFT,
    color: GREEN,
    fontFamily: "inherit",
    fontSize: 14,
    cursor: "pointer",
    fontWeight: 600
  },
  main: {
    maxWidth: 720,
    margin: "0 auto",
    padding: "16px"
  },
  // HOME
  homeContainer: {
    display: "flex",
    flexDirection: "column",
    gap: 16
  },
  heroCard: {
    backgroundColor: CARD,
    border: `1px solid ${RULE}`,
    borderRadius: 14,
    padding: "28px 22px",
    position: "relative"
  },
  eyebrow: {
    fontSize: 11,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: GREEN,
    fontWeight: 600,
    marginBottom: 8
  },
  h1: {
    fontSize: 32,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    margin: "0 0 10px",
    lineHeight: 1.1
  },
  lede: {
    fontSize: 15,
    color: MUTED,
    margin: "0 0 20px",
    maxWidth: 480
  },
  progressRow: {
    display: "flex",
    alignItems: "center",
    gap: 12
  },
  progressBar: {
    flex: 1,
    height: 6,
    backgroundColor: "#ebe9e2",
    borderRadius: 3,
    overflow: "hidden"
  },
  progressFill: {
    height: "100%",
    backgroundColor: GREEN,
    transition: "width 0.5s ease"
  },
  progressLabel: {
    fontSize: 12,
    color: MUTED,
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums"
  },
  controlsCard: {
    backgroundColor: CARD,
    border: `1px solid ${RULE}`,
    borderRadius: 14,
    padding: 20,
    display: "flex",
    flexDirection: "column",
    gap: 16
  },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    fontSize: 13,
    color: MUTED,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em"
  },
  select: {
    fontFamily: "inherit",
    fontSize: 16,
    padding: "12px 14px",
    border: `1px solid ${RULE}`,
    borderRadius: 8,
    backgroundColor: PAPER,
    color: INK,
    fontWeight: 500,
    appearance: "none",
    backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'><path d='M1 1l5 5 5-5' stroke='%236b6b6b' stroke-width='1.5' fill='none'/></svg>\")",
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 14px center"
  },
  toggleRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 15,
    color: INK,
    fontWeight: 500
  },
  toggle: {
    width: 46,
    height: 26,
    borderRadius: 13,
    border: "none",
    cursor: "pointer",
    position: "relative",
    transition: "background-color 0.2s ease",
    padding: 0
  },
  toggleKnob: {
    position: "absolute",
    top: 2,
    left: 0,
    width: 22,
    height: 22,
    borderRadius: "50%",
    backgroundColor: "#ffffff",
    boxShadow: "0 2px 4px rgba(0,0,0,0.15)",
    transition: "transform 0.2s ease"
  },
  modeGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12
  },
  modeCardPrimary: {
    backgroundColor: GREEN,
    color: "#ffffff",
    border: "none",
    borderRadius: 14,
    padding: "20px 18px",
    textAlign: "left",
    cursor: "pointer",
    fontFamily: "inherit",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minHeight: 140,
    position: "relative"
  },
  modeCardSecondary: {
    backgroundColor: CARD,
    color: INK,
    border: `1px solid ${RULE}`,
    borderRadius: 14,
    padding: "20px 18px",
    textAlign: "left",
    cursor: "pointer",
    fontFamily: "inherit",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minHeight: 140,
    position: "relative"
  },
  modeKicker: {
    fontSize: 10,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    fontWeight: 600,
    opacity: 0.85
  },
  modeTitle: {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: "-0.01em",
    marginTop: 6
  },
  modeDesc: {
    fontSize: 13,
    opacity: 0.85,
    marginTop: 4,
    flex: 1
  },
  modeArrow: {
    fontSize: 22,
    fontWeight: 300,
    alignSelf: "flex-end"
  },
  bankNotice: {
    backgroundColor: "#fff8e7",
    border: "1px solid #f0d99a",
    borderRadius: 10,
    padding: "14px 16px",
    fontSize: 14,
    color: "#7a5a00",
    cursor: "pointer"
  },
  schedulesCard: {
    position: "relative",
    background: GREEN_SOFT,
    border: `1.5px solid ${GREEN_BORDER}`,
    borderRadius: 12,
    padding: "16px 18px 14px",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    fontFamily: "inherit"
  },
  schedulesCardKicker: {
    fontSize: 10,
    color: GREEN,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontWeight: 700
  },
  schedulesCardTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: INK
  },
  schedulesCardDesc: {
    fontSize: 13,
    color: MUTED,
    lineHeight: 1.45,
    marginBottom: 6
  },
  schedulesCardStats: {
    display: "flex",
    gap: 14,
    marginTop: 4
  },
  schedulesCardStat: {
    flex: "0 0 auto"
  },
  schedulesCardStatVal: {
    fontSize: 16,
    fontWeight: 700,
    color: INK
  },
  schedulesCardStatLbl: {
    fontSize: 10,
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginTop: 2
  },
  // SESSION
  sessionContainer: {
    display: "flex",
    flexDirection: "column",
    gap: 14
  },
  sessionTopBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap"
  },
  stopBtn: {
    background: "transparent",
    border: "none",
    color: MUTED,
    fontFamily: "inherit",
    fontSize: 14,
    cursor: "pointer",
    padding: "6px 0"
  },
  sessionMeta: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
    flex: 1,
    justifyContent: "center"
  },
  metaPill: {
    fontSize: 11,
    padding: "4px 10px",
    borderRadius: 100,
    backgroundColor: GREEN_SOFT,
    color: GREEN,
    fontWeight: 600,
    letterSpacing: "0.02em",
    textTransform: "uppercase"
  },
  sessionProgress: {
    fontSize: 13,
    fontWeight: 600,
    color: MUTED,
    fontVariantNumeric: "tabular-nums"
  },
  timer: {
    height: 4,
    backgroundColor: "#ebe9e2",
    borderRadius: 2,
    overflow: "hidden",
    position: "relative"
  },
  timerBar: {
    height: "100%",
    transition: "width 1s linear, background-color 0.3s ease"
  },
  timerLabel: {
    position: "absolute",
    right: 0,
    top: 8,
    fontSize: 11,
    color: MUTED,
    fontWeight: 600
  },
  questionCard: {
    backgroundColor: CARD,
    border: `1px solid ${RULE}`,
    borderRadius: 14,
    padding: "22px 20px"
  },
  scenario: {
    fontSize: 15,
    color: INK,
    marginBottom: 14,
    whiteSpace: "pre-wrap"
  },
  leadIn: {
    fontSize: 17,
    fontWeight: 600,
    color: INK,
    marginBottom: 16,
    letterSpacing: "-0.005em"
  },
  guessRow: {
    marginBottom: 12,
    paddingBottom: 12,
    borderBottom: `1px solid ${RULE}`
  },
  guessLabel: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 14,
    color: MUTED,
    cursor: "pointer",
    userSelect: "none"
  },
  guessCheck: {
    width: 18,
    height: 18,
    accentColor: GREEN,
    cursor: "pointer"
  },
  options: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginBottom: 16
  },
  option: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "14px 14px",
    border: `1.5px solid ${RULE}`,
    borderRadius: 10,
    backgroundColor: CARD,
    color: INK,
    fontFamily: "inherit",
    fontSize: 15,
    textAlign: "left",
    cursor: "pointer",
    transition: "border-color 0.15s ease, background-color 0.15s ease",
    width: "100%"
  },
  optionSelected: {
    borderColor: GREEN,
    backgroundColor: GREEN_SOFT
  },
  optionCorrect: {
    borderColor: GREEN,
    backgroundColor: GREEN_SOFT,
    color: GREEN
  },
  optionWrong: {
    borderColor: RED,
    backgroundColor: RED_SOFT,
    color: RED
  },
  optionDimmed: {
    opacity: 0.5
  },
  optionLabel: {
    fontWeight: 700,
    fontSize: 14,
    flexShrink: 0,
    width: 22,
    height: 22,
    borderRadius: "50%",
    backgroundColor: "currentColor",
    color: "#ffffff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1
  },
  optionText: {
    flex: 1,
    lineHeight: 1.4
  },
  submitBtn: {
    width: "100%",
    padding: "14px",
    backgroundColor: GREEN,
    color: "#ffffff",
    border: "none",
    borderRadius: 10,
    fontFamily: "inherit",
    fontSize: 16,
    fontWeight: 600,
    transition: "opacity 0.15s ease"
  },
  // EXPLANATION
  explanation: {
    marginTop: 6
  },
  verdict: {
    padding: "14px 16px",
    borderRadius: 10,
    border: "1px solid",
    marginBottom: 18
  },
  verdictTitle: {
    fontSize: 16,
    fontWeight: 700,
    marginBottom: 2
  },
  verdictBody: {
    fontSize: 13,
    opacity: 0.85
  },
  explainSection: {
    marginBottom: 20
  },
  explainHeading: {
    fontSize: 12,
    color: MUTED,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    margin: "0 0 10px"
  },
  explainBody: {
    fontSize: 15,
    color: INK,
    margin: 0,
    lineHeight: 1.55
  },
  citation: {
    marginTop: 10,
    padding: "10px 12px",
    backgroundColor: GREEN_SOFT,
    borderLeft: `3px solid ${GREEN}`,
    borderRadius: "0 6px 6px 0",
    fontSize: 13,
    color: INK,
    lineHeight: 1.45
  },
  citationLabel: {
    display: "block",
    fontSize: 10,
    fontWeight: 700,
    color: GREEN,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    marginBottom: 4
  },
  wrongReason: {
    display: "flex",
    gap: 12,
    padding: "10px 0",
    borderTop: `1px solid ${RULE}`,
    fontSize: 14
  },
  wrongLabel: {
    flexShrink: 0,
    width: 22,
    height: 22,
    borderRadius: "50%",
    backgroundColor: RED_SOFT,
    color: RED,
    fontWeight: 700,
    fontSize: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1
  },
  wrongText: {
    flex: 1,
    color: INK,
    lineHeight: 1.5
  },
  nextBtn: {
    width: "100%",
    padding: "14px",
    backgroundColor: GREEN,
    color: "#ffffff",
    border: "none",
    borderRadius: 10,
    fontFamily: "inherit",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 8
  },
  scorePeek: {
    textAlign: "center",
    fontSize: 13,
    color: MUTED,
    fontVariantNumeric: "tabular-nums"
  },
  // COMPLETE
  completeContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "40px 20px",
    textAlign: "center"
  },
  completeBig: {
    fontSize: 96,
    fontWeight: 700,
    color: GREEN,
    letterSpacing: "-0.04em",
    lineHeight: 1
  },
  completeLabel: {
    fontSize: 14,
    color: MUTED,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    marginTop: 8,
    marginBottom: 32
  },
  completeStats: {
    display: "flex",
    gap: 32,
    marginBottom: 36
  },
  completeStat: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center"
  },
  completeStatValue: {
    fontSize: 32,
    fontWeight: 700,
    color: INK,
    fontVariantNumeric: "tabular-nums"
  },
  completeStatLabel: {
    fontSize: 12,
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    marginTop: 4
  },
  completeButtons: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    width: "100%",
    maxWidth: 320
  },
  bigPrimaryBtn: {
    width: "100%",
    padding: "14px 20px",
    backgroundColor: GREEN,
    color: "#ffffff",
    border: "none",
    borderRadius: 10,
    fontFamily: "inherit",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer"
  },
  bigSecondaryBtn: {
    width: "100%",
    padding: "14px 20px",
    backgroundColor: "transparent",
    color: GREEN,
    border: `1.5px solid ${GREEN}`,
    borderRadius: 10,
    fontFamily: "inherit",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer"
  },
  // INSIGHTS
  insightsContainer: {
    display: "flex",
    flexDirection: "column",
    gap: 16
  },
  insightsTopRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: 8
  },
  statCard: {
    backgroundColor: CARD,
    border: `1px solid ${RULE}`,
    borderRadius: 12,
    padding: "16px 12px",
    textAlign: "center"
  },
  statBig: {
    fontSize: 28,
    fontWeight: 700,
    color: GREEN,
    letterSpacing: "-0.02em",
    fontVariantNumeric: "tabular-nums",
    lineHeight: 1
  },
  statLabel: {
    fontSize: 11,
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginTop: 6,
    fontWeight: 600
  },
  statSub: {
    fontSize: 11,
    color: MUTED,
    marginTop: 4
  },
  insightsSection: {
    backgroundColor: CARD,
    border: `1px solid ${RULE}`,
    borderRadius: 12,
    padding: "16px 18px"
  },
  sectionTitle: {
    fontSize: 12,
    color: MUTED,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    margin: "0 0 12px"
  },
  topicRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 0",
    borderTop: `1px solid ${RULE}`,
    gap: 8
  },
  topicName: {
    fontSize: 14,
    fontWeight: 500,
    color: INK,
    flex: 1
  },
  topicStats: {
    display: "flex",
    gap: 10,
    alignItems: "center"
  },
  topicAccuracy: {
    fontSize: 18,
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums"
  },
  topicCount: {
    fontSize: 11,
    color: MUTED
  },
  topicFlag: {
    fontSize: 11,
    color: "#a86b00",
    fontWeight: 600,
    backgroundColor: "#fff3d6",
    padding: "3px 8px",
    borderRadius: 100
  },
  flagNote: {
    fontSize: 13,
    color: MUTED,
    marginBottom: 8,
    lineHeight: 1.45
  },
  diffRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "8px 0",
    borderTop: `1px solid ${RULE}`
  },
  diffLabel: {
    fontSize: 14,
    fontWeight: 500,
    textTransform: "capitalize"
  },
  diffStat: {
    fontSize: 14,
    color: GREEN,
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums"
  },
  daysGrid: {
    display: "flex",
    gap: 6,
    alignItems: "flex-end"
  },
  dayCell: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6
  },
  dayDate: {
    fontSize: 10,
    color: MUTED,
    fontVariantNumeric: "tabular-nums"
  },
  dayBar: {
    width: "100%",
    height: 60,
    backgroundColor: "#ebe9e2",
    borderRadius: 4,
    display: "flex",
    alignItems: "flex-end",
    overflow: "hidden"
  },
  dayBarFill: {
    width: "100%",
    backgroundColor: GREEN,
    minHeight: 2,
    transition: "height 0.4s ease"
  },
  dayStat: {
    fontSize: 10,
    color: MUTED,
    fontVariantNumeric: "tabular-nums"
  },
  emptyInsights: {
    backgroundColor: CARD,
    border: `1px solid ${RULE}`,
    borderRadius: 12,
    padding: 30,
    textAlign: "center",
    color: MUTED,
    fontSize: 14
  },
  muted: {
    color: MUTED,
    fontSize: 13
  },
  resetBtn: {
    background: "transparent",
    border: `1px solid ${RULE}`,
    color: MUTED,
    padding: "10px 16px",
    borderRadius: 8,
    fontFamily: "inherit",
    fontSize: 13,
    cursor: "pointer",
    alignSelf: "center",
    marginTop: 8
  },
  dangerBtn: {
    background: "transparent",
    border: "none",
    color: RED,
    padding: "10px 16px",
    fontFamily: "inherit",
    fontSize: 13,
    cursor: "pointer",
    textDecoration: "underline",
    marginTop: 4
  },
  // OVERLAY
  overlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    zIndex: 100
  },
  overlayCard: {
    backgroundColor: CARD,
    borderRadius: 14,
    padding: "26px 22px",
    maxWidth: 440,
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: 14
  },
  overlayTitle: {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: "-0.01em",
    margin: 0,
    color: INK
  },
  overlayText: {
    fontSize: 15,
    color: MUTED,
    margin: 0,
    lineHeight: 1.5
  },
  overlayButtons: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginTop: 6
  },
  // PROFILE / WELCOME
  profileBtn: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    border: `1.5px solid ${GREEN_BORDER}`,
    backgroundColor: GREEN_SOFT,
    color: GREEN,
    fontFamily: "inherit",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 4
  },
  welcomeShell: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    backgroundColor: PAPER
  },
  welcomeCard: {
    backgroundColor: CARD,
    border: `1px solid ${RULE}`,
    borderRadius: 16,
    padding: "32px 24px",
    maxWidth: 420,
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    alignItems: "center"
  },
  welcomeLogo: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: GREEN,
    color: "#ffffff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 28,
    fontWeight: 700,
    marginBottom: 4
  },
  welcomeBrand: {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: "-0.01em",
    color: INK
  },
  welcomeTagline: {
    fontSize: 12,
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    marginBottom: 16
  },
  welcomeHeading: {
    fontSize: 18,
    fontWeight: 700,
    color: INK,
    alignSelf: "stretch",
    marginTop: 8
  },
  welcomeBlurb: {
    fontSize: 14,
    color: MUTED,
    margin: 0,
    lineHeight: 1.5,
    alignSelf: "stretch"
  },
  welcomeInput: {
    width: "100%",
    boxSizing: "border-box",
    fontFamily: "inherit",
    fontSize: 16,
    padding: "14px 14px",
    border: `1.5px solid ${RULE}`,
    borderRadius: 10,
    backgroundColor: PAPER,
    color: INK,
    outline: "none"
  },
  welcomePrimaryBtn: {
    width: "100%",
    padding: "14px",
    backgroundColor: GREEN,
    color: "#ffffff",
    border: "none",
    borderRadius: 10,
    fontFamily: "inherit",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer"
  },
  welcomeAddBtn: {
    width: "100%",
    padding: "12px",
    backgroundColor: "transparent",
    color: GREEN,
    border: `1.5px dashed ${GREEN_BORDER}`,
    borderRadius: 10,
    fontFamily: "inherit",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 4
  },
  welcomeBackBtn: {
    background: "transparent",
    border: "none",
    color: MUTED,
    fontFamily: "inherit",
    fontSize: 13,
    cursor: "pointer",
    padding: "4px 0"
  },
  profileList: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginTop: 4
  },
  profileRow: {
    display: "flex",
    gap: 6,
    alignItems: "stretch"
  },
  profileSelectBtn: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    backgroundColor: CARD,
    border: `1.5px solid ${RULE}`,
    borderRadius: 10,
    fontFamily: "inherit",
    fontSize: 15,
    cursor: "pointer",
    color: INK,
    textAlign: "left"
  },
  profileSelectBtnActive: {
    borderColor: GREEN,
    backgroundColor: GREEN_SOFT
  },
  profileAvatar: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    backgroundColor: GREEN,
    color: "#ffffff",
    fontWeight: 700,
    fontSize: 16,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0
  },
  profileNameText: {
    flex: 1,
    fontWeight: 500
  },
  profileActiveTag: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: GREEN,
    backgroundColor: "transparent"
  },
  profileDeleteBtn: {
    width: 36,
    backgroundColor: "transparent",
    border: `1.5px solid ${RULE}`,
    borderRadius: 10,
    color: MUTED,
    fontSize: 18,
    cursor: "pointer",
    fontFamily: "inherit"
  },
  // USER BANNER (insights page)
  userBanner: {
    backgroundColor: GREEN_SOFT,
    border: `1px solid ${GREEN_BORDER}`,
    borderRadius: 12,
    padding: "12px 16px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12
  },
  userBannerLabel: {
    fontSize: 11,
    color: GREEN,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.08em"
  },
  userBannerName: {
    fontSize: 16,
    fontWeight: 700,
    color: INK,
    marginTop: 2
  },
  userBannerBtn: {
    backgroundColor: "transparent",
    border: `1.5px solid ${GREEN}`,
    color: GREEN,
    padding: "6px 14px",
    borderRadius: 8,
    fontFamily: "inherit",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer"
  }
};
