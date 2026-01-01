/**
 * Trace-based recorder — captures real user interactions in the browser.
 *
 * Injects event listeners (click, input, select, keydown, scroll, navigation)
 * into the page via evaluate_script. Events stored in window.__bb_trace.
 *
 * Usage:
 *   trace start   → inject listeners, begin capturing
 *   trace stop    → collect events, return structured trace
 *   trace status  → check if recording
 */

import type {
  ActionContext,
  BrowserActionResponse,
} from "../actions/types.js";

// ─── Types ───────────────────────────────────────────────────

export interface TraceEvent {
  type: "navigation" | "click" | "fill" | "select" | "check" | "press" | "scroll";
  timestamp: number;
  url: string;
  ref?: string;        // CSS selector
  xpath?: string;
  role?: string;       // aria role
  name?: string;       // accessible name
  tag?: string;        // element tag
  value?: string;      // for fill/select
  key?: string;        // for press
  checked?: boolean;   // for check
  direction?: string;  // for scroll
  pixels?: number;     // for scroll
}

export interface Trace {
  name: string;
  startUrl: string;
  startTime: number;
  events: TraceEvent[];
}

// ─── Injected script (runs in browser) ──────────────────────

const INJECT_TRACE = `
(() => {
  if (window.__bb_trace_active) return 'already recording';
  window.__bb_trace_active = true;
  window.__bb_trace = [];

  const MAX = 200;

  // ── Element identification ──
  function getXPath(el) {
    if (el.id) return '//*[@id="' + el.id + '"]';
    if (el === document.body) return '/html/body';
    let idx = 1;
    const sibs = el.parentNode?.children;
    if (sibs) {
      for (let i = 0; i < sibs.length; i++) {
        if (sibs[i] === el) {
          const pp = el.parentElement ? getXPath(el.parentElement) : '';
          return pp + '/' + el.tagName.toLowerCase() + '[' + idx + ']';
        }
        if (sibs[i].nodeType === 1 && sibs[i].tagName === el.tagName) idx++;
      }
    }
    return el.tagName.toLowerCase();
  }

  function getCss(el) {
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body) {
      let sel = cur.tagName.toLowerCase();
      if (cur.id) { parts.unshift('#' + cur.id); break; }
      if (cur.className && typeof cur.className === 'string') {
        const cls = cur.className.split(/\\s+/).filter(c => c && /^[a-zA-Z_]/.test(c));
        if (cls.length) sel += '.' + cls.slice(0, 2).join('.');
      }
      parts.unshift(sel);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  function getSemantic(el) {
    const tag = el.tagName.toLowerCase();
    let role = el.getAttribute('role') || '';
    if (!role) {
      if (tag === 'button') role = 'button';
      else if (tag === 'a') role = 'link';
      else if (tag === 'input') {
        const t = el.type;
        if (['text','email','password','search','tel','url'].includes(t)) role = 'textbox';
        else if (t === 'checkbox') role = 'checkbox';
        else if (t === 'radio') role = 'radio';
        else if (t === 'submit' || t === 'button') role = 'button';
        else role = 'textbox';
      }
      else if (tag === 'textarea') role = 'textbox';
      else if (tag === 'select') role = 'combobox';
      else role = tag;
    }
    const name = el.getAttribute('aria-label')
      || el.getAttribute('title')
      || el.getAttribute('alt')
      || el.placeholder
      || el.textContent?.trim().slice(0, 50) || '';
    return { role, name, tag };
  }

  window.__bb_trace_overflow = false;
  function push(evt) {
    if (!window.__bb_trace) return;
    if (window.__bb_trace.length >= MAX) { window.__bb_trace_overflow = true; return; }
    window.__bb_trace.push(evt);
  }

  // ── Navigation ──
  push({ type: 'navigation', timestamp: Date.now(), url: location.href, role: 'document', name: document.title, tag: 'document' });

  // ── Click ──
  document.addEventListener('click', function(e) {
    const el = e.target;
    if (!el || !el.tagName) return;
    const sem = getSemantic(el);
    const isCheck = el.tagName === 'INPUT' && el.type === 'checkbox';
    push({
      type: isCheck ? 'check' : 'click',
      timestamp: Date.now(), url: location.href,
      ref: getCss(el), xpath: getXPath(el),
      role: sem.role, name: sem.name, tag: sem.tag,
      checked: isCheck ? el.checked : undefined,
    });
  }, true);

  // ── Input (debounced) ──
  let _inputTimer = null, _lastEl = null, _lastVal = '';
  document.addEventListener('input', function(e) {
    const el = e.target;
    if (!el || !('value' in el)) return;
    if (_inputTimer) clearTimeout(_inputTimer);
    _lastEl = el; _lastVal = el.value;
    _inputTimer = setTimeout(() => {
      if (!_lastEl) return;
      const sem = getSemantic(_lastEl);
      const isPw = _lastEl.type === 'password';
      push({
        type: 'fill', timestamp: Date.now(), url: location.href,
        ref: getCss(_lastEl), xpath: getXPath(_lastEl),
        role: sem.role, name: sem.name, tag: sem.tag,
        value: isPw ? '********' : _lastVal,
      });
      _inputTimer = null; _lastEl = null; _lastVal = '';
    }, 500);
  }, true);

  // Expose flush for COLLECT_TRACE to call before collecting
  window.__bb_trace_flush = () => {
    if (_inputTimer && _lastEl) {
      clearTimeout(_inputTimer);
      const sem = getSemantic(_lastEl);
      const isPw = _lastEl.type === 'password';
      push({ type: 'fill', timestamp: Date.now(), url: location.href,
        ref: getCss(_lastEl), xpath: getXPath(_lastEl),
        role: sem.role, name: sem.name, tag: sem.tag,
        value: isPw ? '********' : _lastVal });
      _inputTimer = null; _lastEl = null; _lastVal = '';
    }
  };

  // ── Select ──
  document.addEventListener('change', function(e) {
    const el = e.target;
    if (!el || el.tagName !== 'SELECT') return;
    const sem = getSemantic(el);
    const opt = el.options[el.selectedIndex];
    push({
      type: 'select', timestamp: Date.now(), url: location.href,
      ref: getCss(el), xpath: getXPath(el),
      role: sem.role, name: sem.name, tag: sem.tag,
      value: opt?.text || el.value,
    });
  }, true);

  // ── Keydown (special keys + combos) ──
  const KEYS = new Set(['Enter','Tab','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown','Backspace','Delete']);
  document.addEventListener('keydown', function(e) {
    let key = '';
    if (KEYS.has(e.key)) key = e.key;
    else if ((e.ctrlKey || e.metaKey) && e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key)) {
      key = (e.metaKey ? 'Meta' : 'Control') + '+' + e.key.toLowerCase();
    }
    if (!key) return;
    const el = e.target;
    const sem = el?.tagName ? getSemantic(el) : { role: '', name: '', tag: 'document' };
    push({
      type: 'press', timestamp: Date.now(), url: location.href,
      ref: el?.tagName ? getCss(el) : undefined,
      key, role: sem.role, name: sem.name, tag: sem.tag,
    });
  }, true);

  // ── Scroll (debounced) ──
  let _scrollTimer = null, _scrollStartY = window.scrollY;
  window.addEventListener('scroll', function() {
    if (!_scrollTimer) _scrollStartY = window.scrollY;
    else clearTimeout(_scrollTimer);
    _scrollTimer = setTimeout(() => {
      const delta = window.scrollY - _scrollStartY;
      if (Math.abs(delta) < 50) { _scrollTimer = null; return; }
      push({
        type: 'scroll', timestamp: Date.now(), url: location.href,
        direction: delta > 0 ? 'down' : 'up',
        pixels: Math.abs(Math.round(delta)),
      });
      _scrollTimer = null;
    }, 300);
  }, { passive: true });

  // ── URL change detection (SPA) ──
  let _lastUrl = location.href;
  const _urlCheck = setInterval(() => {
    if (location.href !== _lastUrl) {
      _lastUrl = location.href;
      push({ type: 'navigation', timestamp: Date.now(), url: location.href, role: 'document', name: document.title, tag: 'document' });
    }
  }, 500);
  window.__bb_trace_cleanup = () => { clearInterval(_urlCheck); };

  return 'recording started';
})()`;

