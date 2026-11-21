'use strict';

/* ================= 儲存 ================= */
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 私密模式等情況忽略 */ } },
};

// Google 日曆的 11 種事件顏色
const GCOLORS = {
  '1': ['薰衣草', '#7986cb'], '2': ['鼠尾草', '#33b679'], '3': ['葡萄', '#8e24aa'], '4': ['火鶴', '#e67c73'],
  '5': ['香蕉', '#f6bf26'], '6': ['橘子', '#f4511e'], '7': ['孔雀', '#039be5'], '8': ['石墨', '#616161'],
  '9': ['藍莓', '#3f51b5'], '10': ['羅勒', '#0b8043'], '11': ['番茄', '#d50000'],
};
const DEFAULT_CATS = [
  { name: '課業／工作', colorId: '9' },
  { name: '比賽／專案', colorId: '6' },
  { name: '社交／娛樂', colorId: '2' },
  { name: '生活雜事', colorId: '5' },
];
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Taipei';
const GSCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const REMINDER_PRESETS = [0, 10, 30, 60, 180, 1440, 2880, 10080];
// 全天行程的提醒從當天 00:00 往前算：900 = 前一天 09:00
const ALLDAY_PRESETS = [900, 360, 2340, 10980];

let settings = Object.assign(
  { geminiKey: '', model: 'gemini-flash-latest', clientId: '', calendarId: '', categories: DEFAULT_CATS },
  LS.get('sc.settings', {}),
);
let events = LS.get('sc.events', []);
let gToken = LS.get('sc.gtoken', null);

const saveEvents = () => LS.set('sc.events', events);
const saveSettings = () => LS.set('sc.settings', settings);

