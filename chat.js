/* ============================================================
   NIGHTBOX AI · chat widget
   Talks to ai.nightboxllc.com (your PC via Cloudflare Tunnel)
   ============================================================ */

// Same-origin endpoint — Vercel serverless function with multi-provider fallback:
//   1. Artem's PC bridge (Claude Max, free)  — primary
//   2. OpenRouter Claude Haiku (cheap)       — fallback
//   3. OpenRouter free Llama                 — last resort
// Always responds, even if PC is offline.
const AI_ENDPOINT = '/api/chat';
const AUTH_KEY = 'nightbox_auth';
const SESSION_KEY = 'nightbox_session_id';

const fab = document.getElementById('chatFab');
const panel = document.getElementById('chatPanel');
const closeBtn = document.getElementById('chatClose');
const form = document.getElementById('chatForm');
const input = document.getElementById('chatInputField');
const sendBtn = document.getElementById('chatSendBtn');
const messagesEl = document.getElementById('chatMessages');
const statusEl = document.getElementById('chatStatus');

const history = [];
let busy = false;

// ─── Open / close ───────────────────────────────────────────
fab.addEventListener('click', () => {
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  fab.classList.add('hide');
  setTimeout(() => input.focus(), 280);
  checkHealth();
});

closeBtn.addEventListener('click', () => {
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  fab.classList.remove('hide');
});

// ─── Auth: inline overlay (no native prompt — blocks CDP) ───
function ensureAuth() {
  return new Promise((resolve) => {
    const existing = localStorage.getItem(AUTH_KEY);
    if (existing) {
      resolve(existing);
      return;
    }

    // Build overlay
    const overlay = document.createElement('div');
    overlay.className = 'chat-auth-overlay';
    overlay.innerHTML = `
      <div class="chat-auth-card">
        <div class="chat-auth-orb"></div>
        <h3>Nightbox AI is private</h3>
        <p>Only authorized users can chat. Public info is on the site itself.</p>
        <input type="password" id="chatAuthInput" placeholder="passphrase" autocomplete="off" />
        <div class="chat-auth-actions">
          <button type="button" class="chat-auth-cancel">Cancel</button>
          <button type="button" class="chat-auth-ok">Unlock</button>
        </div>
      </div>
    `;
    panel.appendChild(overlay);

    const inputEl = overlay.querySelector('#chatAuthInput');
    const okBtn = overlay.querySelector('.chat-auth-ok');
    const cancelBtn = overlay.querySelector('.chat-auth-cancel');

    setTimeout(() => inputEl.focus(), 100);

    const submit = () => {
      const v = inputEl.value.trim();
      if (!v) return;
      localStorage.setItem(AUTH_KEY, v);
      overlay.remove();
      resolve(v);
    };
    const cancel = () => {
      overlay.remove();
      resolve(null);
    };

    okBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', cancel);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') cancel();
    });
  });
}

// ─── Health probe ───────────────────────────────────────────
async function checkHealth() {
  statusEl.textContent = 'ready';
  statusEl.className = 'chat-header-sub online';
}

// ─── Session id (persistent across page loads) ──────────────
function getSessionId() {
  let sid = localStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid = (crypto.randomUUID && crypto.randomUUID()) || (Date.now() + '-' + Math.random().toString(36).slice(2));
    localStorage.setItem(SESSION_KEY, sid);
  }
  return sid;
}

