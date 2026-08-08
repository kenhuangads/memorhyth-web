/* MemoRhyth 前端（vanilla JS，無建置步驟） */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ===== 雲端版金鑰（用 ?key= 開啟一次即記住；本機版不需要） =====
   注意：不從網址移除 key——iOS「加入主畫面」以當前網址為進入點，
   保留 key 才能把金鑰一起帶進獨立的 App 容器。 */
{
  const k = new URLSearchParams(location.search).get('key');
  if (k) localStorage.setItem('mr-app-key', k);
}
const APP_KEY = () => localStorage.getItem('mr-app-key') || '';
const authHeaders = () => (APP_KEY() ? { 'X-App-Key': APP_KEY() } : {});
/* API 位置：
   本機（/）與函式版（/functions/v1/app/）→ 相對路徑
   外部靜態主機（GitHub Pages 等）→ 由 <meta name="mr-api-base"> 指定（發佈腳本注入） */
const API_BASE =
  document.querySelector('meta[name="mr-api-base"]')?.content ||
  (location.pathname.includes('/storage/') ? location.origin + '/functions/v1/app' : '');
const rel = (p) => (p.startsWith('/') ? (API_BASE ? API_BASE + p : '.' + p) : p);
/* <a href> 下載連結帶不了 header → 金鑰改掛在網址上 */
const authedHref = (p) => rel(p) + (APP_KEY() ? `?key=${encodeURIComponent(APP_KEY())}` : '');

/** 401 時顯示金鑰輸入卡（iOS 主畫面 App 的容器獨立，貼一次金鑰即可） */
function showKeyPrompt() {
  if ($('#key-input')) return;
  $('#capture-results').innerHTML = `<div class="result-card" style="flex-wrap:wrap">
    <span class="emoji">🔐</span>
    <div class="body">
      <div>需要金鑰——貼上你的專屬網址（或 ?key= 後面那串），見「私人連結.txt」：</div>
      <div class="export-row" style="margin-top:8px">
        <input id="key-input" type="text" autocomplete="off" placeholder="貼上整條網址或金鑰"
          style="flex:1;min-width:180px;background:transparent;color:var(--ink);border:1px solid var(--baseline);border-radius:8px;padding:8px 10px;font-size:14px" />
        <button id="key-save" class="primary-btn">儲存</button>
      </div>
    </div>
  </div>`;
  $('#key-save').addEventListener('click', () => {
    let v = $('#key-input').value.trim();
    const m = /[?&]key=([A-Za-z0-9]+)/.exec(v);
    if (m) v = m[1];
    if (!v) return;
    localStorage.setItem('mr-app-key', v);
    location.reload();
  });
}