/* ================= 小工具 ================= */
const $ = (s) => document.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isHm = (s) => typeof s === 'string' && /^\d{2}:\d{2}$/.test(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function plusHour(date, time) {
  const d = parseYmd(date); const [h, m] = time.split(':').map(Number);
  d.setHours(h + 1, m); return { date: ymd(d), time: hm(d) };
}
function catOf(name) { return settings.categories.find((c) => c.name === name) || settings.categories[0] || { name: '', colorId: '8' }; }
function colorOf(name) { return (GCOLORS[catOf(name).colorId] || GCOLORS['8'])[1]; }
function fmtReminder(m, allDay = false) {
  if (allDay) {
    const days = Math.ceil(m / 1440);
    const t = days * 1440 - m;
    const time = `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
    if (days === 0) return '當天 00:00';
    return `${days === 1 ? '前一天' : days === 7 ? '一週前' : `前 ${days} 天`} ${time}`;
  }
  if (m === 0) return '準時';
  if (m % 1440 === 0) return `${m / 1440} 天前`;
  if (m % 60 === 0) return `${m / 60} 小時前`;
  return `${m} 分鐘前`;
}
function fmtWhen(e) {
  const d = parseYmd(e.date);
  const base = `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）`;
  if (e.allDay || !e.startTime) return `${base} 全天`;
  return `${base} ${e.startTime}${e.endTime ? '–' + e.endTime : ''}`;
}
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ================= 行事曆 ================= */
let cal;
function toFC() {
  return events.filter((e) => !e.deleted).map((e) => {
    const timed = !e.allDay && e.startTime;
    let end;
    if (timed) end = e.endTime ? `${e.date}T${e.endTime}` : undefined;
    return {
      id: e.id,
      title: (e.isPrep ? '🔔 ' : '') + e.title,
      start: timed ? `${e.date}T${e.startTime}` : e.date,
      end,
      allDay: !timed,
      backgroundColor: colorOf(e.category),
      borderColor: colorOf(e.category),
    };
  });
}
function refreshCalendar() {
  if (!cal) return;
  cal.getEventSources().forEach((s) => s.remove());
  cal.addEventSource(toFC());
  updateSyncPill();
}

function initCalendar() {
  if (!window.FullCalendar) {
    $('#calendar').innerHTML = '<p style="padding:16px">行事曆元件載入失敗，請確認網路後重新整理。</p>';
    return;
  }
  cal = new FullCalendar.Calendar($('#calendar'), {
    initialView: LS.get('sc.view', 'dayGridMonth'),
    locale: 'zh-tw',
    height: '100%',
    headerToolbar: false,
    expandRows: true,
    dayMaxEvents: 3,
    editable: true,
    nowIndicator: true,
    scrollTime: '08:00:00',
    eventDisplay: 'block',
    views: {
      dayGridMonth: { displayEventTime: false },
      timeGridWeek: {
        dayHeaderContent: (arg) => ({ html: `<div class="wk-d">${WEEK[arg.date.getDay()]}</div><div class="wk-n">${arg.date.getDate()}</div>` }),
      },
    },
    dayCellContent: (arg) => arg.dayNumberText.replace('日', ''),
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    events: toFC(),
    datesSet: (info) => { $('#calTitle').textContent = info.view.title; },
    dateClick: (info) => {
      const date = info.dateStr.slice(0, 10);
      const startTime = info.allDay ? '' : info.dateStr.slice(11, 16);
      openEditor(null, { date, allDay: info.allDay, startTime });
    },
    eventClick: (info) => { info.jsEvent.preventDefault(); openEditor(info.event.id); },
    eventDrop: (info) => moveEvent(info.event),
    eventResize: (info) => moveEvent(info.event),
  });
  cal.render();
  if (window.ResizeObserver) new ResizeObserver(() => cal.updateSize()).observe($('#calendar'));
  syncViewButtons(cal.view.type);
}
function moveEvent(fcEv) {
  const e = events.find((x) => x.id === fcEv.id); if (!e) return;
  e.date = ymd(fcEv.start);
  if (fcEv.allDay) { e.allDay = true; e.startTime = ''; e.endTime = ''; }
  else { e.allDay = false; e.startTime = hm(fcEv.start); e.endTime = fcEv.end ? hm(fcEv.end) : ''; }
  e.dirty = true; e.updatedAt = Date.now();
  saveEvents(); refreshCalendar(); autoSync();
}
function syncViewButtons(view) {
  document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
}

/* ================= 編輯視窗 ================= */
let editingId = null;
let editorReminders = [];

function renderReminderChips() {
  const allDay = $('#editorForm').allDay.checked;
  const presets = allDay ? ALLDAY_PRESETS : REMINDER_PRESETS;
  const all = [...new Set([...presets, ...editorReminders])].sort((a, b) => a - b);
  const box = $('#reminderChips'); box.innerHTML = '';
  all.forEach((m) => {
    const b = document.createElement('button'); b.type = 'button';
    b.textContent = fmtReminder(m, allDay);
    b.className = editorReminders.includes(m) ? 'on' : '';
    b.onclick = () => {
      if (editorReminders.includes(m)) editorReminders = editorReminders.filter((x) => x !== m);
      else if (editorReminders.length >= 5) { toast('Google 日曆最多 5 個提醒'); return; }
      else editorReminders.push(m);
      renderReminderChips();
    };
    box.appendChild(b);
  });
}
function fillCategorySelect(sel, value) {
  sel.innerHTML = settings.categories.map((c) => `<option ${c.name === value ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}
function openEditor(id, preset = {}) {
  const f = $('#editorForm');
  const e = id ? events.find((x) => x.id === id) : null;
  editingId = e ? e.id : null;
  const v = e || {
    title: '', date: preset.date || ymd(new Date()), allDay: preset.allDay ?? true,
    startTime: preset.startTime || '', endTime: '', category: settings.categories[0]?.name, notes: '', reminders: [],
  };
  $('#editorTitle').textContent = e ? '編輯行程' : '新增行程';
  f.title.value = v.title;
  f.date.value = v.date;
  f.allDay.checked = !!v.allDay;
  f.startTime.value = v.startTime || '';
  f.endTime.value = v.endTime || '';
  fillCategorySelect(f.category, v.category);
  f.notes.value = v.notes || '';
  editorReminders = e ? [...(e.reminders || [])] : (v.allDay ? [900] : [30]);
  renderReminderChips();
  toggleAllDay();
  $('#deleteBtn').hidden = !e;
  $('#editor').showModal();
  if (!e) setTimeout(() => f.title.focus(), 50);
}
function toggleAllDay(userToggled) {
  const f = $('#editorForm');
  if (userToggled === true) { editorReminders = f.allDay.checked ? [900] : [30]; renderReminderChips(); }
  f.querySelector('.grid3').classList.toggle('allday', f.allDay.checked);
  if (!f.allDay.checked && !f.startTime.value) f.startTime.value = '09:00';
}
function saveEditor(ev) {
  ev.preventDefault();
  const f = $('#editorForm');
  const allDay = f.allDay.checked;
  const data = {
    title: f.title.value.trim(),
    date: f.date.value,
    allDay,
    startTime: allDay ? '' : f.startTime.value,
    endTime: allDay ? '' : f.endTime.value,
    category: f.category.value,
    notes: f.notes.value.trim(),
    reminders: [...editorReminders].sort((a, b) => a - b),
  };
  if (!data.title || !data.date) { toast('請填事項和日期'); return; }
  if (!allDay && !data.startTime) { toast('請填開始時間，或勾選全天'); return; }
  if (data.endTime && data.endTime <= data.startTime) data.endTime = '';
  if (editingId) {
    Object.assign(events.find((x) => x.id === editingId), data, { dirty: true, updatedAt: Date.now() });
  } else {
    events.push({ id: uid(), ...data, isPrep: false, dirty: true, createdAt: Date.now() });
  }
  saveEvents(); refreshCalendar(); $('#editor').close(); toast('已儲存'); autoSync();
}
function deleteEvent(id) {
  const e = events.find((x) => x.id === id); if (!e) return;
  const kids = events.filter((x) => x.parentId === id && !x.deleted);
  let targets = [e];
  if (kids.length && confirm(`要一併刪除 ${kids.length} 個相關的準備提醒嗎？`)) targets = targets.concat(kids);
  targets.forEach((t) => {
    if (t.gcalId) { t.deleted = true; t.dirty = true; } else events = events.filter((x) => x.id !== t.id);
  });
  saveEvents(); refreshCalendar(); autoSync();
}

/* ================= Gemini 對話 ================= */
let convo = [];
let busy = false;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    status: { type: 'STRING', enum: ['asking', 'ready'] },
    message: { type: 'STRING' },
    options: { type: 'ARRAY', items: { type: 'STRING' } },
    events: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          date: { type: 'STRING' },
          allDay: { type: 'BOOLEAN' },
          startTime: { type: 'STRING', nullable: true },
          endTime: { type: 'STRING', nullable: true },
          category: { type: 'STRING' },
          notes: { type: 'STRING' },
          reminders: { type: 'ARRAY', items: { type: 'INTEGER' } },
          isPrep: { type: 'BOOLEAN' },
        },
        required: ['title', 'date', 'allDay', 'category', 'isPrep'],
      },
    },
  },
  required: ['status', 'message', 'options', 'events'],
};

