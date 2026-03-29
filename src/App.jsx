import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Papa from "papaparse";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, AreaChart, Area, Legend, ReferenceLine
} from "recharts";
import _ from "lodash";

// ─── THEME ────────────────────────────────────────────────────────────────────
const C = {
  bg: "#080a0e",
  surface: "#0e1117",
  card: "#13161d",
  border: "#1e2330",
  border2: "#252b3b",
  accent: "#c8f53c",  // electric lime
  accent2: "#3de6b8",  // teal
  accent3: "#f5a33c",  // amber
  accent4: "#e05cff",  // purple
  dim: "#4a5568",
  text: "#e8edf5",
  muted: "#6b7a99",
  red: "#ff4c6a",
};

// ─── UTILS ────────────────────────────────────────────────────────────────────
const parseDate = (s) => new Date(s);

const fmtDate = (dateStr) => {
  const d = new Date(dateStr);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${dd}.${mm}.${yyyy} ${hh}:${min}:${ss}`;
};

const fmtShortDate = (dateStr) => {
  const d = new Date(dateStr);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
};

const fmtChartDate = (dateStr) => {
  const d = new Date(dateStr);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}`;
};

// Epley 1RM formula
const calc1RM = (weight, reps) => {
  if (!weight || !reps || reps === 0) return 0;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
};

const parseDuration = (dur) => {
  if (!dur) return 0;
  let mins = 0;
  const h = dur.match(/(\d+)h/);
  const m = dur.match(/(\d+)m/);
  if (h) mins += parseInt(h[1]) * 60;
  if (m) mins += parseInt(m[1]);
  return mins;
};

const isWorkingSet = (setOrder) => {
  if (!setOrder) return false;
  const s = String(setOrder).trim().toUpperCase();
  return s !== 'W' && s !== '';
};

