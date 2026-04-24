// ─────────────────────────────────────────────────────────────────────────────
// B&L DASHBOARD BACKEND v1.2
// Adds: /api/v2/transcripts/{call_id} fetch for AI action items & transcript
// ─────────────────────────────────────────────────────────────────────────────

const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const DIALPAD_BASE = "https://dialpad.com/api/v2";
const DIALPAD_KEY = process.env.DIALPAD_API_KEY;

if (!DIALPAD_KEY) {
  console.warn("⚠️  DIALPAD_API_KEY not set");
}

const dialpadHeaders = {
  "Authorization": `Bearer ${DIALPAD_KEY}`,
  "Content-Type": "application/json",
};

// ── HEALTH ────────────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "B&L Dashboard Backend",
    version: "1.2",
    dialpad_configured: !!DIALPAD_KEY,
    timestamp: new Date().toISOString(),
  });
});

// ── Helper: extract action items from moments ────────────────────────────────
// Dialpad "moments" include action items, sentiment flags, etc.
// Each moment has a type — we pull type === "action_item"
function extractActionItems(moments) {
  if (!Array.isArray(moments)) return [];
  return moments
    .filter(m => (m.type || "").toLowerCase().includes("action"))
    .map(m => m.text || m.excerpt || m.description || "")
    .filter(Boolean);
}

// Helper: count sentiment moments
function extractSentiment(moments) {
  if (!Array.isArray(moments)) return { positive: 0, negative: 0 };
  let positive = 0, negative = 0;
  for (const m of moments) {
    const t = (m.type || "").toLowerCase();
    if (t.includes("positive")) positive++;
    if (t.includes("negative")) negative++;
  }
  return { positive, negative };
}

// ── 1. GET /dialpad/calls — recent call list (metadata only, fast) ───────────
app.get("/dialpad/calls", async (req, res) => {
  try {
    const { started_after, target_id, target_type, cursor } = req.query;
    const after = started_after || (Date.now() - 86400000);

    const params = new URLSearchParams({
      started_after: after,
      ...(target_id && { target_id }),
      ...(target_type && { target_type }),
      ...(cursor && { cursor }),
    });

    const r = await fetch(`${DIALPAD_BASE}/call?${params}`, { headers: dialpadHeaders });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`Dialpad ${r.status}: ${text}`);
    }
    const raw = await r.json();

    // Dedupe: same call rings multiple lines; group by external_number + rounded date
    const seen = new Map();
    for (const c of (raw.items || [])) {
      const key = `${c.external_number}_${Math.floor((c.date_started || 0) / 10000)}`;
      const existing = seen.get(key);
      // Keep the version with the longest duration (that's the one that got answered)
      if (!existing || (c.duration || 0) > (existing.duration || 0)) {
        seen.set(key, c);
      }
    }
    const deduped = Array.from(seen.values()).sort((a, b) => b.date_started - a.date_started);

    const calls = deduped.map(c => ({
      id: c.call_id || c.id,
      date_started: c.date_started,
      duration: c.duration || 0,
      direction: c.direction,
      disposition: c.state === "missed" || c.was_missed || (c.duration === 0 && c.direction === "inbound") ? "missed" : "answered",
      external_number: c.external_number,
      internal_number: c.internal_number,
      contact_name: c.contact?.name || null,
      // AI fields are null here; populated when user clicks detail
      ai_actions: [],
      ai_summary: null,
      call_score: null,
      call_purpose: null,
      has_transcript: (c.duration || 0) > 10000, // ~10s+ calls likely have transcripts
    }));

    res.json({ calls, cursor: raw.cursor, count: calls.length });
  } catch (err) {
    console.error("/dialpad/calls error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 2. GET /dialpad/calls/:id — call detail + transcript + action items ──────
app.get("/dialpad/calls/:id", async (req, res) => {
  const callId = req.params.id;
  try {
    // Fire both requests in parallel
    const [callR, transcriptR] = await Promise.all([
      fetch(`${DIALPAD_BASE}/call/${callId}`, { headers: dialpadHeaders }),
      fetch(`${DIALPAD_BASE}/transcripts/${callId}`, { headers: dialpadHeaders }),
    ]);

    if (!callR.ok) {
      const text = await callR.text();
      throw new Error(`Dialpad call ${callR.status}: ${text}`);
    }
    const c = await callR.json();

    // Transcript is optional — if it fails, return call data without it
    let transcript = null;
    let moments = [];
    let actionItems = [];
    let sentiment = { positive: 0, negative: 0 };
    let transcriptError = null;

    if (transcriptR.ok) {
      const t = await transcriptR.json();
      transcript = t.transcript || t.lines || t;
      moments = t.moments || [];
      actionItems = extractActionItems(moments);
      sentiment = extractSentiment(moments);
    } else {
      transcriptError = `Transcript unavailable (${transcriptR.status})`;
    }

    res.json({
      id: c.call_id || c.id,
      date_started: c.date_started,
      duration: c.duration,
      direction: c.direction,
      disposition: c.state === "missed" || c.was_missed ? "missed" : "answered",
      external_number: c.external_number,
      contact_name: c.contact?.name || null,
      recording_url: c.recording_url || c.recording?.download_url || null,
      transcript,
      moments,                     // full moments array
      ai_actions: actionItems,     // just the action-item moments
      sentiment,
      transcript_error: transcriptError,
      // AI Recap summary comes via webhooks, not available here yet
      ai_summary: null,
      call_score: null,
    });
  } catch (err) {
    console.error(`/dialpad/calls/${callId} error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 3. GET /dialpad/transcripts/:id — raw transcript passthrough (debug) ─────
app.get("/dialpad/transcripts/:id", async (req, res) => {
  try {
    const r = await fetch(`${DIALPAD_BASE}/transcripts/${req.params.id}`, { headers: dialpadHeaders });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`Dialpad transcripts ${r.status}: ${text}`);
    }
    const data = await r.json();
    res.json(data);
  } catch (err) {
    console.error("/dialpad/transcripts error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 4. GET /dialpad/stats — today's aggregate stats ──────────────────────────
app.get("/dialpad/stats", async (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const r = await fetch(`${DIALPAD_BASE}/stats`, {
      method: "POST",
      headers: dialpadHeaders,
      body: JSON.stringify({
        export_type: "records",
        stat_type: "calls",
        date_start: todayStart.getTime(),
        date_end: Date.now(),
      }),
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`Dialpad stats ${r.status}: ${text}`);
    }
    const data = await r.json();
    if (data.report_id) return res.json({ report_id: data.report_id, status: "pending" });
    res.json(data);
  } catch (err) {
    console.error("/dialpad/stats error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✓ B&L Dashboard Backend v1.2 running on port ${PORT}`);
  console.log(`  Dialpad key: ${DIALPAD_KEY ? "✓ configured" : "✗ MISSING"}`);
});
