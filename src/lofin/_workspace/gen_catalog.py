# Generates src/catalog.ts from _workspace/api_specs.json
import json
import re
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

with open(os.path.join(ROOT, '_workspace', 'api_specs.json'), encoding='utf-8') as f:
    data = json.load(f)


def ts_str(s):
    if s is None:
        return 'null'
    return json.dumps(s, ensure_ascii=False)


def parse_type(raw):
    raw = raw.strip()
    m = re.match(r'(\w+)\s*\(([^)]+)\)', raw)
    if not m:
        return ('string', False)
    typ = m.group(1).lower()
    typ = 'integer' if typ == 'integer' else 'string'
    required = '필수' in m.group(2)
    return (typ, required)


sample = data[0]
base_params = sample['baseParams']
error_codes = sample['errorCodes']

L = []
L.append('// Auto-generated from _workspace/api_specs.json — do not edit by hand.')
L.append('// Source: 지방재정365 OpenAPI (https://www.lofin365.go.kr)')
L.append('')
L.append('export interface ApiParam {')
L.append('  name: string;')
L.append('  type: "string" | "integer";')
L.append('  required: boolean;')
L.append('  description: string;')
L.append('  note?: string;')
L.append('}')
L.append('')
L.append('export interface OutputCol {')
L.append('  id: string;')
L.append('  name: string;')
L.append('  description?: string;')
L.append('}')
L.append('')
L.append('export interface ErrorCode {')
L.append('  kind: "ERROR" | "INFO";')
L.append('  code: string;')
L.append('  message: string;')
L.append('}')
L.append('')
L.append('export interface ApiSpec {')
L.append('  pdtaId: string;')
L.append('  code: string;')
L.append('  name: string;')
L.append('  category: string;')
L.append('  years: string;')
L.append('  endpoint: string;')
L.append('  sampleUrl: string | null;')
L.append('  description: string;')
L.append('  dept: string;')
L.append('  tags: string;')
L.append('  searchParams: ApiParam[];')
L.append('  outputCols: OutputCol[];')
L.append('}')
L.append('')

# BASE_PARAMS
L.append('/** 모든 API에 공통으로 적용되는 기본 파라미터 (Key, Type, pIndex, pSize) */')
L.append('export const BASE_PARAMS: ApiParam[] = [')
for p in base_params:
    typ, req = parse_type(p[1])
    L.append(
        f'  {{ name: {ts_str(p[0])}, type: "{typ}", required: {str(req).lower()}, '
        f'description: {ts_str(p[2])}, note: {ts_str(p[3])} }},'
    )
L.append('];')
L.append('')

# ERROR_CODES
L.append('/** 모든 API에 공통으로 적용되는 결과 메시지 코드. INFO-200 = 데이터 없음 (인증 오류 아님) */')
L.append('export const ERROR_CODES: ErrorCode[] = [')
for e in error_codes:
    msg = e[3].replace('\\n', '\n')
    L.append(f'  {{ kind: "{e[1]}", code: {ts_str(e[2])}, message: {ts_str(msg)} }},')
L.append('];')
L.append('')

# CATALOG
L.append('/** 146개 데이터셋 카탈로그 — 지방재정365 OpenAPI */')
L.append('export const CATALOG: ApiSpec[] = [')
for d in data:
    L.append('  {')
    L.append(f'    pdtaId: {ts_str(d["pdtaId"])},')
    L.append(f'    code: {ts_str(d["svcCd"])},')
    L.append(f'    name: {ts_str(d["pdtaNm"])},')
    L.append(f'    category: {ts_str(d["category"])},')
    L.append(f'    years: {ts_str(d["years"])},')
    ep = d['endpoint']
    if ep and 'www.' not in ep:
        ep = ep.replace('lofin365.go.kr', 'www.lofin365.go.kr')
    L.append(f'    endpoint: {ts_str(ep)},')
    L.append(f'    sampleUrl: {ts_str(d["sampleUrl"])},')
    desc = (d['meta'].get('description') or '').strip()
    L.append(f'    description: {ts_str(desc)},')
    L.append(f'    dept: {ts_str(d["meta"].get("dept", ""))},')
    L.append(f'    tags: {ts_str(d["meta"].get("tags", ""))},')
    sp = d['searchParams']
    descs = d.get('searchParamDescs', {})
    if sp:
        L.append('    searchParams: [')
        for p in sp:
            typ, req = parse_type(p[1])
            sp_desc = descs.get(p[0], p[2])
            L.append(
                f'      {{ name: {ts_str(p[0])}, type: "{typ}", '
                f'required: {str(req).lower()}, description: {ts_str(sp_desc)} }},'
            )
        L.append('    ],')
    else:
        L.append('    searchParams: [],')
    oc = d['outputCols']
    if oc:
        L.append('    outputCols: [')
        for c in oc:
            L.append(
                f'      {{ id: {ts_str(c[1])}, name: {ts_str(c[2])}, description: {ts_str(c[3])} }},'
            )
        L.append('    ],')
    else:
        L.append('    outputCols: [],')
    L.append('  },')
