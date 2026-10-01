const SPELL = "https://speller.yandex.net/services/spellservice.json/checkText";
const GRAMMAR = "https://api.languagetool.org/v2/check";
const SKIP_ISSUE = new Set(["misspelling", "style", "register", "locale-violation"]);

function letters(value) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("ru");
}

function usable(source, value) {
  if (!value || value === source) return "";
  const trimmed = value.replace(/^[\s\-–—]+/, "").replace(/[\s\-–—]+$/, "");
  const next = trimmed && trimmed !== value && !/^[\s\-–—]/.test(source) ? trimmed : value;
  if (!next || letters(source) === letters(next)) return "";
  return next;
}

export function buildFixes(text, spellErrors, matches) {
  const fixes = [];
  const taken = [];
  const errors = Array.isArray(spellErrors) ? spellErrors : [];
  for (const err of errors) {
    if (!Number.isInteger(err.pos) || !Number.isInteger(err.len) || err.len < 1) continue;
    const word = text.slice(err.pos, err.pos + err.len);
    const suggestions = Array.isArray(err.s) ? err.s.filter(Boolean) : [];
    if (!suggestions.length || !/[А-Яа-яЁё]/.test(word)) continue;
    if (/^[А-ЯЁ]{2,6}$/.test(word)) continue;
    const same = suggestions.some(function(item){
      return item.toLocaleLowerCase("ru") === word.toLocaleLowerCase("ru");
    });
    if (same) continue;
    const value = usable(word, suggestions[0]);
    if (!value) continue;
    fixes.push({ offset: err.pos, length: err.len, value: value });
    taken.push([err.pos, err.pos + err.len]);
  }
  const grammar = Array.isArray(matches) ? matches : [];
  for (const match of grammar) {
    const issue = match.rule && match.rule.issueType;
    if (SKIP_ISSUE.has(issue)) continue;
    const replacements = Array.isArray(match.replacements) ? match.replacements : [];
    if (replacements.length !== 1 || !replacements[0] || !replacements[0].value) continue;
    if (!Number.isInteger(match.offset) || !Number.isInteger(match.length) || match.length < 1) continue;
    const source = text.slice(match.offset, match.offset + match.length);
    const value = usable(source, replacements[0].value);
    if (!source || !value) continue;
    if (Math.abs(value.length - source.length) > 40) continue;
    const overlaps = taken.some(function(span){
      return match.offset < span[1] && span[0] < match.offset + match.length;
    });
    if (overlaps) continue;
    fixes.push({ offset: match.offset, length: match.length, value: value });
    taken.push([match.offset, match.offset + match.length]);
  }
  fixes.sort(function(a, b){ return a.offset - b.offset; });
  const clean = [];
  let end = -1;
  for (const fix of fixes) {
    if (fix.offset < end) continue;
    clean.push(fix);
    end = fix.offset + fix.length;
  }
  return clean;
}

async function postForm(url, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
    body: new URLSearchParams(params),
  });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      res.status(405).end();
      return;
    }
    const text = req.body && req.body.text;
    if (typeof text !== "string" || text.length > 20000) {
      res.status(400).json({ error: "Нужен текст" });
      return;
    }
    const jobs = await Promise.allSettled([
      postForm(SPELL, { text: text, lang: "ru", options: "16" }),
      postForm(GRAMMAR, { text: text, language: "ru-RU" }),
    ]);
    const spell = jobs[0].status === "fulfilled" && Array.isArray(jobs[0].value) ? jobs[0].value : [];
    const matches = jobs[1].status === "fulfilled" && jobs[1].value && Array.isArray(jobs[1].value.matches)
      ? jobs[1].value.matches
      : [];
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ fixes: buildFixes(text, spell, matches) });
  } catch (error) {
    res.status(500).json({ error: "Не удалось проверить текст" });
  }
}