function systemPrompt() {
  const now = new Date();
  const today = ymd(now);
  const until = addDays(today, 45);
  const upcoming = events
    .filter((e) => !e.deleted && e.date >= today && e.date <= until && !e.isPrep)
    .sort((a, b) => (a.date + (a.startTime || '')).localeCompare(b.date + (b.startTime || '')))
    .slice(0, 40)
    .map((e) => `- ${e.date} ${e.allDay ? '全天' : e.startTime} ${e.title}`).join('\n') || '（無）';
  return `你是「智能行事曆」的排程助理，用繁體中文、口語、簡短地回覆。
現在是 ${today} ${hm(now)}（星期${WEEK[now.getDay()]}），時區 ${TZ}。
可用的種類（category 只能從中選一個）：${settings.categories.map((c) => c.name).join('、')}
使用者接下來已有的行程（用來發現衝突；有衝突才提）：
${upcoming}

你的工作：
1. 把使用者描述的活動轉成行程。「明天」「下週三」「月底」等相對日期要換算成實際日期（一週從星期一開始算，「下週X」指下一個星期一之後那週的星期X）。
2. 資訊不足或值得確認時就追問，重點依序是：
   a. 缺少的關鍵資訊（日期、時間；地點若重要也問）。
   b. 這件事需要事先準備什麼、希望什麼時候被提醒去做（例如：報告要提前幾天開始寫、考試要從哪天開始複習、比賽交件前要檢查什麼、出遊前要訂票打包）。
   c. 活動當天要提前多久提醒。
3. 每次最多問 2 個問題，並在 options 給 2–4 個可以直接點的簡短回覆（例如「提前 3 天」「前一晚提醒」「不用準備」）。
4. 使用者說「不用」「就這樣」「直接加」之類的話，或你已經追問了 2 輪，就直接產出結果，不要再問。很單純的事（例如吃飯、看電影）可以只問一次甚至不問。
5. 產出時 status 設 "ready"，message 用一句話總結；events 包含主行程（isPrep=false），以及每個準備事項各一筆（isPrep=true，標題以動作開頭，例如「開始寫期末報告」「訂高鐵票」，日期放在建議去做的那天，規則見第 6 點）。
6. reminders 是「提前幾分鐘提醒」的整數陣列，最多 5 個、最大 40320：
   - 有時間的行程：依使用者要求；沒講就用 [30]。
   - 全天行程：數字從當天 00:00 往前算，例如 900 = 前一天早上 9 點；沒講就用 [900]。要「當天早上提醒」的事請改成有時間的行程（例如 09:00）並用 [0]。
   - 準備事項：建議做成有時間的行程（例如當天 09:00 或 20:00），reminders 用 [0]。
7. 時間一律 24 小時制 HH:MM；全天行程 startTime 和 endTime 設 null；沒有結束時間 endTime 設 null。
8. notes 放地點、要帶的東西、使用者提到的細節；沒有就給空字串。
9. 追問時（status="asking"）events 回傳空陣列。
10. 使用者的訊息跟排行程無關時，簡短回應並引導他描述要排的事，status="asking"。`;
}

