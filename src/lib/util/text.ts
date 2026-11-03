// Tiện ích xử lý chuỗi (tiếng Việt có dấu, so khớp mờ).

export function stripDiacritics(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

/** Chữ thường, bỏ dấu, chỉ giữ chữ-số, gom khoảng trắng. */
export function normText(input: string): string {
  return stripDiacritics(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Từ chỉ loại hình doanh nghiệp, bỏ đi khi so khớp tên đối tác. */
const LEGAL_WORDS = new Set([
  "cong",
  "ty",
  "tnhh",
  "cp",
  "co",
  "phan",
  "tm",
  "dv",
  "sx",
  "mtv",
  "jsc",
  "ltd",
  "llc",
  "inc",
  "corp",
  "company",
  "limited",
  "joint",
  "stock",
  "dntn",
  "hkd",
]);

/** Khóa chuẩn hóa của tên đối tác (null nếu quá ngắn / không có). */
export function partyKey(name: string | undefined | null): string | null {
  if (!name) return null;
  const tokens = normText(name)
    .split(" ")
    .filter((t) => t && !LEGAL_WORDS.has(t));
  const key = tokens.join(" ");
  return key.length >= 2 ? key : null;
}

/** Chuẩn hóa số chứng từ để so sánh: bỏ ký tự phân cách, số 0 đứng đầu của phần số cuối. */
export function normRef(ref: string | undefined | null): string {
  if (!ref) return "";
  const s = stripDiacritics(String(ref)).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s;
}

/** Tách số chứng từ thành (tiền tố, số) nếu kết thúc bằng chuỗi chữ số. */
export function splitSequence(ref: string | undefined | null): { prefix: string; num: number; width: number } | null {
  const s = normRef(ref);
  const m = /^(.*?)(\d{3,})$/.exec(s);
  if (!m) return null;
  const num = Number(m[2]);
  if (!Number.isSafeInteger(num)) return null;
  return { prefix: m[1], num, width: m[2].length };
}

export function tokens(input: string | undefined | null): string[] {
  if (!input) return [];
  return normText(input)
    .split(" ")
    .filter((t) => t.length >= 2);
}

export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

export function levenshtein(a: string, b: string, maxDist = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > maxDist) return maxDist + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** Độ giống nhau 0..1 dựa trên khoảng cách Levenshtein. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const maxDist = Math.floor(maxLen * 0.3);
  const d = levenshtein(a, b, maxDist);
  if (d > maxDist) return 0;
  return 1 - d / maxLen;
}

/** Kiểm tra `n` (đã normText) chứa nguyên cụm `phrase` (cũng đã normText). */
export function containsPhrase(n: string, phrase: string): boolean {
  return ` ${n} `.includes(` ${phrase} `);
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
