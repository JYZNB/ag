const FIELDS = "ts_code,name,pre_close,open,high,low,close,vol,amount,num";

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
    },
  });
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeCode(tsCode) {
  return String(tsCode || "").replace(".SH", "").replace(".SZ", "").replace(".BJ", "").padStart(6, "0");
}

function toTsCode(code) {
  const c = normalizeCode(code);
  if (c.startsWith("6")) return `${c}.SH`;
  if (c.startsWith("8") || c.startsWith("4") || c.startsWith("9")) return `${c}.BJ`;
  return `${c}.SZ`;
}

function isMainboard(code, name) {
  const c = normalizeCode(code);
  if (String(name || "").toUpperCase().includes("ST")) return false;
  if (c.startsWith("300") || c.startsWith("301") || c.startsWith("688") || c.startsWith("689")) return false;
  if (c.startsWith("8") || c.startsWith("4") || c.startsWith("9")) return false;
  return c.startsWith("600") || c.startsWith("601") || c.startsWith("603") || c.startsWith("605") || c.startsWith("000") || c.startsWith("001") || c.startsWith("002") || c.startsWith("003");
}

function rowsFromTushare(payload) {
  const fields = payload?.data?.fields || [];
  const items = payload?.data?.items || [];
  return items.map((item) => {
    const row = {};
    fields.forEach((field, index) => {
      row[field] = item[index];
    });
    const code = normalizeCode(row.ts_code);
    const close = toNumber(row.close);
    const preClose = toNumber(row.pre_close);
    const pct = preClose > 0 ? (close / preClose - 1) * 100 : 0;
    return {
      code,
      name: String(row.name || ""),
      close,
      pct,
      amount: toNumber(row.amount),
      num: toNumber(row.num),
      high: toNumber(row.high),
      low: toNumber(row.low),
      open: toNumber(row.open),
    };
  }).filter((row) => row.close > 0 && isMainboard(row.code, row.name));
}

function uniqueMainboardCodes(value) {
  return [...new Set(String(value || "")
    .split(",")
    .map((code) => normalizeCode(code.trim()))
    .filter((code) => isMainboard(code, "")))]
    .slice(0, 120);
}

async function fetchRtRows(env, tsCode) {
  const response = await fetch("https://api.tushare.pro", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_name: "rt_k",
      token: env.TUSHARE_TOKEN,
      params: { ts_code: tsCode },
      fields: FIELDS,
    }),
  });
  if (!response.ok) throw new Error(`Tushare HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.code && payload.code !== 0) throw new Error(payload.msg || `Tushare code ${payload.code}`);
  return rowsFromTushare(payload);
}

async function market(env) {
  const generatedAt = new Date().toISOString();
  const token = env.TUSHARE_TOKEN;
  if (!token) {
    return json({
      ok: false,
      source: "worker",
      generatedAt,
      message: "TUSHARE_TOKEN 未配置，暂用静态快照。",
      rows: [],
      strongRisers: [],
      limitWatch: [],
    });
  }

  try {
    const rows = await fetchRtRows(env, "6*.SH,0*.SZ");
    const liquid = rows.filter((row) => row.amount >= 80_000_000);
    const strongRisers = liquid
      .filter((row) => row.pct >= 3.5 && row.close >= row.open)
      .sort((a, b) => b.pct - a.pct || b.amount - a.amount)
      .slice(0, 30);
    const limitWatch = liquid
      .filter((row) => row.pct >= 7.0)
      .sort((a, b) => b.pct - a.pct || b.amount - a.amount)
      .slice(0, 30);
    return json({
      ok: true,
      source: "tushare.rt_k",
      generatedAt,
      message: `读取主板实时样本 ${rows.length} 只；强势 ${strongRisers.length} 只。高热度只作监控，不等于追涨买入。`,
      rows: rows.slice(0, 200),
      strongRisers,
      limitWatch,
    });
  } catch (error) {
    return json({
      ok: false,
      source: "tushare.rt_k",
      generatedAt,
      message: error instanceof Error ? error.message : "Tushare 实时读取失败",
      rows: [],
      strongRisers: [],
      limitWatch: [],
    });
  }
}

async function quotes(request, env) {
  const generatedAt = new Date().toISOString();
  if (!env.TUSHARE_TOKEN) {
    return json({
      ok: false,
      source: "worker",
      generatedAt,
      message: "TUSHARE_TOKEN 未配置，无法刷新观察池实时价格。",
      rows: [],
    });
  }
  const url = new URL(request.url);
  const codes = uniqueMainboardCodes(url.searchParams.get("codes"));
  if (!codes.length) {
    return json({
      ok: false,
      source: "worker",
      generatedAt,
      message: "没有可查询的主板代码。",
      rows: [],
    });
  }
  try {
    const rows = await fetchRtRows(env, codes.map(toTsCode).join(","));
    return json({
      ok: true,
      source: "tushare.rt_k",
      generatedAt,
      message: `刷新 ${rows.length}/${codes.length} 只观察对象；只作实时校正，不等于买入指令。`,
      rows,
    });
  } catch (error) {
    return json({
      ok: false,
      source: "tushare.rt_k",
      generatedAt,
      message: error instanceof Error ? error.message : "Tushare 实时刷新失败",
      rows: [],
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/market") return market(env);
    if (url.pathname === "/api/quotes") return quotes(request, env);
    return env.ASSETS.fetch(request);
  },
};