// 主模型忙線（503/500）或額度用完（429）時，依序改用這些備用模型（各自有獨立額度）
const FALLBACK_MODELS = ['gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callGemini(onStatus = () => {}) {
  if (!settings.geminiKey) throw new Error('還沒設定 Gemini API key，請點右上角 ⚙︎ 設定。');
  const primary = (settings.model || 'gemini-flash-latest').trim();
  const models = [primary, ...FALLBACK_MODELS.filter((m) => m !== primary)];
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt() }] },
    contents: convo,
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.3 },
  });
  let data = null;
  let lastErr = null;
  outer:
  for (let mi = 0; mi < models.length; mi++) {
    const model = models[mi];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    for (let attempt = 0; attempt < 2; attempt++) {
      let r;
      try {
        r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.geminiKey },
          body,
        });
      } catch {
        throw new Error('連不上 Gemini，請確認網路。');
      }
      const d = await r.json().catch(() => ({}));
      if (r.ok) { data = d; break outer; }
      const msg = d?.error?.message || '';
      if (r.status === 400 && /API key/i.test(msg)) throw new Error('Gemini API key 無效，請到設定確認。');
      if (r.status === 503 || r.status === 500) {
        lastErr = new Error('Gemini 目前忙線中，等一下再試。');
        if (attempt === 0) { onStatus('Gemini 忙線，重試中…'); await sleep(1500); continue; }
        break; // 換下一個模型
      }
      if (r.status === 429) { lastErr = new Error('免費額度用完或太頻繁了，等一下再試。'); break; }
      if (r.status === 404) {
        lastErr = new Error(`找不到模型「${model}」，請到設定改模型名稱。`);
        break; // 換下一個模型
      }
      throw new Error(`Gemini 錯誤（${r.status}）：${msg || '未知錯誤'}`);
    }
    if (mi + 1 < models.length) onStatus(`改用備用模型 ${models[mi + 1]}…`);
  }
  if (!data) throw lastErr || new Error('Gemini 沒有回應，請稍後再試。');
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((p) => !p.thought && p.text).map((p) => p.text).join('');
  if (!text) throw new Error('Gemini 沒有回應內容，請換個說法再試。');
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error('Gemini 回傳格式錯誤，請再說一次。'); }
  return { raw: text, res: normalizeResult(obj) };
}