const api = async (path, opts = {}) => {
  const res = await fetch(rel(path), {
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    ...opts,
  });
  if (res.status === 401) {
    showKeyPrompt();
    throw new Error('需要金鑰');
  }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
};

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtMoney = (n) => `$${Math.round(n).toLocaleString('zh-TW')}`;

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function fmtDateTime(s) {
  if (!s) return '';
  const [d, t] = s.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const date = new Date(y, m - 1, day);
  const today = new Date();
  const dayDiff = Math.round((date - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
  let dayLabel;
  if (dayDiff === 0) dayLabel = '今天';
  else if (dayDiff === 1) dayLabel = '明天';
  else if (dayDiff === 2) dayLabel = '後天';
  else if (dayDiff === -1) dayLabel = '昨天';
  else dayLabel = `${m}/${day}（${WEEKDAYS[date.getDay()]}）`;
  return t && t !== '00:00' ? `${dayLabel} ${t}` : dayLabel;
}

/* ===== 今日資訊 ===== */
{
  const now = new Date();
  $('#today-line').textContent = `${now.getMonth() + 1} 月 ${now.getDate()} 日 星期${WEEKDAYS[now.getDay()]}`;
}

/* ===== 分頁 ===== */
let currentTab = 'overview';
const renderers = {};

function switchTab(name) {
  currentTab = name;
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
  renderers[name]?.();
}
$$('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

/* ===== 快速輸入 ===== */
const input = $('#capture-input');
const sendBtn = $('#send-btn');
const resultsBox = $('#capture-results');
const engineBadge = $('#engine-badge');

const ACTION_META = {
  log_expense: { emoji: '💰', label: '已記帳' },
  create_task: { emoji: '⏰', label: '已建立提醒' },
  create_note: { emoji: '📝', label: '已記筆記' },
  create_project: { emoji: '📁', label: '已建立專案' },
};

function describeAction(r) {
  const a = r.action;
  switch (a.type) {
    case 'log_expense':
      return `${esc(a.note)}　<b>${fmtMoney(a.amount)}</b>　<span class="cat-chip">${esc(a.category)}</span>`;
    case 'create_task':
      return `${esc(a.title)}${a.remind_at ? `　<span class="meta">${esc(fmtDateTime(a.remind_at))}</span>` : ''}`;
    case 'create_note':
      return esc(a.content.length > 40 ? a.content.slice(0, 40) + '…' : a.content);
    case 'create_project':
      return esc(a.name);
    default:
      return '';
  }
}

/** 結果卡（打字、語音、照片辨識共用）；prefix 讓照片路徑可以掛一張來源說明卡 */
function renderResults(results, answers = [], prefix = '') {
  const answerCards = answers
    .map(
      (a) => `<div class="result-card answer-card">
        <span class="emoji">💬</span>
        <div class="body answer-text">${esc(a)}</div>
      </div>`,
    )
    .join('');
  const cards = results
    .map((r) => {
      const meta = ACTION_META[r.action.type] || { emoji: '✅', label: '完成' };
      const dedup = r.dedup
        ? `<span class="dedup-badge">${r.dedup[0].level === 'auto' ? '可能重複' : '疑似重複'}</span>`
        : '';
      return `<div class="result-card" data-table="${r.record.table}" data-id="${r.record.id}">
        <span class="emoji">${meta.emoji}</span>
        <div class="body"><span class="meta">${meta.label}</span>${dedup}<div>${describeAction(r)}</div></div>
        ${r.record.table !== 'projects' ? '<button class="undo" title="刪除這筆">復原</button>' : ''}
      </div>`;
    })
    .join('');
  resultsBox.innerHTML = prefix + answerCards + cards;
  renderers[currentTab]?.();
}

async function submitCapture() {
  const text = input.value.trim();
  if (!text) return;
  sendBtn.disabled = true;
  engineBadge.textContent = '解析中…';
  try {
    const data = await api('/api/capture', { method: 'POST', body: JSON.stringify({ text, source: 'web' }) });
    input.value = '';
    const ENGINE_NAMES = { claude: '✦ Claude 解析', gemini: '✦ Gemini 解析' };
    engineBadge.textContent =
      ENGINE_NAMES[data.engine] ?? (data.warning ? '規則解析（LLM 暫時無法使用）' : '規則解析');
    renderResults(data.results, data.answers || []);
    if (data.results.length === 0 && (data.answers || []).length === 0) {
      resultsBox.innerHTML = '<div class="result-card"><span class="emoji">🤔</span><div class="body">看不懂這句，試著說清楚一點？</div></div>';
    }
  } catch (err) {
    engineBadge.textContent = `錯誤：${err.message}`;
  } finally {
    sendBtn.disabled = false;
  }
}

sendBtn.addEventListener('click', submitCapture);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    submitCapture();
  }
});

resultsBox.addEventListener('click', async (e) => {
  const btn = e.target.closest('.undo');
  if (!btn) return;
  const card = btn.closest('.result-card');
  try {
    await api(`/api/${card.dataset.table}/${card.dataset.id}`, { method: 'DELETE' });
    card.remove();
    renderers[currentTab]?.();
  } catch {
    /* 已刪除 */
  }
});

/* ===== 語音輸入（Web Speech API，Chrome/Edge 支援） ===== */
{
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micBtn = $('#mic-btn');
  if (SR) {
    micBtn.hidden = false;
    const rec = new SR();
    rec.lang = 'zh-TW';
    rec.interimResults = true;
    rec.continuous = false;
    let recording = false;
    let base = '';

    micBtn.addEventListener('click', () => {
      if (recording) {
        rec.stop();
        return;
      }
      base = input.value;
      try {
        rec.start();
      } catch { /* 已在錄音中 */ }
    });
    rec.onstart = () => {
      recording = true;
      micBtn.classList.add('recording');
    };
    rec.onresult = (e) => {
      let text = '';
      for (const r of e.results) text += r[0].transcript;
      input.value = base + text;
    };
    rec.onend = () => {
      recording = false;
      micBtn.classList.remove('recording');
      input.focus();
    };
    rec.onerror = () => {
      recording = false;
      micBtn.classList.remove('recording');
    };
  }
}