// ─── Markdown rendering (lightweight, no deps) ──────────────
// Supports: **bold**, *italic*, `inline code`, ```code blocks```, lists, headers, links, paragraphs
function renderMarkdown(text) {
  // Escape HTML first to prevent XSS — AI output is untrusted
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html = esc(text);

  // Code blocks (triple backticks) — must come BEFORE inline code
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
    `<pre class="chat-code"><code class="lang-${esc(lang || 'plain')}">${code.trim()}</code></pre>`);
  // Inline code
  html = html.replace(/`([^`\n]+)`/g, '<code class="chat-inline-code">$1</code>');
  // Bold + italic
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
  // Headers
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
  // Lists (bullet + numbered) — group consecutive list items
  html = html.replace(/(?:^|\n)((?:[\-\*] .+(?:\n|$))+)/g, (_, block) => {
    const items = block.trim().split('\n').map(l => `<li>${l.replace(/^[\-\*]\s+/, '')}</li>`).join('');
    return `\n<ul>${items}</ul>`;
  });
  html = html.replace(/(?:^|\n)((?:\d+\. .+(?:\n|$))+)/g, (_, block) => {
    const items = block.trim().split('\n').map(l => `<li>${l.replace(/^\d+\.\s+/, '')}</li>`).join('');
    return `\n<ol>${items}</ol>`;
  });
  // Links [text](url) — only http(s) URLs allowed
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  // Paragraphs (double newlines)
  html = html.split(/\n{2,}/).map(p =>
    p.match(/^<(ul|ol|pre|h\d)/) ? p : `<p>${p.replace(/\n/g, '<br>')}</p>`
  ).join('\n');
  return html;
}

// ─── Render a message ───────────────────────────────────────
function addMessage(role, text, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = `chat-msg ${role}`;
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  if (role === 'assistant' && opts.markdown !== false) {
    bubble.innerHTML = renderMarkdown(text || '');
  } else {
    bubble.textContent = text;
  }
  wrap.appendChild(bubble);
  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return bubble;
}

// ─── Send a message ─────────────────────────────────────────
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (busy) return;

  const text = input.value.trim();
  if (!text) return;

  // Auth is optional now — public users get the AI too, just unprivileged
  const auth = localStorage.getItem(AUTH_KEY) || '';

  input.value = '';
  busy = true;
  sendBtn.disabled = true;
  input.disabled = true;

  addMessage('user', text);
  history.push({ role: 'user', content: text });

  // Typing indicator
  const typing = addMessage('assistant', '');
  typing.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  typing.classList.add('typing');

  let fullText = '';
  let metaInfo = null;
  const t0 = Date.now();

  try {
    const r = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Nightbox-Auth': auth,
        'X-Session-Id': getSessionId(),
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({
        messages: history,
        session_id: getSessionId(),
        stream: true,
      }),
    });

    if (!r.ok) {
      typing.classList.remove('typing');
      const err = await r.json().catch(() => ({}));
      typing.textContent = err.message || `Service error (${r.status}). Email artem@nightboxllc.com.`;
      return;
    }

    // Streaming SSE consumer
    typing.classList.remove('typing');
    typing.innerHTML = '';
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const events = buf.split('\n\n');
      buf = events.pop() || '';

      for (const ev of events) {
        const line = ev.split('\n').find(l => l.startsWith('data: '));
        if (!line) continue;
        try {
          const obj = JSON.parse(line.slice(6));
          if (obj.type === 'meta') {
            metaInfo = obj;
            statusEl.textContent = obj.provider_label;
            statusEl.className = 'chat-header-sub online';
          } else if (obj.type === 'delta' && obj.text) {
            fullText += obj.text;
            // Re-render markdown of the growing text
            typing.innerHTML = renderMarkdown(fullText);
            messagesEl.scrollTop = messagesEl.scrollHeight;
          } else if (obj.type === 'done') {
            metaInfo = { ...(metaInfo || {}), duration_ms: obj.duration_ms || (Date.now() - t0) };
          } else if (obj.type === 'error') {
            fullText += `\n\n_(streaming error: ${obj.message || 'unknown'})_`;
            typing.innerHTML = renderMarkdown(fullText);
          }
        } catch { /* ignore parse errors */ }
      }
    }

    if (!fullText) {
      typing.textContent = '(empty response — try rephrasing)';
    }

    if (metaInfo?.provider_label) {
      const badge = document.createElement('div');
      badge.className = 'chat-provider-badge';
      const dur = metaInfo.duration_ms ? `${metaInfo.duration_ms}ms` : '?';
      badge.textContent = `via ${metaInfo.provider_label} · ${dur}`;
      typing.parentElement.appendChild(badge);
    }

    history.push({ role: 'assistant', content: fullText });
  } catch (err) {
    typing.classList.remove('typing');
    typing.textContent = `Cannot reach Nightbox AI (${err.message}). Backend may be offline. Email artem@nightboxllc.com.`;
  } finally {
    busy = false;
    sendBtn.disabled = false;
    input.disabled = false;
    input.focus();
  }
});

// ─── Inject widget styles ───────────────────────────────────
const style = document.createElement('style');
style.textContent = `
.chat-fab {
  position: fixed;
  bottom: 28px;
  right: 28px;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 22px;
  background: linear-gradient(135deg, #5b8def 0%, #b06dff 100%);
  color: white;
  border: none;
  border-radius: 999px;
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 8px 32px rgba(91, 141, 239, 0.35);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.chat-fab:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 40px rgba(91, 141, 239, 0.5);
}
.chat-fab.hide {
  transform: scale(0);
  opacity: 0;
  pointer-events: none;
}
.chat-fab-icon {
  font-size: 16px;
}
.chat-fab-pulse {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: linear-gradient(135deg, #5b8def 0%, #b06dff 100%);
  z-index: -1;
  animation: chat-fab-pulse 2.5s infinite;
}
@keyframes chat-fab-pulse {
  0% { transform: scale(1); opacity: 0.6; }
  100% { transform: scale(1.6); opacity: 0; }
}

.chat-panel {
  position: fixed;
  bottom: 28px;
  right: 28px;
  z-index: 1001;
  width: 400px;
  max-width: calc(100vw - 32px);
  height: 600px;
  max-height: calc(100vh - 56px);
  background: rgba(15, 15, 23, 0.96);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 18px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5);
  transform: translateY(20px) scale(0.95);
  opacity: 0;
  pointer-events: none;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.chat-panel.open {
  transform: translateY(0) scale(1);
  opacity: 1;
  pointer-events: auto;
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.3);
}
.chat-header-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 700;
  color: white;
}
.chat-orb {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: linear-gradient(135deg, #5b8def, #b06dff);
  box-shadow: 0 0 12px rgba(91, 141, 239, 0.6);
}
.chat-header-sub {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  margin-top: 4px;
  letter-spacing: 0.5px;
}
.chat-header-sub.online {
  color: #4ade80;
}
.chat-header-sub.offline {
  color: #f87171;
}
.chat-close {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.4);
  font-size: 20px;
  cursor: pointer;
  padding: 4px 10px;
  border-radius: 6px;
  transition: all 0.2s;
}
.chat-close:hover {
  background: rgba(255, 255, 255, 0.08);
  color: white;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.chat-messages::-webkit-scrollbar {
  width: 6px;
}
.chat-messages::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
}

