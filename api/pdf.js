import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";

const FONTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "fonts");
const PURPLE = "#8214FF";
const INK = "#1a1a1a";
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

function contentWidth(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function heading(doc, text, size) {
  const width = contentWidth(doc);
  if (doc.y > doc.page.height - doc.page.margins.bottom - 36) doc.addPage();
  doc.moveDown(0.55);
  doc.font("Bold").fontSize(size).fillColor(PURPLE).text(text, { width: width });
}

function writeLines(doc, lines) {
  const width = contentWidth(doc);
  lines.forEach(function(parts) {
    parts.forEach(function(part, index) {
      doc.font(part.bold ? "Bold" : "Regular").fontSize(11).fillColor(INK);
      doc.text(part.text, {
        width: width,
        continued: index < parts.length - 1,
        lineGap: 1
      });
    });
  });
}

export function buildPdf(data) {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 54, bottom: 54, left: 54, right: 54 },
    info: { Title: plainText(data.title) || "Хакатон Canvas" }
  });
  doc.registerFont("Regular", path.join(FONTS, "PTSans-Regular.ttf"));
  doc.registerFont("Bold", path.join(FONTS, "PTSans-Bold.ttf"));
  const width = contentWidth(doc);
  const chunks = [];
  const done = new Promise(function(resolve, reject) {
    doc.on("data", function(chunk) { chunks.push(chunk); });
    doc.on("end", function() { resolve(Buffer.concat(chunks)); });
    doc.on("error", reject);
  });

  doc.font("Bold").fontSize(16).fillColor(INK).text(plainText(data.title) || "Хакатон Canvas", { width: width });
  heading(doc, "Формула", 13);
  writeLines(doc, richLines(data.formula));
  heading(doc, "1. Сегменты потребителей", 13);
  heading(doc, "1.1 Конечные пользователи", 11);
  writeLines(doc, richLines(data.users));
  heading(doc, "1.2 К какому сегменту бизнеса внутри Ростелеком относится ваша идея:", 11);
  writeLines(doc, [[{ text: checksLine(data), bold: false }]]);
  heading(doc, "2. Проблема", 13);
  writeLines(doc, richLines(data.problem));
  heading(doc, "3. Решение", 13);
  heading(doc, "3.1 Краткое описание", 11);
  writeLines(doc, richLines(data.solution));
  heading(doc, "3.2 Предполагаемые конкурентные преимущества", 11);
  writeLines(doc, richLines(data.advantage));
  heading(doc, "4. Объем рынка", 13);
  writeLines(doc, richLines(data.market));
  heading(doc, "5. Как продукт будет зарабатывать?", 13);
  heading(doc, "5.1 Модель монетизации", 11);
  writeLines(doc, richLines(data.money));
  heading(doc, "5.2 Средний чек", 11);
  writeLines(doc, richLines(data.check));
  heading(doc, "6. Команда", 13);
  writeLines(doc, teamLines(data).map(function(row) {
    return [{ text: row, bold: false }];
  }));

  doc.end();
  return done;
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
