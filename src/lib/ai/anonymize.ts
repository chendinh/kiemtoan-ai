// Ẩn danh hóa dữ liệu trước khi gửi cho AI: thay tên đối tác/tên file bằng mã, che dãy số dài (số tài khoản, MST).
// Sau khi AI trả lời, mã được đổi ngược lại để người dùng đọc được.

import { stripDiacritics } from "@/lib/util/text";

interface Entry {
  plain: string;
  alias: string;
}

const plainOf = (s: string): string => stripDiacritics(s.normalize("NFC")).toLowerCase().replace(/\s+/g, " ").trim();

const isWordChar = (ch: string | undefined): boolean => !!ch && /[a-z0-9]/.test(ch);

/**
 * Họ phổ biến của người Việt (không dấu, viết hoa). Tên người trong diễn giải sao kê gần như luôn bắt đầu bằng một họ;
 * nhận diện theo họ chính xác hơn nhiều so với đoán từ danh sách từ khóa, và để nguyên mọi cụm in hoa không bắt đầu bằng họ
 * (tên công ty, "CHUYEN TIEN MUA HANG", địa chỉ ngân hàng).
 */
const SURNAMES = new Set([
  "NGUYEN", "TRAN", "LE", "PHAM", "HOANG", "HUYNH", "PHAN", "VU", "VO", "DANG", "BUI", "DO", "HO", "NGO", "DUONG", "LY", "DINH", "DOAN", "LAM", "TRINH",
  "LUONG", "LA", "MAI", "TRUONG", "CAO", "TA", "TO", "THAI", "TONG", "CHU", "HA", "QUACH", "LUU", "VUONG", "BANH", "CHAU", "TRIEU", "LAI", "KIEU", "TIEU",
  "DAO", "HUA", "ON", "AU", "DIEP", "MAC", "TIEN", "VIEN", "THACH", "CHUNG", "DUONG", "LIEU", "NINH", "TANG", "BACH", "TU", "KHUU", "LUC", "TON", "UNG",
]);
/**
 * Từ thường hay đứng ngay sau một từ trùng họ trong diễn giải sao kê: "DICH VU SMSBANKING" (VU là họ Vũ nhưng ở đây là "dịch vụ"),
 * "PHAN" trong "CO PHAN". Cụm "họ + từ này" không được coi là tên người. Mọi từ khác theo sau họ đều bị coi là phần của tên, vì
 * trong sao kê một cụm in hoa bắt đầu bằng họ phổ biến gần như luôn là tên người; thà che thừa còn hơn để lọt.
 */
const NOT_NAME_AFTER_SURNAME = new Set([
  "SMSBANKING", "SMS", "BANKING", "INTERNET", "THANG", "NGAY", "TAI", "TOI", "CHUYEN", "KHOAN", "TIEN", "PHI", "LAI", "SUAT", "NOP", "RUT",
  "MAT", "CT", "FT", "QR", "VCB", "MB", "NH", "TMCP", "BANK", "PAYMENT", "TRANSFER", "DEBITS", "DIRECT", "PARTNER",
]);
/** Cặp từ thường mà từ thứ nhất cũng là tên đệm phổ biến ("THANH TOAN"): chỉ chặn khi đi liền nhau. */
const COMMON_PAIRS = new Set(["THANH TOAN", "MUA HANG", "BAN HANG", "HOA DON", "NAM NGOAI"]);
/** Cụm in hoa bắt đầu bằng từ này là tên tổ chức/địa chỉ, không phải tên người: không che (tên công ty là thông tin kiểm toán). */
const ORG_START = new Set(["CONG", "CTY", "CTCP", "TNHH", "NH", "NGAN", "DNTN", "HKD", "CHI", "PGD", "PHONG", "SHOP", "TRUNG", "SIEU", "CUA", "QUAN", "BENH", "TRUONG", "UBND"]);
const isOrgWord = (w: string): boolean => w === "PHAN" || w === "CO" || w === "TY" || w === "CONG" || w === "HOI" || w === "SO" || w === "CHINH" || w === "A" || w === "CHAU" || w === "TMCP";
/** Từ khóa ngân hàng/hành động luôn kết thúc một cụm tên (đứng sau tên người trong diễn giải). */
const NAME_STOP = new Set(["CHUYEN", "TOI", "TAI", "CT", "FT", "NOP", "RUT", "TT", "TKTT", "PAYMENT", "TRANSFER", "FROM", "TO", "KHOAN", "SMSBANKING", "QR"]);

export class Anonymizer {
  private aliasByKey = new Map<string, string>();
  private originalByAlias = new Map<string, string>();
  private entries: Entry[] = [];
  private sorted = true;
  private counter = 0;

  constructor(readonly enabled: boolean) {}

  /** Tên file thường chứa tên công ty: thay bằng mã file (F1, F2...). */
  registerFile(fileName: string, fileId: string): void {
    if (!this.enabled) return;
    const plain = plainOf(fileName);
    if (plain.length >= 3) this.add(plain, fileId);
  }

  private add(plain: string, alias: string): void {
    this.entries.push({ plain, alias });
    this.sorted = false;
  }

