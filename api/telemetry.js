/**
 * Telemetry sink — receives chat events from /api/chat
 *
 * Stores in: Vercel function logs (always)
 * Forwards to Artem's PC if reachable (for Obsidian + SQLite persistence)
 */

export const config = { runtime: 'nodejs', maxDuration: 10 };

const PC_SINK = process.env.TELEMETRY_SINK_URL || ''; // e.g. https://xxx.trycloudflare.com/telemetry

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const event = req.body || {};
  event.received_at = new Date().toISOString();

  // Always log to Vercel function logs (visible in dashboard)
  console.log('[telemetry]', JSON.stringify({
    sid: event.session_id?.slice(0, 8),
    kind: event.kind,
    provider: event.provider,
    country: event.country,
    duration: event.duration_ms,
    user_preview: event.full_user?.slice(0, 80),
  }));

  // Forward to PC if configured (best-effort, fire-and-forget)
  if (PC_SINK) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      await fetch(PC_SINK, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
      clearTimeout(t);
    } catch (e) {
      // PC offline — fine, we have logs
    }
  }

  return res.status(200).json({ ok: true });
}
