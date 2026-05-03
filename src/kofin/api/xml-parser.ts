// src/api/xml-parser.ts
import { XMLParser } from "fast-xml-parser";

export interface DataGoKrResponse {
  readonly totalCount: number;
  readonly rows: Record<string, string>[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  isArray: (_name, jpath) => jpath.endsWith("items.item"),
});

export function parseDataGoKrXml(xml: string): DataGoKrResponse {
  const parsed = parser.parse(xml) as {
    response: {
      header: { resultCode: string; resultMsg: string };
      body?: {
        items?: { item?: Record<string, string>[] };
        totalCount?: string | number;
      };
    };
  };

  const header = parsed.response.header;
  if (header.resultCode !== "00") {
    throw new Error(`data.go.kr API 오류: ${header.resultMsg}`);
  }

  const body = parsed.response.body;
  const items = body?.items?.item ?? [];
  const totalCount = Number(body?.totalCount ?? 0);

  return {
    totalCount,
    rows: items.map((item) =>
      Object.fromEntries(
        Object.entries(item).map(([k, v]) => [k, String(v)]),
      ),
    ),
  };
}