// ─── DATA PROCESSING ──────────────────────────────────────────────────────────
function processData(rows) {
  if (!rows || rows.length === 0) return null;

  const clean = rows.filter(r => r.Date && r['Exercise Name']);

  // Group by workout session (Date)
  const sessions = _.groupBy(clean, 'Date');
  const sessionDates = Object.keys(sessions).sort();

  // All unique exercises
  const exercises = _.uniq(clean.map(r => r['Exercise Name'])).sort();

  // Working sets only
  const working = clean.filter(r => isWorkingSet(r['Set Order']));

  // Per-session stats
  const workoutList = sessionDates.map(date => {
    const sets = sessions[date];
    const workingSets = sets.filter(r => isWorkingSet(r['Set Order']));
    const volume = _.sumBy(workingSets, r => (parseFloat(r.Weight) || 0) * (parseFloat(r.Reps) || 0));
    const exNames = _.uniq(sets.map(r => r['Exercise Name']));
    const duration = sets[0]?.Duration || '';
    return {
      date,
      workoutName: sets[0]?.['Workout Name'] || '',
      duration,
      durationMins: parseDuration(duration),
      volume: Math.round(volume),
      exerciseCount: exNames.length,
      exercises: exNames,
      setCount: workingSets.length,
    };
  });

  // Total stats
  const totalVolume = _.sumBy(workoutList, 'volume');
  const totalWorkouts = workoutList.length;
  const totalSets = working.length;
  const avgDuration = Math.round(_.meanBy(workoutList.filter(w => w.durationMins > 0 && w.durationMins < 300), 'durationMins') || 0);

  // Streak calculation (week starts Monday)
  const getDayOfWeek = (d) => {
    const day = new Date(d).getDay();
    return day === 0 ? 6 : day - 1; // 0=Mon, 6=Sun
  };

  const dateSet = new Set(sessionDates.map(d => d.split(' ')[0]));
  let streak = 0, longestStreak = 0, cur = 0;
  const today = new Date();
  let d = new Date(today);
  d.setHours(0, 0, 0, 0);
  while (true) {
    const key = d.toISOString().split('T')[0];
    if (dateSet.has(key)) { cur++; d.setDate(d.getDate() - 1); }
    else { d.setDate(d.getDate() - 1); if (cur > 0) break; if ((today - d) > 86400000 * 3) break; }
  }
  streak = cur;
  let maxStr = 1, currStr = 1;
  for (let i = 1; i < sessionDates.length; i++) {
    const prev = new Date(sessionDates[i - 1]);
    const curr = new Date(sessionDates[i]);
    const diff = (curr - prev) / 86400000;
    if (diff <= 1.5) { currStr++; maxStr = Math.max(maxStr, currStr); }
    else currStr = 1;
  }
  longestStreak = maxStr;

  // PRs per exercise
  const prs = {};
  exercises.forEach(ex => {
    const exSets = working.filter(r => r['Exercise Name'] === ex && parseFloat(r.Weight) > 0);
    if (exSets.length === 0) return;
    const best1RM = _.maxBy(exSets, r => calc1RM(parseFloat(r.Weight) || 0, parseFloat(r.Reps) || 0));
    const bestWeight = _.maxBy(exSets, r => parseFloat(r.Weight) || 0);
    const bestVol = _.maxBy(exSets, r => (parseFloat(r.Weight) || 0) * (parseFloat(r.Reps) || 0));
    prs[ex] = {
      best1RM: best1RM ? calc1RM(parseFloat(best1RM.Weight), parseFloat(best1RM.Reps)) : 0,
      best1RMDate: best1RM?.Date,
      bestWeight: parseFloat(bestWeight?.Weight || 0),
      bestWeightDate: bestWeight?.Date,
      bestVolumeSet: (parseFloat(bestVol?.Weight || 0)) * (parseFloat(bestVol?.Reps || 0)),
      bestVolDate: bestVol?.Date,
      totalSets: exSets.length,
    };
  });

  // Exercise progression over time (grouped by session date)
  const exProgression = {};
  exercises.forEach(ex => {
    const exSessions = _.groupBy(
      working.filter(r => r['Exercise Name'] === ex && parseFloat(r.Weight) > 0),
      r => r.Date.split(' ')[0]
    );
    const pts = Object.keys(exSessions).sort().map(date => {
      const sets = exSessions[date];
      const max1RM = _.maxBy(sets, r => calc1RM(parseFloat(r.Weight) || 0, parseFloat(r.Reps) || 0));
      const totalVol = _.sumBy(sets, r => (parseFloat(r.Weight) || 0) * (parseFloat(r.Reps) || 0));
      const bestSet = _.maxBy(sets, r => parseFloat(r.Weight) || 0);
      return {
        date,
        dateLabel: fmtChartDate(date),
        estimated1RM: max1RM ? calc1RM(parseFloat(max1RM.Weight), parseFloat(max1RM.Reps)) : 0,
        volume: Math.round(totalVol),
        bestWeight: parseFloat(bestSet?.Weight || 0),
        bestReps: parseFloat(bestSet?.Reps || 0),
      };
    });
    if (pts.length > 0) exProgression[ex] = pts;
  });

  // Weekly volume for heatmap
  const weeklyVolume = {};
  workoutList.forEach(w => {
    const d = new Date(w.date);
    // Get ISO week
    const day = d.getDay() || 7;
    const thu = new Date(d);
    thu.setDate(d.getDate() + 4 - day);
    const yearStart = new Date(thu.getFullYear(), 0, 1);
    const weekNum = Math.ceil((((thu - yearStart) / 86400000) + 1) / 7);
    const key = `${thu.getFullYear()}-W${weekNum}`;
    weeklyVolume[key] = (weeklyVolume[key] || 0) + w.volume;
  });

  // Volume over time (weekly)
  const weeklyData = Object.entries(weeklyVolume).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => ({
    week: k, volume: v
  }));

  // Most frequent exercises
  const exFrequency = _.countBy(working, r => r['Exercise Name']);
  const topExercises = Object.entries(exFrequency).sort(([, a], [, b]) => b - a).slice(0, 10);

  return {
    workoutList,
    exercises,
    totalWorkouts,
    totalVolume,
    totalSets,
    avgDuration,
    streak,
    longestStreak,
    prs,
    exProgression,
    weeklyData,
    topExercises,
    sessionDates,
    dateRange: { start: sessionDates[0], end: sessionDates[sessionDates.length - 1] },
  };
}

// ─── COMPONENTS ───────────────────────────────────────────────────────────────

const StatCard = ({ label, value, sub, accent = C.accent, icon }) => (
  <div style={{
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    padding: '20px 22px',
    position: 'relative',
    overflow: 'hidden',
  }}>
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, height: 2,
      background: `linear-gradient(90deg, ${accent}80, ${accent}20)`,
    }} />
    <div style={{ fontSize: 11, letterSpacing: '0.12em', color: C.muted, textTransform: 'uppercase', marginBottom: 8, fontFamily: 'monospace' }}>
      {icon && <span style={{ marginRight: 6 }}>{icon}</span>}{label}
    </div>
    <div style={{ fontSize: 28, fontWeight: 700, color: C.text, lineHeight: 1.1, fontFamily: '"Bebas Neue", "Impact", sans-serif', letterSpacing: '0.02em' }}>
      {value}
    </div>
    {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{sub}</div>}
  </div>
);