/* ===== 總覽 ===== */
renderers.overview = async () => {
  const panel = $('#tab-overview');
  const data = await api('/api/overview');
  const reminders = data.reminders
    .map((t) => {
      const overdue = t.remind_at < data.now;
      return `<div class="list-item">
        <button class="checkbox" data-id="${t.id}" title="完成">✓</button>
        <div class="grow"><div class="title">${esc(t.title)}</div>
        <div class="meta ${overdue ? 'overdue' : ''}">${overdue ? '⚠ 已逾期 · ' : ''}${esc(fmtDateTime(t.remind_at))}</div></div>
      </div>`;
    })
    .join('');
  const cats = data.month.categories.slice(0, 4);
  const maxCat = Math.max(1, ...cats.map((c) => c.total));
  panel.innerHTML = `
    <div class="card">
      <p class="section-title">接下來的提醒</p>
      <div class="list">${reminders || '<p class="empty-hint">48 小時內沒有排定的提醒 ✨</p>'}</div>
    </div>
    <div class="card">
      <p class="section-title">本月支出（${data.month.month.slice(5)} 月）</p>
      <div class="hero-number"><span class="value">${fmtMoney(data.month.total)}</span><span class="unit">TWD</span></div>
      <div class="chart-block">
        ${cats
          .map(
            (c) => `<div class="hbar-row" title="${esc(c.category)} ${fmtMoney(c.total)}（${c.count} 筆）">
              <span class="label">${esc(c.category)}</span>
              <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(2, (c.total / maxCat) * 100)}%"></div></div>
              <span class="val">${fmtMoney(c.total)}</span>
            </div>`,
          )
          .join('')}
      </div>
    </div>
    <div class="card">
      <p class="section-title">最近的輸入</p>
      <div class="list">${
        data.recent
          .map(
            (r) => `<div class="list-item"><div class="grow">
              <div class="title">${esc(r.raw_text)}</div>
              <div class="meta">${esc(fmtDateTime(r.created_at))}</div></div></div>`,
          )
          .join('') || '<p class="empty-hint">還沒有任何紀錄，從上面輸入第一句吧</p>'
      }</div>
    </div>
    <div class="card">
      <p class="section-title">備份與匯出</p>
      <div class="export-row">
        <a class="chip-btn" href="${authedHref('/api/export/expenses.csv')}" download>⬇ 支出 CSV（Excel 可開）</a>
        <a class="chip-btn" href="${authedHref('/api/export/json')}" download>⬇ 完整備份 JSON</a>
      </div>
      <p class="meta" style="margin:8px 2px 0">備份是全自動的：即時雲端同步＋每日雲端快照（留 30 份）＋每日本機快照（留 14 份）。上面的按鈕是額外手動匯出。</p>
    </div>`;

  $$('.checkbox', panel).forEach((b) =>
    b.addEventListener('click', async () => {
      await api(`/api/tasks/${b.dataset.id}/toggle`, { method: 'POST' });
      renderers.overview();
    }),
  );
};

/* ===== 記帳 ===== */
let expenseMonth = (() => {
  const d = new Date(); // 用本地時間，避免 UTC 在每月 1 日凌晨差一個月
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
})();

function shiftMonth(delta) {
  const [y, m] = expenseMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  expenseMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  renderers.expenses();
}

function trendSvg(daily, month) {
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const byDay = Object.fromEntries(daily.map((d) => [Number(d.day.slice(8)), d.total]));
  const W = 600, H = 150, padL = 8, padR = 8, padT = 22, padB = 20;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const max = Math.max(1, ...Object.values(byDay));
  const gap = 2;
  const barW = plotW / daysInMonth - gap;
  const baseline = padT + plotH;
  let bars = '';
  let maxLabel = '';
  for (let d = 1; d <= daysInMonth; d++) {
    const v = byDay[d] || 0;
    const h = (v / max) * plotH;
    const x = padL + (d - 1) * (plotW / daysInMonth) + gap / 2;
    if (v > 0) {
      bars += `<rect x="${x.toFixed(1)}" y="${(baseline - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${(h + 4).toFixed(1)}" rx="3" fill="var(--series)"><title>${m}/${d}：${fmtMoney(v)}</title></rect>`;
      if (v === max) {
        maxLabel = `<text x="${(x + barW / 2).toFixed(1)}" y="${(baseline - h - 6).toFixed(1)}" text-anchor="middle" font-size="11" fill="var(--ink-2)">${fmtMoney(v)}</text>`;
      }
    }
  }
  let ticks = '';
  for (let d = 1; d <= daysInMonth; d += d === 1 ? 4 : 5) {
    const x = padL + (d - 0.5) * (plotW / daysInMonth);
    ticks += `<text x="${x.toFixed(1)}" y="${H - 5}" text-anchor="middle" font-size="10" fill="var(--muted)">${d}</text>`;
  }
  return `<svg class="trend-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="每日支出趨勢">
    <defs><clipPath id="plot-clip"><rect x="0" y="0" width="${W}" height="${baseline}" /></clipPath></defs>
    <g clip-path="url(#plot-clip)">${bars}</g>
    ${maxLabel}
    <line x1="${padL}" y1="${baseline}" x2="${W - padR}" y2="${baseline}" stroke="var(--baseline)" stroke-width="1" />
    ${ticks}
  </svg>`;
}

