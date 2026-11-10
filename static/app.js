/* 퍼블리싱 비교 화면 — 하네스 결과와 퍼블리셔 결과를 사이트 골격에 끼워 나란히·겹쳐 보고 판정한다. */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const enc = encodeURIComponent;

/* 공유용 정적 묶음(harness shadow export): manifest.js가 주소 → 파일을 알려 주면 서버 대신 그 파일을 읽는다. 보기 전용. */
const STATIC = window.HARNESS_STATIC || null;
function staticFile(path) {
  const u = new URL(path, 'http://x');
  return STATIC[u.pathname + '?' + [...u.searchParams].map(([k, v]) => `${k}=${v}`).sort().join('&')];
}
if (STATIC) document.body.classList.add('static');

async function api(path, opt) {
  if (STATIC) {
    if (opt && opt.method === 'POST') throw new Error('공유용 화면에서는 볼 수만 있어요');
    path = staticFile(path);
    if (!path) throw new Error('내보낸 자료에 없어요');
    opt = undefined;
  }
  const r = await fetch(path, opt);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function chip(text, kind = '') { return el('span', `chip ${kind}`, text); }

/* 하네스를 언제 돌렸나: 납품 뒤에 돌리거나 이어 간 건은 사람 단계 값(업로드 주소·링크 영역)을 납품본에서 빌렸다 */
const REPLAY = {
  before: ['납품본 없이 돌림', 'ok', '돌릴 때 납품본이 없었어요(납품 전이거나 납품본을 찾지 못함). 납품본에서 빌린 값이 없어요.'],
  resumed: ['납품본 없이 돌림 · 사람 단계는 납품본 값', 'info', '초안은 납품본 없이 만들었고, 사람만 줄 수 있는 값(이미지 업로드 주소·링크 영역 등)은 납품 뒤 납품본에서 빌려 채웠어요.'],
  after: ['납품 뒤에 돌림', 'warn', '납품본이 이미 있을 때 돌린 결과예요. 사람만 줄 수 있는 값(이미지 업로드 주소·링크 영역 등)은 납품본에서 빌렸고, 운영 페이지에 납품본이 이미 반영돼 있었을 수 있어요.'],
};
function replayChip(kind, short = false) {
  const [text, cls, tip] = REPLAY[kind];
  const c = chip(short ? text.split(' · ')[0] : text, cls);
  c.title = tip;
  return c;
}

/* 목록의 채점은 '코드' 기준(주석 제외)이다. 화면 캡처 결과는 따로 표시한다. */
const EVAL = {
  match: ['코드 일치', 'ok'], equivalent: ['코드 기능 동일', 'ok'], partial: ['코드 일부 다름', 'warn'],
  mismatch: ['코드 다름', 'bad'], not_comparable: ['비교 불가', ''],
};
const VISUAL = { same: ['화면 같음', 'ok'], diff: ['화면 다름', 'bad'], partial: ['화면 일부 확인', ''], unseen: ['화면엔 안 보이는 차이', 'warn'] };
const VERDICT = {
  harness: ['하네스가 맞음', 'h'], publisher: ['퍼블리셔가 맞음', 'p'],
  both_ok: ['둘 다 괜찮음', 'ok'], both_wrong: ['둘 다 틀림', 'bad'],
};
const TYPE = { page_edit: '페이지 수정', image_event_new: '이미지 단건', vendor_html_register: '수급 HTML', new_page_build: '신규 제작' };
const SEVERITY = { error: ['오류', 'bad'], warn: ['확인', 'warn'], info: ['정보', 'info'] };
const CAUSES = ['분석', '기준본', '계획', '연산', '팀 관례', '요청서 모호', '퍼블리셔 누락', '운영 화면만 바뀜'];

const RESULT = { '결과 대기': ['결과 대기', 'warn'], '결과 없음': ['결과 없음', ''] };
/* 하네스가 끝까지 가지 못하고 멈춘 건: 화면의 하네스 파일은 멈춘 지점까지의 결과다 */
const HALTED = { waiting: '하네스 사람 대기', error: '하네스 오류', handled_by_human: '사람이 처리', hold: '하네스 보류' };
const FILTERS = {
  all: () => true,
  harness: c => c.has_harness,
  diff: c => c.has_harness && c.eval !== 'match',
  todo: c => c.has_harness && !c.verdict,
};
const WEEK = '일월화수목금토';

function stored(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
}
function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 저장소를 못 쓰면 이번 화면에서만 */ }
}

const S = {
  cases: [], filter: stored('compare.filter', 'all'), open: null, id: null, d: null, key: null, v: null,
  mode: 'side', zoom: 'fit', diff: 'hp', active: false, shot: 'diff',
  draft: { verdict: null, causes: new Set() },
};
if (!FILTERS[S.filter]) S.filter = 'all';

/* ---------- 목록 ---------- */

async function loadCases(keep = true) {
  const r = await api('/api/cases');
  S.cases = r.cases;
  $('#source').textContent = r.sources.join(' · ');
  $('#source').title = r.sources.join('\n');
  $('#lastSync').textContent = r.last_sync ? `마지막 확인 ${r.last_sync}` : '아직 확인 전';
  let pick = null;
  if (!keep || !S.id) {
    const want = caseFromHash(), saved = stored('compare.case', null);
    pick = S.cases.find(c => c.id === want) || S.cases.find(c => c.id === saved)
      || visibleCases().find(c => c.has_harness) || visibleCases()[0];
  }
  if (!S.open) {               // 처음 열 때: 저장해 둔 펼침 상태, 없으면 하네스 결과가 있는 날짜와 고른 건의 날짜
    const saved = stored('compare.open', null);
    S.open = new Set(saved || S.cases.filter(c => c.has_harness).map(c => c.day));
    if (pick) S.open.add(pick.day);
    if (!S.open.size && S.cases.length) S.open.add(S.cases[0].day);
  }
  renderList();
  if (pick) select(pick.id);
}