const CustomTooltipBase = ({ active, payload, label, unit = '', dateLabel = true }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#1a1d2a', border: `1px solid ${C.border2}`, borderRadius: 8,
      padding: '10px 14px', fontSize: 12, color: C.text,
    }}>
      {dateLabel && <div style={{ color: C.muted, marginBottom: 6, fontFamily: 'monospace' }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, display: 'inline-block' }} />
          <span style={{ color: C.muted }}>{p.name}:</span>
          <span style={{ fontWeight: 600 }}>{typeof p.value === 'number' ? p.value.toLocaleString() : p.value}{unit}</span>
        </div>
      ))}
    </div>
  );
};

const SectionTitle = ({ children, accent = C.accent }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
    <div style={{ width: 3, height: 18, background: accent, borderRadius: 2 }} />
    <h2 style={{ margin: 0, fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.text, fontFamily: 'monospace', fontWeight: 600 }}>
      {children}
    </h2>
  </div>
);

// Upload Screen
const UploadScreen = ({ onData }) => {
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef();

  const handleFile = (file) => {
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => { onData(result.data); },
    });
  };

  return (
    <div style={{
      minHeight: '100vh', background: C.bg, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 24,
      fontFamily: '"Bebas Neue", sans-serif',
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
      <div style={{ textAlign: 'center', maxWidth: 520 }}>
        <div style={{
          fontSize: 11, letterSpacing: '0.3em', color: C.accent, textTransform: 'uppercase',
          fontFamily: '"JetBrains Mono", monospace', marginBottom: 16,
        }}>
          STRONG WORKOUT ANALYTICS
        </div>
        <h1 style={{
          fontSize: 'clamp(52px, 10vw, 96px)', margin: '0 0 8px', lineHeight: 0.9,
          color: C.text, letterSpacing: '0.02em',
        }}>
          LIFT<span style={{ color: C.accent }}>.</span>
          <br />TRACK<span style={{ color: C.accent2 }}>.</span>
          <br />EVOLVE<span style={{ color: C.accent3 }}>.</span>
        </h1>
        <p style={{
          color: C.muted, fontFamily: '"JetBrains Mono", monospace',
          fontSize: 12, lineHeight: 1.7, margin: '24px 0 40px',
          letterSpacing: '0.02em',
        }}>
          Upload your Strong app CSV export to unlock<br />
          advanced analytics, PR tracking, and progression charts.
        </p>

        <div
          onClick={() => fileRef.current.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
          style={{
            border: `2px dashed ${dragging ? C.accent : C.border2}`,
            borderRadius: 16,
            padding: '48px 32px',
            cursor: 'pointer',
            transition: 'all 0.2s',
            background: dragging ? `${C.accent}08` : 'transparent',
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 12 }}>⬆</div>
          <div style={{
            color: dragging ? C.accent : C.text,
            fontFamily: '"JetBrains Mono", monospace', fontSize: 13, transition: 'color 0.2s',
          }}>
            Drop your CSV here or <span style={{ color: C.accent, textDecoration: 'underline' }}>click to browse</span>
          </div>
          <div style={{ color: C.muted, fontFamily: '"JetBrains Mono", monospace', fontSize: 11, marginTop: 8 }}>
            Export from Strong app → Profile → Export Workouts
          </div>
        </div>
        <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }}
          onChange={e => handleFile(e.target.files[0])} />
      </div>
    </div>
  );
};

