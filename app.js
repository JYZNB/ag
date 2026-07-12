const $ = (id) => document.getElementById(id);
const STORAGE = "taishan-fusion-watch-v1";
let snapshot = null;

const n = (v) => Number.isFinite(Number(v)) ? Number(v) : NaN;
const pct = (v) => Number.isFinite(n(v)) ? `${n(v) >= 0 ? "+" : ""}${(n(v) * 100).toFixed(2)}%` : "--";
const rawPct = (v) => Number.isFinite(n(v)) ? `${n(v) >= 0 ? "+" : ""}${n(v).toFixed(2)}%` : "--";
const num = (v) => Number.isFinite(n(v)) ? n(v).toFixed(2) : "--";
const text = (v, d = "--") => v === undefined || v === null || v === "" ? d : String(v);
const getWatch = () => { try { return JSON.parse(localStorage.getItem(STORAGE) || "[]"); } catch { return []; } };
const saveWatch = (items) => localStorage.setItem(STORAGE, JSON.stringify(items));
const sourceCandidates = () => snapshot?.momentumQuality?.candidates || [];

function researchScore(row) {
  const base = n(row.quality_score) * .36 + n(row.risk_control_score) * .22 + n(row.trend_template_score) * .14 + n(row.stage_score) * .10 + n(row.sector_rotation_score) * .12 + n(row.relay_score) * .06;
  const extendedPenalty = Math.max(0, n(row.ma20_gap) - .12) * 85;
  const drawdownPenalty = Math.max(0, Math.abs(n(row.drawdown20)) - .10) * 28;
  return base - extendedPenalty - drawdownPenalty;
}

function candidates() {
  const ranked = sourceCandidates()
    .map((row) => ({ ...row, research_score: researchScore(row) }))
    .sort((a, b) => n(b.research_score) - n(a.research_score));
  return ranked.map((row, index) => ({
    ...row,
    rank: index + 1,
    _tier: index < 4 && n(row.research_score) >= 83 ? 1 : index < 12 && n(row.research_score) >= 75 ? 2 : 3,
  }));
}

const tier = (row) => row._tier || 3;
const tierText = (value) => value === 1 ? "一级研究关注" : value === 2 ? "二级等确认" : "三级观察";

function levelReason(row) {
  const extension = n(row.ma20_gap);
  const extensionText = Number.isFinite(extension) ? `距20日线 ${pct(extension)}` : "均线偏离待补";
  const chase = extension > .12 ? "偏离偏大，不追高" : "价格仍在合理观察区";
  return `趋势 ${num(row.trend_template_score)} / 板块 ${num(row.sector_rotation_score)} / 风控 ${num(row.risk_control_score)}；${extensionText}，${chase}`;
}

function metric(check, id) {
  const qfq = check?.qfq || {};
  const raw = check?.tdxRaw || {};
  $(id).textContent = pct(qfq.avgReturn);
  $(`${id}sub`).textContent = `前复权胜率 ${pct(qfq.winRate)} / 通达信胜率 ${pct(raw.winRate)}`;
}

function daysSince(value) {
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000));
}

function watchRows() {
  const byCode = new Map(candidates().map((row) => [String(row.code).padStart(6, "0"), row]));
  return getWatch().map((item) => ({ ...item, latest: byCode.get(item.code) || null }));
}

function renderWatch() {
  const rows = watchRows();
  const root = $("watchList");
  if (!rows.length) {
    root.innerHTML = '<div class="watch-empty">点击候选行的“加入观察”后，会记录加入时间、加入价、加入前历史趋势与后续快照表现。</div>';
    return;
  }

  root.innerHTML = rows.map((item) => {
    const now = n(item.latest?.close);
    const price = Number.isFinite(now) ? now : n(item.addedPrice);
    const ret = Number.isFinite(price) && n(item.addedPrice) > 0 ? price / n(item.addedPrice) - 1 : NaN;
    const days = daysSince(item.addedAt);
    const stages = [3, 5, 7].map((day) => `<i class="${days >= day ? "done" : days >= (day - 1) ? "current" : ""}"></i>`).join("");
    return `<article class="watch-card"><header><div><strong>${text(item.name)}</strong><small>${item.code} / 加入 ${new Date(item.addedAt).toLocaleDateString("zh-CN")}</small></div><button class="remove-watch" data-code="${item.code}" title="移出观察">×</button></header><div class="watch-metrics"><div><small>加入前 20 日</small><b class="${n(item.historicalTrend) >= 0 ? "up" : "down"}">${pct(item.historicalTrend)}</b></div><div><small>加入后跟踪</small><b class="${n(ret) >= 0 ? "up" : "down"}">${pct(ret)}</b></div></div><div class="watch-return ${n(ret) >= 0 ? "up" : "down"}">第 ${days} 天 / 最新快照 ${num(price)}</div><div class="timeline" title="3、5、7日观察节点">${stages}</div></article>`;
  }).join("");

  document.querySelectorAll(".remove-watch").forEach((button) => {
    button.onclick = () => {
      saveWatch(getWatch().filter((item) => item.code !== button.dataset.code));
      renderWatch();
      renderCandidates();
    };
  });
}