renderers.expenses = async () => {
  const panel = $('#tab-expenses');
  const data = await api(`/api/expenses?month=${expenseMonth}`);
  const total = data.categories.reduce((s, c) => s + c.total, 0);
  const maxCat = Math.max(1, ...data.categories.map((c) => c.total));
  const [, mm] = expenseMonth.split('-');

  panel.innerHTML = `
    <div class="card">
      <div class="month-nav">
        <button class="icon-btn" id="prev-month">◀</button>
        <span class="label">${expenseMonth.replace('-', ' 年 ')} 月</span>
        <button class="icon-btn" id="next-month">▶</button>
      </div>
      <div class="hero-number" style="margin-top:8px">
        <span class="value">${fmtMoney(total)}</span><span class="unit">共 ${data.items.length} 筆</span>
      </div>
      <button id="scan-invoice" class="scan-btn">📷 拍照記帳（發票／收據／截圖）</button>
      <div class="export-row" style="margin-top:8px">
        <button id="csv-import" class="chip-btn">📄 匯入財政部 CSV</button>
        <button id="insight-btn" class="chip-btn">📊 ${Number(mm)} 月洞察</button>
      </div>
      <div id="insight-box"></div>
    </div>
    ${
      data.items.length
        ? `<div class="card">
            <p class="section-title">每日趨勢</p>
            ${trendSvg(data.daily, expenseMonth)}
          </div>
          <div class="card">
            <p class="section-title">分類占比</p>
            ${data.categories
              .map(
                (c) => `<div class="hbar-row" title="${esc(c.category)} ${fmtMoney(c.total)}（${c.count} 筆）">
                  <span class="label">${esc(c.category)}</span>
                  <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(2, (c.total / maxCat) * 100)}%"></div></div>
                  <span class="val">${fmtMoney(c.total)}</span>
                </div>`,
              )
              .join('')}
          </div>
          <div class="card">
            <p class="section-title">明細</p>
            <div class="list">${data.items
              .map(
                (e) => `<div class="list-item">
                  <div class="grow">
                    <div class="title"><span class="cat-chip">${esc(e.category)}</span>${esc(e.note)}${
                      e.dedup_status ? '<span class="dedup-badge">疑似重複</span>' : ''
                    }</div>
                    <div class="meta">${esc(fmtDateTime(e.occurred_at))}${e.merchant ? ' · ' + esc(e.merchant) : ''}</div>
                  </div>
                  <span class="amount">${fmtMoney(e.amount)}</span>
                  <button class="icon-btn edit" data-id="${e.id}" title="編輯">✎</button>
                  <button class="icon-btn del" data-table="expenses" data-id="${e.id}" title="刪除">✕</button>
                </div>`,
              )
              .join('')}</div>
          </div>`
        : `<div class="card"><p class="empty-hint">${Number(mm)} 月還沒有支出紀錄</p></div>`
    }`;

  $('#prev-month').addEventListener('click', () => shiftMonth(-1));
  $('#next-month').addEventListener('click', () => shiftMonth(1));
  $('#scan-invoice').addEventListener('click', () => $('#photo-file').click());
  $('#csv-import').addEventListener('click', () => $('#csv-file').click());
  $('#insight-btn').addEventListener('click', showInsight);
  bindDeletes(panel, renderers.expenses);
  bindExpenseEdits(panel, data.items);
};