function normalizeResult(o) {
  const res = {
    status: o.status === 'ready' ? 'ready' : 'asking',
    message: String(o.message || ''),
    options: Array.isArray(o.options) ? o.options.filter((x) => typeof x === 'string').slice(0, 4) : [],
    events: [],
  };
  const names = settings.categories.map((c) => c.name);
  (Array.isArray(o.events) ? o.events : []).forEach((e) => {
    if (!e || !e.title || !isYmd(e.date)) return;
    const timed = !e.allDay && isHm(e.startTime);
    res.events.push({
      title: String(e.title).slice(0, 120),
      date: e.date,
      allDay: !timed,
      startTime: timed ? e.startTime : '',
      endTime: timed && isHm(e.endTime) && e.endTime > e.startTime ? e.endTime : '',
      category: names.includes(e.category) ? e.category : names[0],
      notes: String(e.notes || ''),
      reminders: [...new Set((Array.isArray(e.reminders) ? e.reminders : [])
        .map(Number).filter((m) => Number.isInteger(m) && m >= 0 && m <= 40320))].slice(0, 5),
      isPrep: !!e.isPrep,
    });
  });
  // 主行程排前面
  res.events.sort((a, b) => Number(a.isPrep) - Number(b.isPrep));
  return res;
}

function showLog() { $('#chatLog').hidden = false; document.body.classList.add('chatting'); }
function scrollLog() { const l = $('#chatLog'); l.scrollTop = l.scrollHeight; }
function addMsg(kind, text) {
  showLog();
  const d = document.createElement('div'); d.className = `msg ${kind}`; d.textContent = text;
  $('#messages').appendChild(d); scrollLog(); return d;
}
function disableOldOptions() { document.querySelectorAll('#messages .options button').forEach((b) => { b.disabled = true; }); }

async function sendChat(text) {
  text = text.trim(); if (!text || busy) return;
  disableOldOptions();
  addMsg('user', text);
  convo.push({ role: 'user', parts: [{ text }] });
  setBusy(true);
  const typing = addMsg('bot typing', '思考中…');
  try {
    const { raw, res } = await callGemini((t) => { typing.textContent = t; });
    typing.remove();
    convo.push({ role: 'model', parts: [{ text: raw }] });
    renderAssistant(res);
  } catch (err) {
    typing.remove();
    convo.pop();
    addMsg('error', err.message);
  } finally {
    setBusy(false);
  }
}
function setBusy(b) { busy = b; $('#sendBtn').disabled = b; }

function renderAssistant(res) {
  if (res.message) addMsg('bot', res.message);
  if (res.status === 'ready' && res.events.length) renderDraft(res.events);
  else if (res.status === 'ready') addMsg('bot', '（沒有產生行程，可以再描述一次）');
  if (res.options.length && res.status !== 'ready') {
    const box = document.createElement('div'); box.className = 'options';
    res.options.forEach((o) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = o;
      b.onclick = () => sendChat(o);
      box.appendChild(b);
    });
    $('#messages').appendChild(box); scrollLog();
  }
}

function renderDraft(drafts) {
  const card = document.createElement('div'); card.className = 'draft';
  card.innerHTML = `<h3>要加入的行程（可取消勾選）</h3>` + drafts.map((e, i) => `
    <label class="draft-item">
      <input type="checkbox" data-i="${i}" checked>
      <div>
        <div class="t"><span class="dot" style="background:${colorOf(e.category)}"></span>${e.isPrep ? '🔔 ' : ''}${esc(e.title)}</div>
        <div class="m">${esc(fmtWhen(e))}・${esc(e.category)}${e.reminders.length ? '・提醒 ' + e.reminders.map((m) => fmtReminder(m, e.allDay)).join('、') : ''}</div>
        ${e.notes ? `<div class="m">${esc(e.notes)}</div>` : ''}
      </div>
    </label>`).join('') +
    `<div class="draft-actions"><button type="button" class="edit">我要修改</button><button type="button" class="primary add">加入行事曆</button></div>`;
  card.querySelector('.add').onclick = () => {
    const picked = [...card.querySelectorAll('input[type=checkbox]')].filter((c) => c.checked).map((c) => drafts[+c.dataset.i]);
    if (!picked.length) { toast('沒有勾選任何行程'); return; }
    const main = picked.find((e) => !e.isPrep);
    const mainId = main ? uid() : null;
    picked.forEach((e) => {
      events.push({ id: e === main ? mainId : uid(), ...e, parentId: e.isPrep ? mainId : null, dirty: true, createdAt: Date.now() });
    });
    saveEvents(); refreshCalendar();
    card.querySelectorAll('button, input').forEach((x) => { x.disabled = true; });
    card.querySelector('.add').textContent = '已加入 ✓';
    addMsg('bot', `已加入 ${picked.length} 個行程。還有其他要排的嗎？`);
    convo = []; // 下一件事重新開始
    if (main && cal) cal.gotoDate(main.date);
    autoSync();
  };
  card.querySelector('.edit').onclick = () => {
    const i = $('#chatInput'); i.placeholder = '說說要改哪裡，例如：改成 3 點、不用準備提醒'; i.focus();
  };
  $('#messages').appendChild(card); scrollLog();
}

