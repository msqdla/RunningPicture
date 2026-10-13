/* =========================================================
 * 跑步打卡日签生成器 · 截图识别 + 卡片渲染
 * 纯静态、无后端。OCR 使用 tesseract.js（本地语言包）
 * ========================================================= */
(function () {
  "use strict";

  const QUOTES = [
    ["出发", "永远是最有意义的事"],
    ["自律", "给我自由"],
    ["每一步", "都算数"],
    ["跑过的路", "不会辜负你"],
    ["坚持", "是世界上最酷的事"],
    ["今天流的汗", "是明天的光"],
    ["不必赶路", "感受路"],
    ["风很温柔", "跑步的人更自由"],
    ["日复一日", "终会见光"],
    ["跑步是与自己的对话", "坚持下去"],
    ["没有奇迹", "只有努力的轨迹"],
    ["早起的人", "都在偷偷变强"]
  ];

  const $ = (id) => document.getElementById(id);
  const cv = $("cv");
  const ctx = cv.getContext("2d");

  let ratio = "34";      // 34 -> 810x1080 ; 916 -> 810x1440
  let bgImg = null;      // 自定义背景图
  let shotImg = null;    // 用户上传的跑步截图
  let bgStyle = "night"; // 苹果风纯色方案
  let busy = false;

  // 苹果风配色（纯色 + 极轻的径向光晕，克制、大气）
  const BACKGROUNDS = {
    night:    { name: "深空", top: "#1c1c1e", bottom: "#000000", light: false },
    graphite: { name: "石墨", top: "#4a4a4f", bottom: "#252528", light: false },
    silver:   { name: "月银", top: "#ececf1", bottom: "#c2c2cb", light: true  },
    ocean:    { name: "深海", top: "#1d3a5f", bottom: "#0a1622", light: false },
    mist:     { name: "晨雾", top: "#e3ebf0", bottom: "#aebfca", light: true  },
    ink:      { name: "墨黑", top: "#2b2b30", bottom: "#0e0e10", light: false }
  };

  // ---------- 初始化 ----------
  const today = new Date();
  $("date").value = today.toISOString().slice(0, 10);
  $("quote").value = QUOTES[0].join("\n");

  // ---------- 渲染卡片 ----------
  // 苹果风背景：柔和线性渐变 + 顶部极淡光晕，无具象山影
  function drawDefaultBg(c, style) {
    const w = Number(c.canvas.width) || 810;
    const h = Number(c.canvas.height) || 1080;
    const cfg = BACKGROUNDS[style] || BACKGROUNDS.night;

    const g = c.createLinearGradient(0, 0, w * 0.35, h);
    g.addColorStop(0, cfg.top);
    g.addColorStop(1, cfg.bottom);
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);

    // 顶部柔光（模拟环境光，增强层次但不抢主体）
    const rg = c.createRadialGradient(w * 0.78, h * 0.06, 0, w * 0.78, h * 0.06, h * 0.62);
    if (cfg.light) {
      rg.addColorStop(0, "rgba(255,255,255,0.75)");
      rg.addColorStop(1, "rgba(255,255,255,0)");
    } else {
      rg.addColorStop(0, "rgba(255,255,255,0.10)");
      rg.addColorStop(1, "rgba(255,255,255,0)");
    }
    c.fillStyle = rg;
    c.fillRect(0, 0, w, h);
  }

  // 根据背景明暗决定文字主色
  function theme(cfg) {
    return cfg && cfg.light
      ? { main: "#1d1d1f", sub: "rgba(29,29,31,0.62)", line: "rgba(0,0,0,0.10)" }
      : { main: "#ffffff", sub: "rgba(255,255,255,0.66)", line: "rgba(255,255,255,0.14)" };
  }

  function getInputs() {
    const dv = $("date").value ? new Date($("date").value + "T00:00:00") : new Date();
    const mm = String(dv.getMonth() + 1).padStart(2, "0");
    const dd = String(dv.getDate()).padStart(2, "0");
    const wd = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][dv.getDay()];

    // 天数模式：跑步第 N 天 / 倒计时第 N 天
    const mode = $("dayMode").value;
    let dayNum = $("runDays").value || "1";
    let dayPrefix = "这是我在悦跑圈的第 ";
    if (mode === "countdown") {
      const tv = $("targetDate").value;
      if (tv) {
        const t = new Date(tv + "T00:00:00");
        const diff = Math.round((t - dv) / 86400000);
        dayNum = Math.abs(diff);
        dayPrefix = "距离目标还有 ";
      } else {
        dayNum = $("runDays").value || "0";
        dayPrefix = "距离目标还有 ";
      }
    }

    return {
      dateStr: mm + "." + dd,
      weekday: wd,
      name: $("name").value || "跑者",
      dayNum: dayNum,
      dayPrefix: dayPrefix,
      dayUnit: mode === "countdown" ? " 天" : " 天",
      appName: $("appName").value || "",
      km: $("km").value || "0.00",
      kcal: $("kcal").value || "0",
      duration: $("duration").value || "--",
      pace: ($("pace").value || "--"),
      hr: $("hr").value || "--",
      cadence: $("cadence").value || "--",
      elev: $("elev").value || "--",
      power: $("power").value || "--",
      accent: $("accentColor").value || "#FA3E5C",
      quoteLines: ($("quote").value || "").split("\n").map(s => s.trim()).filter(Boolean)
    };
  }

  function wrapText(c, text, maxWidth) {
    let lines = [], line = "";
    for (const ch of [...text]) {
      if (c.measureText(line + ch).width > maxWidth && line) { lines.push(line); line = ch; }
      else line += ch;
    }
    if (line) lines.push(line);
    return lines;
  }

  function render() {
    const W = 810;
    const H = ratio === "34" ? 1080 : 1440;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const d = getInputs();
    const FONT = "-apple-system,'SF Pro Display','PingFang SC','Microsoft YaHei',sans-serif";
    const cfg = BACKGROUNDS[bgStyle] || BACKGROUNDS.night;

    // 内容整体垂直排布（9:16 时下方留白更多）
    const padX = 64;

    // ===== 背景 =====
    if (bgImg) {
      const sc = Math.max(W / bgImg.width, H / bgImg.height);
      const dw = bgImg.width * sc, dh = bgImg.height * sc;
      ctx.drawImage(bgImg, (W - dw) / 2, (H - dh) / 2, dw, dh);
      // 轻压暗，保证文字可读
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.fillRect(0, 0, W, H);
      var th = { main: "#fff", sub: "rgba(255,255,255,0.72)", line: "rgba(255,255,255,0.16)" };
    } else {
      drawDefaultBg(ctx, bgStyle);
      th = theme(cfg);
    }

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    // ===== 顶部：日期 + App 名 =====
    const topY = 148;
    ctx.fillStyle = th.main;
    ctx.font = "600 46px " + FONT;
    ctx.fillText(d.dateStr, padX, topY);
    ctx.font = "400 26px " + FONT;
    ctx.fillStyle = th.sub;
    ctx.fillText(d.weekday, padX + ctx.measureText(d.dateStr).width + 210, topY);

    // 右上角 App 名
    ctx.textAlign = "right";
    ctx.font = "500 26px " + FONT;
    ctx.fillStyle = th.sub;
    ctx.fillText(d.appName, W - padX, topY);
    ctx.textAlign = "left";

    // 顶部分隔线（极细，苹果风）
    const lineY = topY + 46;
    ctx.strokeStyle = th.line;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padX, lineY); ctx.lineTo(W - padX, lineY); ctx.stroke();

    // ===== 主数据：公里（巨大、克制）=====
    const kmY = ratio === "34" ? 400 : 520;
    ctx.fillStyle = th.main;
    ctx.font = "700 190px " + FONT;
    const kmText = String(d.km);
    ctx.fillText(kmText, padX - 8, kmY);
    const kmW = ctx.measureText(kmText).width;
    ctx.font = "500 40px " + FONT;
    ctx.fillStyle = th.sub;
    ctx.fillText("公里", padX + kmW + 12, kmY);

    // 副数据行：消耗 / 用时 / 配速
    const subY = kmY + 74;
    const subs = [
      [d.kcal, "大卡"],
      [d.duration, "用时"],
      [d.pace, "配速"]
    ];
    let sx = padX;
    for (const [val, label] of subs) {
      ctx.fillStyle = th.main;
      ctx.font = "700 44px " + FONT;
      ctx.fillText(String(val), sx, subY);
      const w = ctx.measureText(String(val)).width;
      ctx.font = "400 26px " + FONT;
      ctx.fillStyle = th.sub;
      ctx.fillText(label, sx + w + 8, subY - 4);
      sx += Math.max(w + 90, 210);
    }

    // ===== 激励语：位于下三分之一 =====
    const qStart = ratio === "34" ? subY + 168 : subY + 300;
    let qy = qStart;
    ctx.font = "600 56px " + FONT;
    let first = true;
    for (const line of d.quoteLines) {
      ctx.fillStyle = first ? d.accent : th.main;
      for (const wl of wrapText(ctx, line, W - padX * 2)) {
        ctx.fillText(wl, padX, qy);
        qy += 78;
      }
      first = false;
    }

    // ===== 底部：头像 + 昵称 + 天数 =====
    const baseY = ratio === "34" ? H - 148 : H - 190;
    const cx = padX + 42, cy = baseY - 40, r = 42;

    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = d.accent;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = "#fff";
    ctx.font = "600 40px " + FONT;
    ctx.textAlign = "center";
    ctx.fillText(d.name.charAt(0), cx, cy + 14);
    ctx.restore();
    ctx.textAlign = "left";

    ctx.fillStyle = th.main;
    ctx.font = "600 44px " + FONT;
    ctx.fillText(d.name, cx + r + 26, baseY - 54);

    ctx.font = "400 26px " + FONT;
    ctx.fillStyle = th.sub;
    const t1 = d.dayPrefix;
    ctx.fillText(t1, cx + r + 26, baseY - 8);
    const tw = ctx.measureText(t1).width;
    ctx.font = "700 26px " + FONT;
    ctx.fillStyle = d.accent;
    ctx.fillText(d.dayNum, cx + r + 26 + tw, baseY - 8);
    const nw = ctx.measureText(d.dayNum).width;
    ctx.font = "400 26px " + FONT;
    ctx.fillStyle = th.sub;
    ctx.fillText(" 天", cx + r + 26 + tw + nw, baseY - 8);

    // ===== 3:4 底部小数据条（心率 / 步频 / 爬升）=====
    if (ratio === "34") {
      const barY = H - 56;
      ctx.strokeStyle = th.line;
      ctx.beginPath(); ctx.moveTo(padX, barY - 46); ctx.lineTo(W - padX, barY - 46); ctx.stroke();

      const cells = [
        ["心率", d.hr === "--" ? "--" : d.hr + " 次/分"],
        ["步频", d.cadence === "--" ? "--" : d.cadence + " 步/分"],
        ["爬升", d.elev === "--" ? "--" : d.elev + " 米"]
      ];
      const cw = (W - padX * 2) / cells.length;
      cells.forEach(([k, v], i) => {
        const x = padX + cw * i;
        ctx.font = "400 22px " + FONT;
        ctx.fillStyle = th.sub;
        ctx.fillText(k, x, barY - 14);
        ctx.font = "600 28px " + FONT;
        ctx.fillStyle = th.main;
        ctx.fillText(v, x, barY + 22);
      });
    }
  }

  // =========================================================
  // OCR 解析：真实词框 + 坐标列对齐
  // 真实截图结构（已实测）：
  //   标签行 y=529:  体能训练时间@89 .. 距离@601
  //   数值行 y=605:  1:21:58@91  9.30@603  公@771 里@863
  // 即「标签在上、数值在下、x 坐标对齐」
  // =========================================================
  const FIX = { "O": "0", "o": "0", "D": "0", "Q": "0", "l": "1", "I": "1", "|": "1",
                "S": "5", "s": "5", "B": "8", "g": "9", "Z": "2", "z": "2", "A": "4" };

  const norm = (s) => String(s == null ? "" : s)
    .replace(/[\s\u200b-\u200f\ufeff]/g, "");

  function num(s) {
    let t = String(s == null ? "" : s)
      .replace(/[\uFF10-\uFF19]/g, ch => String(ch.charCodeAt(0) - 65296));
    t = t.replace(/(?<![a-zA-Z])[oOQ](?![a-zA-Z])/g, "0");
    t = t.replace(/(?<![a-zA-Z])[lI|](?![a-zA-Z])/g, "1");
    t = t.replace(/(?<![a-zA-Z])S(?![a-zA-Z])/g, "5");
    return t;
  }

  // 词框 → 行（按 y 聚类）
  function groupLines(words) {
    const ws = (words || []).filter(w => w && w.text && w.bbox);
    ws.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
    const lines = [];
    for (const w of ws) {
      const cy = (w.bbox.y0 + w.bbox.y1) / 2;
      const h = Math.max(1, w.bbox.y1 - w.bbox.y0);
      let line = null;
      for (const l of lines) {
        if (Math.abs(l.cy - cy) < Math.max(h, l.h) * 0.6) { line = l; break; }
      }
      if (!line) { line = { cy, h, ws: [] }; lines.push(line); }
      line.ws.push(w);
      line.h = Math.max(line.h, h);
      line.cy = (line.cy * (line.ws.length - 1) + cy) / line.ws.length;
    }
    lines.forEach(l => l.ws.sort((a, b) => a.bbox.x0 - b.bbox.x0));
    lines.sort((a, b) => a.cy - b.cy);
    return lines;
  }

  const itemsOf = (line) => line.ws.map(w => ({
    raw: w.text,
    t: norm(w.text),          // 去空格
    n: num(norm(w.text)),     // 数值修正后
    x0: w.bbox.x0, x1: w.bbox.x1
  }));

  function numsIn(str, min, max) {
    const out = [];
    const re = /\d+(?:[.,]\d+)?/g;
    let m;
    while ((m = re.exec(num(str))) !== null) {
      const v = parseFloat(m[0].replace(",", "."));
      if (!isNaN(v) && v >= min && v <= max) out.push(v);
    }
    return out;
  }

  // 文字降级（无词框时）
  function linesFromText(text) {
    const out = [];
    let y = 0;
    for (const raw of String(text || "").split(/\n/)) {
      const row = raw.trim();
      if (!row) continue;
      y += 30;
      const toks = row.match(
        /\d+(?:[.,:']\d+)*["\u201d]{0,2}(?:\/[A-Za-z\u4e00-\u9fa5]{0,2})?|[A-Za-z]+|[\u4e00-\u9fa5]+/g
      ) || [row];
      const ws = []; let x = 0;
      for (const tk of toks) {
        let u = 0;
        for (const ch of tk) u += /[\u4e00-\u9fa5]/.test(ch) ? 2 : 1;
        const w = Math.max(20, u * 15);
        ws.push({ text: tk, bbox: { x0: x, y0: y, x1: x + w, y1: y + 20 } });
        x += w + 10;
      }
      out.push({ cy: y + 10, h: 20, ws });
    }
    return out;
  }

  // 在「行内」查找标签（支持相邻词块拼接，因为 OCR 会把词组切成单字）
  // 返回 {kStart,kEnd} 或 null
  // 重要：按「跨度从小到大」扫描，保证最短匹配优先
  // 例：体能|训练|时|间|距离 中，「距离」应单独成标签，而不是被拼进左边长串
  function findLabel(items, labelSrc, maxSpan) {
    const re = new RegExp(labelSrc, "i");
    const span = maxSpan || 5;
    for (let width = 1; width <= span; width++) {
      for (let k = 0; k + width <= items.length; k++) {
        let acc = "";
        for (let j = k; j < k + width; j++) acc += items[j].t;
        if (re.test(acc)) return { kStart: k, kEnd: k + width - 1, text: acc };
      }
    }
    return null;
  }

  // 主取数：① 标签右侧同列 ② 下一行同列 ③ 标签块内
  function valueFor(lines, labelSrc, min, max) {
    for (let i = 0; i < lines.length; i++) {
      const items = itemsOf(lines[i]);
      const lab = findLabel(items, labelSrc);
      if (!lab) continue;
      const rowW = Math.max(...items.map(o => o.x1), 1);
      const a = items[lab.kStart], b = items[lab.kEnd];
      const relA = a.x0 / rowW, relB = b.x1 / rowW;

      // ① 标签同行右侧的数值
      for (let j = lab.kEnd + 1; j < items.length; j++) {
        if (/\d/.test(items[j].n)) {
          const vs = numsIn(items[j].n, min, max);
          if (vs.length) return vs[0];
        }
      }
      // ② 下方 1~2 行，取 x 与该标签列最接近的数值
      for (let d = 1; d <= 2 && i + d < lines.length; d++) {
        const next = itemsOf(lines[i + d]).filter(o => /\d/.test(o.n));
        if (!next.length) continue;
        const nW = Math.max(...itemsOf(lines[i + d]).map(o => o.x1), 1);
        let best = null;
        for (const o of next) {
          const r = o.x0 / nW;
          const diff = Math.min(Math.abs(r - relA), Math.abs(r - relB));
          if (!best || diff < best.diff) best = { diff, o };
        }
        if (best && best.diff <= 0.30) {
          const vs = numsIn(best.o.n, min, max);
          if (vs.length) return vs[0];
        }
      }
    }
    return null;
  }

  // 标签正下方同列、且形如 x.xx 的数值（跑步距离/里程的典型形态）
  // 清洗「21.2]」「9.30公」等尾部噪音，提取纯数值
  function cleanDec(s) {
    const m = String(s).match(/(\d{1,3})[.,](\d{1,3})/);
    if (!m) return null;
    const v = parseFloat(m[1] + "." + m[2]);
    return isNaN(v) ? null : v;
  }

  function rawDecimalUnder(lines, labelSrc) {
    for (let i = 0; i < lines.length; i++) {
      const items = itemsOf(lines[i]);
      const lab = findLabel(items, labelSrc);
      if (!lab) continue;
      const rowW = Math.max(...items.map(o => o.x1), 1);
      const relA = items[lab.kStart].x0 / rowW;
      const relB = items[lab.kEnd].x1 / rowW;
      for (let d = 1; d <= 3 && i + d < lines.length; d++) {
        const all = itemsOf(lines[i + d]);
        const nW = Math.max(...all.map(o => o.x1), 1);
        let best = null;
        for (const o of all) {
          if (!/\d+[.,]\d/.test(o.n)) continue;     // 必须带小数
          const r = o.x0 / nW;
          const diff = Math.min(Math.abs(r - relA), Math.abs(r - relB));
          if (diff > 0.30) continue;
          if (!best || diff < best.diff) best = { diff, text: o.n };
        }
        if (best) {
          const v = cleanDec(best.text);
          if (v !== null && v >= 0.3 && v <= 500) return v;
        }
      }
    }
    return null;
  }

  // 取原始文本（用于配速这种带符号的字段）
  function rawFor(lines, labelSrc) {
    for (let i = 0; i < lines.length; i++) {
      const items = itemsOf(lines[i]);
      const lab = findLabel(items, labelSrc);
      if (!lab) continue;
      const rowW = Math.max(...items.map(o => o.x1), 1);
      const a = items[lab.kStart], b = items[lab.kEnd];
      const relA = a.x0 / rowW, relB = b.x1 / rowW;
      for (let j = lab.kEnd + 1; j < items.length; j++) {
        if (/\d/.test(items[j].n)) return items[j].raw;
      }
      for (let d = 1; d <= 2 && i + d < lines.length; d++) {
        const all = itemsOf(lines[i + d]);
        const next = all.filter(o => /\d/.test(o.n));
        if (!next.length) continue;
        const nW = Math.max(...all.map(o => o.x1), 1);
        let best = null;
        for (const o of next) {
          const r = o.x0 / nW;
          const diff = Math.min(Math.abs(r - relA), Math.abs(r - relB));
          if (!best || diff < best.diff) best = { diff, o };
        }
        if (best && best.diff <= 0.30) return best.o.raw;
      }
    }
    return null;
  }

  // 卡路里：优先「总千卡/总卡」所在列，取该列下方的整数值
  function kcalNearTotal(lines, text) {
    for (let i = 0; i < lines.length; i++) {
      const items = itemsOf(lines[i]);
      const lab = findLabel(items, "总千卡数|总千卡|总卡|total");
      if (!lab) continue;
      // 「总千卡数」位于右半区，其数值应在该列正下方
      const rowW = Math.max(...items.map(o => o.x1), 1);
      const relA = items[lab.kStart].x0 / rowW;
      const relB = items[lab.kEnd].x1 / rowW;
      for (let d = 1; d <= 3 && i + d < lines.length; d++) {
        const all = itemsOf(lines[i + d]);
        const nW = Math.max(...all.map(o => o.x1), 1);
        let best = null;
        for (const o of all) {
          const ints = (o.n.match(/\d{2,5}/g) || []).map(Number)
            .filter(v => v >= 30 && v <= 20000);
          if (!ints.length) continue;
          const r = o.x0 / nW;
          const diff = Math.min(Math.abs(r - relA), Math.abs(r - relB));
          if (diff > 0.30) continue;
          if (!best || diff < best.diff) best = { diff, v: ints[0] };
        }
        if (best) return best.v;
      }
    }
    // 次选：全文「千卡/大卡/kcal」附近的较大值
    const cands = [];
    const pwVal = valueFor(lines, "\u529f\u7387|power", 30, 800);
    const re = /(\d{2,5})\s*(?:千卡|大卡|kcal|卡路里)/gi;
    let m;
    while ((m = re.exec(text)) !== null) cands.push(+m[1]);
    const ok = cands.filter(v => v >= 30 && v <= 20000 && (pwVal === null || v !== pwVal));
    if (ok.length) return Math.max(...ok);
    // 最终兜底：全图 200~20000 的较大值（排除「第 N 天」里的天数）
    const days = (text.match(/第\s*(\d{2,5})\s*天/g) || []).map(x => +(x.match(/\d+/) || [0])[0]);
    const all = (num(text).match(/\b\d{3,5}\b/g) || []).map(Number)
      .filter(v => v >= 200 && v <= 20000 && !days.includes(v));
    if (all.length) return Math.max(...all);
    return null;   // 允许多个字段为空，交由用户手动核对，避免给出错误数值
  }

  const fmtPace = (mm, ss) => mm + "'" + String(ss).padStart(2, "0") + '"';

  // 配速原文 → x'xx"（兼容 ”849'"/、8'49"、8:49、849）
  function toPace(v) {
    if (v == null) return null;
    let s = String(v)
      .replace(/[\u201c\u201d\u2018\u2019\u02bc\u02ba"]/g, "'")  // 各类引号 → 单引号
      .replace(/[^0-9':.]/g, "")
      .replace(/^'+/, "")        // 去掉开头的引号（OCR 噪音）
      .replace(/'{2,}/g, "'");   // 连续引号合并
    let m = s.match(/^(\d{1,2})(\d{2})'/);        // 849' -> 8'49
    if (m) { const a = +m[1], b = +m[2]; if (a >= 2 && a <= 30 && b <= 59) return fmtPace(a, b); }
    m = s.match(/(\d{1,2})'(\d{1,2})/);           // 8'49
    if (m) { const a = +m[1], b = +m[2]; if (a >= 2 && a <= 30 && b <= 59) return fmtPace(a, b); }
    m = s.match(/(\d{1,2}):([0-5]\d)/);           // 8:49
    if (m) { const a = +m[1], b = +m[2]; if (a >= 2 && a <= 30) return fmtPace(a, b); }
    let n = parseFloat(s);
    if (!isNaN(n)) {
      if (n >= 100) n = n / 100;
      const a = Math.floor(n), b = Math.round((n - a) * 100);
      if (a >= 2 && a <= 30 && b <= 59) return fmtPace(a, b);
    }
    return null;
  }

  function parseRunData(raw, words) {
    const text = String(raw || "").replace(/\r/g, "");
    let lines = groupLines(words);
    if (!lines.length) lines = linesFromText(text);
    const R = {};

    // 距离：优先「距离」标签正下方同列的带小数数值（最可靠）
    R.km = rawDecimalUnder(lines, "\u8ddd\u79bb");
    if (R.km === null) R.km = valueFor(lines, "\u8ddd\u79bb", 0.3, 500);
    if (R.km === null) R.km = valueFor(lines, "distance", 0.3, 500);
    if (R.km === null) {
      const dec = (num(text).match(/\d{1,3}[.,]\d{1,2}/g) || [])
        .map(x => parseFloat(x.replace(",", "."))).filter(v => v >= 1 && v <= 300);
      if (dec.length) R.km = Math.max(...dec);
    }

    // 用时：时:分:秒 优先
    let dm = text.match(/(\d{1,2}):([0-5]\d):([0-5]\d)/);
    if (dm) R.duration = dm[0];
    else {
      dm = text.match(/(?:\u7528\u65f6|\u65f6\u957f|duration)[\s\S]{0,20}?(\d{1,3}):([0-5]\d)/i);
      if (dm && +dm[1] >= 3) R.duration = dm[1] + ":" + dm[2];
    }

    // 配速：优先平均配速，退回配速（排除分段表）
    let praw = rawFor(lines, "\u5e73\u5747\u914d\u901f");
    if (!praw) praw = rawFor(lines, "avg\\\\s*pace");
    if (!praw) praw = rawFor(lines, "\u914d\u901f");
    if (praw) R.pace = toPace(praw);
    if (!R.pace) {
      const pm = text.match(/(\d{1,2})\s*['\u2019]\s*([0-5]\d)\s*"/);
      if (pm) { const a = +pm[1], b = +pm[2]; if (a >= 2 && a <= 30) R.pace = fmtPace(a, b); }
    }

    // 卡路里：优先「总千卡数」列取数
    R.kcal = kcalNearTotal(lines, text);
    // 可疑值剔除：卡路里与功率完全相同，多半是把「瓦」当成了「千卡」
    if (R.kcal !== null) {
      const pwChk = valueFor(lines, "\u529f\u7387|power", 30, 800);
      if (pwChk !== null && R.kcal === pwChk) R.kcal = null;
    }

    // 心率
    R.hr = valueFor(lines, "\u5fc3\u7387", 60, 230);
    if (R.hr === null) {
      const m = text.match(/(\d{2,3})\s*\u6b21\s*\/?\s*\u5206/);
      if (m && +m[1] >= 60 && +m[1] <= 230) R.hr = +m[1];
    }

    // 步频
    R.cadence = valueFor(lines, "\u6b65\u9891", 100, 220);
    if (R.cadence === null) {
      const m = text.match(/(\d{3})\s*\u6b65/);
      if (m && +m[1] >= 100 && +m[1] <= 220) R.cadence = +m[1];
    }

    // 爬升
    R.elev = valueFor(lines, "\u722c\u5347|\u758f\u5347|\u4e0a\u5347|elevation|\belev\b", 1, 5000);

    // 功率
    R.power = valueFor(lines, "\u529f\u7387|power", 30, 800);

    // 日期
    let d2 = text.match(/(\d{4})\s*[\u5e74\/-]\s*(\d{1,2})\s*[\u6708\/-]\s*(\d{1,2})/);
    if (d2) {
      R.date = d2[1] + "-" + String(+d2[2]).padStart(2, "0") + "-" + String(+d2[3]).padStart(2, "0");
    } else {
      d2 = text.match(/(\d{1,2})\s*\u6708\s*(\d{1,2})\s*\u65e5/) ||
           num(text).match(/(\d{1,2})\u6708(\d{1,2})\u65e5/);
      if (d2) {
        R.date = new Date().getFullYear() + "-" +
                 String(+d2[1]).padStart(2, "0") + "-" + String(+d2[2]).padStart(2, "0");
      }
    }

    // 清洗
    const r1 = v => (v == null || isNaN(v) ? null : Math.round(v * 100) / 100);
    R.km = r1(R.km); R.kcal = r1(R.kcal); R.hr = R.hr ? Math.round(R.hr) : null;
    R.cadence = R.cadence ? Math.round(R.cadence) : null;
    R.elev = R.elev ? Math.round(R.elev) : null;
    R.power = R.power ? Math.round(R.power) : null;
    if (R.km !== null && R.km < 0.3) R.km = null;
    return R;
  }

  // ---- tesseract.js 调用 ----
  let worker = null;

  async function getWorker(onProgress) {
    if (worker) return worker;
    const w = await Tesseract.createWorker(["chi_sim", "eng"], 1, {
      workerPath: "worker.min.js",
      corePath: "tesseract-core-simd.wasm.js",
      langPath: "tessdata",
      gzip: true,
      logger: (m) => { if (onProgress && m.status) onProgress(m); }
    });
    worker = w;
    return w;
  }

  async function ocrImage(img, onProgress) {
    const w = await getWorker(onProgress);
    // 放大 + 反色（深色截图 → 白底黑字）+ 二值化，提升小字与彩色数字的识别率
    const scale = Math.min(2.4, 2600 / Math.max(img.width, img.height));
    const oc = document.createElement("canvas");
    oc.width = Math.round(img.width * scale);
    oc.height = Math.round(img.height * scale);
    const ocx = oc.getContext("2d");
    ocx.filter = "invert(1) grayscale(1) contrast(2.2) brightness(1.12)";
    ocx.drawImage(img, 0, 0, oc.width, oc.height);
    // 自适应阈值二值化：把彩色/低对比小字变成纯黑白
    try {
      const id = ocx.getImageData(0, 0, oc.width, oc.height);
      const d = id.data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i];
      const mean = sum / (d.length / 4);
      const th = Math.min(200, Math.max(90, mean * 0.92));
      for (let i = 0; i < d.length; i += 4) {
        const v = d[i] > th ? 255 : 0;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      ocx.putImageData(id, 0, 0);
    } catch (e) { /* 忽略跨域限制 */ }
    const url = oc.toDataURL("image/png");
    const res = await w.recognize(url, {}, { text: true, blocks: true, hocr: false });
    const data = (res && res.data) || {};

    // 提取真正的「词级」框：tesseract.js 的 words 常为符号级，这里遍历
    // blocks → paragraphs → lines → words 取词级；同时保留 lines 便于兜底
    const words = [];
    const lines = [];
    const pushWord = (t, bbox) => {
      if (!t || !bbox) return;
      words.push({ text: t, bbox: { x0: bbox.x0, y0: bbox.y0, x1: bbox.x1, y1: bbox.y1 } });
    };
    (data.blocks || []).forEach(blk =>
      (blk.paragraphs || []).forEach(par =>
        (par.lines || []).forEach(ln => {
          const lw = [];
          (ln.words || []).forEach(wd => {
            pushWord(wd.text, wd.bbox);
            lw.push({ text: wd.text, bbox: wd.bbox });
          });
          if (lw.length) lines.push({ text: ln.text, words: lw });
        })
      )
    );
    // 没有块信息时退回 words / symbols
    if (!words.length) {
      (data.words || data.symbols || []).forEach(wd => pushWord(wd.text, wd.bbox));
    }

    return { text: data.text || "", words, lines };
  }

  // ---- 写入表单 ----
  function setField(id, value, isText) {
    if (value === null || value === undefined || value === "") return false;
    const el = $(id);
    el.value = String(value);
    el.classList.add("filled");
    return true;
  }

  function applyParsed(p, logEl) {
    const hits = [];
    if (setField("km", p.km !== null ? Number(p.km).toFixed(2) : null)) hits.push("距离 " + p.km + " 公里");
    if (setField("kcal", p.kcal)) hits.push("消耗 " + p.kcal + " 大卡");
    if (setField("duration", p.duration)) hits.push("用时 " + p.duration);
    if (setField("pace", p.pace)) hits.push("配速 " + p.pace);
    if (setField("hr", p.hr)) hits.push("心率 " + p.hr);
    if (setField("cadence", p.cadence)) hits.push("步频 " + p.cadence);
    if (setField("elev", p.elev)) hits.push("爬升 " + p.elev);
    if (setField("power", p.power)) hits.push("功率 " + p.power);
    if (setField("date", p.date)) hits.push("日期 " + p.date);

    const missing = ["km", "kcal", "duration", "pace", "hr", "cadence", "elev", "power", "date"]
      .filter(id => !$(id).classList.contains("filled"));
    const names = { km: "距离", kcal: "消耗", duration: "用时", pace: "配速",
                    hr: "心率", cadence: "步频", elev: "爬升", power: "功率", date: "日期" };

    let html = "✅ 识别到：" + (hits.length ? hits.join(" · ") : "无");
    if (missing.length) html += "\n\n⚠️ 未识别到（请手动填写）：" + missing.map(m => names[m]).join("、");
    html += "\n\n提示：识别结果已用黄框标出，请核对后再导出。";
    logEl.innerHTML = html;
  }

  async function handleShot(file) {
    if (busy) return;
    busy = true;
    const status = $("ocrStatus"), txt = $("ocrText"), log = $("ocrLog");
    status.hidden = false; log.hidden = true;
    txt.textContent = "正在识别中…（首次加载语言包约需几秒）";

    try {
      const url = URL.createObjectURL(file);
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = url;
      });
      shotImg = img;
      const thumb = $("shotThumb");
      thumb.src = url; thumb.hidden = false;

      const ocr = await ocrImage(img, (m) => {
        if (m.status === "recognizing text") {
          txt.textContent = "正在识别中… " + Math.round((m.progress || 0) * 100) + "%";
        } else if (m.status) {
          txt.textContent = "加载识别引擎：" + m.status;
        }
      });

      const text = ocr.text;
      let words = (ocr.words && ocr.words.length) ? ocr.words : null;

      console.log("=== OCR RAW ===\n" + text);
      window.__lastWords = words;
      window.__lastOCR = { text: text, words: words };
      const parsed = parseRunData(text, words);
      console.log("=== PARSED ===", parsed, "words:", words ? words.length : 0);
      log.hidden = false;
      applyParsed(parsed, log);
      render();
      txt.textContent = "识别完成";
      setTimeout(() => { status.hidden = true; }, 1200);
    } catch (e) {
      console.error(e);
      log.hidden = false;
      log.textContent = "识别失败：" + e.message + "\n可手动填写数据后导出。";
      status.hidden = true;
    } finally {
      busy = false;
    }
  }

  // =========================================================
  // 事件绑定
  // =========================================================
  document.querySelectorAll(".tab").forEach(t => {
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
      t.classList.add("active");
      ratio = t.dataset.ratio;
      render();
    });
  });

  ["date","name","runDays","appName","km","kcal","duration","pace","hr","cadence","elev","power","quote","accentColor","targetDate"]
    .forEach(id => $(id).addEventListener("input", render));

  // 天数模式切换
  $("dayMode").addEventListener("change", () => {
    const isRun = $("dayMode").value === "run";
    $("runDaysBox").hidden = !isRun;
    $("countdownBox").hidden = isRun;
    if (!isRun && !$("targetDate").value) {
      // 默认目标日期：约 3 个月后，方便直接看效果
      const t = new Date(); t.setDate(t.getDate() + 100);
      $("targetDate").value = t.toISOString().slice(0, 10);
    }
    render();
  });

  // 背景色板
  document.querySelectorAll(".sw").forEach(sw => {
    sw.addEventListener("click", () => {
      document.querySelectorAll(".sw").forEach(x => x.classList.remove("active"));
      sw.classList.add("active");
      bgStyle = sw.dataset.bg;
      bgImg = null;          // 选纯色时清掉自定义图
      render();
    });
  });

  // 上传交互
  const drop = $("drop"), fileInput = $("shotFile");
  drop.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", e => { if (e.target.files[0]) handleShot(e.target.files[0]); });
  ["dragenter","dragover"].forEach(ev => drop.addEventListener(ev, e => {
    e.preventDefault(); drop.classList.add("over");
  }));
  ["dragleave","drop"].forEach(ev => drop.addEventListener(ev, e => {
    e.preventDefault(); drop.classList.remove("over");
  }));
  drop.addEventListener("drop", e => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && /^image\//.test(f.type)) handleShot(f);
  });
  window.addEventListener("paste", e => {
    const items = (e.clipboardData || {}).items || [];
    for (const it of items) {
      if (it.type && it.type.indexOf("image") === 0) {
        const f = it.getAsFile();
        if (f) { handleShot(f); break; }
      }
    }
  });

  $("reOcr").addEventListener("click", () => {
    if (fileInput.files && fileInput.files[0]) handleShot(fileInput.files[0]);
    else alert("请先上传一张跑步记录截图");
  });

  $("clearAll").addEventListener("click", () => {
    ["km","kcal","duration","pace","hr","cadence","elev","power"].forEach(id => {
      $(id).value = ""; $(id).classList.remove("filled");
    });
    $("ocrLog").hidden = true;
    render();
  });

  $("randomQuote").addEventListener("click", () => {
    $("quote").value = QUOTES[Math.floor(Math.random() * QUOTES.length)].join("\n");
    render();
  });

  $("bgFile").addEventListener("change", e => {
    const f = e.target.files[0];
    if (!f) return;
    const u = URL.createObjectURL(f);
    const i = new Image();
    i.onload = () => { bgImg = i; render(); };
    i.src = u;
  });
  $("useShot").addEventListener("click", () => {
    if (!shotImg) return alert("请先上传一张跑步记录截图");
    bgImg = shotImg; render();
  });

  function download() {
    render();
    const d = getInputs();
    const a = document.createElement("a");
    a.download = "跑步打卡_" + d.dateStr.replace(".", "") + (ratio === "34" ? "_3x4" : "_9x16") + ".png";
    a.href = cv.toDataURL("image/png");
    a.click();
  }
  $("dl34").addEventListener("click", () => { ratio = "34"; document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active", x.dataset.ratio==="34")); download(); });
  $("dl916").addEventListener("click", () => { ratio = "916"; document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active", x.dataset.ratio==="916")); download(); });

  // 暴露给自动化测试
  window.__card = { render, parseRunData, getInputs };

  render();
})();