/* ===== 月度洞察 ===== */
async function showInsight() {
  const box = $('#insight-box');
  if (!box) return;
  box.innerHTML =
    '<p class="meta" style="margin-top:10px">🤖 分析中…（免費 Gemini 引擎，約 5～10 秒）</p>';
  try {
    const data = await api(`/api/insight?month=${expenseMonth}`);
    box.innerHTML = `
      <div style="margin-top:10px;border-top:1px solid var(--baseline);padding-top:10px;white-space:pre-wrap;line-height:1.7">${esc(data.report)}</div>
      <p class="meta" style="margin-top:6px">${
        data.engine === 'gemini' ? 'Gemini 分析' : '內建摘要（設定 GEMINI_API_KEY 可升級 AI 洞察）'
      }</p>`;
  } catch (err) {
    box.innerHTML = `<p class="meta" style="margin-top:10px">⚠️ ${esc(err.message)}</p>`;
  }
}

const CATEGORIES = ['餐飲', '飲料', '交通', '購物', '娛樂', '醫療', '美容', '居家', '教育', '其他'];

function bindExpenseEdits(panel, items) {
  const byId = Object.fromEntries(items.map((e) => [e.id, e]));
  $$('.edit', panel).forEach((btn) =>
    btn.addEventListener('click', () => {
      const e = byId[btn.dataset.id];
      if (!e) return;
      const item = btn.closest('.list-item');
      item.innerHTML = `
        <form class="edit-form">
          <input name="note" value="${esc(e.note)}" placeholder="品項" required />
          <input name="amount" type="number" min="0.01" step="0.01" value="${e.amount}" required />
          <select name="category">${CATEGORIES.map((c) => `<option ${c === e.category ? 'selected' : ''}>${c}</option>`).join('')}</select>
          <input name="occurred_at" type="datetime-local" value="${esc(e.occurred_at)}" required />
          <input name="merchant" value="${esc(e.merchant || '')}" placeholder="店家（選填）" />
          <div class="edit-actions">
            <button type="button" class="icon-btn cancel">取消</button>
            <button type="submit" class="primary-btn">儲存</button>
          </div>
        </form>`;
      item.querySelector('.cancel').addEventListener('click', () => renderers.expenses());
      item.querySelector('form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const f = new FormData(ev.target);
        try {
          const res = await fetch(rel(`/api/expenses/${e.id}`), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({
              note: f.get('note'),
              amount: Number(f.get('amount')),
              category: f.get('category'),
              occurred_at: f.get('occurred_at'),
              merchant: f.get('merchant'),
            }),
          });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
          renderers.expenses();
        } catch (err) {
          alert('儲存失敗：' + err.message);
        }
      });
    }),
  );
}

/* ===== 發票 QR 掃描 =====
   翻拍的發票照片常見難點：兩顆 QR 並排（jsQR 一次只找一顆）、縮圖後模組太小、
   光線不均。因此採多階段：整張高解析 → 對比強化 → 分區放大 → 分區對比強化，
   任一階段湊齊左右碼就提前結束。 */
const QR_OPTS = { inversionAttempts: 'attemptBoth' };

function drawToCanvas(img, maxDim, sx, sy, sw, sh) {
  const scale = Math.min(2, maxDim / Math.max(sw, sh)); // 小圖可放大到 2 倍幫助解碼
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return ctx;
}

/** 灰階＋直方圖拉伸：翻拍光線不均時大幅提高辨識率 */
function boostContrast(imageData) {
  const d = imageData.data;
  const gray = new Uint8ClampedArray(d.length / 4);
  let min = 255;
  let max = 0;
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    gray[j] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const span = Math.max(1, max - min);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const v = ((gray[j] - min) * 255) / span;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  return imageData;
}

/** 在單一畫布上找碼（找到就塗白再找下一顆），結果併入 found */
function scanCtx(ctx, found, { contrast = false, passes = 3 } = {}) {
  const { width, height } = ctx.canvas;
  for (let i = 0; i < passes; i++) {
    let imageData = ctx.getImageData(0, 0, width, height);
    if (contrast) imageData = boostContrast(imageData);
    const code = jsQR(imageData.data, width, height, QR_OPTS);
    if (!code) return;
    const bytes = code.binaryData;
    const key = Array.from(bytes.slice(0, 24)).join(',');
    if (!found.has(key)) found.set(key, bytes);
    // 塗白已找到的區域，讓下一輪能看到另一顆
    const pts = Object.values(code.location).filter((p) => p && typeof p.x === 'number');
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(
      Math.min(...xs) - 12,
      Math.min(...ys) - 12,
      Math.max(...xs) - Math.min(...xs) + 24,
      Math.max(...ys) - Math.min(...ys) + 24,
    );
  }
}

/** 左右碼是否都到齊了（有左碼即可記帳，兩顆都有品項才完整） */
function hasBothCodes(found) {
  let left = false;
  let right = false;
  for (const b of found.values()) {
    if (b[0] === 42 && b[1] === 42) right = true;
    else if (b.length >= 77) left = true;
  }
  return left && right;
}

