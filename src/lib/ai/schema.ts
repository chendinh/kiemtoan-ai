// Kiểm tra dữ liệu gửi lên /api/ai-review (giới hạn kích thước, loại bỏ trường thừa như tên file gốc trong bằng chứng).

import { z } from "zod";

const role = z.enum(["ledger", "bank", "invoice", "other"]);

/** Chuỗi quá dài được cắt ngắn thay vì làm cả yêu cầu bị từ chối: một ghi chú dài hơn dự kiến không được phép chặn cả lượt rà soát. */
const text = (max: number) => z.string().transform((s) => (s.length > max ? `${s.slice(0, max - 1)}…` : s));

export const aiRecordSchema = z.object({
  id: z.string().max(60),
  fileId: z.string().max(20),
  role,
  sheet: z.string().max(100).optional(),
  row: z.number().optional(),
  date: z.string().max(10).optional(),
  description: text(600).optional(),
  counterparty: text(300).optional(),
  taxCode: z.string().max(40).optional(),
  reference: text(100).optional(),
  debit: z.number().optional(),
  credit: z.number().optional(),
  amount: z.number(),
  balance: z.number().optional(),
  note: text(600).optional(),
});

export const aiRequestSchema = z.object({
  anonymize: z.boolean().default(true),
  analysis: z.object({
    files: z
      .array(
        z.object({
          fileId: z.string().max(20),
          fileName: text(300),
          role,
          records: z.number(),
          dateFrom: z.string().max(10).optional(),
          dateTo: z.string().max(10).optional(),
          totalDebit: z.number(),
          totalCredit: z.number(),
          warnings: z.array(text(500)).max(20).default([]),
          // Bảng nghiệp vụ của shop đã đọc được trong file (file loại này có records = 0 nhưng không phải file lỗi).
          shopTables: z.array(z.object({ label: text(80), count: z.number(), rows: z.number() })).max(12).optional(),
          shopUnknownTabs: z.number().optional(),
        }),
      )
      .max(40),
    totals: z.object({
      records: z.number(),
      debit: z.number(),
      credit: z.number(),
      amount: z.number(),
      dateFrom: z.string().max(10).optional(),
      dateTo: z.string().max(10).optional(),
    }),
    riskScore: z.number(),
    riskLevel: z.string().max(20),
    findings: z
      .array(
        z.object({
          id: z.string().max(20),
          rule: z.string().max(60),
          severity: z.enum(["high", "medium", "low", "info"]),
          title: text(300),
          description: text(4000),
          amount: z.number(),
          totalRecords: z.number(),
          evidence: z.array(aiRecordSchema).max(80),
        }),
      )
      .max(300),
    benford: z
      .array(
        z.object({
          fileId: z.string().max(20),
          n: z.number(),
          mad: z.number(),
          chiSquare: z.number(),
          conformity: z.string().max(20),
        }),
      )
      .max(20)
      .default([]),
    reconciliation: z
      .array(
        z.object({
          leftLabel: z.string().max(100),
          rightLabel: z.string().max(100),
          leftCount: z.number(),
          rightCount: z.number(),
          matched: z.number(),
          matchedGroups: z.number(),
          amountMismatches: z.number(),
          leftUnmatched: z.number(),
          rightUnmatched: z.number(),
          leftUnmatchedAmount: z.number(),
          rightUnmatchedAmount: z.number(),
          matchRate: z.number(),
        }),
      )
      .max(10)
      .default([]),
    /** Ma trận kiểm tra của shop ký gửi (nếu có): cho AI biết phép kiểm nào đạt, lệch bao nhiêu, thiếu dữ liệu gì. */
    shop: z
      .object({
        year: z.number(),
        asOf: text(10),
        checks: z
          .array(
            z.object({
              id: text(40),
              label: text(200),
              status: z.enum(["ok", "issue", "na"]),
              issues: z.number(),
              amount: z.number(),
              detail: text(400),
            }),
          )
          .max(40),
        coverage: z.array(z.object({ level: z.enum(["warn", "info"]), label: text(400) })).max(20),
      })
      .optional(),
    digest: z.object({
      topCounterparties: z.array(z.object({ name: z.string().max(300), count: z.number(), total: z.number() })).max(30),
      monthly: z.array(z.object({ month: z.string().max(7), count: z.number(), total: z.number() })).max(60),
      largest: z.array(aiRecordSchema).max(30),
      sample: z.array(aiRecordSchema).max(60),
      textExcerpts: z.array(z.object({ fileId: z.string().max(20), role, excerpt: z.string().max(4000) })).max(10),
    }),
  }),
});

export type AiRequest = z.infer<typeof aiRequestSchema>;
export type AiRecord = z.infer<typeof aiRecordSchema>;

/** Phản hồi của AI: chấp nhận lỏng, giá trị sai được thay bằng mặc định rồi lọc lại sau. */
export const aiOutputSchema = z.object({
  overallAssessment: z.string().catch(""),
  riskLevel: z.enum(["low", "medium", "high"]).catch("medium"),
  findingReviews: z
    .array(
      z.object({
        findingId: z.string().catch(""),
        verdict: z.enum(["likely_issue", "needs_followup", "likely_benign"]).catch("needs_followup"),
        comment: z.string().catch(""),
        procedures: z.array(z.string()).catch([]),
      }),
    )
    .catch([]),
  additionalObservations: z
    .array(
      z.object({
        title: z.string().catch(""),
        detail: z.string().catch(""),
        severity: z.enum(["low", "medium", "high"]).catch("low"),
        recordIds: z.array(z.string()).catch([]),
      }),
    )
    .catch([]),
  questions: z.array(z.string()).catch([]),
  limitations: z.array(z.string()).catch([]),
});