/* ================= Google 日曆同步 ================= */
const hasToken = () => gToken && gToken.exp > Date.now() + 60_000;

function getToken(interactive) {
  return new Promise((resolve, reject) => {
    if (hasToken()) return resolve(gToken.token);
    if (!interactive) return reject(new Error('needauth'));
    if (!settings.clientId) return reject(new Error('請先在設定填入 Google OAuth Client ID。'));
    if (!window.google?.accounts?.oauth2) return reject(new Error('Google 登入元件還沒載入，請確認網路後再試。'));
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: settings.clientId,
      scope: GSCOPE,
      callback: (r) => {
        if (r.error) return reject(new Error(`Google 授權失敗：${r.error}`));
        gToken = { token: r.access_token, exp: Date.now() + Number(r.expires_in || 3600) * 1000 };
        LS.set('sc.gtoken', gToken);
        resolve(gToken.token);
      },
      error_callback: (e) => reject(new Error(e?.type === 'popup_closed' ? '登入視窗被關閉了' : `Google 登入失敗：${e?.message || e?.type || ''}`)),
    });
    tc.requestAccessToken();
  });
}

async function gapi(path, opts = {}) {
  const token = await getToken(false);
  const r = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (r.status === 401) { gToken = null; LS.set('sc.gtoken', null); throw new Error('needauth'); }
  if (r.status === 204) return null;
  const d = await r.json().catch(() => null);
  if (!r.ok) { const err = new Error(d?.error?.message || `HTTP ${r.status}`); err.status = r.status; throw err; }
  return d;
}

async function ensureCalendar() {
  if (settings.calendarId) {
    try { await gapi(`/calendars/${encodeURIComponent(settings.calendarId)}`); return settings.calendarId; } catch (e) {
      if (e.message === 'needauth') throw e;
      if (e.status !== 404 && e.status !== 403) throw e;
    }
  }
  const c = await gapi('/calendars', { method: 'POST', body: JSON.stringify({ summary: '智能行事曆', timeZone: TZ }) });
  settings.calendarId = c.id; saveSettings();
  return c.id;
}

function toGoogle(e) {
  const timed = !e.allDay && e.startTime;
  let start, end;
  if (timed) {
    const endT = e.endTime ? { date: e.date, time: e.endTime } : plusHour(e.date, e.startTime);
    start = { dateTime: `${e.date}T${e.startTime}:00`, timeZone: TZ };
    end = { dateTime: `${endT.date}T${endT.time}:00`, timeZone: TZ };
  } else {
    start = { date: e.date }; end = { date: addDays(e.date, 1) };
  }
  return {
    summary: (e.isPrep ? '🔔 ' : '') + e.title,
    description: [e.notes, `種類：${e.category}`].filter(Boolean).join('\n\n'),
    colorId: catOf(e.category).colorId,
    start, end,
    reminders: { useDefault: false, overrides: (e.reminders || []).slice(0, 5).map((m) => ({ method: 'popup', minutes: m })) },
    extendedProperties: { private: { smartCalId: e.id } },
  };
}