// Exercise Progression View
const ExerciseView = ({ data, exercise }) => {
  const [metric, setMetric] = useState('oneRM');
  const prog = data.exProgression[exercise];
  const pr = data.prs[exercise];

  if (!prog || prog.length === 0) {
    return <div style={{ color: C.muted, padding: 20, fontFamily: 'monospace', fontSize: 13 }}>
      No weighted sets found for this exercise.
    </div>;
  }

  const chartData = prog;
  const allTime1RM = Math.max(...prog.map(p => p.estimated1RM));
  const allTimeVol = Math.max(...prog.map(p => p.volume));

  const metrics = [
    { key: 'oneRM', label: 'Est. 1RM', color: C.accent, unit: 'kg', dataKey: 'estimated1RM' },
    { key: 'volume', label: 'Session Volume', color: C.accent2, unit: 'kg', dataKey: 'volume' },
    { key: 'bestWeight', label: 'Best Weight', color: C.accent3, unit: 'kg', dataKey: 'bestWeight' },
  ];
  const active = metrics.find(m => m.key === metric);

  // Calculate progression %
  const first = prog[0]?.[active.dataKey] || 0;
  const last = prog[prog.length - 1]?.[active.dataKey] || 0;
  const pct = first > 0 ? ((last - first) / first * 100).toFixed(1) : null;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {metrics.map(m => (
          <button key={m.key} onClick={() => setMetric(m.key)} style={{
            background: metric === m.key ? m.color : 'transparent',
            color: metric === m.key ? '#000' : C.muted,
            border: `1px solid ${metric === m.key ? m.color : C.border}`,
            borderRadius: 6, padding: '6px 14px', cursor: 'pointer',
            fontSize: 11, fontFamily: 'monospace', letterSpacing: '0.08em',
            textTransform: 'uppercase', transition: 'all 0.15s', fontWeight: 600,
          }}>
            {m.label}
          </button>
        ))}
      </div>

      {/* Mini stat row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
        <div style={{ background: C.surface, borderRadius: 8, padding: '12px 14px', border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 10, color: C.muted, fontFamily: 'monospace', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>PR 1RM</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.accent, fontFamily: '"Bebas Neue",sans-serif' }}>{pr?.best1RM || '—'}<span style={{ fontSize: 12, color: C.muted }}> kg</span></div>
        </div>
        <div style={{ background: C.surface, borderRadius: 8, padding: '12px 14px', border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 10, color: C.muted, fontFamily: 'monospace', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>Best Weight</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.accent3, fontFamily: '"Bebas Neue",sans-serif' }}>{pr?.bestWeight || '—'}<span style={{ fontSize: 12, color: C.muted }}> kg</span></div>
        </div>
        <div style={{ background: C.surface, borderRadius: 8, padding: '12px 14px', border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 10, color: C.muted, fontFamily: 'monospace', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>Total Sets</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.accent2, fontFamily: '"Bebas Neue",sans-serif' }}>{pr?.totalSets || 0}</div>
        </div>
      </div>

      {pct !== null && (
        <div style={{
          fontFamily: 'monospace', fontSize: 11, color: pct >= 0 ? C.accent : C.red,
          marginBottom: 12, letterSpacing: '0.05em',
        }}>
          {pct >= 0 ? '▲' : '▼'} {Math.abs(pct)}% {active.label} from first to last session ({prog.length} sessions logged)
        </div>
      )}

      <div style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id={`grad_${metric}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={active.color} stopOpacity={0.2} />
                <stop offset="95%" stopColor={active.color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
            <XAxis dataKey="dateLabel" tick={{ fill: C.muted, fontSize: 10, fontFamily: 'monospace' }} tickLine={false} axisLine={false}
              interval={Math.floor(chartData.length / 6)} />
            <YAxis tick={{ fill: C.muted, fontSize: 10, fontFamily: 'monospace' }} tickLine={false} axisLine={false}
              tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v} />
            <Tooltip content={<CustomTooltipBase unit={` ${active.unit}`} />} />
            <Area type="monotone" dataKey={active.dataKey} name={active.label}
              stroke={active.color} strokeWidth={2} fill={`url(#grad_${metric})`}
              dot={chartData.length < 30 ? { fill: active.color, strokeWidth: 0, r: 3 } : false}
              activeDot={{ r: 5, fill: active.color }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// Activity Heatmap - last 52 weeks
const ActivityHeatmap = ({ workoutList }) => {
  const weeks = useMemo(() => {
    const dateVol = {};
    workoutList.forEach(w => {
      const key = w.date.split(' ')[0];
      dateVol[key] = (dateVol[key] || 0) + w.volume;
    });

    // Build 52 weeks grid
    const today = new Date();
    // Go back to last Monday
    const dayOfWeek = today.getDay() || 7;
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - dayOfWeek + 1 - 51 * 7);
    startDate.setHours(0, 0, 0, 0);

    const grid = [];
    for (let w = 0; w < 52; w++) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + w * 7 + d);
        const key = date.toISOString().split('T')[0];
        week.push({ date: key, vol: dateVol[key] || 0, future: date > today });
      }
      grid.push(week);
    }
    return grid;
  }, [workoutList]);

  const maxVol = Math.max(...weeks.flat().map(d => d.vol));

  const getColor = (vol, future) => {
    if (future) return 'transparent';
    if (vol === 0) return C.border;
    const intensity = vol / maxVol;
    if (intensity < 0.25) return `${C.accent}40`;
    if (intensity < 0.5) return `${C.accent}70`;
    if (intensity < 0.75) return `${C.accent}aa`;
    return C.accent;
  };

  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', gap: 2, alignItems: 'flex-start', minWidth: 'max-content' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 4 }}>
          {days.map((d, i) => (
            <div key={i} style={{
              width: 10, height: 10, fontSize: 8, color: C.muted,
              fontFamily: 'monospace', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{i % 2 === 0 ? d : ''}</div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {week.map((day, di) => (
              <div key={di} title={day.future ? '' :
                `${fmtShortDate(day.date)}${day.vol ? ` — ${day.vol.toLocaleString()}kg vol` : ' — rest'}`}
                style={{
                  width: 10, height: 10, borderRadius: 2,
                  background: getColor(day.vol, day.future),
                  transition: 'background 0.15s',
                  cursor: day.vol > 0 ? 'pointer' : 'default',
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
        <span style={{ fontSize: 10, color: C.muted, fontFamily: 'monospace' }}>Less</span>
        {[0.1, 0.3, 0.55, 0.8, 1].map((v, i) => (
          <div key={i} style={{ width: 10, height: 10, borderRadius: 2, background: `${C.accent}${Math.round(v * 255).toString(16).padStart(2, '0')}` }} />
        ))}
        <span style={{ fontSize: 10, color: C.muted, fontFamily: 'monospace' }}>More</span>
      </div>
    </div>
  );
};

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [rawData, setRawData] = useState(null);
  const [selectedExercise, setSelectedExercise] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const [searchEx, setSearchEx] = useState('');
  const [historyPage, setHistoryPage] = useState(0);

  const data = useMemo(() => rawData ? processData(rawData) : null, [rawData]);

  const filteredExercises = useMemo(() => {
    if (!data) return [];
    return data.exercises.filter(ex => {
      const hasWeighted = data.prs[ex] && data.prs[ex].best1RM > 0;
      const matchSearch = searchEx === '' || ex.toLowerCase().includes(searchEx.toLowerCase());
      return hasWeighted && matchSearch;
    });
  }, [data, searchEx]);

  // Set default exercise
  const defaultEx = useMemo(() => {
    if (!data) return '';
    const bigLifts = ['Squat (Barbell)', 'Bench Press (Barbell)', 'Deadlift (Barbell)', 'Overhead Press (Barbell)'];
    for (const l of bigLifts) {
      if (data.exercises.includes(l)) return l;
    }
    return filteredExercises[0] || '';
  }, [data, filteredExercises]);

  const currentExercise = selectedExercise || defaultEx;

  // Service worker registration - moved here to comply with hooks rules (before early return)
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then(registration => {
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New content is available, notify user
                if (confirm('New version available! Would you like to update?')) {
                  window.location.reload();
                }
              }
            });
          });
        })
        .catch(error => console.log('Service worker registration failed:', error));
    }
  }, []);

  if (!data) return <UploadScreen onData={setRawData} />;

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'progression', label: 'Progression' },
    { key: 'prs', label: 'PRs & Records' },
    { key: 'history', label: 'History' },
  ];

  const HISTORY_PER_PAGE = 15;
  const historySlice = [...data.workoutList].reverse().slice(historyPage * HISTORY_PER_PAGE, (historyPage + 1) * HISTORY_PER_PAGE);

  return (
    <div style={{
      minHeight: '100vh', background: C.bg, color: C.text,
      fontFamily: '"JetBrains Mono", "Courier New", monospace',
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />

      {/* Noise overlay */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E")`,
        opacity: 0.4,
      }} />

      {/* HEADER */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: `${C.bg}e0`, backdropFilter: 'blur(16px)',
        borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 24, fontFamily: '"Bebas Neue",sans-serif', letterSpacing: '0.05em', color: C.text }}>
              LIFT<span style={{ color: C.accent }}>LOG</span>
            </span>
            <span style={{ fontSize: 10, color: C.muted, letterSpacing: '0.1em' }}>
              {fmtShortDate(data.dateRange.start)} — {fmtShortDate(data.dateRange.end)}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {tabs.map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
                background: activeTab === t.key ? `${C.accent}18` : 'transparent',
                color: activeTab === t.key ? C.accent : C.muted,
                border: activeTab === t.key ? `1px solid ${C.accent}40` : '1px solid transparent',
                borderRadius: 6, padding: '5px 12px', cursor: 'pointer',
                fontSize: 11, fontFamily: 'inherit', letterSpacing: '0.06em',
                textTransform: 'uppercase', transition: 'all 0.15s',
              }}>{t.label}</button>
            ))}
            <button onClick={() => setRawData(null)} style={{
              background: 'transparent', color: C.muted, border: `1px solid ${C.border}`,
              borderRadius: 6, padding: '5px 12px', cursor: 'pointer',
              fontSize: 11, fontFamily: 'inherit', marginLeft: 8,
            }}>↑ New File</button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 20px', position: 'relative', zIndex: 1 }}>

        {/* ── OVERVIEW TAB ── */}
        {activeTab === 'overview' && (
          <div>
            {/* Summary stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 28 }}>
              <StatCard label="Total Workouts" value={data.totalWorkouts.toLocaleString()} sub={`${data.exercises.length} exercises`} accent={C.accent} icon="🏋️" />
              <StatCard label="Total Volume" value={data.totalVolume >= 1e6 ? `${(data.totalVolume / 1e6).toFixed(2)}M` : `${(data.totalVolume / 1000).toFixed(1)}K`} sub="kg lifted" accent={C.accent2} icon="⚡" />
              <StatCard label="Total Sets" value={data.totalSets.toLocaleString()} sub="working sets" accent={C.accent3} icon="🎯" />
              <StatCard label="Avg Duration" value={`${data.avgDuration}m`} sub="per session" accent={C.accent4} icon="⏱" />
              <StatCard label="Longest Streak" value={`${data.longestStreak}d`} sub="consecutive days" accent={C.accent} icon="🔥" />
            </div>

            {/* Activity Heatmap */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 22px', marginBottom: 20 }}>
              <SectionTitle accent={C.accent}>Activity · Last 52 Weeks</SectionTitle>
              <ActivityHeatmap workoutList={data.workoutList} />
            </div>

            {/* Weekly volume chart */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 22px' }}>
                <SectionTitle accent={C.accent2}>Weekly Volume</SectionTitle>
                <div style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.weeklyData.slice(-24)} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                      <XAxis dataKey="week" tick={{ fill: C.muted, fontSize: 9, fontFamily: 'monospace' }} tickLine={false} axisLine={false}
                        tickFormatter={v => v.split('-W')[1] ? `W${v.split('-W')[1]}` : v}
                        interval={3} />
                      <YAxis tick={{ fill: C.muted, fontSize: 9, fontFamily: 'monospace' }} tickLine={false} axisLine={false}
                        tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                      <Tooltip content={<CustomTooltipBase unit=" kg" />} />
                      <Bar dataKey="volume" name="Volume" fill={C.accent2} radius={[3, 3, 0, 0]} fillOpacity={0.8} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Top Exercises */}
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 22px' }}>
                <SectionTitle accent={C.accent3}>Most Trained Exercises</SectionTitle>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {data.topExercises.map(([ex, count], i) => {
                    const pct = count / data.topExercises[0][1] * 100;
                    const colors = [C.accent, C.accent2, C.accent3, C.accent4];
                    const col = colors[i % colors.length];
                    return (
                      <div key={ex} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ fontSize: 10, color: C.muted, fontFamily: 'monospace', width: 16, textAlign: 'right' }}>{i + 1}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                            <span style={{ fontSize: 11, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{ex}</span>
                            <span style={{ fontSize: 10, color: C.muted }}>{count} sets</span>
                          </div>
                          <div style={{ height: 3, background: C.border, borderRadius: 2 }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: col, borderRadius: 2, transition: 'width 0.4s' }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Quick PR Summary */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 22px' }}>
              <SectionTitle accent={C.accent4}>Big Lift PRs</SectionTitle>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
                {['Squat (Barbell)', 'Bench Press (Barbell)', 'Deadlift (Barbell)', 'Overhead Press (Barbell)',
                  'Romanian Deadlift (Barbell)', 'Chin Up', 'Row (Barbell)'].filter(e => data.prs[e]).map(ex => {
                    const pr = data.prs[ex];
                    return (
                      <div key={ex} style={{
                        background: C.surface, borderRadius: 8, padding: '12px 14px',
                        border: `1px solid ${C.border}`, cursor: 'pointer',
                      }} onClick={() => { setSelectedExercise(ex); setActiveTab('progression'); }}>
                        <div style={{ fontSize: 10, color: C.muted, letterSpacing: '0.05em', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ex}</div>
                        <div style={{ display: 'flex', gap: 12 }}>
                          <div>
                            <div style={{ fontSize: 8, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>1RM</div>
                            <div style={{ fontSize: 20, fontWeight: 700, color: C.accent, fontFamily: '"Bebas Neue",sans-serif' }}>{pr.best1RM}<span style={{ fontSize: 10, color: C.muted }}> kg</span></div>
                          </div>
                          <div>
                            <div style={{ fontSize: 8, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Best</div>
                            <div style={{ fontSize: 20, fontWeight: 700, color: C.accent3, fontFamily: '"Bebas Neue",sans-serif' }}>{pr.bestWeight}<span style={{ fontSize: 10, color: C.muted }}> kg</span></div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        )}

        {/* ── PROGRESSION TAB ── */}
        {activeTab === 'progression' && (
          <div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Search exercise..."
                value={searchEx}
                onChange={e => setSearchEx(e.target.value)}
                style={{
                  background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
                  padding: '8px 14px', color: C.text, fontFamily: 'inherit', fontSize: 12,
                  width: 220, outline: 'none',
                }}
              />
              <div style={{
                display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1,
                maxHeight: 80, overflowY: 'auto',
              }}>
                {filteredExercises.slice(0, 20).map(ex => (
                  <button key={ex} onClick={() => setSelectedExercise(ex)} style={{
                    background: currentExercise === ex ? C.accent : 'transparent',
                    color: currentExercise === ex ? '#000' : C.muted,
                    border: `1px solid ${currentExercise === ex ? C.accent : C.border}`,
                    borderRadius: 6, padding: '5px 10px', cursor: 'pointer',
                    fontSize: 10, fontFamily: 'inherit', letterSpacing: '0.04em',
                    transition: 'all 0.15s', whiteSpace: 'nowrap',
                  }}>{ex}</button>
                ))}
              </div>
            </div>

            {currentExercise && (
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 22px' }}>
                <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <h2 style={{ margin: 0, fontSize: 20, fontFamily: '"Bebas Neue",sans-serif', letterSpacing: '0.05em', color: C.text }}>
                    {currentExercise}
                  </h2>
                  <div style={{ fontSize: 10, color: C.muted }}>
                    {data.exProgression[currentExercise]?.length || 0} sessions recorded
                  </div>
                </div>
                <ExerciseView data={data} exercise={currentExercise} />
              </div>
            )}

            {/* Comparison grid for top exercises */}
            <div style={{ marginTop: 20 }}>
              <SectionTitle accent={C.accent2}>All Exercise Progress</SectionTitle>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                {filteredExercises.slice(0, 12).map(ex => {
                  const prog = data.exProgression[ex];
                  if (!prog || prog.length < 2) return null;
                  const first1RM = prog[0].estimated1RM;
                  const last1RM = prog[prog.length - 1].estimated1RM;
                  const delta = first1RM > 0 ? ((last1RM - first1RM) / first1RM * 100).toFixed(1) : null;
                  const isUp = delta >= 0;

                  return (
                    <div key={ex} style={{
                      background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
                      padding: '14px 16px', cursor: 'pointer',
                      transition: 'border-color 0.15s',
                    }} onClick={() => { setSelectedExercise(ex); }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                        <div style={{ fontSize: 11, color: C.text, lineHeight: 1.3, maxWidth: 160 }}>{ex}</div>
                        {delta !== null && (
                          <div style={{
                            fontSize: 11, fontWeight: 600, color: isUp ? C.accent : C.red,
                            background: isUp ? `${C.accent}15` : `${C.red}15`,
                            padding: '2px 7px', borderRadius: 4,
                          }}>
                            {isUp ? '▲' : '▼'} {Math.abs(delta)}%
                          </div>
                        )}
                      </div>
                      <div style={{ height: 60 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={prog} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                            <Line type="monotone" dataKey="estimated1RM" stroke={isUp ? C.accent : C.red}
                              strokeWidth={1.5} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                        <span style={{ fontSize: 9, color: C.muted }}>1RM: {data.prs[ex]?.best1RM} kg</span>
                        <span style={{ fontSize: 9, color: C.muted }}>{prog.length} sessions</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── PRs TAB ── */}
        {activeTab === 'prs' && (
          <div>
            <SectionTitle accent={C.accent}>Personal Records</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 0 }}>
              <div style={{
                display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr',
                background: C.surface, borderRadius: '10px 10px 0 0',
                border: `1px solid ${C.border}`,
                padding: '10px 16px',
                fontSize: 9, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase',
              }}>
                <span>Exercise</span>
                <span style={{ textAlign: 'right' }}>Est. 1RM</span>
                <span style={{ textAlign: 'right' }}>Best Weight</span>
                <span style={{ textAlign: 'right' }}>Best Set Vol.</span>
                <span style={{ textAlign: 'right' }}>Sessions</span>
              </div>
              {Object.entries(data.prs)
                .filter(([, pr]) => pr.best1RM > 0)
                .sort(([, a], [, b]) => b.best1RM - a.best1RM)
                .map(([ex, pr], i) => (
                  <div key={ex} style={{
                    display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr',
                    padding: '12px 16px',
                    borderLeft: `1px solid ${C.border}`,
                    borderRight: `1px solid ${C.border}`,
                    borderBottom: `1px solid ${C.border}`,
                    background: i % 2 === 0 ? 'transparent' : `${C.surface}60`,
                    cursor: 'pointer', transition: 'background 0.1s',
                  }} onClick={() => { setSelectedExercise(ex); setActiveTab('progression'); }}>
                    <div>
                      <div style={{ fontSize: 12, color: C.text }}>{ex}</div>
                      <div style={{ fontSize: 9, color: C.muted, marginTop: 1 }}>
                        Last: {pr.best1RMDate ? fmtShortDate(pr.best1RMDate) : '—'}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', fontFamily: '"Bebas Neue",sans-serif', fontSize: 20, color: C.accent }}>
                      {pr.best1RM}<span style={{ fontSize: 10, color: C.muted }}> kg</span>
                    </div>
                    <div style={{ textAlign: 'right', fontFamily: '"Bebas Neue",sans-serif', fontSize: 20, color: C.accent3 }}>
                      {pr.bestWeight}<span style={{ fontSize: 10, color: C.muted }}> kg</span>
                    </div>
                    <div style={{ textAlign: 'right', fontFamily: '"Bebas Neue",sans-serif', fontSize: 20, color: C.accent2 }}>
                      {pr.bestVolumeSet.toFixed(0)}<span style={{ fontSize: 10, color: C.muted }}> kg</span>
                    </div>
                    <div style={{ textAlign: 'right', fontFamily: '"Bebas Neue",sans-serif', fontSize: 20, color: C.muted }}>
                      {pr.totalSets}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* ── HISTORY TAB ── */}
        {activeTab === 'history' && (
          <div>
            <SectionTitle accent={C.accent3}>Workout History</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {historySlice.map((w, i) => (
                <div key={w.date} style={{
                  background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
                  padding: '14px 18px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 14, color: C.text, fontWeight: 600, fontFamily: '"Bebas Neue",sans-serif', letterSpacing: '0.04em' }}>
                        {w.workoutName || 'Workout'}
                      </div>
                      <div style={{ fontSize: 10, color: C.muted, fontFamily: 'monospace', marginTop: 2 }}>
                        {fmtDate(w.date)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 9, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Duration</div>
                        <div style={{ fontSize: 14, color: C.accent, fontFamily: '"Bebas Neue",sans-serif' }}>{w.duration}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 9, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Volume</div>
                        <div style={{ fontSize: 14, color: C.accent2, fontFamily: '"Bebas Neue",sans-serif' }}>{w.volume >= 1000 ? `${(w.volume / 1000).toFixed(1)}k` : w.volume} kg</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 9, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Sets</div>
                        <div style={{ fontSize: 14, color: C.accent3, fontFamily: '"Bebas Neue",sans-serif' }}>{w.setCount}</div>
                      </div>
                    </div>
                  </div>
                  <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {w.exercises.map(ex => (
                      <span key={ex} style={{
                        fontSize: 9, padding: '3px 8px', borderRadius: 4,
                        background: `${C.border}`, color: C.muted, letterSpacing: '0.03em',
                      }}>{ex}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
              <button onClick={() => setHistoryPage(Math.max(0, historyPage - 1))} disabled={historyPage === 0} style={{
                background: 'transparent', border: `1px solid ${historyPage === 0 ? C.border : C.border2}`,
                color: historyPage === 0 ? C.dim : C.text, borderRadius: 6, padding: '6px 14px',
                cursor: historyPage === 0 ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 11,
              }}>← Prev</button>
              <span style={{ padding: '6px 14px', fontSize: 11, color: C.muted }}>
                {historyPage + 1} / {Math.ceil(data.workoutList.length / HISTORY_PER_PAGE)}
              </span>
              <button onClick={() => setHistoryPage(Math.min(Math.ceil(data.workoutList.length / HISTORY_PER_PAGE) - 1, historyPage + 1))}
                disabled={(historyPage + 1) * HISTORY_PER_PAGE >= data.workoutList.length} style={{
                  background: 'transparent', border: `1px solid ${(historyPage + 1) * HISTORY_PER_PAGE >= data.workoutList.length ? C.border : C.border2}`,
                  color: (historyPage + 1) * HISTORY_PER_PAGE >= data.workoutList.length ? C.dim : C.text,
                  borderRadius: 6, padding: '6px 14px',
                  cursor: (historyPage + 1) * HISTORY_PER_PAGE >= data.workoutList.length ? 'default' : 'pointer',
                  fontFamily: 'inherit', fontSize: 11,
                }}>Next →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}