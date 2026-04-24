// ─────────────────────────────────────────────────────────────────────────────
// B&L DASHBOARD BACKEND v1.1 — fixed Dialpad endpoint (/call not /calls)
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
  console.warn("⚠️  DIALPAD_API_KEY not set — API routes will fail until configured");
}

const dialpadHeaders = {
  "Authorization": `Bearer ${DIALPAD_KEY}`,
  "Content-Type": "application/json",
};

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "B&L Dashboard Backend",
    version: "1.1",
    dialpad_configured: !!DIALPAD_KEY,
    timestamp: new Date().toISOString(),
  });
});

// ── 1. GET /dialpad/calls ─────────────────────────────────────────────────────
// NOTE: Dialpad endpoint is /call (singular), not /calls
app.get("/dialpad/calls", async (req, res) => {
  try {
    const { started_after, target_id, target_type, cursor } = req.query;
    const after = started_after || (Date.now() - 86400000); // last 24h default

    const params = new URLSearchParams({
      started_after: after,
      ...(target_id && { target_id }),
      ...(target_type && { target_type }),
      ...(cursor && { cursor }),
    });

    const url = `${DIALPAD_BASE}/call?${params}`;
    console.log(`→ Dialpad GET ${url}`);

    const r = await fetch(url, { headers: dialpadHeaders });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`Dialpad ${r.status}: ${text}`);
    }
    const raw = await r.json();

    const calls = (raw.items || []).map(c => ({
      id: c.call_id || c.id,
      date_started: c.date_started,
      duration: c.duration || 0,
      direction: c.direction,
      disposition: c.state === "missed" || c.was_missed ? "missed" : "answered",
      external_number: c.external_number,
      internal_number: c.internal_number,
      contact_name: c.contact?.name || null,
      ai_actions: c.transcription?.action_items || c.action_items || [],
      ai_summary: c.transcription?.summary || c.summary || null,
      call_score: c.csat_score ?? c.coaching_score ?? null,
      call_purpose: c.transcription?.call_purpose || c.call_purpose || null,
    }));

    res.json({ calls, cursor: raw.cursor });
  } catch (err) {
    console.error("Dialpad /call error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 2. GET /dialpad/calls/:id ─────────────────────────────────────────────────
app.get("/dialpad/calls/:id", async (req, res) => {
  try {
    const r = await fetch(`${DIALPAD_BASE}/call/${req.params.id}`, { headers: dialpadHeaders });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`Dialpad ${r.status}: ${text}`);
    }
    const c = await r.json();

    res.json({
      id: c.call_id || c.id,
      date_started: c.date_started,
      duration: c.duration,
      direction: c.direction,
      disposition: c.state === "missed" || c.was_missed ? "missed" : "answered",
      external_number: c.external_number,
      contact_name: c.contact?.name || null,
      recording_url: c.recording?.download_url || null,
      transcript: c.transcription?.transcript || null,
      ai_actions: c.transcription?.action_items || c.action_items || [],
      ai_summary: c.transcription?.summary || c.summary || null,
      call_score: c.csat_score ?? c.coaching_score ?? null,
      call_purpose: c.transcription?.call_purpose || c.call_purpose || null,
      sentiment: c.transcription?.sentiment || null,
    });
  } catch (err) {
    console.error("Dialpad /call/:id error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 3. GET /dialpad/stats ─────────────────────────────────────────────────────
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

    if (data.report_id) {
      return res.json({ report_id: data.report_id, status: "pending" });
    }
    res.json(data);
  } catch (err) {
    console.error("Dialpad /stats error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✓ B&L Dashboard Backend v1.1 running on port ${PORT}`);
  console.log(`  Dialpad key: ${DIALPAD_KEY ? "✓ configured" : "✗ MISSING"}`);
});
