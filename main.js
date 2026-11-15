/* =====================================================================
   DATA LAYER — all GitHub logic lives here. UI only calls getProjects()
   and getActivity(), which return normalized objects. To switch to a
   build-time JSON (see the GitHub Action), set CONFIG.source = 'static'.
   ===================================================================== */
const CONFIG = {
  user: 'AryanPatill',
  source: 'live',                     // 'live' = browser → GitHub API; 'static' = ./projects.json written at build time
  staticUrl: 'projects.json',
  fallbackUrl: 'projects.fallback.json',
  snapshotDate: '2026-09-21',         // date the bundled fallback was captured
  cacheTtlMs: 60 * 60 * 1000,         // 1 hour
  timeoutMs: 7000,
  maxFeatured: 4,
  // Repos that are never shown, in addition to forks, archived repos and the 'hide' topic.
  alwaysExclude: ['AryanPatill', 'AryanPatill.github.io'],
  // When no repo carries the 'featured' topic yet, promote the most recently pushed repos
  // that have a description (layout fallback only; add 'featured' topics to take control).
  featuredFallbackCount: 3
};

const GitHubData = (() => {
  const API = `https://api.github.com/users/${CONFIG.user}`;
  const LANG_COLORS = {
    'Python':'#3572A5','Jupyter Notebook':'#DA5B0B','JavaScript':'#f1e05a','TypeScript':'#3178c6',
    'HTML':'#e34c26','CSS':'#663399','Java':'#b07219','C++':'#f34b7d','C':'#555555','R':'#198CE7',
    'Go':'#00ADD8','Rust':'#dea584','Shell':'#89e051','SQL':'#e38c00','PLpgSQL':'#336790','Scala':'#c22d40',
    'Kotlin':'#A97BFF','Swift':'#F05138','Dockerfile':'#384d54','Vue':'#41b883','Svelte':'#ff3e00'
  };
  const ACRONYMS = { ai:'AI', ml:'ML', api:'API', nlp:'NLP', llm:'LLM', llms:'LLMs', f1:'F1', gpt:'GPT', ui:'UI', etl:'ETL', sql:'SQL', rag:'RAG', mcp:'MCP', cv:'CV', gan:'GAN', app:'App', io:'IO', js:'JS' };

  const cacheGet = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
  const cacheSet = (key, data) => { try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), data })); } catch {} };

  async function fetchJSON(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONFIG.timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: url.startsWith('https://api.github.com') ? { Accept: 'application/vnd.github+json' } : {} });
      if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
      return await res.json();
    } finally { clearTimeout(timer); }
  }

  function humanize(name) {
    return name.replace(/[-_.]+/g, ' ').trim().split(/\s+/).map(w => {
      const lw = w.toLowerCase();
      if (ACRONYMS[lw]) return ACRONYMS[lw];
      return w === lw ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    }).join(' ');
  }

  function normalize(r) {
    const topics = Array.isArray(r.topics) ? r.topics : [];
    return {
      id: r.id ?? r.name,
      name: r.name,
      title: humanize(r.name),
      description: (r.description || '').trim() || null,   // never invented
      url: r.html_url || `https://github.com/${CONFIG.user}/${r.name}`,
      homepage: (r.homepage || '').trim() || null,
      language: r.language || null,
      languageColor: LANG_COLORS[r.language] || '#8a8f98',
      stars: r.stargazers_count || 0,
      pushedAt: r.pushed_at ? new Date(r.pushed_at) : null,
      topics: topics.filter(t => t !== 'featured' && t !== 'hide'),
      featured: topics.includes('featured'),
      thumbnail: `https://opengraph.githubassets.com/1/${CONFIG.user}/${r.name}`,
      _raw: { fork: !!r.fork, archived: !!r.archived, hidden: topics.includes('hide') }
    };
  }

  function select(rawList) {
    if (!Array.isArray(rawList)) return [];
    const exclude = new Set(CONFIG.alwaysExclude.map(s => s.toLowerCase()));
    const list = rawList.map(normalize)
      .filter(p => !p._raw.fork && !p._raw.archived && !p._raw.hidden && !exclude.has(p.name.toLowerCase()))
      .sort((a, b) => (b.pushedAt || 0) - (a.pushedAt || 0));
    let featured = list.filter(p => p.featured).slice(0, CONFIG.maxFeatured);
    if (!featured.length) {
      featured = list.filter(p => p.description).slice(0, CONFIG.featuredFallbackCount);
      featured.forEach(p => p.featured = true);
    }
    const featuredSet = new Set(featured.map(p => p.name));
    list.forEach(p => { p.featured = featuredSet.has(p.name); delete p._raw; });
    return list;
  }

  function inlineFallback() {
    try { return JSON.parse(document.getElementById('inline-fallback').textContent); } catch { return []; }
  }

  /** Returns { projects: Project[], source: 'live'|'cache'|'static'|'fallback', syncedAt: Date, reason?: string } */
  async function getProjects() {
    const key = `gh:repos:${CONFIG.user}`;
    const cached = cacheGet(key);
    const ok = (raw) => select(raw).length > 0;

    if (CONFIG.source === 'static') {
      try { const raw = await fetchJSON(CONFIG.staticUrl); if (ok(raw)) return { projects: select(raw), source: 'static', syncedAt: null }; } catch {}
    } else {
      if (cached && Date.now() - cached.t < CONFIG.cacheTtlMs && ok(cached.data)) {
        return { projects: select(cached.data), source: 'cache', syncedAt: new Date(cached.t) };
      }
      try {
        const raw = await fetchJSON(`${API}/repos?per_page=100&sort=pushed`);
        if (ok(raw)) { cacheSet(key, raw); return { projects: select(raw), source: 'live', syncedAt: new Date() }; }
      } catch (e) {
        var reason = e.status === 403 || e.status === 429 ? 'rate-limit' : 'network';
      }
      if (cached && ok(cached.data)) return { projects: select(cached.data), source: 'cache', syncedAt: new Date(cached.t), reason };
    }
    try { const raw = await fetchJSON(CONFIG.fallbackUrl); if (ok(raw)) return { projects: select(raw), source: 'fallback', syncedAt: new Date(CONFIG.snapshotDate), reason }; } catch {}
    return { projects: select(inlineFallback()), source: 'fallback', syncedAt: new Date(CONFIG.snapshotDate), reason };
  }

  /** Last 5 push events → [{ repo, title, at: Date }]. Falls back to per-repo pushed_at. */
  async function getActivity(projects = []) {
    const key = `gh:events:${CONFIG.user}`;
    const hidden = new Set(CONFIG.alwaysExclude.map(s => s.toLowerCase()));
    const fromProjects = () => projects.filter(p => p.pushedAt).slice(0, 5).map(p => ({ repo: p.name, title: p.title, at: p.pushedAt }));
    const shape = (events) => {
      const seen = new Set(), out = [];
      for (const ev of events || []) {
        if (ev.type !== 'PushEvent') continue;
        const repo = (ev.repo?.name || '').split('/').pop();
        if (!repo || seen.has(repo) || hidden.has(repo.toLowerCase())) continue;
        seen.add(repo); out.push({ repo, title: humanize(repo), at: new Date(ev.created_at) });
        if (out.length === 5) break;
      }
      return out;
    };
    if (CONFIG.source === 'static') {
      try { const ev = shape(await fetchJSON('events.json')); if (ev.length) return ev; } catch {}
      return fromProjects();
    }
    const cached = cacheGet(key);
    if (cached && Date.now() - cached.t < CONFIG.cacheTtlMs) { const ev = shape(cached.data); if (ev.length) return ev; }
    try { const raw = await fetchJSON(`${API}/events/public?per_page=30`); cacheSet(key, raw); const ev = shape(raw); if (ev.length) return ev; } catch {}
    if (cached) { const ev = shape(cached.data); if (ev.length) return ev; }
    return fromProjects();
  }

  return { getProjects, getActivity };
})();