L.append('];')
L.append('')

# Helpers
L.append('// =============== 검색/조회 헬퍼 ===============')
L.append('')
L.append('/** 서비스코드(svcCd)로 단건 조회 */')
L.append('export function getApiSpec(code: string): ApiSpec | undefined {')
L.append('  const upper = code.toUpperCase();')
L.append('  return CATALOG.find((c) => c.code === upper);')
L.append('}')
L.append('')
L.append('export interface SearchQuery {')
L.append('  /** 키워드: name/description/tags/category/code 부분 매칭 (대소문자 무시) */')
L.append('  q?: string;')
L.append('  /** 카테고리 정확 매칭 */')
L.append('  category?: string;')
L.append('  /** 보유연도가 이 연도를 포함하는 것만 (예: 2024) */')
L.append('  year?: number;')
L.append('  /** 결과 최대 개수 (기본 20) */')
L.append('  limit?: number;')
L.append('}')
L.append('')
L.append('/** 카탈로그 검색 */')
L.append('export function searchCatalog(query: SearchQuery = {}): ApiSpec[] {')
L.append('  const { q, category, year, limit = 20 } = query;')
L.append('  const needle = q?.toLowerCase().trim();')
L.append('  let results = CATALOG;')
L.append('  if (category) {')
L.append('    results = results.filter((c) => c.category === category);')
L.append('  }')
L.append('  if (needle) {')
L.append('    results = results.filter((c) =>')
L.append('      c.name.toLowerCase().includes(needle) ||')
L.append('      c.description.toLowerCase().includes(needle) ||')
L.append('      c.tags.toLowerCase().includes(needle) ||')
L.append('      c.category.toLowerCase().includes(needle) ||')
L.append('      c.code.toLowerCase().includes(needle)')
L.append('    );')
L.append('  }')
L.append('  if (year !== undefined) {')
L.append('    results = results.filter((c) => {')
L.append('      const m = c.years.match(/(\\d{4})\\s*~\\s*(\\d{4})/);')
L.append('      if (!m) return false;')
L.append('      const start = parseInt(m[1], 10);')
L.append('      const end = parseInt(m[2], 10);')
L.append('      return year >= start && year <= end;')
L.append('    });')
L.append('  }')
L.append('  return results.slice(0, limit);')
L.append('}')
L.append('')
L.append('/** 모든 카테고리 목록 (개수 내림차순) */')
L.append('export function listCategories(): { category: string; count: number }[] {')
L.append('  const counts = new Map<string, number>();')
L.append('  for (const c of CATALOG) {')
L.append('    counts.set(c.category, (counts.get(c.category) ?? 0) + 1);')
L.append('  }')
L.append('  return Array.from(counts.entries())')
L.append('    .map(([category, count]) => ({ category, count }))')
L.append('    .sort((a, b) => b.count - a.count);')
L.append('}')

out = '\n'.join(L) + '\n'
out_path = os.path.join(ROOT, 'src', 'catalog.ts')
with open(out_path, 'w', encoding='utf-8') as f:
    f.write(out)

print(f'OK: {out_path}')
print(f'lines: {len(L)}, bytes: {len(out):,}')