.chat-msg {
  display: flex;
  max-width: 85%;
}
.chat-msg.user {
  align-self: flex-end;
}
.chat-msg.assistant {
  align-self: flex-start;
}

.chat-bubble {
  padding: 12px 16px;
  border-radius: 14px;
  font-size: 14px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
.chat-msg.user .chat-bubble {
  background: linear-gradient(135deg, #5b8def 0%, #b06dff 100%);
  color: white;
  border-bottom-right-radius: 4px;
}
.chat-msg.assistant .chat-bubble {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-bottom-left-radius: 4px;
}

/* Markdown-rendered content inside assistant bubble */
.chat-msg.assistant .chat-bubble p {
  margin: 0 0 8px 0;
}
.chat-msg.assistant .chat-bubble p:last-child { margin-bottom: 0; }
.chat-msg.assistant .chat-bubble strong { color: white; font-weight: 700; }
.chat-msg.assistant .chat-bubble em { color: rgba(255,255,255,0.85); }
.chat-msg.assistant .chat-bubble h2,
.chat-msg.assistant .chat-bubble h3,
.chat-msg.assistant .chat-bubble h4 {
  color: white;
  margin: 12px 0 6px 0;
  font-weight: 700;
}
.chat-msg.assistant .chat-bubble h2 { font-size: 16px; }
.chat-msg.assistant .chat-bubble h3 { font-size: 15px; }
.chat-msg.assistant .chat-bubble h4 { font-size: 14px; }
.chat-msg.assistant .chat-bubble ul,
.chat-msg.assistant .chat-bubble ol {
  margin: 6px 0;
  padding-left: 22px;
}
.chat-msg.assistant .chat-bubble li {
  margin: 3px 0;
}
.chat-msg.assistant .chat-bubble a {
  color: #8ab0ff;
  text-decoration: underline;
}
.chat-msg.assistant .chat-bubble a:hover {
  color: #b6cbff;
}
.chat-msg.assistant .chat-bubble .chat-inline-code {
  background: rgba(91, 141, 239, 0.15);
  padding: 1px 6px;
  border-radius: 4px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  color: #b6cbff;
}
.chat-msg.assistant .chat-bubble .chat-code {
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  padding: 10px 12px;
  margin: 8px 0;
  overflow-x: auto;
}
.chat-msg.assistant .chat-bubble .chat-code code {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  color: #d8e1f0;
  white-space: pre;
}

.chat-bubble.typing {
  display: flex;
  gap: 4px;
  padding: 16px;
}
.chat-bubble.typing .dot {
  width: 8px;
  height: 8px;
  background: rgba(255, 255, 255, 0.4);
  border-radius: 50%;
  animation: typing 1.4s infinite;
}
.chat-bubble.typing .dot:nth-child(2) { animation-delay: 0.2s; }
.chat-bubble.typing .dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes typing {
  0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-4px); }
}