async function decodeQrCodes(file, onProgress, { bailIfNoQrEarly = false } = {}) {
  const img = await createImageBitmap(file);
  const found = new Map();
  const W = img.width;
  const H = img.height;
  const hasLeft = () => [...found.values()].some((b) => !(b[0] === 42 && b[1] === 42) && b.length >= 77);

  // 掃描區域：整張 → 左右垂直切半（隔開並排的兩顆 QR，jsQR 一次只認得一顆）
  // → 下半部左右（更緊的裁切＝更大的放大倍率，救小顆或模糊的碼）
  const regions = [
    ['整張', 0, 0, W, H, 2000],
    ['左半', 0, 0, W * 0.6, H, 1600],
    ['右半', W * 0.4, 0, W * 0.6, H, 1600],
    ['下半左', 0, H * 0.45, W * 0.6, H * 0.55, 1400],
    ['下半右', W * 0.4, H * 0.45, W * 0.6, H * 0.55, 1400],
  ];

  // 掃好掃滿：QR 路徑免費、金額 100% 準，還帶品項與發票號碼（同號去重靠它），值得多花幾秒。
  // 但整輪掃完要 5～7 秒，對「根本沒有 QR 的照片」（收據、海報、便條）是純浪費——
  // bailIfNoQrEarly：整張＋左半都連一顆 QR 的影子都沒有，就認定這張沒有 QR，及早交給 AI 看圖。
  for (const contrast of [false, true]) {
    for (const [i, [label, sx, sy, sw, sh, dim]] of regions.entries()) {
      onProgress?.(contrast ? `加強對比重掃（${label}）` : `掃描中（${label}）`);
      scanCtx(drawToCanvas(img, dim, sx, sy, sw, sh), found, { contrast });
      if (hasBothCodes(found)) return [...found.values()];
      if (bailIfNoQrEarly && !contrast && i === 1 && found.size === 0) return [];
      await new Promise((r) => setTimeout(r, 0)); // 讓畫面有機會更新，避免手機卡住
    }
    // 第一輪掃完已有左碼（金額/日期/發票號碼都在左碼）就夠了，不必再花時間強化對比
    if (hasLeft()) break;
  }
  return [...found.values()];
}

function showScanMessage(emoji, html) {
  resultsBox.innerHTML = `<div class="result-card"><span class="emoji">${emoji}</span><div class="body">${html}</div></div>`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/** 發票左右碼 → 後端解析入帳（QR 路徑，免費且金額 100% 準確） */
async function submitInvoiceCodes(left, right) {
  const res = await fetch(rel('/api/invoice/scan'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ left: Array.from(left), right: right ? Array.from(right) : undefined }),
  });
  if (res.status === 401) return showKeyPrompt();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return showScanMessage('⚠️', esc(data.error || '發票解析失敗'));
  if (data.status === 'duplicate-invoice') {
    return showScanMessage('✅', `這張發票（${esc(data.invoice.number)}）之前已經匯入過了，不會重複記帳。`);
  }
  const dedup = data.dedup
    ? `<span class="dedup-badge">${data.dedup[0].level === 'auto' ? '可能與手動記帳重複' : '疑似與手動記帳重複'}</span>`
    : '';
  showScanMessage(
    '🧾',
    `已匯入發票 ${esc(data.invoice.number)}　<b>${fmtMoney(data.invoice.amount)}</b>　` +
      `<span class="cat-chip">${esc(data.invoice.category)}</span>${dedup}` +
      `<div class="meta">${esc(data.invoice.date)} · ${data.invoice.items} 個品項 · 發票 QR 碼</div>`,
  );
  renderers[currentTab]?.();
}

/* ===== AI 看圖辨識（沒有 QR 碼時的路徑） =====
   手機原圖動輒 3～5 MB，上傳慢又浪費額度；先縮到最長邊 1600px 的 JPEG（通常 200～400 KB），
   這個解析度足夠讀清楚收據上的金額與店名。 */
async function shrinkImage(file, maxDim = 1600, quality = 0.82) {
  try {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    // 小圖轉 JPEG 有可能反而變大（例如純色 PNG），那就用原檔
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file; // 瀏覽器解不開（例如某些 HEIC）就原檔上傳，交給後端與模型處理
  }
}

