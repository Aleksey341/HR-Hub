import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const FONTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "fonts");
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 54;
const PURPLE = rgb(130 / 255, 20 / 255, 1);
const INK = rgb(26 / 255, 26 / 255, 26 / 255);
const CHECKS = [
  ["c:it", "ИТ"],
  ["c:b2b", "B2B"],
  ["c:wink", "B2C Wink"],
  ["c:core", "B2C Core"],
  ["c:b20", "B20"],
  ["c:solar", "Солар"],
  ["c:turbo", "Турбо"],
];

function decode(value) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/g, " ")
    .replace(/&#(\d+);/g, function(_, n) { return String.fromCharCode(Number(n)); })
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function richLines(value) {
  if (!value) return [];
  const html = String(value)
    .replace(/<del\b[^>]*>[\s\S]*?<\/del>/gi, "")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h1|h2|h3)>/gi, "\n");
  const lines = [];
  let line = [];
  let bold = false;
  const re = /<\/?(?:b|strong)\b[^>]*>|<[^>]+>|[^<]+/gi;
  let match;
  while ((match = re.exec(html))) {
    const token = match[0];
    if (/^<(?:b|strong)\b/i.test(token)) {
      bold = true;
      continue;
    }
    if (/^<\/(?:b|strong)\b/i.test(token)) {
      bold = false;
      continue;
    }
    if (token[0] === "<") continue;
    decode(token).split("\n").forEach(function(part, index) {
      if (index > 0 && line.length) {
        lines.push(line);
        line = [];
      }
      const text = part.replace(/\s+/g, " ");
      if (text.trim()) line.push({ text: text, bold: bold });
    });
  }
  if (line.length) lines.push(line);
  return lines;
}

function plainText(value) {
  return richLines(value).map(function(line) {
    return line.map(function(part) { return part.text; }).join("");
  }).join(" ").trim();
}

function checksLine(data) {
  return CHECKS.map(function(item) {
    return (data[item[0]] === "1" ? "[x] " : "[ ] ") + item[1];
  }).join("  ");
}

function teamLines(data) {
  const rows = [];
  for (let i = 1; i <= 4; i++) {
    const cells = ["n", "r", "e", "w"].map(function(part) {
      return plainText(data["t" + i + part]);
    }).filter(Boolean);
    if (cells.length) rows.push(cells.join(" · "));
  }
  return rows;
}

function tokensOf(parts) {
  const tokens = [];
  parts.forEach(function(part) {
    part.text.split(/(\s+)/).filter(Boolean).forEach(function(text) {
      tokens.push({ text: text, bold: part.bold });
    });
  });
  return tokens;
}

export async function buildPdf(data) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(await readFile(path.join(FONTS, "Montserrat-Regular.ttf")), {
    subset: false,
    customName: "Montserrat-Regular"
  });
  const bold = await pdf.embedFont(await readFile(path.join(FONTS, "Montserrat-Bold.ttf")), {
    subset: false,
    customName: "Montserrat-Bold"
  });
  pdf.setTitle(plainText(data.title) || "Хакатон Canvas");
  const maxW = PAGE_W - MARGIN * 2;
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  function fontOf(isBold) {
    return isBold ? bold : regular;
  }

  function nextPage() {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  }

  function drawLine(parts, size, color) {
    const tokens = tokensOf(parts);
    const lines = [];
    let line = [];
    let width = 0;
    tokens.forEach(function(token) {
      const piece = fontOf(token.bold).widthOfTextAtSize(token.text, size);
      const space = /^\s+$/.test(token.text);
      if (line.length && width + piece > maxW && !space) {
        lines.push(line);
        line = [];
        width = 0;
      }
      if (space && !line.length) return;
      line.push(token);
      width += piece;
    });
    if (line.length) lines.push(line);
    const step = size * 1.4;
    lines.forEach(function(row) {
      if (y - step < MARGIN) nextPage();
      let x = MARGIN;
      row.forEach(function(token) {
        if (x === MARGIN && /^\s+$/.test(token.text)) return;
        const font = fontOf(token.bold);
        page.drawText(token.text, { x: x, y: y - size, size: size, font: font, color: color });
        x += font.widthOfTextAtSize(token.text, size);
      });
      y -= step;
    });
  }

  function heading(text, size) {
    y -= size * 0.7;
    drawLine([{ text: text, bold: true }], size, PURPLE);
  }

  function body(lines) {
    lines.forEach(function(parts) { drawLine(parts, 11, INK); });
  }

  drawLine([{ text: plainText(data.title) || "Хакатон Canvas", bold: true }], 16, INK);
  heading("Формула", 13);
  body(richLines(data.formula));
  heading("1. Сегменты потребителей", 13);
  heading("1.1 Конечные пользователи", 11);
  body(richLines(data.users));
  heading("1.2 К какому сегменту бизнеса внутри Ростелеком относится ваша идея:", 11);
  body([[{ text: checksLine(data), bold: false }]]);
  heading("2. Проблема", 13);
  body(richLines(data.problem));
  heading("3. Решение", 13);
  heading("3.1 Краткое описание", 11);
  body(richLines(data.solution));
  heading("3.2 Предполагаемые конкурентные преимущества", 11);
  body(richLines(data.advantage));
  heading("4. Объем рынка", 13);
  body(richLines(data.market));
  heading("5. Как продукт будет зарабатывать?", 13);
  heading("5.1 Модель монетизации", 11);
  body(richLines(data.money));
  heading("5.2 Средний чек", 11);
  body(richLines(data.check));
  heading("6. Команда", 13);
  body(teamLines(data).map(function(row) { return [{ text: row, bold: false }]; }));

  return Buffer.from(await pdf.save());
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      res.status(405).end();
      return;
    }
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      res.status(400).json({ error: "Нужен канвас" });
      return;
    }
    const file = await buildPdf(body);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename*=UTF-8''HR%20Agent%20Studio%20Canvas.pdf");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(file);
  } catch (error) {
    res.status(500).json({ error: "Не удалось собрать PDF" });
  }
}
