// Injected into the browser via evaluate_script to extract page content
// Must be a self-contained function string that returns JSON-serializable data
export const PAGE_EXTRACTOR_SCRIPT = `() => {
  const title = document.title;
  const url = location.href;

  const headings = [...document.querySelectorAll('h1,h2,h3,h4')].slice(0, 30).map(h => ({
    level: parseInt(h.tagName[1]),
    text: h.textContent.trim()
  }));

  const links = [...document.querySelectorAll('a[href]')].slice(0, 100).map(a => ({
    text: (a.textContent || '').trim().substring(0, 100),
    href: a.href
  })).filter(l => l.text && l.href);

  const forms = [...document.querySelectorAll('form')].slice(0, 10).map(f => ({
    id: f.id || f.action || '',
    fields: [...f.querySelectorAll('input,select,textarea')].slice(0, 20).map(el => ({
      name: el.name || el.id || '',
      type: el.type || el.tagName.toLowerCase(),
      label: el.labels?.[0]?.textContent?.trim() || el.placeholder || el.getAttribute('aria-label') || ''
    }))
  }));

  // Extract main content (textContent avoids costly layout reflow unlike innerText)
  const main = document.querySelector('main, article, [role="main"]') || document.body;
  const content = (main.textContent || '').replace(/\\s+/g, ' ').trim().substring(0, 10000);

  return { title, url, headings, links, forms, content };
}`;

export const DATA_EXTRACTOR_SCRIPT = `(selector) => {
  const elements = document.querySelectorAll(selector);
  if (!elements.length) return { data: null, matchCount: 0, type: 'empty' };

  const first = elements[0];

  // Detect table
  const table = first.tagName === 'TABLE' ? first : first.querySelector('table');
  if (table) {
    const headers = [...table.querySelectorAll('th')].map(th => th.textContent.trim());
    const tbody = table.querySelector('tbody');
    const dataRows = tbody ? [...tbody.querySelectorAll('tr')] : [...table.querySelectorAll('tr')].slice(headers.length ? 1 : 0);
    const rows = dataRows.map(tr => {
      const cells = [...tr.querySelectorAll('td')].map(td => td.textContent.trim());
      if (headers.length) {
        return Object.fromEntries(cells.map((c, i) => [headers[i] || 'col' + i, c]));
      }
      return cells;
    });
    return { data: rows, matchCount: rows.length, type: 'table' };
  }

  // Detect list
  if (first.tagName === 'UL' || first.tagName === 'OL') {
    const items = [...first.querySelectorAll('li')].map(li => li.textContent.trim());
    return { data: items, matchCount: items.length, type: 'list' };
  }

  // Generic elements
  const data = [...elements].slice(0, 50).map(el => ({
    text: el.textContent.trim().substring(0, 500),
    tag: el.tagName.toLowerCase(),
    id: el.id || undefined,
    className: el.className || undefined
  }));
  return { data, matchCount: elements.length, type: 'elements' };
}`;