function addWatch(code) {
  const row = candidates().find((candidate) => String(candidate.code).padStart(6, "0") === code);
  if (!row) return;
  const items = getWatch();
  if (!items.some((item) => item.code === code)) {
    items.unshift({
      code,
      name: row.name,
      sector: row.sector,
      addedAt: new Date().toISOString(),
      addedPrice: n(row.close),
      historicalTrend: n(row.ret20),
    });
    saveWatch(items);
  }
  renderWatch();
  renderFocus(candidates());
  renderCandidates();
}

function renderFocus(rows) {
  const root = $("tierOne");
  const top = rows.filter((row) => tier(row) === 1);
  const watched = new Set(getWatch().map((item) => item.code));
  root.innerHTML = top.map((row) => { const code = String(row.code).padStart(6, "0"); return `<article class="focus-card"><span class="tier-label t1">一级研究关注 / 排名 ${row.rank}</span><h3>${text(row.name)} <small>${text(row.code)}</small></h3><p>${text(row.sector)} / 综合 ${num(row.research_score)}</p><p>${levelReason(row)}</p><p>观察区 ${num(row.entry_low)} - ${num(row.entry_high)} / 风险 ${num(row.risk_line)}</p><button class="watch-add" data-code="${code}" ${watched.has(code) ? "disabled" : ""}>${watched.has(code) ? "✓ 已观察" : "✓ 加入观察"}</button></article>`; }).join("") || "<p>当前没有达到一级研究关注门槛的样本，不强行凑数。</p>";
  document.querySelectorAll("#tierOne .watch-add:not([disabled])").forEach((button) => {
    button.onclick = () => addWatch(button.dataset.code);
  });
}

function renderCandidates() {
  const rows = candidates();
  const watched = new Set(getWatch().map((item) => item.code));
  $("candidateCount").textContent = `${rows.length} 只研究观察`;
  $("candidateRows").innerHTML = rows.slice(0, 28).map((row) => {
    const code = String(row.code).padStart(6, "0");
    const value = tier(row);
    return `<tr><td><span class="tier-label t${value}">${tierText(value)}<small>排名 ${row.rank}</small></span></td><td><strong>${text(row.name)}</strong><small>${code} / ${text(row.sector)}</small></td><td>${num(row.research_score)}</td><td class="analysis-copy">${levelReason(row)}</td><td>${num(row.close)}</td><td>${num(row.entry_low)} - ${num(row.entry_high)}</td><td>${num(row.risk_line)}</td><td>5日 ${pct(row.ret5)}<small>20日 ${pct(row.ret20)}</small></td><td><button class="watch-add" data-code="${code}" ${watched.has(code) ? "disabled" : ""}>${watched.has(code) ? "✓ 已观察" : "✓ 加入"}</button></td></tr>`;
  }).join("") || '<tr><td colspan="9">当前没有符合过滤条件的研究观察样本。</td></tr>';

  document.querySelectorAll("#candidateRows .watch-add:not([disabled])").forEach((button) => {
    button.onclick = () => addWatch(button.dataset.code);
  });
}

function render(data) {
  snapshot = data;
  const fusion = data.fusionModelV73 || {};
  const selected = fusion.selectedResearchCore;
  const market = data.market || {};
  const generatedAt = data.generatedAt ? new Date(data.generatedAt).toLocaleString("zh-CN") : "--";

  $("sideSnapshot").textContent = data.generatedAt ? `快照 ${generatedAt}` : "等待快照";
  $("updatedAt").textContent = generatedAt;
  $("coreStatus").textContent = selected ? "双样本研究通过" : "等待双样本验证";
  $("coreTitle").textContent = selected === "V50_momentum_quality" ? "趋势质量融合模型" : "暂无可用融合核心";
  $("coreSummary").textContent = fusion.summary || "等待融合验证";
  $("formalStatus").textContent = fusion.formalPromotion ? "已晋级" : "研究观察";
  $("dataEnd").textContent = text(data.dataReadiness?.history?.latestDate || data.latestDate);

  const coreRow = (fusion.rows || []).find((row) => row.layer === selected);
  const checks = coreRow?.checks || [];
  metric(checks.find((check) => check.horizon === 3), "m3");
  metric(checks.find((check) => check.horizon === 5), "m5");
  metric(checks.find((check) => check.horizon === 7), "m7");

  const broad = n(market.up_ratio);
  const median = n(market.median_pct);
  $("marketStatus").textContent = broad >= .60 && median >= 0 ? "环境偏强" : broad >= .45 ? "环境中性" : "环境偏弱";
  $("marketSub").textContent = `上涨比 ${pct(broad)} / 中位涨幅 ${rawPct(median)}`;
  $("dataNote").textContent = data.publicMirrorNotice || "本页面仅展示经发布的研究快照。";

  const rows = candidates();
  renderFocus(rows);
  renderCandidates();
  renderWatch();
}

async function load() {
  try {
    const response = await fetch(`./snapshot.json?t=${Date.now()}`, { cache: "no-store" });
    render(await response.json());
  } catch (error) {
    $("coreTitle").textContent = "快照读取失败";
    $("coreSummary").textContent = error.message;
  }
}

$("refreshNow").onclick = load;
$("clearWatch").onclick = () => {
  if (confirm("清空本机浏览器中的观察栏？")) {
    saveWatch([]);
    renderWatch();
    renderCandidates();
  }
};

load();
setInterval(load, 60000);