let syncing = false;
async function syncAll(interactive = false) {
  if (syncing) return;
  const pending = events.filter((e) => e.dirty);
  if (!settings.clientId) { updateSyncPill(); return; }
  syncing = true; updateSyncPill('同步中…');
  try {
    await getToken(interactive);
    const calId = encodeURIComponent(await ensureCalendar());
    for (const e of pending) {
      try {
        if (e.deleted) {
          if (e.gcalId) await gapi(`/calendars/${calId}/events/${e.gcalId}`, { method: 'DELETE' }).catch((err) => { if (err.status !== 404 && err.status !== 410) throw err; });
          events = events.filter((x) => x.id !== e.id);
        } else if (e.gcalId) {
          try {
            await gapi(`/calendars/${calId}/events/${e.gcalId}`, { method: 'PUT', body: JSON.stringify(toGoogle(e)) });
          } catch (err) {
            if (err.status !== 404 && err.status !== 410) throw err;
            const g = await gapi(`/calendars/${calId}/events`, { method: 'POST', body: JSON.stringify(toGoogle(e)) });
            e.gcalId = g.id;
          }
          e.dirty = false;
        } else {
          const g = await gapi(`/calendars/${calId}/events`, { method: 'POST', body: JSON.stringify(toGoogle(e)) });
          e.gcalId = g.id; e.dirty = false;
        }
        saveEvents();
      } catch (err) {
        if (err.message === 'needauth') throw err;
        console.warn('同步單筆失敗', e, err);
      }
    }
    if (interactive) toast('已同步到 Google 日曆');
  } catch (err) {
    if (err.message !== 'needauth' || interactive) toast(err.message === 'needauth' ? '需要重新連結 Google' : err.message);
  } finally {
    syncing = false; updateSyncPill(); refreshGoogleStatus();
  }
}
function autoSync() { if (settings.clientId && hasToken()) syncAll(false); else updateSyncPill(); }

function updateSyncPill(text) {
  const p = $('#syncPill');
  if (text) { p.hidden = false; p.className = 'sync-pill'; p.textContent = text; return; }
  const n = events.filter((e) => e.dirty).length;
  if (!settings.clientId) { p.hidden = true; return; }
  if (!n) { p.hidden = !hasToken(); p.className = 'sync-pill'; p.textContent = '✓ 已同步 Google 日曆'; return; }
  p.hidden = false; p.className = 'sync-pill warn';
  p.textContent = hasToken() ? `${n} 筆待同步，點此同步` : `${n} 筆待同步，點此連結 Google`;
}
function refreshGoogleStatus() {
  const s = $('#googleStatus'); if (!s) return;
  s.textContent = !settings.clientId ? '尚未設定 Client ID' : hasToken() ? '已連結 ✓' : '未連結（每次開啟約需重新連結一次）';
}

/* ================= 設定 ================= */
let draftCats = [];
function renderCats() {
  const box = $('#catList'); box.innerHTML = '';
  draftCats.forEach((c, i) => {
    const row = document.createElement('div'); row.className = 'cat-row';
    row.innerHTML = `<input value="${esc(c.name)}" aria-label="種類名稱">
      <select aria-label="顏色">${Object.entries(GCOLORS).map(([id, [n]]) => `<option value="${id}" ${id === c.colorId ? 'selected' : ''}>● ${n}</option>`).join('')}</select>
      <button type="button" aria-label="刪除">×</button>`;
    const [inp, sel, del] = row.children;
    sel.style.color = GCOLORS[c.colorId][1];
    inp.oninput = () => { c.name = inp.value; };
    sel.onchange = () => { c.colorId = sel.value; sel.style.color = GCOLORS[c.colorId][1]; };
    del.onclick = () => { if (draftCats.length <= 1) { toast('至少要留一個種類'); return; } draftCats.splice(i, 1); renderCats(); };
    box.appendChild(row);
  });
}
function openSettings() {
  const f = $('#settingsForm');
  f.geminiKey.value = settings.geminiKey; f.model.value = settings.model; f.clientId.value = settings.clientId;
  draftCats = settings.categories.map((c) => ({ ...c }));
  renderCats(); refreshGoogleStatus();
  $('#settings').showModal();
}
function applySettingsForm() {
  const f = $('#settingsForm');
  const oldNames = settings.categories.map((c) => c.name);
  const oldColors = settings.categories.map((c) => c.colorId);
  const cats = draftCats.map((c) => ({ name: c.name.trim(), colorId: c.colorId })).filter((c) => c.name);
  const newClient = f.clientId.value.trim();
  if (newClient !== settings.clientId) { gToken = null; LS.set('sc.gtoken', null); settings.calendarId = ''; }
  Object.assign(settings, {
    geminiKey: f.geminiKey.value.trim(),
    model: f.model.value.trim() || 'gemini-flash-latest',
    clientId: newClient,
    categories: cats.length ? cats : DEFAULT_CATS,
  });
  // 改名的種類：依位置對應，讓既有行程跟著改；顏色變了也要重新同步
  oldNames.forEach((n, i) => {
    const nn = draftCats[i]?.name?.trim();
    const colorChanged = draftCats[i] && oldColors[i] !== draftCats[i].colorId;
    if (nn && (nn !== n || colorChanged)) events.forEach((e) => { if (e.category === n && !e.deleted) { e.category = nn; e.dirty = true; } });
  });
  saveSettings(); saveEvents(); refreshCalendar();
}