async function recognizePhoto(file) {
  const caption = input.value.trim();
  showScanMessage('⏳', '看圖辨識中…<div class="meta">AI 讀取，約 5～15 秒</div>');
  const blob = await shrinkImage(file);
  const res = await fetch(rel('/api/capture/image') + (caption ? `?caption=${encodeURIComponent(caption)}` : ''), {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'image/jpeg', ...authHeaders() },
    body: blob,
  });
  if (res.status === 401) return showKeyPrompt();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return showScanMessage('🤔', esc(data.error || '照片辨識失敗'));
  }
  input.value = '';
  engineBadge.textContent = '✦ Gemini 看圖';
  renderResults(
    data.results,
    [],
    `<div class="result-card"><span class="emoji">📷</span><div class="body"><span class="meta">照片辨識</span>` +
      `<div>以下是從照片讀出來的內容，數字看錯可以在「記帳」分頁按 ✎ 改，或按「復原」刪掉。</div></div></div>`,
  );
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* 一顆按鈕吃所有照片：先快速找發票 QR（免費、金額 100% 準），
   找不到才交給 AI 看圖——使用者不必先分辨手上這張是不是電子發票。 */
$('#photo-btn').addEventListener('click', () => $('#photo-file').click());

$('#photo-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    let left = null;
    let right = null;
    if (typeof jsQR === 'function') {
      showScanMessage('⏳', '先看看有沒有發票 QR 碼…');
      const codes = await decodeQrCodes(
        file,
        (step) => showScanMessage('⏳', `先看看有沒有發票 QR 碼…<div class="meta">${esc(step)}</div>`),
        { bailIfNoQrEarly: true },
      );
      for (const b of codes) {
        if (b[0] === 42 && b[1] === 42) right = b; // '**' 開頭 = 右碼
        else if (b.length >= 77) left = b;
      }
    }
    if (left) return await submitInvoiceCodes(left, right);
    await recognizePhoto(file);
  } catch (err) {
    showScanMessage('⚠️', `辨識失敗：${esc(err.message)}`);
  }
});

/* ===== 財政部消費明細 CSV 匯入 ===== */
$('#csv-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  showScanMessage('⏳', `匯入 ${esc(file.name)} 中…`);
  try {
    const res = await fetch(rel('/api/invoice/import-csv'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', ...authHeaders() },
      body: await file.arrayBuffer(),
    });
    if (res.status === 401) return showKeyPrompt();
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return showScanMessage('⚠️', esc(data.error || '匯入失敗'));
    const parts = [`已匯入 <b>${data.imported}</b> 筆`];
    if (data.duplicates) parts.push(`略過已存在的 ${data.duplicates} 筆`);
    if (data.skipped) parts.push(`略過作廢 ${data.skipped} 張`);
    if (data.flagged) parts.push(`其中 ${data.flagged} 筆標記疑似與手動記帳重複`);
    showScanMessage('🧾', `${parts.join('，')}。<div class="meta">檔案共 ${data.total} 張發票</div>`);
    renderers[currentTab]?.();
  } catch (err) {
    showScanMessage('⚠️', `匯入失敗：${esc(err.message)}`);
  }
});

/* ===== 待辦 ===== */
renderers.tasks = async () => {
  const panel = $('#tab-tasks');
  const data = await api('/api/tasks');
  const now = new Date();
  const nowStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const todos = data.items.filter((t) => t.status === 'todo');
  const dones = data.items.filter((t) => t.status === 'done');

  const renderTask = (t) => {
    const overdue = t.status === 'todo' && t.remind_at && t.remind_at < nowStr;
    return `<div class="list-item ${t.status === 'done' ? 'done' : ''}">
      <button class="checkbox ${t.status === 'done' ? 'checked' : ''}" data-id="${t.id}">✓</button>
      <div class="grow">
        <div class="title">${esc(t.title)}</div>
        <div class="meta ${overdue ? 'overdue' : ''}">${overdue ? '⚠ 已逾期 · ' : ''}${
          t.remind_at ? esc(fmtDateTime(t.remind_at)) : '沒有時間'
        }${t.project ? ' · 📁 ' + esc(t.project) : ''}</div>
      </div>
      <button class="icon-btn del" data-table="tasks" data-id="${t.id}" title="刪除">✕</button>
    </div>`;
  };

  panel.innerHTML = `
    <div class="card">
      <p class="section-title">待辦（${todos.length}）</p>
      <div class="list">${todos.map(renderTask).join('') || '<p class="empty-hint">目前沒有待辦事項 🎉</p>'}</div>
    </div>
    ${dones.length ? `<div class="card"><p class="section-title">已完成</p><div class="list">${dones.slice(0, 10).map(renderTask).join('')}</div></div>` : ''}
    <div class="card">
      <p class="section-title">行事曆備援</p>
      <div class="export-row"><a class="chip-btn" href="${authedHref('/api/calendar.ics')}" download>⬇ 下載 .ics 匯入行事曆</a></div>
      <div id="calendar-link-box"></div>
      <p class="meta" style="margin:8px 2px 0">訂閱網址貼進 Google 日曆「透過網址新增」或 iOS「加入已訂閱的行事曆」，提醒就會自動同步。</p>
    </div>`;
  renderCalendarLink();

  $$('.checkbox', panel).forEach((b) =>
    b.addEventListener('click', async () => {
      await api(`/api/tasks/${b.dataset.id}/toggle`, { method: 'POST' });
      renderers.tasks();
    }),
  );
  bindDeletes(panel, renderers.tasks);
};