function visibleCases() { return S.cases.filter(FILTERS[S.filter]); }

/* 보고서의 '비교' 링크(/#<건 ID>)로 들어오면 그 건을 연다 */
function caseFromHash() {
  try { return decodeURIComponent(location.hash.slice(1)); } catch { return ''; }
}
window.addEventListener('hashchange', () => {
  const id = caseFromHash();
  if (id !== S.id && S.cases?.some(c => c.id === id)) select(id);
});

/* NAS 날짜 폴더(YYMMDD) → 2026년 10월 / 10/23 (금) */
function dayParts(day) {
  const y = 2000 + +day.slice(0, 2), m = +day.slice(2, 4), d = +day.slice(4, 6);
  return { month: `${y}년 ${m}월`, week: WEEK[new Date(y, m - 1, d).getDay()] };
}

function renderList() {
  const list = $('#caseList');
  list.innerHTML = '';
  const byDay = new Map();
  for (const c of visibleCases()) {
    if (!byDay.has(c.day)) byDay.set(c.day, []);
    byDay.get(c.day).push(c);
  }
  let month = null;
  for (const [day, cases] of byDay) {
    const { month: m, week } = dayParts(day);
    if (m !== month) {
      list.append(el('li', 'month', m));
      month = m;
    }
    const open = S.open.has(day);
    const head = el('li', `day ${open ? 'open' : ''}`);
    head.append(el('span', 'caret', open ? '▾' : '▸'), el('strong', null, day), el('span', 'muted', `(${week})`));
    const all = S.cases.filter(c => c.day === day);
    const judged = all.filter(c => c.has_harness);
    const count = [`${all.length}건`];
    if (judged.length) count.push(`판정 ${judged.filter(c => c.verdict).length}/${judged.length}`);
    head.append(el('span', 'count', count.join(' · ')));
    const folder = all[0].folder;
    head.title = folder ? folder.split('/').slice(0, -1).join('/') : day;
    head.onclick = () => {
      S.open.has(day) ? S.open.delete(day) : S.open.add(day);
      store('compare.open', [...S.open]);
      renderList();
    };
    list.append(head);
    if (!open) continue;
    for (const c of cases) list.append(caseItem(c));
  }
  if (!list.children.length) list.append(el('li', 'muted none', '조건에 맞는 건이 없어요'));
}

function caseItem(c) {
  const li = el('li', `case ${c.id === S.id ? 'on' : ''} ${c.has_harness ? '' : 'noh'}`);
  li.dataset.id = c.id;
  li.title = c.has_harness ? c.title : `${c.title}\n아직 하네스로 처리하지 않은 요청이에요`;
  li.append(el('div', 't', c.title));
  const m = el('div', 'm');
  if (c.task_type) m.append(chip(TYPE[c.task_type] || c.task_type));
  if (c.has_harness && c.status && c.status !== 'done') m.append(chip(HALTED[c.status] || '하네스 미완료', 'warn'));
  if (RESULT[c.result] && !c.versions) m.append(chip(...RESULT[c.result]));
  if (c.eval) m.append(chip(...EVAL[c.eval]));
  if (REPLAY[c.replay]) m.append(replayChip(c.replay, true));
  if (c.visual) m.append(chip(...VISUAL[c.visual]));
  if (c.versions > 1) m.append(chip(`${c.versions}판`, 'info'));
  if (c.verdict) m.append(chip(...VERDICT[c.verdict.verdict]));
  li.append(m);
  li.onclick = () => select(c.id);
  return li;
}

/* ---------- 건 ---------- */