const COLLECT_TRACE = `
(() => {
  // Flush pending debounced input
  if (window.__bb_trace_flush) window.__bb_trace_flush();
  const events = window.__bb_trace || [];
  const overflow = !!window.__bb_trace_overflow;
  // Cleanup
  window.__bb_trace_active = false;
  window.__bb_trace = [];
  window.__bb_trace_overflow = false;
  if (window.__bb_trace_cleanup) { window.__bb_trace_cleanup(); window.__bb_trace_cleanup = null; }
  return { events, overflow };
})()`;

const CHECK_STATUS = `
(() => ({
  recording: !!window.__bb_trace_active,
  eventCount: (window.__bb_trace || []).length,
  overflow: !!window.__bb_trace_overflow,
}))()`;

// ─── Public API ──────────────────────────────────────────────

export async function traceStart(ctx: ActionContext): Promise<BrowserActionResponse> {
  const result = await ctx.run({ action: "eval", script: INJECT_TRACE });
  const retVal = result.data?.result;
  if (retVal === "already recording") {
    const status = await ctx.run({ action: "eval", script: CHECK_STATUS });
    const count = status.data?.result?.eventCount || 0;
    return {
      success: true, action: "dev",
      data: { content: `Already recording (${count} events captured). Run "trace stop" to collect.` },
    };
  }
  return {
    success: true, action: "dev",
    data: { content: "Recording started. Interact with the page in Chrome, then run: trace stop" },
  };
}

