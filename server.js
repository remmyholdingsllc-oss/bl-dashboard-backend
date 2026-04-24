// ─────────────────────────────────────────────────────────────────────────────
// B&L DASHBOARD BACKEND
// Express server that proxies Dialpad API calls for the dashboard
// ─────────────────────────────────────────────────────────────────────────────

const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(cors());                    // allow dashboard (any origin) to call us
app.use(express.json());            // parse JSON request bodies

// ── CONFIG ────────────────────────────────────────────────────────────────────
const DIALPAD_BASE = "https://dialpad.com/api/v2";
const DIALPAD_KEY = process.env.DIALPAD_API_KEY;

if (!DIALPAD_KEY) {
  console.warn("⚠️  DIALPAD_API_KEY not set — API routes will fail until configured");
}

const dialpadHeaders = {
  "Authorization": `Bearer ${DIALPAD_KEY}`,
  "Content-Type": "application/json",
};

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
// Hit this URL in a browser to confirm the server is running
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "B&L Dashboard Backend",
    dialpad_configured: !!DIALPAD_KEY,
    timestamp: new Date().toISOString(),
  });
});

// ── 1. GET /dialpad/calls ─────────────────────────────────────────────────────
// Returns recent calls with AI data (action items, summary, score)
app.get("/dialpad/calls", async (req, res) => {
  try {
    const { limit = 50, started_after, target_id } = req.query;
    const after = started_after || (Date.now() - 86400000); // last 24h default

    const params = new URLSearchParams({
      limit,
      started_after: after,
      ...(target_id && { target_id }),
    });

    const r = await fetch(`${DIALPAD_BASE}/calls?${params}`, { headers: dialpadHeaders });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`Dialpad ${r.status}: ${text}`);
    }
    const raw = await r.json();

    const calls = (raw.items || []).map(c => ({
      id: c.id,
      date_started: c.date_started,
      duration: c.duration || 0,
      direction: c.direction,
      disposition: c.state === "missed" || c.was_missed ? "missed" : "answered",
      external_number: c.external_number,
      internal_number: c.internal_number,
      contact_name: c.contact?.name || null,
      ai_actions: c.transcription?.action_items || [],
      ai_summary: c.transcription?.summary || null,
      call_score: c.csat_score ?? c.coaching_score ?? null,
      call_purpose: c.transcription?.call_purpose || null,
    }));

    res.json({ calls, cursor: raw.cursor });
  } catch (err) {
    console.error("Dialpad /calls error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 2. GET /dialpad/calls/:id ─────────────────────────────────────────────────
// Full detail for a single call
app.get("/dialpad/calls/:id", async (req, res) => {
  try {
    const r = await fetch(`${DIALPAD_BASE}/calls/${req.params.id}`, { headers: dialpadHeaders });
    if (!r.ok) throw new Error(`Dialpad ${r.status}`);
    const c = await r.json();

    res.json({
      id: c.id,
      date_started: c.date_started,
      duration: c.duration,
      direction: c.direction,
      disposition: c.state === "missed" || c.was_missed ? "missed" : "answered",
      external_number: c.external_number,
      contact_name: c.contact?.name || null,
      recording_url: c.recording?.download_url || null,
      transcript: c.transcription?.transcript || null,
      ai_actions: c.transcription?.action_items || [],
      ai_summary: c.transcription?.summary || null,
      call_score: c.csat_score ?? c.coaching_score ?? null,
      call_purpose: c.transcription?.call_purpose || null,
      sentiment: c.transcription?.sentiment || null,
    });
  } catch (err) {
    console.error("Dialpad /calls/:id error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 3. GET /dialpad/stats ─────────────────────────────────────────────────────
// Today's aggregate stats (uses /stats endpoint with polling)
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

    if (!r.ok) throw new Error(`Dialpad stats ${r.status}`);
    const data = await r.json();

    if (data.report_id) {
      return res.json({ report_id: data.report_id, status: "pending" });
    }
    res.json(data);
  } catch (err) {
    console.error("Dialpad /stats error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── START SERVER ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✓ B&L Dashboard Backend running on port ${PORT}`);
  console.log(`  Health check: http://localhost:${PORT}/`);
  console.log(`  Dialpad key: ${DIALPAD_KEY ? "✓ configured" : "✗ MISSING"}`);
});