.chat-input {
  display: flex;
  gap: 8px;
  padding: 14px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.chat-input input {
  flex: 1;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  color: white;
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  outline: none;
  transition: all 0.2s;
}
.chat-input input:focus {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(91, 141, 239, 0.6);
}
.chat-input input:disabled {
  opacity: 0.5;
}
.chat-input button {
  width: 42px;
  height: 42px;
  background: linear-gradient(135deg, #5b8def 0%, #b06dff 100%);
  color: white;
  border: none;
  border-radius: 50%;
  font-size: 20px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
}
.chat-input button:hover:not(:disabled) {
  transform: scale(1.05);
}
.chat-input button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.chat-provider-badge {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px;
  color: rgba(255, 255, 255, 0.3);
  margin-top: 4px;
  letter-spacing: 0.5px;
}

.chat-footer {
  padding: 8px 20px 12px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.3);
  text-align: center;
  letter-spacing: 0.5px;
}

/* Auth overlay */
.chat-auth-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  background: rgba(5, 5, 8, 0.85);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  animation: fadeIn 0.2s ease;
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
.chat-auth-card {
  width: 100%;
  background: rgba(20, 20, 30, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  padding: 28px 24px;
  text-align: center;
}
.chat-auth-orb {
  width: 48px;
  height: 48px;
  margin: 0 auto 16px;
  border-radius: 50%;
  background: linear-gradient(135deg, #5b8def, #b06dff);
  box-shadow: 0 0 24px rgba(91, 141, 239, 0.5);
  animation: orbPulse 2s infinite;
}
@keyframes orbPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.08); }
}
.chat-auth-card h3 {
  margin: 0 0 8px 0;
  font-size: 17px;
  font-weight: 700;
  color: white;
}
.chat-auth-card p {
  margin: 0 0 20px 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
  line-height: 1.5;
}
.chat-auth-card input {
  width: 100%;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  color: white;
  font-family: 'JetBrains Mono', monospace;
  font-size: 14px;
  outline: none;
  margin-bottom: 16px;
  text-align: center;
  letter-spacing: 0.5px;
}
.chat-auth-card input:focus {
  border-color: rgba(91, 141, 239, 0.6);
}
.chat-auth-actions {
  display: flex;
  gap: 8px;
}
.chat-auth-actions button {
  flex: 1;
  padding: 10px 16px;
  border-radius: 999px;
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}
.chat-auth-cancel {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.7);
}
.chat-auth-cancel:hover {
  background: rgba(255, 255, 255, 0.1);
}
.chat-auth-ok {
  background: linear-gradient(135deg, #5b8def, #b06dff);
  color: white;
}
.chat-auth-ok:hover {
  transform: scale(1.02);
}

@media (max-width: 600px) {
  .chat-fab {
    bottom: 16px;
    right: 16px;
    padding: 12px 18px;
    font-size: 13px;
  }
  .chat-panel {
    bottom: 0;
    right: 0;
    left: 0;
    width: 100%;
    max-width: 100%;
    height: 100vh;
    max-height: 100vh;
    border-radius: 18px 18px 0 0;
  }
}
`;
document.head.appendChild(style);