async function select(id) {
  S.id = id;
  store('compare.case', id);
  const c = S.cases.find(x => x.id === id);
  if (c && !S.open.has(c.day)) {           // j/k로 접힌 날짜의 건에 가면 그 날짜를 편다
    S.open.add(c.day);
    store('compare.open', [...S.open]);
    renderList();
  }
  $$('#caseList li.case').forEach(li => li.classList.toggle('on', li.dataset.id === id));
  $(`#caseList li.case[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
  S.d = await api(`/api/case?id=${enc(id)}`);
  const pairs = S.d.pairs;
  S.key = pairs.length ? (pairs.find(p => p.has_harness) || pairs[0]).key : null;
  const latest = S.d.versions.find(v => v.latest) || S.d.versions[S.d.versions.length - 1];
  S.v = latest ? latest.id : '';
  S.draft = { verdict: null, causes: new Set() };
  $('#memo').value = '';
  $('#empty').hidden = true;
  $('#caseView').hidden = false;
  renderCase();
}

function pair() { return S.d.pairs.find(p => p.key === S.key); }

function renderCase() {
  const d = S.d, m = d.meta;
  $('#title').textContent = d.title;
  const at = d.folder.match(/\d{4}년\/\d{1,2}월\/\d{6}/);
  const bits = [at ? at[0].split('/').join(' / ') : d.date, m.requester && `${m.requester} ${m.posted_at || ''}`,
    TYPE[d.task_type] || d.task_type, m.schedule && `반영 ${m.schedule}`, d.source && `하네스 ${d.source}`].filter(Boolean);
  $('#subline').textContent = bits.join(' · ');
  const chips = $('#chips');
  chips.innerHTML = '';
  if (!d.has_harness) chips.append(chip('하네스 처리 전'));
  if (d.has_harness && d.status && d.status !== 'done') chips.append(chip(`${HALTED[d.status] || '하네스 미완료'} · 여기까지의 파일`, 'warn'));
  if (RESULT[d.result] && !d.versions.length) chips.append(chip(...RESULT[d.result]));
  if (d.eval) chips.append(chip(...EVAL[d.eval]));
  if (REPLAY[d.replay]) chips.append(replayChip(d.replay));
  if (d.warns) chips.append(chip(`확인 필요 ${d.warns}`, 'warn'));
  if (d.versions.length > 1) chips.append(chip(`퍼블리셔 ${d.versions.length}판 (재납품)`, 'info'));

  const tabs = $('#fileTabs');
  tabs.innerHTML = '';
  for (const p of d.pairs) {
    const b = el('button', p.key === S.key ? 'on' : '', p.label || p.key);
    b.title = p.key;
    b.onclick = () => { S.key = p.key; renderCase(); };
    tabs.append(b);
  }
  const sel = $('#versionSel');
  sel.innerHTML = '';
  for (const v of d.versions) {
    const o = el('option', null, v.label + (v.latest ? ' (최신)' : ''));
    o.value = v.id;
    o.selected = v.id === S.v;
    sel.append(o);
  }
  sel.disabled = d.versions.length < 2;
  renderStage();
  renderDetails();
  renderVerdict();
}

/* ---------- 비교 영역 ---------- */

function renderUrl(side) {
  const url = `/render?id=${enc(S.id)}&side=${side}&key=${enc(S.key)}&v=${enc(S.v)}`;
  return STATIC ? staticFile(url) || 'about:blank' : url;
}

function verLabel() {
  const v = S.d.versions.find(x => x.id === S.v);
  return v ? v.label : '';
}

/* 하네스 결과가 없으면 퍼블리셔 결과만 볼 수 있다 (고른 보기 방식은 그대로 두고 다음 건에서 다시 쓴다) */
function mode() { return S.d && S.d.has_harness ? S.mode : 'side'; }

function syncOpts() {
  $$('#modeSeg button').forEach(b => {
    b.classList.toggle('on', b.dataset.mode === mode());
    b.disabled = !S.d.has_harness && b.dataset.mode !== 'side';
  });
  $$('#viewOpts .opt').forEach(o => { o.hidden = !o.dataset.for.split(' ').includes(mode()); });
  $$('#zoomSeg button').forEach(b => b.classList.toggle('on', b.dataset.zoom === S.zoom));
  $$('#diffSeg button').forEach(b => b.classList.toggle('on', b.dataset.diff === S.diff));
  $$('#shotSeg button').forEach(b => b.classList.toggle('on', b.dataset.shot === S.shot));
}

function renderStage() {
  syncOpts();
  const st = $('#stage');
  st.innerHTML = '';
  const p = pair();
  if (!p) {
    $('#pairNote').textContent = '';
    st.append(el('div', 'none', {
      '결과 대기': '퍼블리셔 결과물이 아직 없어요. 요청 폴더에 결과물이 올라오면 \'지금 확인\'으로 가져와요.',
      '결과 없음': '14일 동안 결과물이 올라오지 않아 닫은 요청이에요.',
    }[S.d.result] || '비교할 결과물이 없어요'));
    return;
  }
  const pubHas = p.publisher[S.v];
  $('#pairNote').textContent = [
    `${p.device === 'mo' ? 'MO' : 'PC'} 너비 ${p.width}px`,
    !S.d.has_harness ? '하네스 처리 전이라 퍼블리셔 결과만 보여요' : !p.has_harness && '하네스 결과 없음',
    !pubHas && '이 판에 퍼블리셔 파일 없음',
    p.other && `파일이 달라요: 퍼블리셔는 ${p.other.split('/').pop()}`,
  ].filter(Boolean).join(' · ');
  if (!S.d.has_harness) {
    st.append(pane('퍼블리셔', 'var(--publisher)', verLabel(), [renderUrl('publisher')], p.width));
    requestAnimationFrame(fitAll);
    return;
  }
  if (S.mode === 'code') return renderCode(st);
  if (S.mode === 'blend') return renderCapture(st);
  if (S.mode === 'side') {
    st.append(pane('하네스', 'var(--harness)', '', [renderUrl('harness')], p.width),
      pane('퍼블리셔', 'var(--publisher)', verLabel(), [renderUrl('publisher')], p.width));
  } else {
    st.append(pane('겹쳐 보기', 'var(--accent)', `아래 하네스 · 위 퍼블리셔 ${verLabel()}`,
      [renderUrl('harness'), renderUrl('publisher')], p.width));
  }
  hookScroll();
  requestAnimationFrame(fitAll);
}

function pane(title, color, sub, urls, width) {
  const pn = el('div', 'pane');
  const head = el('div', 'pane-head');
  const dot = el('span', 'dot');
  dot.style.background = color;
  head.append(dot, el('span', null, title));
  if (sub) head.append(el('span', 'sub', sub));
  const box = el('div', 'frame-box');
  box.dataset.w = width;
  const sizer = el('div', 'sizer');
  box.append(sizer);
  urls.forEach((u, i) => {
    const f = el('iframe');
    f.src = u;
    f.loading = 'eager';
    if (i === 1) {
      f.classList.add('overlay-top');      // 'top'은 화면 맨 위 막대 스타일(좌우 안쪽 여백 16px)과 이름이 겹친다
      f.style.opacity = $('#opacity').value / 100;
    }
    box.append(f);
  });
  pn.append(head, box);
  return pn;
}

function fitAll() {
  $$('#stage .frame-box').forEach(box => {
    const w = +box.dataset.w;
    const frames = $$('iframe', box);
    const sizer = $('.sizer', box);
    if (S.zoom === 'fit') {
      const s = Math.min(1, box.clientWidth / w);
      box.classList.remove('real');
      sizer.style.width = '0';
      frames.forEach(f => {
        f.style.width = `${w}px`;
        f.style.height = `${box.clientHeight / s}px`;
        f.style.transform = `scale(${s})`;
        f.style.left = `${Math.max(0, (box.clientWidth - w * s) / 2)}px`;
      });
    } else {
      box.classList.add('real');
      sizer.style.width = `${w}px`;
      sizer.style.height = '1px';
      frames.forEach(f => {
        f.style.width = `${w}px`;
        f.style.height = `${box.clientHeight - 14}px`;
        f.style.transform = 'none';
        f.style.left = `${Math.max(0, (box.clientWidth - w) / 2)}px`;
      });
    }
  });
}

function hookScroll() {
  const frames = $$('#stage iframe');
  let busy = false;
  frames.forEach(f => f.addEventListener('load', () => {
    const w = f.contentWindow;
    if (!w) return;
    w.addEventListener('scroll', () => {
      const always = S.mode !== 'side';            // 겹쳐 볼 때는 늘 맞춘다
      if (busy || (!always && !$('#syncScroll').checked)) return;
      busy = true;
      frames.forEach(o => { if (o !== f && o.contentWindow) o.contentWindow.scrollTo(w.scrollX, w.scrollY); });
      requestAnimationFrame(() => { busy = false; });
    }, { passive: true });
  }));
}

/* ---------- 캡처 비교 ---------- */

const sleep = ms => new Promise(res => setTimeout(res, ms));

async function renderCapture(st) {
  const box = el('div', 'shots');
  box.append(el('div', 'none', '두 결과를 캡처해서 비교하고 있어요… (처음 한 번만 10~30초)'));
  st.append(box);
  const at = `${S.id}|${S.key}|${S.v}`;
  const still = () => S.mode === 'blend' && `${S.id}|${S.key}|${S.v}` === at;
  let r;
  try {
    for (;;) {
      r = await api(`/api/capture?id=${enc(S.id)}&key=${enc(S.key)}&v=${enc(S.v)}`);
      if (r.status !== 'running') break;
      await sleep(1500);
      if (!still()) return;
    }
  } catch (e) { r = { status: 'error', error: e.message }; }
  if (!still()) return;
  box.innerHTML = '';
  if (r.status === 'error') {
    const p = pair();
    if (!(STATIC && p && p.has_harness && p.publisher[S.v])) { box.append(el('div', 'none', `캡처하지 못했어요: ${r.error}`)); return; }
    // 공유용 화면에 찍어 둔 캡처가 없으면: 두 화면을 겹쳐 같은 곳은 검게, 다른 곳만 밝게 보여 준다 (브라우저가 바로 계산)
    const note = el('div', 'shot-head');
    note.append(chip('찍어 둔 화면 비교가 없어 겹쳐서 보여 줘요'), el('span', 'muted', `${r.error} · 검은 곳은 같고, 밝게 보이는 곳이 달라요 (바뀐 곳 개수는 안 나와요)`));
    const pn = pane('차이만 밝게', 'var(--accent)', `하네스와 퍼블리셔 ${verLabel()}를 겹침`, [renderUrl('harness'), renderUrl('publisher')], p.width);
    const top = $('iframe.overlay-top', pn);
    top.style.opacity = 1;
    top.style.mixBlendMode = 'difference';
    pn.style.cssText = 'flex:1;min-height:0;border:0;border-radius:0';
    box.append(note, pn);
    hookScroll();
    requestAnimationFrame(fitAll);
    return;
  }

  const head = el('div', 'shot-head');
  const [, hh] = r.harness_size, [, ph] = r.publisher_size;
  const count = k => r.regions.filter(x => x.kind === k).length;
  if (!r.regions.some(x => x.kind !== 'unstable')) head.append(chip('화면상 차이 없음', 'ok'));
  if (count('changed')) head.append(chip(`바뀐 곳 ${count('changed')}`, 'bad'));
  if (count('publisher_only')) head.append(chip(`퍼블리셔에만 ${count('publisher_only')}`, 'warn'));
  if (count('harness_only')) head.append(chip(`하네스에만 ${count('harness_only')}`, 'h'));
  if (count('unstable')) head.append(chip(`움직이는 요소 ${count('unstable')} (비교에서 제외)`));
  if (hh !== ph) head.append(chip(`높이 하네스 ${hh}px · 퍼블리셔 ${ph}px`));
  head.append(el('span', 'muted', '퍼블리셔 화면 기준 · 빨강 바뀜 · 주황 퍼블리셔에만 · 파란 선 하네스에만 있는 부분이 빠진 자리 · 회색 움직이는 요소'));
  const regions = el('div', 'regions');
  head.append(regions);
  box.append(head);

  if (!r.regions.some(x => x.kind !== 'unstable')) {
    const d = await api(`/api/diff?id=${enc(S.id)}&key=${enc(S.key)}&v=${enc(S.v)}&mode=hp&active=1`).catch(() => null);
    if (d && !d.same) box.append(hiddenHint(d));
  }
  const body = el('div', `shot-body ${S.zoom === 'fit' ? 'fit' : ''}`);
  const img = el('img');
  img.src = STATIC ? `captures/${r.digest}/${S.shot}.jpg` : `/capture-img?d=${r.digest}&f=${S.shot}`;
  img.style.maxWidth = `${r.size[0]}px`;          // 화면 맞춤이어도 원래 크기보다 키우지 않는다 (MO 390px)
  img.alt = { diff: '차이 표시', harness: '하네스 캡처', publisher: '퍼블리셔 캡처' }[S.shot];
  body.append(img);
  box.append(body);
  const KIND = { changed: '바뀜', publisher_only: '퍼블리셔에만', harness_only: '하네스에만', unstable: '움직이는 요소' };
  r.regions.forEach((g, i) => {
    const size = g.kind === 'harness_only' ? `${g.a_h}px` : `${g.w}×${g.h}`;
    const b = el('button', `k-${g.kind}`, `${i + 1} ${KIND[g.kind]} · y ${g.y} · ${size}`);
    b.onclick = () => {
      if (S.shot === 'harness') {           // 하네스 캡처는 하네스 좌표로 이동
        const scale = img.clientWidth / r.harness_size[0] || 1;
        body.scrollTo({ top: Math.max(0, g.a_y * scale - 60), behavior: 'smooth' });
        return;
      }
      const scale = img.clientWidth / r.size[0] || 1;
      body.scrollTo({ top: Math.max(0, g.y * scale - 60), behavior: 'smooth' });
    };
    regions.append(b);
  });
}

function hiddenHint(d) {
  const where = d.places.length ? d.places.join('·') : '처음 화면에 안 보이는 곳';
  const hint = el('div', 'hint');
  hint.append(el('strong', null, '처음 보이는 화면에서는 같지만, 코드는 달라요. '),
    el('span', null, `다른 ${d.added + d.removed}줄이 ${where} 안에 있어서 캡처에 안 잡혀요. 배너가 넘어가거나 팝업을 열면 보이는 차이예요.`));
  const lines = d.hunks.flatMap(h => h.lines).filter(l => l.t !== ' ').slice(0, 4);
  const pre = el('div', 'hint-lines');
  lines.forEach(l => pre.append(el('div', l.t === '+' ? 'add' : 'del',
    `${l.t === '+' ? '+ 퍼블리셔' : '− 하네스'}  ${l.text.trim().slice(0, 140)}`)));
  const go = el('button', 'btn', '코드 차이 보기');
  go.onclick = () => { S.mode = 'code'; S.diff = 'hp'; S.active = true; $('#activeOnly').checked = true; renderStage(); };
  hint.append(pre, go);
  return hint;
}

/* ---------- 코드 차이 ---------- */

async function renderCode(st) {
  const box = el('div', 'code');
  box.append(el('div', 'none', '불러오는 중…'));
  st.append(box);
  const label = { hp: ['하네스', '퍼블리셔'], bh: ['기준본', '하네스'], bp: ['기준본', '퍼블리셔'] }[S.diff];
  try {
    const r = await api(`/api/diff?id=${enc(S.id)}&key=${enc(S.key)}&v=${enc(S.v)}&mode=${S.diff}&active=${S.active ? 1 : 0}`);
    box.innerHTML = '';
    box.append(el('div', 'sum', r.same
      ? `${label[0]}와 ${label[1]}가 같아요${S.active ? ' (주석 제외)' : ''}`
      : `− ${label[0]}에만 있는 줄 ${r.removed} · + ${label[1]}에만 있는 줄 ${r.added}${S.active ? ' · 주석 제외' : ''}`
        + (r.places.length ? ` · 위치: ${r.places.join(', ')}` : '')
        + (r.normalized ? ' · 생성기 난수·작업 ID는 같은 것으로 봄' : '')));
    if (r.same) { box.append(el('div', 'none', '차이가 없어요')); return; }
    r.hunks.forEach((h, i) => {
      const hk = el('div', 'hunk');
      if (i) hk.append(el('div', 'hunk-sep', '⋯'));
      for (const ln of h.lines) {
        const row = el('div', `ln ${ln.t === '+' ? 'add' : ln.t === '-' ? 'del' : ''}`);
        row.append(el('span', 'no', ln.a ?? ''), el('span', 'no', ln.b ?? ''), el('span', 'no', ln.t === ' ' ? '' : ln.t));
        row.append(marked(ln.text, ln.spans || []));
        hk.append(row);
      }
      box.append(hk);
    });
  } catch (e) {
    box.innerHTML = '';
    box.append(el('div', 'none', `차이를 불러오지 못했어요: ${e.message}`));
  }
}

function marked(text, spans) {
  const tx = el('span', 'tx');
  let pos = 0;
  for (const [s, e] of spans) {
    if (s > pos) tx.append(document.createTextNode(text.slice(pos, s)));
    tx.append(el('mark', null, text.slice(s, e)));
    pos = e;
  }
  tx.append(document.createTextNode(text.slice(pos)));
  return tx;
}

/* ---------- 오른쪽 정보 ---------- */

/* 차이 원인 (자동 진단): 하네스와 납품본(최신 판)이 다른 곳마다 규칙으로 가린 원인. 하네스 탓인 것과
   하네스가 알 수 없던 것(요청서 밖·나중 판)을 색으로 나눈다. LLM 없이 서버의 diagnose.py가 만든다. */
function renderDiagnosis(groups) {
  const s = section('차이 원인 (자동 진단)');
  const all = groups.flatMap(g => g.items);
  const mine = all.filter(i => i.harness_fault === true).length, theirs = all.filter(i => i.harness_fault === false).length;
  s.append(el('p', 'muted', `하네스 결과와 최신 납품본이 다른 곳 ${all.length}곳 · 하네스 탓 ${mine} · 하네스가 알 수 없던 것 ${theirs}`));
  groups.forEach(g => {
    const head = el('div', 'diag-file');
    head.append(el('strong', null, g.file));
    Object.entries(g.counts).forEach(([k, n]) => head.append(chip(`${k} ${n}`)));
    s.append(head);
    g.items.forEach(it => {
      const row = el('div', 'finding diag');
      row.append(chip(it.label, it.harness_fault === true ? 'bad' : it.harness_fault === false ? '' : 'info'));
      const body = el('div');
      body.append(el('div', null, it.text));
      if (it.h) body.append(el('code', 'diag-h', 'H ' + it.h));
      if (it.p) body.append(el('code', 'diag-p', 'P ' + it.p));
      row.append(body);
      s.append(row);
    });
    if (g.more) s.append(el('p', 'muted', `… ${g.more}곳 더 (코드 차이에서 보세요)`));
  });
  return s;
}

function section(title) {
  const s = el('section');
  s.append(el('h2', null, title));
  return s;
}

function renderDetails() {
  const m = S.d.meta, box = $('#details');
  box.innerHTML = '';

  const req = section('요청');
  if (m.summary) req.append(el('p', null, m.summary));
  if (S.d.folder) {
    const row = el('p', 'muted', S.d.folder.split('/').slice(-2).join(' / ') + ' ');
    row.append(reveal(STATIC ? 'NAS 경로 복사' : 'Finder에서 열기', { kind: 'request' }));
    req.append(row);
  }
  const inputs = m.shadow?.inputs || [];
  if (inputs.length) {
    const ul = el('ul');
    inputs.forEach(n => {
      const li = el('li');
      li.append(reveal(n, { kind: 'input', name: n }, true));
      ul.append(li);
    });
    req.append(el('p', 'muted', `요청서·자료 ${inputs.length}개 (${STATIC ? '누르면 NAS 경로를 복사해요' : '누르면 Finder에서 보여요'})`), ul);
  }
  const paths = m.paths || [];
  if (paths.length) {
    const ul = el('ul');
    paths.forEach((p, index) => {
      const li = el('li');
      if (p.label) li.append(el('span', 'muted', `[${p.label}] `));
      const btn = reveal(p.rel.split('/').slice(-3).join(' / '), { kind: 'path', index }, true);
      btn.title = p.rel;
      li.append(btn);
      ul.append(li);
    });
    req.append(el('p', 'muted', `요청서에 적힌 경로 ${paths.length}개 (${STATIC ? '누르면 NAS 경로를 복사해요' : '누르면 Finder에서 열려요'})`), ul);
  }
  if (m.open_questions?.length) {
    const ul = el('ul');
    m.open_questions.forEach(q => ul.append(el('li', null, q)));
    req.append(el('p', 'muted', '요청서 확인 필요'), ul);
  }
  box.append(req);

  if (!S.d.job_id) {
    const s = section('하네스');
    s.append(el('p', null, '아직 하네스로 처리하지 않은 요청이에요.'),
      el('p', 'muted', '하네스로 처리하면 같은 요청 폴더의 결과가 여기에 붙고, 판정할 수 있어요.'));
    box.append(s);
  }

  if (m.plan?.length || m.items?.length) {
    const s = section('하네스가 한 일 (계획)');
    const ul = el('ul');
    (m.plan.length ? m.plan : m.items).forEach(it => {
      const li = el('li');
      li.append(el('strong', null, `[${it.no}] ${it.op}`));
      const params = it.params ? Object.entries(it.params).filter(([k]) => k !== 'instruction')
        .map(([k, v]) => `${k}=${String(v).slice(0, 70)}`).join(', ') : it.summary;
      if (params) li.append(el('div', 'muted', params));
      ul.append(li);
    });
    s.append(ul);
    box.append(s);
  }

  if (m.findings?.length) {
    const s = section('검증');
    m.findings.forEach(f => {
      const row = el('div', 'finding');
      row.append(chip(...(SEVERITY[f.severity] || [f.severity])), el('span', null, f.message));
      s.append(row);
    });
    box.append(s);
  }

  if (m.evaluation) {
    const s = section('채점 (실제 결과물과 비교)');
    s.append(chip(...(EVAL[m.evaluation.verdict] || [m.evaluation.verdict])));
    const ul = el('ul');
    Object.entries(m.evaluation.file_scores || {}).forEach(([k, v]) => ul.append(el('li', null, `${k.split('/').pop()}: ${v}`)));
    (m.evaluation.details || []).forEach(t => ul.append(el('li', 'muted', t)));
    s.append(ul);
    box.append(s);
  }

  if (S.d.diagnosis?.length) box.append(renderDiagnosis(S.d.diagnosis));

  if (S.d.job_id) {
    const base = section('기준본');
    const langs = Object.entries(m.base?.by_lang || {});
    if (langs.length) {
      langs.forEach(([lang, b]) => {
        const row = el('p', null, `${langs.length > 1 ? lang + ' · ' : ''}${b.source} `);
        row.append(reveal(b.rel.split('/').pop(), { kind: 'base', lang }, true));
        base.append(row);
      });
    } else if (m.base?.rel) {
      const row = el('p', null, `${m.base.source} `);
      row.append(reveal(m.base.rel.split('/').pop(), { kind: 'base' }, true));
      base.append(row);
    } else {
      base.append(el('p', null, '없음 (새로 만든 결과물)'));
    }
    (m.base?.notes || []).forEach(n => base.append(el('p', 'muted', n)));
    box.append(base);
  }

  const borrowed = Object.entries(m.borrowed || {});
  if (borrowed.length || m.human?.length) {
    const s = section('사람 단계 · 빌려 쓴 값');
    const ul = el('ul');
    borrowed.forEach(([k, v]) => ul.append(el('li', null, `${k} = ${String(v).slice(-60)}`)));
    (m.human || []).forEach(h => ul.append(el('li', 'muted', `${h.node}: ${h.question.slice(0, 80)} → ${h.answer ?? '대기'}`)));
    s.append(ul);
    box.append(s);
  }

  if (S.d.versions.length) {
    const s = section('퍼블리셔 납품');
    const ul = el('ul');
    S.d.versions.forEach(v => ul.append(el('li', null, `${v.label}: ${v.zips.join(', ')}`)));
    s.append(ul);
    box.append(s);
  }

  if (m.usage && S.d.job_id) {
    const u = m.usage, s = section('처리 시간·토큰');
    s.append(el('p', null, `${Math.round(u.seconds)}초 (사람을 기다린 시간 제외)`));
    s.append(el('p', 'muted', Object.entries(u.by_node).filter(([, v]) => v >= 1).map(([n, v]) => `${n} ${Math.round(v)}초`).join(' · ')));
    if (u.calls) {
      const ul = el('ul');
      Object.entries(u.by_purpose).forEach(([p, v]) => ul.append(el('li', null,
        `${p} ${v.calls}회 · ${Math.round(v.seconds)}초 · 입력 ${(v.input_tokens + v.cache_write_tokens).toLocaleString()} + 캐시 ${v.cache_read_tokens.toLocaleString()} / 출력 ${v.output_tokens.toLocaleString()}`)));
      s.append(ul);
    } else {
      s.append(el('p', 'muted', '토큰 기록 없음 (2026-10-26 토큰 기록을 넣기 전에 돌린 실행)'));
    }
    box.append(s);
  }

  if (m.path?.length) {
    const flow = section('처리 흐름');
    flow.append(el('div', 'path', m.path.join(' → ')));
    box.append(flow);
  }

  if (S.d.history?.length) {
    const s = section('판정 이력');
    const ul = el('ul');
    S.d.history.slice().reverse().forEach(h => {
      const when = new Date(h.created * 1000).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const seen = [h.version, h.harness && `하네스 ${h.harness.split(':')[0]}`].filter(Boolean).join(', ');
      ul.append(el('li', null, `${when} · ${VERDICT[h.verdict][0]}${seen ? ` (${seen})` : ''}${h.causes.length ? ` · ${h.causes.join(', ')}` : ''}${h.memo ? ` — ${h.memo}` : ''}`));
    });
    s.append(ul);
    box.append(s);
  }
}

/* 공유용 화면: 웹 페이지는 Finder를 열 수 없어서, 누르면 NAS 경로를 복사한다 (Finder에서 ⌘⇧G → 붙여넣기).
   NAS를 Finder로 연결하면 /Volumes/lotte_dfs 에 붙는다. 다른 곳에 붙였으면 한 번 물어 이 브라우저에 기억한다. */
function nasRoot() {
  try { return localStorage.getItem('nasRoot') || '/Volumes/lotte_dfs'; } catch { return '/Volumes/lotte_dfs'; }
}
/* 공유용 화면 머리줄의 'NAS 위치' 설정: 누르면 입력칸으로 바뀌고, Enter로 이 브라우저에 저장한다 */
function nasSetting() {
  const btn = el('button', 'btn', `NAS 위치 ${nasRoot()}`);
  btn.title = '내 맥에서 NAS가 붙은 폴더 (경로 복사에 써요). 눌러서 바꿀 수 있어요';
  btn.onclick = () => {
    const input = el('input', 'memo');
    input.value = nasRoot();
    input.placeholder = '/Volumes/lotte_dfs';
    input.style.width = '260px';
    const done = save => {
      if (save) {
        const v = input.value.trim().replace(/\/+$/, '');
        try { v ? localStorage.setItem('nasRoot', v) : localStorage.removeItem('nasRoot'); } catch { /* 저장이 막힌 브라우저 */ }
        toast(`NAS 위치를 ${nasRoot()} 로 저장했어요 (이 브라우저에만)`);
      }
      btn.textContent = `NAS 위치 ${nasRoot()}`;
      input.replaceWith(btn);
    };
    input.onkeydown = e => { if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); };
    input.onblur = () => done(false);
    btn.replaceWith(input);
    input.focus();
    input.select();
  };
  return btn;
}
if (STATIC) $('.top-right').prepend(nasSetting());

function nasRel(what) {
  const d = S.d, m = d.meta || {};
  if (what.kind === 'request') return d.folder;
  if (what.kind === 'input') return `${d.folder}/${what.name}`;
  if (what.kind === 'publisher') {
    const v = d.versions.find(x => x.latest);
    return v && v.zips && v.zips[0] ? `${d.folder}/${v.zips[0]}` : d.folder;
  }
  if (what.kind === 'path') return ((m.paths || [])[what.index] || {}).rel;
  if (what.kind === 'base') return (((m.base || {}).by_lang || {})[what.lang] || {}).rel || (m.base || {}).rel;
  return null;
}
function nasPath(label, what, asText) {
  const b = el('button', asText ? 'linkbtn' : 'btn small-btn', label);
  b.title = 'NAS 경로 복사 (Finder에서 ⌘⇧G → 붙여넣기)';
  b.onclick = async () => {
    const rel = nasRel(what);
    if (!rel) return toast('이 항목은 NAS 경로를 몰라요');
    const path = `${nasRoot()}/${rel}`;
    try {
      await navigator.clipboard.writeText(path);
      toast('경로를 복사했어요. Finder에서 ⌘⇧G를 누르고 붙여 넣어 주세요');
    } catch {
      toast(path);
    }
  };
  return b;
}

/* Finder로 열기: 무엇을 열지만 보내고, 경로는 서버가 그 건의 기록에서 정한다 */
function reveal(label, what, asText = false) {
  if (STATIC) return nasPath(label, what, asText);
  const b = el('button', asText ? 'linkbtn' : 'btn small-btn', label);
  b.title = 'Finder에서 보기';
  b.onclick = async () => {
    try {
      const r = await api('/api/reveal', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: S.id, ...what }) });
      toast(`Finder에서 열었어요 (${r.where})`);
    } catch (e) {
      toast(`열지 못했어요: ${e.message}`);
    }
  };
  return b;
}

/* ---------- 판정 ---------- */

function renderVerdict() {
  const can = S.d.has_harness;
  $$('#verdicts button').forEach(b => {
    b.classList.toggle('on', b.dataset.v === S.draft.verdict);
    b.disabled = !can;
  });
  $('#memo').disabled = !can;
  const causes = $('#causes');
  causes.innerHTML = '';
  CAUSES.forEach(c => {
    const b = el('button', S.draft.causes.has(c) ? 'on' : '', c);
    b.onclick = () => { S.draft.causes.has(c) ? S.draft.causes.delete(c) : S.draft.causes.add(c); renderVerdict(); };
    causes.append(b);
  });
  $('#saveBtn').disabled = !S.draft.verdict;
  const last = S.d.history?.[S.d.history.length - 1];
  $('#lastVerdict').textContent = !can ? '하네스 결과가 생기면 판정할 수 있어요'
    : last ? `지난 판정: ${VERDICT[last.verdict][0]}` : '';
  $('#causes').hidden = !can;
}

async function saveVerdict() {
  if (!S.draft.verdict) return;
  try {
    await api('/api/verdict', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ case_id: S.id, version: S.v, file_key: null, verdict: S.draft.verdict,
        causes: [...S.draft.causes], memo: $('#memo').value.trim() }),
    });
    toast(`저장했어요: ${VERDICT[S.draft.verdict][0]}`);
    const id = S.id;
    await loadCases(true);
    S.d = await api(`/api/case?id=${enc(id)}`);
    S.draft = { verdict: null, causes: new Set() };
    $('#memo').value = '';
    renderDetails();
    renderVerdict();
  } catch (e) {
    toast(`저장하지 못했어요: ${e.message}`);
  }
}

/* ---------- 졸업 판정 ---------- */
// 유형마다 최근 연속 '일치·근접' 건수. 기준 건수를 채우면 그 유형은 하네스에 맡겨도 된다(담당자는 승인만).

async function toggleGraduation() {
  const panel = $('#gradPanel');
  if (!panel.hidden) { panel.hidden = true; return; }
  panel.hidden = false;
  panel.textContent = '계산 중…';
  try {
    const r = await api('/api/graduation');
    const esc = t => String(t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
    const rows = r.types.map(x => {
      const pct = Math.min(100, Math.round(100 * x.streak / x.need));
      const brk = x.last_break
        ? `<a href="#${encodeURIComponent(x.last_break.id)}" class="grad-break">${esc(x.last_break.date.slice(5))} ${esc(x.last_break.title)} <b>${esc(x.last_break.result)}</b></a>`
        : '<span class="muted">끊긴 적 없음</span>';
      return `<tr><td><b>${esc(x.label)}</b></td>
        <td><div class="grad-bar"><span style="width:${pct}%"></span></div>
          <span class="${x.graduated ? 'grad-ok' : 'muted'}">${x.graduated ? '졸업' : `${x.streak} / ${x.need}`}</span>${x.screen_unchecked ? ` <span class="muted">(화면 확인 전 ${x.screen_unchecked})</span>` : ''}</td>
        <td class="num">${x.good} / ${x.counted}${x.uncomparable ? ` <span class="muted">(비교 불가 ${x.uncomparable})</span>` : ''}${x.screen_down ? ` <span class="muted">(화면 달라 낮춤 ${x.screen_down})</span>` : ''}</td>
        <td>${brk}</td></tr>`;
    }).join('');
    panel.innerHTML = `<div class="grad-head"><b>유형별 졸업 판정</b>
      <span class="muted">최근 ${r.need}건 연속 일치·근접이면 졸업 (그 유형은 하네스가 납품, 담당자는 승인만). '비교 불가'·납품 전은 세지 않아요. 화면이 25% 넘게 다르면 일치·근접으로 치지 않아요(찍어 둔 화면 기준).</span>
      <button class="btn grad-close" type="button">닫기</button></div>
      <table class="grad-table"><thead><tr><th>유형</th><th>연속 기록</th><th class="num">일치·근접 / 전체</th><th>마지막으로 끊긴 건</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
    panel.querySelector('.grad-close').onclick = () => { panel.hidden = true; };
  } catch (e) {
    panel.textContent = `계산하지 못했어요: ${e.message}`;
  }
}

