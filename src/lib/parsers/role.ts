// Đoán vai trò của file (sổ sách / sao kê / hóa đơn) từ tên file và các cột nhận diện được.

import type { SourceRole } from "@/lib/types";
import { normText } from "@/lib/util/text";
import type { Field } from "./columns";

type GuessRole = Exclude<SourceRole, "other">;

const PHRASES: Record<GuessRole, string[]> = {
  ledger: [
    "so cai",
    "so chi tiet",
    "nhat ky",
    "ledger",
    "journal",
    "so quy",
    "so ke toan",
    "so tien gui",
    "so tien mat",
    "so cong no",
    "cong no",
    "tk 111",
    "tk 112",
    "tk111",
    "tk112",
  ],
  bank: [
    "sao ke",
    "saoke",
    "statement",
    "ngan hang",
    "bank",
    "vietcombank",
    "techcombank",
    "agribank",
    "sacombank",
    "vpbank",
    "tpbank",
    "hdbank",
    "eximbank",
    "bidv",
    "vcb",
    "tcb",
    "mbbank",
    "acb",
  ],
  invoice: ["hoa don", "invoice", "bang ke", "einvoice", "e invoice", "bk hd", "hoadon"],
};

/** Từ viết tắt ngắn: chỉ nhận khi đứng riêng thành một từ trong tên file. */
const SHORT_TOKENS: Record<Exclude<GuessRole, "ledger">, string[]> = {
  bank: ["mb", "vib", "ocb", "shb", "msb", "scb", "cimb"],
  invoice: ["hd", "vat"],
};

function hasPhrase(padded: string, compact: string, phrase: string): boolean {
  if (padded.includes(` ${phrase} `)) return true;
  const pc = phrase.replace(/ /g, "");
  return pc.length >= 5 && compact.includes(pc);
}

export function guessRole(fileName: string, cols?: Partial<Record<Field, number>>): SourceRole {
  const n = normText(fileName.replace(/\.[^.]+$/, ""));
  const padded = ` ${n} `;
  const compact = n.replace(/ /g, "");
  const order: GuessRole[] = ["ledger", "bank", "invoice"];

  for (const role of order) {
    if (PHRASES[role].some((p) => hasPhrase(padded, compact, p))) return role;
  }
  for (const role of ["bank", "invoice"] as const) {
    if (SHORT_TOKENS[role].some((t) => padded.includes(` ${t} `))) return role;
  }

  if (cols) {
    if (cols.series !== undefined) return "invoice";
    if (cols.taxCode !== undefined && (cols.net !== undefined || cols.tax !== undefined)) return "invoice";
    if (cols.balance !== undefined && (cols.debit !== undefined || cols.credit !== undefined)) return "bank";
    if (cols.account !== undefined) return "ledger";
  }
  return "other";
}
