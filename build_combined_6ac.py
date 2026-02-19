import csv
import json
import math
import re
from pathlib import Path

ROOT = Path.cwd()
CROSS_DIR = Path('/Users/jacksonelliott/Downloads/6A-6C connections')


def read_graph_from_html(html_path: Path):
    text = html_path.read_text(encoding='utf-8')
    m = re.search(r'<script id="graph-data" type="application/json">([\s\S]*?)</script>', text)
    if not m:
        raise RuntimeError(f'graph-data script not found in {html_path}')
    return json.loads(m.group(1))


def normalize_ids_from_cell(cell: str):
    if not cell:
        return []
    vals = re.findall(r'\d+\s*[A-Z]+', cell.upper())
    out = []
    seen = set()
    for v in vals:
        vv = re.sub(r'\s+', '', v)
        if vv not in seen:
            seen.add(vv)
            out.append(vv)
    return out


def add_edge(edge_map, a, b, tags):
    if not a or not b:
        return
    s, t = sorted([a, b])
    key = f'{s}|{t}'
    if key not in edge_map:
        edge_map[key] = {'source': s, 'target': t, 'tags': set()}
    for tag in tags or []:
        clean = str(tag).strip()
        if clean:
            edge_map[key]['tags'].add(clean)


def decorate_nodes(base_nodes, course, module_offset):
    out = []
    for n in base_nodes:
        nn = dict(n)
        nn['id'] = f"{course}:{n['id']}"
        nn['base_id'] = n['id']
        nn['course'] = course
        nn['course_module_num'] = n['module_num']
        nn['module_num'] = n['module_num'] + module_offset
        nn['module_title'] = f"{course} M{n['module_num']}: {n['module_title']}"
        out.append(nn)
    return out


def decorate_links(base_links, course):
    out = []
    for l in base_links:
        out.append({
            'source': f"{course}:{l['source']}",
            'target': f"{course}:{l['target']}",
            'tags': list(l.get('tags') or []),
        })
    return out


def compute_positions(nodes):
    width, height = 1400, 1000
    left, right, top, bottom = 120, 120, 90, 90

    by_module = {}
    for n in nodes:
        by_module.setdefault(n['module_num'], []).append(n)

    modules = sorted(by_module.keys())
    row_count = max(2, len(modules))
    row_spacing = (height - top - bottom) / (row_count - 1)
    total_width = width - left - right

    for idx, m in enumerate(modules):
        arr = by_module[m]
        arr.sort(key=lambda n: n['base_id'])
        step = total_width / (len(arr) + 1)
        y = (height - bottom) - idx * row_spacing
        for i, n in enumerate(arr):
            n['sx'] = left + (i + 1) * step
            n['sy'] = y
            n['x'] = n['sx']
            n['y'] = n['sy']

    cx, cy = width / 2, height / 2
    big_r = min(width, height) * 0.38
    for mi, m in enumerate(modules):
        arr = by_module[m]
        a0 = (2 * math.pi * mi) / len(modules) - math.pi / 2
        mx = cx + big_r * math.cos(a0)
        my = cy + big_r * math.sin(a0)
        mini_r = max(18.0, min(55.0, 210.0 / math.sqrt(len(arr) + 1)))
        k = max(1, len(arr))
        for i, n in enumerate(arr):
            a = (2 * math.pi * i) / k
            n['rx'] = mx + mini_r * math.cos(a)
            n['ry'] = my + mini_r * math.sin(a)


def main():
    g6a = read_graph_from_html(ROOT / 'map_6A.html')
    g6c = read_graph_from_html(ROOT / 'map_6C.html')

    nodes6a = decorate_nodes(g6a['nodes'], '6A', 0)
    nodes6c = decorate_nodes(g6c['nodes'], '6C', 10)
    nodes = nodes6a + nodes6c
    node_ids = {n['id'] for n in nodes}

    edge_map = {}

    for l in decorate_links(g6a['links'], '6A'):
        add_edge(edge_map, l['source'], l['target'], l['tags'])
    for l in decorate_links(g6c['links'], '6C'):
        add_edge(edge_map, l['source'], l['target'], l['tags'])

    for csv_path in sorted(CROSS_DIR.glob('*.csv')):
        mm = re.search(r'Module\s+(\d+)_', csv_path.name, re.IGNORECASE)
        if not mm:
            continue
        module_num = int(mm.group(1))

        with csv_path.open('r', encoding='utf-8', newline='') as f:
            rows = list(csv.reader(f))

        if not rows:
            continue

        label_col = -1
        c6_col = -1
        for r in rows[:4]:
            lowered = [str(c).strip().lower() for c in r]
            if label_col < 0 and 'label' in lowered:
                label_col = lowered.index('label')
            if c6_col < 0 and '6c connections' in lowered:
                c6_col = lowered.index('6c connections')
        if label_col < 0 or c6_col < 0:
            continue

        for row in rows[1:]:
            if label_col >= len(row):
                continue
            label = str(row[label_col]).strip().upper()
            if not re.fullmatch(r'[A-Z]+', label or ''):
                continue
            src = f'6A:{module_num}{label}'
            if src not in node_ids:
                continue
            cell = row[c6_col] if c6_col < len(row) else ''
            for tgt_base in normalize_ids_from_cell(cell):
                tgt = f'6C:{tgt_base}'
                if tgt in node_ids:
                    add_edge(edge_map, src, tgt, ['cross-course', '6A-6C'])

    compute_positions(nodes)

    links = []
    cross_count = 0
    for e in edge_map.values():
        tags = sorted(e['tags'])
        links.append({'source': e['source'], 'target': e['target'], 'tags': tags})
        if e['source'].startswith('6A:') and e['target'].startswith('6C:'):
            cross_count += 1

    out = {'nodes': nodes, 'links': links}
    (ROOT / 'graph_6AC.json').write_text(json.dumps(out, indent=2) + '\n', encoding='utf-8')
    print(f"Wrote graph_6AC.json with {len(nodes)} nodes, {len(links)} links ({cross_count} cross-course).")


if __name__ == '__main__':
    main()