/* ===== 筆記 ===== */
renderers.notes = async () => {
  const panel = $('#tab-notes');
  const data = await api('/api/notes');
  panel.innerHTML = `<div class="card">
    <p class="section-title">筆記</p>
    <div class="list">${
      data.items
        .map(
          (n) => `<div class="list-item">
            <div class="grow"><div class="title">${esc(n.content)}</div>
            <div class="meta">${esc(fmtDateTime(n.created_at))}</div></div>
            <button class="icon-btn del" data-table="notes" data-id="${n.id}" title="刪除">✕</button>
          </div>`,
        )
        .join('') || '<p class="empty-hint">還沒有筆記，把靈感丟進上面的輸入框吧</p>'
    }</div>
  </div>`;
  bindDeletes(panel, renderers.notes);
};

/** 顯示行事曆訂閱網址（伺服器讀 .env 組出來）＋複製按鈕 */
async function renderCalendarLink() {
  try {
    const links = await api('/api/links');
    if (!links.calendarFeed) return;
    const box = $('#calendar-link-box');
    if (!box) return;
    box.innerHTML = `<div class="export-row" style="margin-top:8px">
      <button class="chip-btn" id="copy-cal">📋 複製訂閱網址</button>
    </div>`;
    $('#copy-cal').addEventListener('click', async () => {
      await navigator.clipboard.writeText(links.calendarFeed);
      $('#copy-cal').textContent = '✅ 已複製';
      setTimeout(() => ($('#copy-cal').textContent = '📋 複製訂閱網址'), 1500);
    });
  } catch {
    /* 沒設定雲端時不顯示 */
  }
}

function bindDeletes(panel, refresh) {
  $$('.del', panel).forEach((b) =>
    b.addEventListener('click', async () => {
      await api(`/api/${b.dataset.table}/${b.dataset.id}`, { method: 'DELETE' });
      refresh();
    }),
  );
}

/* ===== 到點提醒（頁面開啟時的瀏覽器通知） ===== */
{
  const notifyBtn = $('#notify-btn');
  const fired = new Set(JSON.parse(localStorage.getItem('mr-fired') || '[]'));

  const saveFired = () => localStorage.setItem('mr-fired', JSON.stringify([...fired].slice(-200)));

  async function checkReminders() {
    if (Notification.permission !== 'granted') return;
    try {
      const data = await api('/api/overview');
      for (const t of data.reminders) {
        if (t.remind_at <= data.now && !fired.has(t.id)) {
          fired.add(t.id);
          new Notification('MemoRhyth 提醒', { body: t.title, tag: t.id, icon: './icon.svg' });
        }
      }
      saveFired();
    } catch { /* 離線時略過 */ }
  }

  if ('Notification' in window) {
    if (Notification.permission === 'default') {
      notifyBtn.hidden = false;
      notifyBtn.addEventListener('click', async () => {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') notifyBtn.hidden = true;
      });
    }
    setInterval(checkReminders, 30_000);
    checkReminders();
  }
}

/* ===== PWA ===== */
// updateViaCache:'none' → SW 本身永不從 HTTP 快取取得；每次載入主動檢查更新
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('./sw.js', { updateViaCache: 'none' })
    .then((reg) => reg.update())
    .catch(() => {});
}

// 版本戳記顯示在頁尾：回報問題時一眼看出跑的是哪一版
{
  const build = document.querySelector('meta[name="mr-build"]')?.content;
  const foot = $('.foot p');
  if (build && foot) foot.textContent += ` · 版本 ${build}`;
}

/* 啟動 */
renderers.overview();
