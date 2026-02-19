import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const CROSS_DIR = '/Users/jacksonelliott/Downloads/6A-6C connections';

function readGraphFromHtml(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const m = html.match(/<script id="graph-data" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error(`graph-data script not found in ${htmlPath}`);
  return JSON.parse(m[1]);
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map(parseCsvLine);
}

function normalizeIdsFromCell(cell) {
  if (!cell) return [];
  const matches = String(cell).toUpperCase().match(/\d+\s*[A-Z]+/g) || [];
  return [...new Set(matches.map((s) => s.replace(/\s+/g, '')))];
}

function addEdge(edgeMap, a, b, tags) {
  if (!a || !b) return;
  const [s, t] = [a, b].sort();
  const key = `${s}|${t}`;
  if (!edgeMap.has(key)) {
    edgeMap.set(key, { source: s, target: t, tags: new Set() });
  }
  const e = edgeMap.get(key);
  (tags || []).forEach((tag) => {
    const clean = String(tag || '').trim();
    if (clean) e.tags.add(clean);
  });
}

function decorateNodes(baseNodes, course, moduleOffset) {
  return baseNodes.map((n) => ({
    ...n,
    id: `${course}:${n.id}`,
    base_id: n.id,
    course,
    course_module_num: n.module_num,
    module_num: n.module_num + moduleOffset,
    module_title: `${course} M${n.module_num}: ${n.module_title}`,
  }));
}

function decorateLinks(baseLinks, course) {
  return baseLinks.map((l) => ({
    source: `${course}:${l.source}`,
    target: `${course}:${l.target}`,
    tags: Array.isArray(l.tags) ? l.tags : [],
  }));
}

function computePositions(nodes) {
  const width = 1400;
  const height = 1000;
  const left = 120;
  const right = 120;
  const top = 90;
  const bottom = 90;

  const byModule = new Map();
  for (const n of nodes) {
    if (!byModule.has(n.module_num)) byModule.set(n.module_num, []);
    byModule.get(n.module_num).push(n);
  }

  const modules = Array.from(byModule.keys()).sort((a, b) => a - b);
  const rowCount = Math.max(2, modules.length);
  const rowSpacing = (height - top - bottom) / (rowCount - 1);
  const totalWidth = width - left - right;

  modules.forEach((m, idx) => {
    const arr = byModule.get(m);
    arr.sort((a, b) => a.base_id.localeCompare(b.base_id));
    const step = totalWidth / (arr.length + 1);
    const y = (height - bottom) - idx * rowSpacing;
    arr.forEach((n, i) => {
      n.sx = left + (i + 1) * step;
      n.sy = y;
      n.x = n.sx;
      n.y = n.sy;
    });
  });

  // Ring-like fallback positions for compatibility with existing rings mode.
  const cx = width / 2;
  const cy = height / 2;
  const R = Math.min(width, height) * 0.38;
  modules.forEach((m, mi) => {
    const arr = byModule.get(m);
    const a0 = (2 * Math.PI * mi) / modules.length - Math.PI / 2;
    const mx = cx + R * Math.cos(a0);
    const my = cy + R * Math.sin(a0);
    const rMini = Math.max(18, Math.min(55, 210 / Math.sqrt(arr.length + 1)));
    arr.forEach((n, i) => {
      const a = (2 * Math.PI * i) / Math.max(1, arr.length);
      n.rx = mx + rMini * Math.cos(a);
      n.ry = my + rMini * Math.sin(a);
    });
  });
}

function main() {
  const g6a = readGraphFromHtml(path.join(ROOT, 'map_6A.html'));
  const g6c = readGraphFromHtml(path.join(ROOT, 'map_6C.html'));

  const nodes6a = decorateNodes(g6a.nodes, '6A', 0);
  const nodes6c = decorateNodes(g6c.nodes, '6C', 10);
  const allNodes = [...nodes6a, ...nodes6c];
  const nodeSet = new Set(allNodes.map((n) => n.id));

  const edgeMap = new Map();

  for (const l of decorateLinks(g6a.links, '6A')) addEdge(edgeMap, l.source, l.target, l.tags);
  for (const l of decorateLinks(g6c.links, '6C')) addEdge(edgeMap, l.source, l.target, l.tags);

  const crossFiles = fs.readdirSync(CROSS_DIR).filter((f) => f.toLowerCase().endsWith('.csv'));
  for (const file of crossFiles) {
    const mm = file.match(/Module\s+(\d+)_/i);
    if (!mm) continue;
    const moduleNum = Number(mm[1]);
    const rows = parseCsv(fs.readFileSync(path.join(CROSS_DIR, file), 'utf8'));
    if (rows.length === 0) continue;

    const header = rows[0];
    const labelCol = header.findIndex((c) => String(c).trim().toLowerCase() === 'label');
    const c6Col = header.findIndex((c) => String(c).trim().toLowerCase() === '6c connections');
    if (labelCol < 0 || c6Col < 0) continue;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const label = String(row[labelCol] || '').trim().toUpperCase();
      if (!label || !/^[A-Z]+$/.test(label)) continue;
      const src = `6A:${moduleNum}${label}`;
      if (!nodeSet.has(src)) continue;
      const targets = normalizeIdsFromCell(row[c6Col]);
      for (const tgtBase of targets) {
        const tgt = `6C:${tgtBase}`;
        if (!nodeSet.has(tgt)) continue;
        addEdge(edgeMap, src, tgt, ['cross-course', '6A-6C']);
      }
    }
  }

  computePositions(allNodes);

  const links = Array.from(edgeMap.values()).map((e) => ({
    source: e.source,
    target: e.target,
    tags: Array.from(e.tags).sort(),
  }));

  const out = { nodes: allNodes, links };
  fs.writeFileSync(path.join(ROOT, 'graph_6AC.json'), JSON.stringify(out, null, 2) + '\n');

  const crossCount = links.filter((l) => l.source.startsWith('6A:') && l.target.startsWith('6C:')).length;
  console.log(`Wrote graph_6AC.json with ${allNodes.length} nodes, ${links.length} links (${crossCount} cross-course).`);
}

main();