/* ---------- 지금 확인 ---------- */

async function runSync() {
  const btn = $('#syncBtn');
  btn.classList.add('busy');
  btn.textContent = '확인 중…';
  try {
    let r = await api('/api/sync', { method: 'POST' });
    while (r.running) {
      await new Promise(res => setTimeout(res, 1500));
      r = await api('/api/sync');
    }
    if (r.error) toast(r.error);
    else {
      const x = r.result;
      toast(`확인했어요 · 새 요청 ${x.new_requests}건 · 새 결과 ${x.new_outputs}개 (재납품 ${x.redeliveries}) · 바뀐 것 없음 ${x.skipped}건`);
      await loadCases(true);
    }
    $('#lastSync').textContent = r.last ? `마지막 확인 ${r.last}` : '';
  } catch (e) {
    toast(`확인하지 못했어요: ${e.message}`);
  } finally {
    btn.classList.remove('busy');
    btn.textContent = '지금 확인';
  }
}

let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

/* ---------- 이벤트 ---------- */

$$('#filters button').forEach(b => {
  b.classList.toggle('on', b.dataset.filter === S.filter);
  b.onclick = () => {
    S.filter = b.dataset.filter;
    store('compare.filter', S.filter);
    $$('#filters button').forEach(x => x.classList.toggle('on', x === b));
    renderList();
  };
});
$$('#modeSeg button').forEach(b => b.onclick = () => { S.mode = b.dataset.mode; renderStage(); });
$$('#zoomSeg button').forEach(b => b.onclick = () => {
  S.zoom = b.dataset.zoom;
  syncOpts();
  if (S.mode === 'blend') renderStage(); else fitAll();
});
$$('#shotSeg button').forEach(b => b.onclick = () => { S.shot = b.dataset.shot; renderStage(); });
$$('#diffSeg button').forEach(b => b.onclick = () => { S.diff = b.dataset.diff; renderStage(); });
$('#activeOnly').onchange = e => { S.active = e.target.checked; renderStage(); };
$('#versionSel').onchange = e => { S.v = e.target.value; renderStage(); };
$('#opacity').oninput = e => $$('#stage iframe.overlay-top').forEach(f => { f.style.opacity = e.target.value / 100; });
$$('#verdicts button').forEach(b => b.onclick = () => {
  S.draft.verdict = S.draft.verdict === b.dataset.v ? null : b.dataset.v;
  renderVerdict();
});
$('#saveBtn').onclick = saveVerdict;
$('#syncBtn').onclick = runSync;
$('#gradBtn').onclick = toggleGraduation;
window.addEventListener('resize', () => requestAnimationFrame(fitAll));

document.addEventListener('keydown', e => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName) || e.metaKey || e.ctrlKey) return;
  const list = visibleCases();
  const i = list.findIndex(c => c.id === S.id);
  if (e.key === 'j' && i < list.length - 1) select(list[i + 1].id);
  else if (e.key === 'k' && i > 0) select(list[i - 1].id);
  else if (['1', '2', '3', '4'].includes(e.key) && S.d?.has_harness) {
    S.draft.verdict = ['harness', 'publisher', 'both_ok', 'both_wrong'][+e.key - 1];
    renderVerdict();
  } else if (e.key === 's' && S.draft.verdict) saveVerdict();
});

loadCases(false).catch(e => toast(`목록을 불러오지 못했어요: ${e.message}`));
