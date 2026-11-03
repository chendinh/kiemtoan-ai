// Nối bộ nhận diện + bộ trích xuất vào từng tab của một workbook.
// parseWorkbook gọi readShopTab cho mỗi tab; tab nào được nhận diện thì không đi qua bộ đọc bảng giao dịch chung.

import { detectLayout } from "./detect";
import {
  extractDaySummary,
  extractGaOrders,
  extractGaOverview,
  extractLedger,
  extractLots,
  extractMonthly,
  extractPayouts,
  extractRevenue,
} from "./extract";
import { Grid } from "./grid";
import type { Layout, ShopFileData, ShopTab, SrcRef } from "./types";

export type SrcBase = Omit<SrcRef, "sheet">;

/**
 * Trích xuất một tab theo bố cục đã biết rồi ghi vào `data`.
 * Trả về false nếu tab không dùng được với bố cục này (ví dụ tab doanh thu không có tháng trong tên).
 */
export function extractWithLayout(g: Grid, layout: Layout, base: SrcBase, data: ShopFileData): boolean {
  const src: SrcRef = { ...base, sheet: g.name };
  const via = layout.via ?? "rules";
  const used = new Set(Object.values(layout.cols));
  const add = (rows: number, note?: string): void => {
    const tab: ShopTab = { sheet: g.name, kind: layout.kind, hidden: g.hidden, rows, via };
    if (note) tab.note = note;
    // Chỉ quan tâm hàng ẩn có dữ liệu và cột ẩn mà ta đang đọc; cột ẩn khác (thường là thông tin liên hệ) không liên quan đến tiền.
    const hiddenRows = g.hiddenRowsWithData(200);
    if (hiddenRows.length > 0) tab.hiddenRows = hiddenRows;
    const hiddenCols = g.hiddenColsWithData().filter((letter) => used.has(Grid.colIndex(letter)));
    if (hiddenCols.length > 0) tab.hiddenCols = hiddenCols;
    data.tabs.push(tab);
  };

  switch (layout.kind) {
    case "lots": {
      const t = extractLots(g, layout, src);
      data.lots.push(t);
      add(t.rows.length);
      return true;
    }
    case "payouts": {
      const t = extractPayouts(g, layout, src);
      data.payouts.push(t);
      add(t.rows.length);
      return true;
    }
    case "ledger": {
      const t = extractLedger(g, layout, src);
      data.ledgers.push(t);
      add(t.rows.length);
      return true;
    }
    case "daySummary": {
      const t = extractDaySummary(g, layout, src);
      data.daySummaries.push(t);
      add(t.rows.length);
      return true;
    }
    case "revenue": {
      const t = extractRevenue(g, layout, src);
      if (!t) {
        // Đã biết là bảng doanh thu ngày nhưng tên tab không có tháng/năm nên không xếp vào kỳ nào được.
        // Vẫn ghi nhận để tab không rơi xuống bộ đọc bảng giao dịch chung.
        add(0, "Không xác định được tháng/năm từ tên tab");
        return true;
      }
      data.revenues.push(t);
      add(t.rows.length);
      return true;
    }
    case "monthly": {
      const t = extractMonthly(g, layout, src);
      data.monthly.push(t);
      add(t.rows.length);
      return true;
    }
    case "gaOrders": {
      const t = extractGaOrders(g, layout, src);
      data.gaOrders.push(t);
      add(t.orders.length);
      return true;
    }
    case "gaOverview": {
      data.gaOverview.push(extractGaOverview(g, src));
      add(0);
      return true;
    }
    case "gaProducts": {
      // Chi tiết sản phẩm phục vụ kiểm hàng (làm sau): chỉ ghi nhận tab, không đọc 26 nghìn dòng chứa dữ liệu khách.
      add(Math.max(0, g.r1 - layout.headerRow));
      return true;
    }
  }
}

/** Nhận diện bằng luật cố định rồi trích xuất. Trả về true nếu tab thuộc nghiệp vụ shop và đã được ghi vào `data`. */
export function readShopTab(g: Grid, base: SrcBase, data: ShopFileData): boolean {
  const layout = detectLayout(g);
  return layout ? extractWithLayout(g, layout, base, data) : false;
}
