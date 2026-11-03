// Nối lớp AI nhận diện bố cục (structure.ts) vào việc đọc file: dựng StructureResolver cho parseFile.

import type { PendingTab, StructureResolver } from "@/lib/parsers";
import type { AiStructureNote } from "@/lib/types";
import type { AiConfig } from "./config";
import { type StructureOutcome, proposeLayouts } from "./structure";

/** Số tab tối đa hỏi AI trong một lần phân tích, để chi phí và thời gian có giới hạn. */
const MAX_TABS_PER_RUN = 24;

export function noteOf(o: StructureOutcome): AiStructureNote {
  return { sheet: o.sheet, status: o.status, message: o.message, kind: o.kind, confidence: o.confidence, rows: o.rows };
}

/**
 * Tạo bộ nhận diện dùng một cấu hình AI. `call` chỉ dùng để kiểm thử.
 * `budget` chia sẻ giữa các file của cùng một lần phân tích nên tổng số tab hỏi AI không vượt MAX_TABS_PER_RUN.
 */
export function makeStructureResolver(cfg: AiConfig | null, call?: (system: string, user: string) => Promise<string>): StructureResolver {
  const budget = { left: MAX_TABS_PER_RUN };
  return async (tabs: PendingTab[]) => {
    const take = tabs.slice(0, Math.max(0, budget.left));
    budget.left -= take.length;
    const notes: AiStructureNote[] = tabs.slice(take.length).map((t) => ({
      sheet: t.tab.sheet,
      status: "no_answer",
      message: `Đã đủ ${MAX_TABS_PER_RUN} bảng hỏi AI trong lần phân tích này nên bảng này chưa được hỏi.`,
    }));
    const layouts = new Map<string, NonNullable<StructureOutcome["layout"]>>();
    if (take.length > 0) {
      const outcomes = await proposeLayouts(
        take.map((t) => ({ tab: t.tab, grid: t.grid })),
        cfg,
        call,
      );
      for (const o of outcomes) {
        notes.push(noteOf(o));
        if ((o.status === "accepted" || o.status === "cached") && o.layout) layouts.set(o.sheet, o.layout);
      }
    }
    return { layouts, notes };
  };
}