/* ================= 綁定事件 ================= */
function bind() {
  $('#prevBtn').onclick = () => cal?.prev();
  $('#nextBtn').onclick = () => cal?.next();
  $('#todayBtn').onclick = () => cal?.today();
  document.querySelectorAll('.seg button').forEach((b) => {
    b.onclick = () => { cal?.changeView(b.dataset.view); LS.set('sc.view', b.dataset.view); syncViewButtons(b.dataset.view); };
  });
  $('#addBtn').onclick = () => openEditor(null, { date: ymd(new Date()) });
  $('#settingsBtn').onclick = openSettings;
  $('#syncPill').onclick = () => syncAll(true);

  // 編輯視窗
  $('#editorForm').addEventListener('submit', saveEditor);
  $('#editorForm').allDay.addEventListener('change', () => toggleAllDay(true));
  $('#cancelEdit').onclick = () => $('#editor').close();
  $('#deleteBtn').onclick = () => {
    if (!editingId) return;
    if (!confirm('確定刪除這個行程？')) return;
    deleteEvent(editingId); $('#editor').close(); toast('已刪除');
  };

  // 設定
  $('#settingsForm').addEventListener('submit', (e) => { e.preventDefault(); applySettingsForm(); $('#settings').close(); toast('設定已儲存'); });
  $('#cancelSettings').onclick = () => $('#settings').close();
  $('#addCat').onclick = () => { draftCats.push({ name: '新種類', colorId: '7' }); renderCats(); };
  $('#connectGoogle').onclick = async () => {
    applySettingsForm();
    if (!settings.clientId) { toast('請先填 Client ID'); return; }
    await syncAll(true);
  };
  $('#exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify({ version: 1, events: events.filter((e) => !e.deleted), categories: settings.categories }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `smart-calendar-${ymd(new Date())}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#importFile').onchange = async (ev) => {
    const file = ev.target.files[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.events)) throw new Error();
      const ids = new Set(events.map((e) => e.id));
      const add = data.events.filter((e) => e && e.id && isYmd(e.date) && !ids.has(e.id)).map((e) => ({ ...e, gcalId: undefined, dirty: true }));
      events = events.concat(add);
      if (Array.isArray(data.categories) && data.categories.length) { settings.categories = data.categories; saveSettings(); }
      saveEvents(); refreshCalendar(); toast(`匯入 ${add.length} 筆`); $('#settings').close(); autoSync();
    } catch { toast('檔案格式不正確'); }
    ev.target.value = '';
  };

  // 聊天
  const input = $('#chatInput');
  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; };
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#chatForm').requestSubmit(); }
  });
  $('#chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = input.value; input.value = ''; grow();
    input.placeholder = '描述行程，例如：下週三 2 點開會';
    sendChat(t);
  });
  $('#clearChat').onclick = () => { convo = []; $('#messages').innerHTML = ''; $('#chatLog').hidden = true; document.body.classList.remove('chatting'); };
}

/* ================= 啟動 ================= */
bind();
initCalendar();
updateSyncPill();
if (hasToken()) autoSync();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