/* =============================== UI =============================== */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const motionOK = document.documentElement.classList.contains('motion-ok');
  const finePointer = window.matchMedia('(hover:hover) and (pointer:fine)').matches;
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElementNS(tag === 'svg' || attrs._svg ? 'http://www.w3.org/2000/svg' : 'http://www.w3.org/1999/xhtml', tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === '_svg' || v == null || v === false) continue;
      if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach(k => k != null && el.append(k));
    return el;
  };

  /* ---- time ---- */
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  function ago(date) {
    if (!date) return '';
    const s = (date - Date.now()) / 1000, a = Math.abs(s);
    const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
    for (const [u, n] of units) if (a >= n) return rtf.format(Math.round(s / n), u);
    return 'just now';
  }
  const fmtDate = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  /* ---- seeded generative image, used when GitHub's preview card can't load ---- */
  function seed(str) { let x = 2166136261; for (const c of str) x = Math.imul(x ^ c.charCodeAt(0), 16777619); return x >>> 0; }
  function rng(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function streamSVG(name, { w = 600, hgt = 300 } = {}) {
    const r = rng(seed(name));
    const themes = [['#16150F', '#F4F1EA', '#B8371A'], ['#EAE6DB', '#16150F', '#B8371A']];
    const [bg, fg, ac] = themes[Math.floor(r() * themes.length)];
    const svg = h('svg', { viewBox: `0 0 ${w} ${hgt}`, preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true', focusable: 'false' });
    svg.append(h('rect', { _svg: 1, width: w, height: hgt, fill: bg }));
    const wm = w * (0.45 + r() * 0.4), base = hgt * 0.78, n = Math.round(34 + r() * 30);
    for (let i = 0; i < n; i++) {
      const x = r() * w, len = hgt * (0.08 + Math.pow(r(), 2) * 0.62), late = x < wm && r() < 0.12;
      svg.append(h('rect', { _svg: 1, x: x.toFixed(1), y: (base - len).toFixed(1), width: late ? 3 : 1.5, height: len.toFixed(1), fill: late ? ac : fg, opacity: x > wm ? 0.35 : 0.9 }));
    }
    svg.append(h('rect', { _svg: 1, x: 0, y: base, width: w, height: 1.5, fill: fg }));
    svg.append(h('rect', { _svg: 1, x: wm.toFixed(1), y: 0, width: 2.5, height: hgt, fill: ac }));
    return svg;
  }

  /* ---- index rows ---- */
  const byName = new Map();
  function row(p, i) {
    byName.set(p.name, p);
    const meta = h('div', { class: 'meta' },
      p.language ? h('span', { class: 'lang', text: p.language }) : null,
      p.pushedAt ? h('span', {}, 'Updated ', h('time', { datetime: p.pushedAt.toISOString(), title: fmtDate(p.pushedAt), text: ago(p.pushedAt) })) : null,
      p.stars > 0 ? h('span', { class: 'num', text: `${p.stars} ${p.stars === 1 ? 'star' : 'stars'}` }) : null);
    const shown = p.topics.slice(0, 6), extra = p.topics.length - shown.length;
    const tags = p.featured && shown.length ? h('ul', { class: 'tags', 'aria-label': 'Topics' }, shown.map(t => h('li', { text: t })), extra > 0 ? h('li', { text: `+${extra} more`, title: p.topics.slice(6).join(', ') }) : null) : null;
    let thumb = null;
    if (p.featured) {
      const img = h('img', { src: p.thumbnail, alt: '', width: 1200, height: 600, loading: 'lazy', decoding: 'async' });
      img.addEventListener('error', () => img.replaceWith(streamSVG(p.name)), { once: true });
      thumb = h('div', { class: 'row-thumb' }, img);
    }
    return h('li', { class: 'row' + (p.featured ? ' is-featured' : ''), 'data-lang': p.language || 'Other', 'data-name': p.name },
      h('span', { class: 'no num', 'aria-hidden': 'true', text: String(i + 1).padStart(2, '0') }),
      h('div', { class: 'main' },
        h('h3', {}, h('a', { class: 'row-link', href: p.url, rel: 'noopener' }, p.title, h('span', { class: 'sr-only', text: ', code on GitHub' }))),
        p.description ? h('p', { class: 'desc', text: p.description }) : null, tags, thumb),
      meta,
      h('div', { class: 'act' },
        p.homepage ? h('a', { href: p.homepage, rel: 'noopener', 'aria-label': `Live site for ${p.title}`, text: 'Live' }) : null,
        h('span', { class: 'arrow', 'aria-hidden': 'true', text: '↗' })));
  }

  function statusText({ source, syncedAt, reason }) {
    if (source === 'live') return 'Synced from GitHub just now.';
    if (source === 'cache') return `Synced from GitHub ${ago(syncedAt)}.${reason ? ' Showing the last good copy while GitHub is unavailable.' : ''}`;
    if (source === 'static') return 'Synced from GitHub at the last site build.';
    return `Showing a saved snapshot from ${fmtDate(syncedAt)}${reason === 'rate-limit' ? ' because GitHub’s hourly request limit was reached' : ''}. Every repository is still linked.`;
  }

  function renderIndex(result) {
    // featured first, then the rest; both keep the data layer's most-recently-pushed order
    const ordered = [...result.projects.filter(p => p.featured), ...result.projects.filter(p => !p.featured)];
    const list = $('#rows'), filters = $('#filters');
    list.replaceChildren(...ordered.map(row)); list.removeAttribute('aria-busy');
    $('#work-status').textContent = statusText(result);
    document.documentElement.dataset.source = result.source;

    const counts = ordered.reduce((m, p) => (m[p.language || 'Other'] = (m[p.language || 'Other'] || 0) + 1, m), {});
    const langs = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const mk = (label, value, count) => h('button', { type: 'button', 'data-lang': value, 'aria-pressed': value === '*' ? 'true' : 'false' }, `${label} `, h('span', { class: 'num', text: count }));
    filters.replaceChildren(mk('All', '*', ordered.length), ...(langs.length > 1 ? langs.map(([l, c]) => mk(l, l, c)) : []));
    filters.onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      filters.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      const shown = applyFilter(list, b.dataset.lang);
      $('#filter-status').textContent = `Showing ${shown} ${shown === 1 ? 'project' : 'projects'}${b.dataset.lang === '*' ? '' : ' in ' + b.dataset.lang}.`;
    };
  }

  /* ---- filter with a layout transition: rows that stay slide to their new place (FLIP), new rows fade in ---- */
  function applyFilter(list, v) {
    const rows = [...list.children];
    const before = new Map(rows.filter(r => !r.hidden).map(r => [r, r.getBoundingClientRect().top]));
    let shown = 0;
    rows.forEach(r => { r.hidden = !(v === '*' || r.dataset.lang === v); shown += !r.hidden; });
    if (!rows[0]?.animate) return shown;
    rows.forEach(r => {
      if (r.hidden) return;
      const was = before.get(r);
      if (was == null || !motionOK) { r.animate([{ opacity: 0 }, { opacity: 1 }], { duration: motionOK ? 320 : 150, easing: 'ease' }); return; }
      const d = was - r.getBoundingClientRect().top;
      if (d) r.animate([{ transform: `translateY(${d}px)` }, { transform: 'none' }], { duration: 460, easing: 'cubic-bezier(.2,.8,.2,1)' });
    });
    return shown;
  }

  /* ---- signature: project preview that follows the cursor (and sits beside the row on keyboard focus) ---- */
  function preview() {
    const list = $('#rows'), box = $('#preview'), img = $('img', box);
    const failed = new Set();
    let current = null, svg = null, x = 0, y = 0, tx = 0, ty = 0, raf = 0, placed = false;
    const wide = () => window.innerWidth >= 760;

    function show(li) {
      const p = byName.get(li.dataset.name); if (!p) return;
      if (current !== p.name) {
        current = p.name; svg?.remove(); svg = null;
        if (failed.has(p.name)) { img.hidden = true; svg = streamSVG(p.name); box.append(svg); }
        else { img.hidden = false; img.src = p.thumbnail; }
      }
      box.classList.add('on');
    }
    function hide() { box.classList.remove('on'); placed = false; cancelAnimationFrame(raf); raf = 0; }
    img.addEventListener('error', () => {
      if (!current) return;
      failed.add(current); img.hidden = true; svg?.remove(); svg = streamSVG(current); box.append(svg);
    });
    const clampTo = (px, py) => {
      const w = box.offsetWidth, hh = box.offsetHeight, pad = 12;
      return [Math.max(pad, Math.min(px, window.innerWidth - w - pad)), Math.max(pad, Math.min(py, window.innerHeight - hh - pad))];
    };
    const paint = () => { box.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`; };
    const tick = () => {
      x += (tx - x) * 0.16; y += (ty - y) * 0.16; paint();
      raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.3 ? requestAnimationFrame(tick) : 0;
    };

    if (finePointer) {
      list.addEventListener('pointermove', e => {
        const li = e.target.closest('.row'); if (!li || !wide()) { hide(); return; }
        show(li);
        [tx, ty] = clampTo(e.clientX + 28, e.clientY + 24);
        if (!placed || !motionOK) { x = tx; y = ty; placed = true; paint(); }   // reduced motion: no trailing, it just sits at the pointer
        else if (!raf) raf = requestAnimationFrame(tick);
      }, { passive: true });
      list.addEventListener('pointerleave', hide);
    }
    list.addEventListener('focusin', e => {
      const li = e.target.closest('.row'); if (!li || !wide() || !e.target.matches(':focus-visible')) return;
      show(li);
      const b = li.getBoundingClientRect();
      [x, y] = clampTo(b.right - box.offsetWidth - 64, b.top + 8); tx = x; ty = y; placed = true; paint();
    });
    list.addEventListener('focusout', hide);
    addEventListener('scroll', () => { if (!list.matches(':hover')) hide(); }, { passive: true });
  }

  function renderStack(projects) {
    const counts = {}, topics = {};
    projects.forEach(p => { if (p.language) counts[p.language] = (counts[p.language] || 0) + 1; p.topics.forEach(t => topics[t] = (topics[t] || 0) + 1); });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    $('#langs').replaceChildren(...top.map(([l, c]) => h('li', {},
      h('span', { class: 'name', text: l }),
      h('span', { class: 'count num', text: `${c} ${c === 1 ? 'repository' : 'repositories'}` }))));
    $('#langs').removeAttribute('aria-busy');
    const tt = Object.entries(topics).filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 14);
    const t2 = tt.length >= 5 ? tt : Object.entries(topics).sort((a, b) => b[1] - a[1]).slice(0, 14);
    if (t2.length) { $('#topics').replaceChildren(...t2.map(([t]) => h('li', { text: t }))); $('#topics-wrap').hidden = false; }
  }

  function renderPulse(items) {
    $('#pulse-list').replaceChildren(...items.map(it => h('li', {},
      h('b', { text: it.title }), ' ', h('time', { datetime: it.at.toISOString(), title: fmtDate(it.at), text: ago(it.at) }))));
  }

  /* ---- cursor detail, hero only: the column grid appears around the pointer ---- */
  function heroGrid() {
    const hero = $('.hero'), grid = $('.hero-grid');
    for (let i = 1; i <= 12; i++) grid.append(h('i', { 'data-n': String(i).padStart(2, '0') }));
    if (!finePointer || !motionOK) return;
    let raf = 0, ev;
    hero.addEventListener('pointermove', e => {
      ev = e; if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0; const b = grid.getBoundingClientRect();
        grid.style.setProperty('--gx', `${ev.clientX - b.left}px`); grid.style.setProperty('--gy', `${ev.clientY - b.top}px`);
        hero.classList.add('grid-on');
      });
    }, { passive: true });
    hero.addEventListener('pointerleave', () => hero.classList.remove('grid-on'));
  }

  /* ---- scroll-linked motion, two places only: the hero name drifts apart, the quote inks in word by word ---- */
  function scrollMotion() {
    const q = $('#quote-text');
    const words = q.textContent.trim().split(/\s+/);
    const spans = words.map(w => h('span', { class: 'w', text: w }));
    q.replaceChildren(...spans.flatMap((s, i) => i ? [' ', s] : [s]));
    if (!motionOK) return;
    const name = $('#hero-name'), hero = $('.hero');
    let raf = 0, lit = -1;
    const update = () => {
      raf = 0;
      const vh = window.innerHeight;
      name.style.setProperty('--hs', Math.min(1, Math.max(0, scrollY / hero.offsetHeight)).toFixed(3));
      const b = q.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (vh * 0.9 - b.top) / (b.height + vh * 0.35)));
      const n = Math.round(p * spans.length);
      if (n !== lit) { lit = n; spans.forEach((s, i) => s.classList.toggle('lit', i < n)); }
    };
    addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(update); }, { passive: true });
    addEventListener('resize', update);
    update();
  }

  /* ---- small detail: live local time in Rochester ---- */
  function clock() {
    const el = $('#clock');
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
    const tick = () => { const d = new Date(); el.textContent = fmt.format(d); el.dateTime = d.toISOString(); setTimeout(tick, 1000 - d.getMilliseconds()); };
    tick();
  }

  function chrome() {
    const head = $('.site-head');
    const onScroll = () => head.classList.toggle('scrolled', scrollY > 8);
    addEventListener('scroll', onScroll, { passive: true }); onScroll();
    $('#yr').textContent = new Date().getFullYear();
    const links = [...document.querySelectorAll('.site-nav a')];
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) links.forEach(a => a.setAttribute('aria-current', String(a.getAttribute('href') === '#' + e.target.id))); }), { rootMargin: '-45% 0px -50% 0px' });
    document.querySelectorAll('main > section[id]').forEach(s => io.observe(s));
  }

  heroGrid(); scrollMotion(); clock(); chrome(); preview();
  GitHubData.getProjects().then(result => {
    renderIndex(result); renderStack(result.projects);
    return GitHubData.getActivity(result.projects);
  }).then(renderPulse).catch(() => { /* data layer always resolves */ });
})();
