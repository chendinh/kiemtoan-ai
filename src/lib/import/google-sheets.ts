// Tải một Google Sheet đã chia sẻ bằng link thành file .xlsx.
//
// An toàn (chống SSRF): code KHÔNG bao giờ gọi URL do người dùng đưa. Từ link chỉ lấy ra mã sheet (đã kiểm bằng regex),
// URL tải do code tự dựng. Mọi lần chuyển hướng đều được kiểm: chỉ https và chỉ các host của Google dùng để xuất sheet.
// Có giới hạn dung lượng (đọc theo luồng, dừng ngay khi vượt) và thời gian.

export class ImportError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ImportError";
  }
}

export type SheetRef = { kind: "id"; id: string } | { kind: "published"; id: string };

/** Host mà Google dùng khi xuất sheet: docs.google.com rồi chuyển sang doc-xx-xx-sheets.googleusercontent.com. */
const ALLOWED_HOSTS: RegExp[] = [/^docs\.google\.com$/, /^doc-[a-z0-9-]+-sheets\.googleusercontent\.com$/];
const isAllowedHost = (host: string): boolean => ALLOWED_HOSTS.some((re) => re.test(host));

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Rút mã sheet từ link Google Sheets. Ném ImportError (400) nếu link không đúng dạng. */
export function parseSheetLink(input: string): SheetRef {
  const raw = input.trim();
  if (raw.length === 0 || raw.length > 2048) throw new ImportError("Link trống hoặc quá dài.", 400);
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ImportError("Đây không phải đường link hợp lệ.", 400);
  }
  if (u.protocol !== "https:") throw new ImportError("Chỉ nhận link https.", 400);
  if (u.hostname !== "docs.google.com") throw new ImportError("Chỉ nhận link Google Sheets (docs.google.com).", 400);
  if (u.username !== "" || u.password !== "" || (u.port !== "" && u.port !== "443")) throw new ImportError("Link có thông tin không hợp lệ.", 400);

  // Link "Xuất bản lên web": /spreadsheets/d/e/<mã xuất bản>/pubhtml
  const published = /^\/spreadsheets\/d\/e\/([A-Za-z0-9_-]{20,200})(?:\/|$)/.exec(u.pathname);
  if (published) return { kind: "published", id: published[1] };

  const m = /^\/spreadsheets(?:\/u\/\d+)?\/d\/([A-Za-z0-9_-]{20,100})(?:\/|$)/.exec(u.pathname);
  if (!m) {
    throw new ImportError("Link không có dạng …/spreadsheets/d/<mã>/…. Hãy mở sheet rồi copy đường link trên thanh địa chỉ.", 400);
  }
  return { kind: "id", id: m[1] };
}

function exportUrl(ref: SheetRef): string {
  return ref.kind === "id"
    ? `https://docs.google.com/spreadsheets/d/${ref.id}/export?format=xlsx`
    : `https://docs.google.com/spreadsheets/d/e/${ref.id}/pub?output=xlsx`;
}

function sanitizeName(name: string, fallback: string): string {
  const base = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  if (base === "") return fallback;
  return /\.(xlsx|xlsm)$/i.test(base) ? base : `${base}.xlsx`;
}

/** Tên file từ Content-Disposition (ưu tiên filename*=UTF-8''…). */
export function filenameFrom(contentDisposition: string | null, fallback: string): string {
  if (!contentDisposition) return fallback;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(contentDisposition);
  if (star) {
    try {
      return sanitizeName(decodeURIComponent(star[1].trim()), fallback);
    } catch {
      // rơi xuống nhánh filename thường
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(contentDisposition);
  return plain ? sanitizeName(plain[1].trim(), fallback) : fallback;
}

async function readLimited(res: Response, maxBytes: number): Promise<Buffer> {
  const mb = (maxBytes / 1024 / 1024).toFixed(0);
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel();
    throw new ImportError(`Sheet lớn hơn ${mb} MB.`, 413);
  }
  if (!res.body) throw new ImportError("Google không trả nội dung nào.", 502);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ImportError(`Sheet lớn hơn ${mb} MB.`, 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export interface DownloadOptions {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects?: number;
  /** Chỉ để kiểm thử: thay hàm fetch. */
  fetchImpl?: typeof fetch;
}

const PRIVATE_HINT = "Sheet chưa mở quyền xem. Mở Chia sẻ → “Bất kỳ ai có đường liên kết” → vai trò Người xem, rồi thử lại.";

function statusError(status: number): ImportError {
  if (status === 400) return new ImportError("Link sai hoặc sheet không tồn tại (Google trả mã 400).", 404);
  if (status === 401 || status === 403) return new ImportError(PRIVATE_HINT, 403);
  if (status === 404) return new ImportError("Không tìm thấy sheet. Kiểm tra lại link.", 404);
  if (status === 429) return new ImportError("Google đang giới hạn lượt tải. Thử lại sau vài phút.", 429);
  return new ImportError(`Google trả lỗi ${status}. Thử lại sau.`, 502);
}

export async function downloadSheet(ref: SheetRef, opts: DownloadOptions): Promise<{ buffer: Buffer; filename: string }> {
  const doFetch = opts.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(opts.timeoutMs);
  const fallbackName = `google-sheet-${ref.id.slice(0, 6)}.xlsx`;
  let url = exportUrl(ref);

  for (let hop = 0; hop <= (opts.maxRedirects ?? 4); hop++) {
    const u = new URL(url);
    if (u.protocol !== "https:" || !isAllowedHost(u.hostname)) throw new ImportError(PRIVATE_HINT, 403);

    let res: Response;
    try {
      res = await doFetch(url, { redirect: "manual", signal, cache: "no-store", headers: { accept: `${XLSX_MIME},*/*;q=0.5` } });
    } catch (e) {
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
        throw new ImportError(`Hết thời gian chờ Google (${Math.max(1, Math.round(opts.timeoutMs / 1000))} giây).`, 504);
      }
      throw new ImportError("Không kết nối được tới Google. Kiểm tra mạng rồi thử lại.", 502);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.body?.cancel();
      if (!location) throw new ImportError("Google chuyển hướng nhưng không cho biết đích đến.", 502);
      url = new URL(location, url).toString();
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw statusError(res.status);
    }

    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    if (type.includes("text/html")) {
      await res.body?.cancel();
      throw new ImportError(PRIVATE_HINT, 403);
    }
    let buffer: Buffer;
    try {
      buffer = await readLimited(res, opts.maxBytes);
    } catch (e) {
      if (e instanceof ImportError) throw e;
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
        throw new ImportError(`Hết thời gian chờ Google (${Math.max(1, Math.round(opts.timeoutMs / 1000))} giây).`, 504);
      }
      throw new ImportError("Đang tải thì Google ngắt kết nối. Thử lại.", 502);
    }
    // File xlsx là một tệp ZIP: phải bắt đầu bằng "PK". Nếu không thì đó là trang lỗi hoặc trang đăng nhập.
    if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new ImportError(PRIVATE_HINT, 403);
    return { buffer, filename: filenameFrom(res.headers.get("content-disposition"), fallbackName) };
  }
  throw new ImportError("Google chuyển hướng quá nhiều lần.", 502);
}