export async function traceStop(ctx: ActionContext): Promise<BrowserActionResponse> {
  const result = await ctx.run({ action: "eval", script: COLLECT_TRACE });
  const raw = result.data?.result;
  const events: TraceEvent[] = Array.isArray(raw?.events) ? raw.events : (Array.isArray(raw) ? raw : []);
  const overflow = raw?.overflow || false;

  if (events.length === 0) {
    return {
      success: true, action: "dev",
      data: { content: "No events recorded. The page may have navigated (full reload destroys the trace). Trace works best on SPAs." },
    };
  }

  // Format for display
  const lines: string[] = [`Recorded ${events.length} events:\n`];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    switch (e.type) {
      case "navigation":
        lines.push(`${i + 1}. Navigate: ${e.url}`);
        break;
      case "click":
        lines.push(`${i + 1}. Click [${e.role}] "${e.name}" → ${e.ref}`);
        break;
      case "fill":
        lines.push(`${i + 1}. Fill [${e.role}] "${e.name}" ← "${e.value}" → ${e.ref}`);
        break;
      case "select":
        lines.push(`${i + 1}. Select [${e.role}] "${e.name}" ← "${e.value}" → ${e.ref}`);
        break;
      case "check":
        lines.push(`${i + 1}. ${e.checked ? "Check" : "Uncheck"} [${e.role}] "${e.name}" → ${e.ref}`);
        break;
      case "press":
        lines.push(`${i + 1}. Press ${e.key}`);
        break;
      case "scroll":
        lines.push(`${i + 1}. Scroll ${e.direction} ${e.pixels}px`);
        break;
    }
  }

  if (overflow) {
    lines.push(`\nWarning: event limit (200) reached — some events may have been dropped.`);
  }

  return {
    success: true, action: "dev",
    data: {
      content: lines.join("\n"),
      result: { name: `trace-${Date.now()}`, startUrl: events[0]?.url || "", startTime: events[0]?.timestamp || Date.now(), events },
    },
  };
}

export async function traceStatus(ctx: ActionContext): Promise<BrowserActionResponse> {
  const result = await ctx.run({ action: "eval", script: CHECK_STATUS });
  const status = result.data?.result || { recording: false, eventCount: 0 };
  return {
    success: true, action: "dev",
    data: {
      content: status.recording
        ? `Recording (${status.eventCount} events captured)`
        : "Not recording",
      result: status,
    },
  };
}

// ─── Serialization (compat) ──────────────────────────────────

export function serializeTrace(trace: Trace): string {
  return JSON.stringify(trace, null, 2);
}

export function deserializeTrace(json: string): Trace {
  const data = JSON.parse(json);
  if (!Array.isArray(data.events)) throw new Error("Invalid trace: missing events array");
  return { name: data.name || "unnamed", startUrl: data.startUrl || "", startTime: data.startTime || 0, events: data.events };
}