  /** Mã hóa tên đối tác (cùng tên luôn ra cùng mã). */
  party(name: string | undefined): string | undefined {
    if (!this.enabled || !name) return name;
    const key = plainOf(name);
    if (key.length < 3) return name;
    let alias = this.aliasByKey.get(key);
    if (!alias) {
      alias = `ĐT-${String(++this.counter).padStart(3, "0")}`;
      this.aliasByKey.set(key, alias);
      this.originalByAlias.set(alias, name);
      this.add(key, alias);
    }
    return alias;
  }

  /**
   * Tên người viết HOA trong diễn giải sao kê ngân hàng ("NGUYEN THI MINH THU chuyen tien", "CT tu 0181… TRAN VAN A toi …").
   * Sao kê không có cột đối tác riêng nên tên chỉ nằm trong văn bản tự do, và các tên này chưa từng được đăng ký.
   * Một cụm in hoa là tên người khi từ đầu là họ phổ biến và có từ 2 đến 5 từ; cụm dừng ở từ khóa như CHUYEN, TOI.
   */
  private maskUpperNames(src: string): string {
    const re = /(?<![A-Za-z0-9ÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯ])([A-ZÀ-Ỹ]{2,}(?: [A-ZÀ-Ỹ]{1,}){1,9})(?![A-Za-z0-9])/g;
    return src.replace(re, (match: string) => {
      const words = match.split(" ");
      // Sao kê MB ghi tên người chuyển hai lần liền nhau ("PHAM THI LAN PHAM THI LAN"): coi là một tên để cùng một người ra cùng một mã.
      const half = words.length / 2;
      if (Number.isInteger(half) && half >= 2 && words.slice(0, half).join(" ") === words.slice(half).join(" ")) {
        const one = this.maskWords(words.slice(0, half));
        return `${one} ${one}`;
      }
      return this.maskWords(words);
    });
  }

  /** Trong một cụm từ in hoa, che mỗi đoạn tên bắt đầu bằng họ (tối đa 5 từ, dừng ở từ khóa), giữ nguyên phần còn lại. */
  private maskWords(words: string[]): string {
    const plain = (w: string): string => plainOf(w).toUpperCase();
    // "TRUONG" vừa là họ vừa là "trường học": chỉ coi là tổ chức khi theo sau là từ báo hiệu (TRUONG THPT, TRUONG TIEU HOC...).
    const first = plain(words[0]);
    const schoolLike = first === "TRUONG" && /^(THPT|THCS|TIEU|MAM|DAI|CAO|DAO)$/.test(plain(words[1] ?? ""));
    const orgLike = ORG_START.has(first) && (first !== "TRUONG" || schoolLike);
    if (orgLike) return words.join(" ");
    const out: string[] = [];
    let i = 0;
    while (i < words.length) {
      if (SURNAMES.has(plain(words[i])) && (i === 0 || !isOrgWord(plain(words[i - 1]))) && i + 1 < words.length && !NOT_NAME_AFTER_SURNAME.has(plain(words[i + 1])) && !COMMON_PAIRS.has(`${plain(words[i + 1])} ${plain(words[i + 2] ?? "")}`)) {
        let j = i + 1;
        while (j < words.length && j - i < 5 && !NAME_STOP.has(plain(words[j]))) j++;
        if (j - i >= 2) {
          out.push(this.aliasForName(words.slice(i, j).join(" ")));
          i = j;
          continue;
        }
      }
      out.push(words[i]);
      i++;
    }
    return out.join(" ");
  }

  private aliasForName(name: string): string {
    const key = plainOf(name);
    let alias = this.aliasByKey.get(key);
    if (!alias) {
      alias = `ĐT-${String(++this.counter).padStart(3, "0")}`;
      this.aliasByKey.set(key, alias);
      this.originalByAlias.set(alias, name);
    }
    return alias;
  }

  /** Thay tên đã biết trong văn bản tự do, che tên người viết HOA kiểu sao kê, và che các dãy từ 8 chữ số trở lên. */
  text(s: string | undefined): string | undefined {
    if (!this.enabled || !s) return s;
    if (!this.sorted) {
      this.entries.sort((a, b) => b.plain.length - a.plain.length);
      this.sorted = true;
    }
    const src = s.normalize("NFC");
    const plain = stripDiacritics(src).toLowerCase();
    let out = src;
    if (plain.length === src.length) {
      const ranges: { start: number; end: number; alias: string }[] = [];
      const overlaps = (a: number, b: number) => ranges.some((r) => a < r.end && b > r.start);
      for (const e of this.entries) {
        let from = 0;
        for (;;) {
          const idx = plain.indexOf(e.plain, from);
          if (idx < 0) break;
          const end = idx + e.plain.length;
          from = end;
          if (isWordChar(plain[idx - 1]) || isWordChar(plain[end])) continue;
          if (overlaps(idx, end)) continue;
          ranges.push({ start: idx, end, alias: e.alias });
        }
      }
      ranges.sort((a, b) => a.start - b.start);
      let cursor = 0;
      let rebuilt = "";
      for (const r of ranges) {
        rebuilt += src.slice(cursor, r.start) + r.alias;
        cursor = r.end;
      }
      out = rebuilt + src.slice(cursor);
    }
    return this.maskUpperNames(out).replace(/\d{8,}/g, (m) => `***${m.slice(-3)}`);
  }

  /** Đổi mã đối tác trong câu trả lời của AI về tên gốc. */
  restore(s: string): string {
    if (!this.enabled) return s;
    return s.replace(/ĐT-\d{3}/g, (a) => this.originalByAlias.get(a) ?? a);
  }
}
