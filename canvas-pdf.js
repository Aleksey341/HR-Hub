(function (root) {
  var CHECKS = [
    ["ит", "it"],
    ["b2b", "b2b"],
    ["b2c wink", "wink"],
    ["b2c core", "core"],
    ["b20", "b20"],
    ["солар", "solar"],
    ["турбо", "turbo"]
  ];

  function findAll(text) {
    var specs = [
      ["formula", /Формула/],
      ["segments", /1\.\s*Сегменты потребителей/],
      ["users", /1\.1\s*Конечные пользователи/],
      ["segment", /1\.2\s*К какому сегменту/],
      ["problem", /2\.\s*Проблема/],
      ["solutionHead", /3\.\s*Решение/],
      ["solution", /3\.1\s*Краткое описание/],
      ["advantage", /3\.2\s*Предполагаемые конкурентные преимущества/],
      ["market", /4\.\s*Объем рынка/],
      ["moneyHead", /5\.\s*Как продукт будет зарабатывать\??/],
      ["money", /5\.1\s*/],
      ["check", /5\.2\s*/],
      ["team", /6\.\s*Команда/]
    ];
    var from = 0;
    var found = [];
    specs.forEach(function (spec) {
      var slice = text.slice(from);
      var match = spec[1].exec(slice);
      if (!match) return;
      var at = from + match.index;
      found.push({ key: spec[0], at: at, len: match[0].length });
      from = at + match[0].length;
    });
    return found;
  }

  function between(text, found, key, nextKeys) {
    var start = null;
    var i;
    for (i = 0; i < found.length; i++) {
      if (found[i].key === key) start = found[i];
    }
    if (!start) return "";
    var end = text.length;
    for (i = 0; i < found.length; i++) {
      if (found[i].at <= start.at) continue;
      if (!nextKeys || nextKeys.indexOf(found[i].key) !== -1) {
        end = found[i].at;
        break;
      }
    }
    return text.slice(start.at + start.len, end).replace(/^[ \t]*[:.]?[ \t]*/, "").trim();
  }

  function htmlFromText(value) {
    var lines = value.replace(/===== PAGE \d+ =====/g, "").split(/\n+/).map(function (line) {
      return line.replace(/\s+/g, " ").trim();
    }).filter(Boolean);
    if (!lines.length) return "";
    return lines.map(function (line) {
      return "<p>" + line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</p>";
    }).join("");
  }

  function checksFrom(value) {
    var out = {};
    var re = /\[(x|X|х|Х| )\]\s*([^\[\n]+)/g;
    var match;
    while ((match = re.exec(value))) {
      var on = match[1].toLowerCase() !== " ";
      var name = match[2].replace(/\s+/g, " ").trim().toLowerCase();
      CHECKS.forEach(function (item) {
        if (name.indexOf(item[0]) === 0) out[item[1]] = on ? "1" : "0";
      });
    }
    return out;
  }

  function stripChecks(value) {
    return value.replace(/\[(x|X|х|Х| )\]\s*[^\[\n]+/g, "").replace(/\s+/g, " ").trim();
  }

  function teamFrom(value) {
    var rows = [];
    value.split(/\n+/).forEach(function (line) {
      var clean = line.replace(/\s+/g, " ").trim();
      if (!clean || /^фио\b/i.test(clean)) return;
      var parts = clean.split(/\s*[·•|]\s*/).map(function (part) { return part.trim(); });
      if (parts.length < 2) {
        var dash = clean.split(/\s+[–—-]\s+/);
        if (dash.length >= 2) {
          var bits = dash.slice(1).join(", ").split(",").map(function (part) { return part.trim(); });
          parts = [dash[0]].concat(bits);
        }
      }
      if (!parts[0]) return;
      rows.push({
        n: parts[0] || "",
        r: parts[1] || "",
        e: parts[2] || "",
        w: parts[3] || ""
      });
    });
    return rows.slice(0, 4);
  }

  function splitCanvas(text) {
    var found = findAll(text);
    var segment = between(text, found, "segment", ["problem"]).replace(/===== PAGE \d+ =====/g, "");
    var moneyIntro = between(text, found, "moneyHead", ["money"]);
    var moneyBody = between(text, found, "money", ["check"]);
    var title = "";
    var titleMatch = /Хакатон Canvas\.\s*Название проекта:\s*(.+)/.exec(text);
    if (titleMatch) title = "Хакатон Canvas. Название проекта: " + titleMatch[1].split("\n")[0].trim();
    return {
      title: title,
      formula: htmlFromText(between(text, found, "formula", ["segments", "users"])),
      users: htmlFromText(between(text, found, "users", ["segment"]) + (stripChecks(segment) ? "\n" + stripChecks(segment) : "")),
      checks: checksFrom(segment),
      problem: htmlFromText(between(text, found, "problem", ["solutionHead", "solution"])),
      solution: htmlFromText(between(text, found, "solution", ["advantage"])),
      advantage: htmlFromText(between(text, found, "advantage", ["market"])),
      market: htmlFromText(between(text, found, "market", ["moneyHead"])),
      money: htmlFromText([moneyIntro, moneyBody].filter(Boolean).join("\n")),
      check: htmlFromText(between(text, found, "check", ["team"])),
      team: teamFrom(between(text, found, "team", []))
    };
  }

  function linesFromItems(items) {
    var rows = [];
    items.forEach(function (item) {
      if (!item.str) return;
      var y = Math.round(item.transform[5]);
      var row = rows.length ? rows[rows.length - 1] : null;
      if (!row || Math.abs(row.y - y) > 3) {
        rows.push({ y: y, parts: [item.str] });
      } else {
        row.parts.push(item.str);
      }
    });
    return rows.map(function (row) { return row.parts.join(" ").replace(/\s+/g, " ").trim(); }).filter(Boolean).join("\n");
  }

  function read(buf) {
    if (!root.pdfjsLib) return Promise.reject(new Error("pdf"));
    root.pdfjsLib.GlobalWorkerOptions.workerSrc = "js/pdf.worker.min.js";
    return root.pdfjsLib.getDocument({ data: buf }).promise.then(function (pdf) {
      var jobs = [];
      for (var i = 1; i <= pdf.numPages; i++) jobs.push(pdf.getPage(i));
      return Promise.all(jobs);
    }).then(function (pages) {
      return Promise.all(pages.map(function (page) {
        return page.getTextContent().then(function (content) {
          return linesFromItems(content.items);
        });
      }));
    }).then(function (pages) {
      return splitCanvas(pages.join("\n"));
    });
  }

  function apply(data) {
    if (data.title) {
      var title = document.querySelector(".hack h1");
      if (title) title.textContent = data.title;
    }
    ["formula", "users", "problem", "solution", "advantage", "market", "money", "check"].forEach(function (key) {
      var el = document.querySelector('[data-k="' + key + '"]');
      if (el && data[key]) el.innerHTML = data[key];
    });
    if (data.checks) {
      document.querySelectorAll("[data-c]").forEach(function (el) {
        var id = el.getAttribute("data-c");
        if (Object.prototype.hasOwnProperty.call(data.checks, id)) el.checked = data.checks[id] === "1";
      });
    }
    var rows = data.team || [];
    for (var i = 1; i <= 4; i++) {
      var row = rows[i - 1] || { n: "", r: "", e: "", w: "" };
      ["n", "r", "e", "w"].forEach(function (part) {
        var cell = document.querySelector('[data-k="t' + i + part + '"]');
        if (cell) cell.textContent = row[part] || "";
      });
    }
  }

  var api = { splitCanvas: splitCanvas, read: read, apply: apply };
  root.CanvasPdf = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
