const $ = (id) => document.getElementById(id);
const WATCH_ONLY_STORAGE = "taishan-fusion-watch-only-v1";
const OWNED_WATCH_STORAGE = "taishan-fusion-owned-watch-v1";
const WATCH_MIGRATION_MARKER = "taishan-fusion-watch-ledgers-v1-migrated";
const LEGACY_WATCH_STORAGES = ["taishan-fusion-watch-v4", "taishan-fusion-watch-v3", "taishan-fusion-watch-v2"];
const VIEWS = {
  overview: { title: "研究总览", subtitle: "融合后的单一模型、候选质量与风险状态。" },
  watch: { title: "未买观察", subtitle: "加入时刷新行情并锁定观察价格，之后只更新现价。" },
  ownedWatch: { title: "已买观察", subtitle: "填写真实成交价格，独立记录买入后的价格变化。" },
  history: { title: "历史候选库", subtitle: "按研究日期回看候选与已获得的后验记录。" },
  holdings: { title: "我的持仓", subtitle: "公开持仓研究快照与风险复核记录。" },
};

let snapshot = null;
let historyIndex = [];
let historyData = null;
let historySort = "post";

const n = (value) => Number.isFinite(Number(value)) ? Number(value) : NaN;
const safe = (value) => Number.isFinite(n(value)) ? n(value) : 0;
const pct = (value) => Number.isFinite(n(value)) ? `${n(value) >= 0 ? "+" : ""}${(n(value) * 100).toFixed(2)}%` : "--";
const rawPct = (value) => Number.isFinite(n(value)) ? `${n(value) >= 0 ? "+" : ""}${n(value).toFixed(2)}%` : "--";
const num = (value) => Number.isFinite(n(value)) ? n(value).toFixed(2) : "--";
const text = (value, fallback = "--") => value === undefined || value === null || value === "" ? fallback : String(value);
const codeOf = (value) => String(value || "").padStart(6, "0");
function normalizeWatch(item = {}) {
  const mode = item.mode === "owned" ? "owned" : "watch";
  const referencePrice = n(item.referencePrice ?? item.addedPrice);
  const fallbackAt = item.addedAt || new Date().toISOString();
  return {
    ...item,
    code: codeOf(item.code),
    mode,
    referencePrice,
    // Keep the old name as an alias so old local records remain compatible.
    addedPrice: referencePrice,
    addedAt: fallbackAt,
    referencePriceAt: item.referencePriceAt || item.boughtAt || item.observedAt || fallbackAt,
    records: Array.isArray(item.records) ? item.records : [],
  };
}

function readWatchRows(key, forcedMode) {
  try {
    const stored = localStorage.getItem(key) || "[]";
    const rows = JSON.parse(stored);
    return Array.isArray(rows)
      ? rows.map((item) => normalizeWatch({ ...item, mode: forcedMode }))
      : [];
  } catch {
    return [];
  }
}

function writeWatchRows(key, rows, forcedMode) {
  localStorage.setItem(
    key,
    JSON.stringify(rows.map((item) => normalizeWatch({ ...item, mode: forcedMode }))),
  );
}

function migrateWatchLedgers() {
  if (localStorage.getItem(WATCH_MIGRATION_MARKER)) return;
  let legacyRows = [];
  for (const key of LEGACY_WATCH_STORAGES) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "[]");
      if (Array.isArray(parsed) && parsed.length) {
        legacyRows = parsed.map(normalizeWatch);
        break;
      }
    } catch {
      // Ignore one malformed legacy key and continue to the next one.
    }
  }
  if (!localStorage.getItem(WATCH_ONLY_STORAGE)) {
    writeWatchRows(WATCH_ONLY_STORAGE, legacyRows.filter((item) => item.mode !== "owned"), "watch");
  }
  if (!localStorage.getItem(OWNED_WATCH_STORAGE)) {
    writeWatchRows(OWNED_WATCH_STORAGE, legacyRows.filter((item) => item.mode === "owned"), "owned");
  }
  LEGACY_WATCH_STORAGES.forEach((key) => localStorage.removeItem(key));
  localStorage.setItem(WATCH_MIGRATION_MARKER, "1");
}

function getWatchOnly() {
  migrateWatchLedgers();
  return readWatchRows(WATCH_ONLY_STORAGE, "watch");
}

function getOwnedWatch() {
  migrateWatchLedgers();
  return readWatchRows(OWNED_WATCH_STORAGE, "owned");
}

function getWatch() {
  return [...getWatchOnly(), ...getOwnedWatch()];
}

function saveWatch(rows) {
  writeWatchRows(WATCH_ONLY_STORAGE, rows.filter((item) => item.mode !== "owned"), "watch");
  writeWatchRows(OWNED_WATCH_STORAGE, rows.filter((item) => item.mode === "owned"), "owned");
}

function clearWatchOnly() {
  writeWatchRows(WATCH_ONLY_STORAGE, [], "watch");
}

function clearOwnedWatch() {
  writeWatchRows(OWNED_WATCH_STORAGE, [], "owned");
}

function watchModeLabel(item) {
  return item.mode === "owned" ? "已买观察" : "未买观察";
}

function candidateSource(data = snapshot) {
  const unified = data?.unifiedSwingModel?.candidates;
  return Array.isArray(unified) ? unified : (data?.momentumQuality?.candidates || []);
}

function researchScore(row) {
  if (Number.isFinite(n(row.research_score))) return n(row.research_score);
  const base = safe(row.quality_score) * .36 + safe(row.risk_control_score) * .22 + safe(row.trend_template_score) * .14 + safe(row.stage_score) * .10 + safe(row.sector_rotation_score) * .12 + safe(row.relay_score) * .06;
  const extendedPenalty = Math.max(0, safe(row.ma20_gap) - .12) * 85;
  const drawdownPenalty = Math.max(0, Math.abs(safe(row.drawdown20)) - .10) * 28;
  return base - extendedPenalty - drawdownPenalty;
}

function rankedCandidates(data = snapshot) {
  const rows = candidateSource(data)
    .map((row) => ({ ...row, research_score: researchScore(row) }))
    .sort((left, right) => n(right.research_score) - n(left.research_score));
  return rows.map((row, index) => ({
    ...row,
    rank: index + 1,
    tier: Number.isFinite(n(row.research_tier)) ? n(row.research_tier) : (index < 4 && n(row.research_score) >= 83 ? 1 : index < 12 && n(row.research_score) >= 75 ? 2 : 3),
  }));
}

function tierText(value) {
  return value === 1 ? "一级研究关注" : value === 2 ? "二级等确认" : "三级观察";
}

function researchPeriod(row) {
  if (row.research_horizon) return text(row.research_horizon);
  return row.tier === 1 ? "10-20交易日" : row.tier === 2 ? "5-10交易日" : "3-5交易日";
}

function currentPrice(row) {
  const quote = snapshot?.intradayQuote?.quotes?.[codeOf(row?.code)];
  return n(quote?.live_price ?? row?.live_price ?? row?.close);
}

function rowState(row) {
  if (row.model_status === "REJECT") return { tone: "red", label: "撤出观察" };
  if (row.model_status === "BUY") return { tone: "green", label: "推荐购买" };
  if (row.model_status === "WATCH") return { tone: "blue", label: "影子观察" };
  const extension = safe(row.ma20_gap);
  const risk = safe(row.risk_control_score);
  const weak = risk < 65 || extension > .18 || safe(row.ret5) < -.08;
  const live = currentPrice(row);
  const entryLow = n(row.entry_low);
  const entryHigh = n(row.entry_high);
  const inEntryZone = Number.isFinite(live) && Number.isFinite(entryLow) && Number.isFinite(entryHigh)
    && live >= entryLow && live <= entryHigh;
  const ready = row.tier === 1 && risk >= 80 && extension <= .12 && snapshot?.marketOk === true;
  if (weak) return { tone: "red", label: "撤出观察" };
  if (ready && inEntryZone) return { tone: "green", label: "推荐购买" };
  if (ready && Number.isFinite(live) && live < entryLow) return { tone: "blue", label: "等回到买入线" };
  if (ready && Number.isFinite(live) && live > entryHigh) return { tone: "blue", label: "等回踩确认" };
  return { tone: "blue", label: "等确认" };
}

function reason(row) {
  if (row.model_reason) return text(row.model_reason);
  const extension = safe(row.ma20_gap);
  const extensionText = extension > .12 ? `距20日线 ${pct(extension)}，不追高` : `距20日线 ${pct(extension)}`;
  return `趋势 ${num(row.trend_template_score)} / 板块 ${num(row.sector_rotation_score)} / 风控 ${num(row.risk_control_score)}；${extensionText}`;
}

function retCell(value) {
  const className = !Number.isFinite(n(value)) ? "ret-neutral" : n(value) >= 0 ? "ret-up" : "ret-down";
  return `<span class="${className}">${pct(value)}</span>`;
}

function metric(check, id) {
  const qfq = check?.qfq || {};
  const raw = check?.tdxRaw || {};
  $(id).textContent = pct(qfq.avgReturn);
  $(`${id}sub`).textContent = `前复权胜率 ${pct(qfq.winRate)} / 通达信胜率 ${pct(raw.winRate)}`;
}

function foldMetric(fold, id) {
  $(id).textContent = pct(fold?.modelReturn);
  $(`${id}sub`).textContent = `相对同池等权 ${pct(fold?.activeReturn)} / 最大回撤 ${pct(fold?.maxDrawdown)}`;
}

function archiveDate(data) {
  return String(data?.generatedAt || data?.latestDate || "").slice(0, 10).replaceAll("/", "-");
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--" : date.toLocaleString("zh-CN");
}

function compactTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间待核实";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function priceMap(data = snapshot) {
  const map = new Map();
  candidateSource(data).forEach((row) => map.set(codeOf(row.code), currentPrice(row)));
  (data?.candidates || []).forEach((row) => {
    const value = n(row.live_price ?? row.close);
    if (Number.isFinite(value)) map.set(codeOf(row.code), value);
  });
  return map;
}

function recordWatchSnapshots(data = snapshot) {
  const key = data?.generatedAt || data?.latestDate;
  if (!key) return;
  const prices = priceMap(data);
  let changed = false;
  const next = getWatch().map((item) => {
    const price = prices.get(item.code);
    if (!Number.isFinite(price)) return item;
    const records = Array.isArray(item.records) ? item.records : [];
    if (records.some((record) => record.at === key)) return item;
    changed = true;
    return { ...item, records: [...records, { at: key, price }] };
  });
  if (changed) saveWatch(next);
}

function returnAt(item, days) {
  const target = new Date(item.addedAt);
  target.setDate(target.getDate() + days);
  const record = (item.records || []).find((point) => new Date(point.at).getTime() >= target.getTime());
  const referencePrice = n(item.referencePrice ?? item.addedPrice);
  if (!record || !Number.isFinite(referencePrice) || referencePrice <= 0) return NaN;
  return n(record.price) / referencePrice - 1;
}

function watchStatus(item, row) {
  if (!row) return { tone: "blue", label: "等待数据" };
  return rowState(row);
}

function renderCandidateRow(row, compact = false) {
  const code = codeOf(row.code);
  const watched = getWatch().find((item) => item.code === code);
  const state = rowState(row);
  const tierClass = `t${row.tier}`;
  const reasonCell = compact ? "" : `<td class="reason">${reason(row)}</td>`;
  const watchButton = `<button class="watch-add" data-code="${code}" ${watched ? "disabled" : ""}>${watched ? (watched.mode === "owned" ? "已买观察" : "未买已观察") : "未买：加入观察"}</button>`;
  const buyButton = `<button class="watch-buy" data-code="${code}" ${watched?.mode === "owned" ? "disabled" : ""}>${watched?.mode === "owned" ? "已填买入价" : "已买：填买入价"}</button>`;
  return `<tr><td><span class="tier-label ${tierClass}">${tierText(row.tier)}<small>排名 ${row.rank}</small></span></td><td class="stock-cell"><strong>${text(row.name)}</strong><small>${code} / ${text(row.sector)}</small></td><td><span class="state ${state.tone}">${state.label}</span></td><td>${num(row.research_score)}</td>${reasonCell}<td>${retCell(row.ret5)}</td><td>${retCell(row.ret10)}</td><td>${retCell(row.ret20)}</td><td>${retCell(row.ret60)}</td><td>${num(currentPrice(row))}</td><td>${num(row.entry_low)} - ${num(row.entry_high)}</td><td>${num(row.risk_line)}</td><td>${num(row.target1)}</td><td>${researchPeriod(row)}</td><td><div class="watch-actions">${watchButton}${buyButton}</div></td></tr>`;
}

function bindWatchButtons(scope) {
  document.querySelectorAll(`${scope} .watch-add:not([disabled])`).forEach((button) => {
    button.onclick = () => addObservation(button.dataset.code);
  });
  document.querySelectorAll(`${scope} .watch-buy:not([disabled])`).forEach((button) => {
    button.onclick = () => openPurchaseDialog(button.dataset.code);
  });
}

function renderOverviewTables() {
  const rows = rankedCandidates();
  $("candidateCount").textContent = `${rows.length} 只研究观察`;
  $("tierOneRows").innerHTML = rows.filter((row) => row.tier === 1).map((row) => renderCandidateRow(row, true)).join("") || '<tr><td colspan="14" class="empty">当前没有达到一级研究关注门槛的样本。</td></tr>';
  $("candidateRows").innerHTML = rows.map((row) => renderCandidateRow(row, false)).join("") || '<tr><td colspan="15" class="empty">当前没有符合过滤条件的研究观察样本。</td></tr>';
  bindWatchButtons("#tierOneRows");
  bindWatchButtons("#candidateRows");
}

function addWatch(code, mode = "watch", manualPrice = NaN) {
  const items = getWatch();
  const existingIndex = items.findIndex((item) => item.code === code);
  const existing = existingIndex >= 0 ? normalizeWatch(items[existingIndex]) : null;
  const row = rankedCandidates().find((candidate) => codeOf(candidate.code) === code) || existing;
  if (!row) return;
  const marketPrice = priceMap().get(code);
  const referencePrice = mode === "owned"
    ? n(manualPrice)
    : (Number.isFinite(marketPrice) ? marketPrice : currentPrice(row));
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
    alert("当前没有可用价格，暂时无法记录。请刷新快照后重试。");
    return;
  }

  const addedAt = new Date().toISOString();
  const quoteAt = snapshot?.intradayQuote?.capturedAt || snapshot?.generatedAt;
  const referencePriceAt = mode === "owned" ? addedAt : (quoteAt || addedAt);
  const initial = { at: referencePriceAt, price: referencePrice };
  if (existingIndex >= 0) {
    if (mode !== "owned") return;
    items[existingIndex] = {
      ...existing,
      mode: "owned",
      name: row.name,
      sector: row.sector,
      referencePrice,
      addedPrice: referencePrice,
      addedAt,
      referencePriceAt,
      observedAt: existing.observedAt || existing.addedAt,
      boughtAt: addedAt,
      historicalTrend: n(row.ret20),
      records: [initial],
    };
  } else {
    items.unshift({
      code,
      name: row.name,
      sector: row.sector,
      mode,
      addedAt,
      referencePriceAt,
      observedAt: mode === "watch" ? addedAt : null,
      boughtAt: mode === "owned" ? addedAt : null,
      referencePrice,
      addedPrice: referencePrice,
      historicalTrend: n(row.ret20),
      records: [initial],
    });
  }
  saveWatch(items);
  renderAllLocal();
}

async function addObservation(code) {
  const refreshed = await load();
  if (!refreshed) {
    alert("最新行情快照核对失败，本次没有写入观察价。请稍后重试。");
    return;
  }
  addWatch(code, "watch");
}

let pendingPurchaseCode = null;

function openPurchaseDialog(code) {
  const tracked = getWatch().find((item) => item.code === code);
  const row = rankedCandidates().find((candidate) => codeOf(candidate.code) === code) || tracked;
  if (!row) return;
  const live = priceMap().get(code);
  const defaultPrice = Number.isFinite(live) ? live : currentPrice(row);
  const dialog = $("purchaseDialog");
  pendingPurchaseCode = code;
  $("purchaseStock").textContent = `${text(row.name)} (${code})`;
  $("purchasePrice").value = Number.isFinite(defaultPrice) ? defaultPrice.toFixed(2) : "";
  $("purchasePriceError").textContent = "";
  if (dialog?.showModal) {
    dialog.showModal();
    setTimeout(() => $("purchasePrice").focus(), 0);
    return;
  }
  const entered = window.prompt(`输入 ${text(row.name)} 的实际买入价`, Number.isFinite(defaultPrice) ? defaultPrice.toFixed(2) : "");
  if (entered !== null) addWatch(code, "owned", Number(entered));
}

function removeWatch(code) {
  saveWatch(getWatch().filter((item) => item.code !== code));
  renderAllLocal();
}

function renderWatchTable() {
  recordWatchSnapshots();
  const current = new Map(rankedCandidates().map((row) => [codeOf(row.code), row]));
  const prices = priceMap();
  const rows = getWatch();
  const watchRows = getWatchOnly();
  const ownedRows = getOwnedWatch();
  $("watchOnlyBadge").textContent = String(watchRows.length);
  $("ownedWatchBadge").textContent = String(ownedRows.length);
  $("watchOnlyCount").textContent = `${watchRows.length} 只`;
  $("ownedWatchCount").textContent = `${ownedRows.length} 只`;

  const renderRows = (items, mode) => items.map((item) => {
    const latest = prices.get(item.code);
    const referencePrice = n(item.referencePrice ?? item.addedPrice);
    const currentReturn = Number.isFinite(latest) && referencePrice > 0 ? latest / referencePrice - 1 : NaN;
    const state = watchStatus(item, current.get(item.code));
    const buyAction = mode === "watch"
      ? `<button class="watch-buy watch-convert" data-code="${item.code}">转为已买并填价</button>`
      : "";
    const removeLabel = mode === "owned" ? "结束已买观察" : "取消未买观察";
    const referenceLabel = mode === "owned" ? "买入价格 · 用户填写" : "观察价格 · 点击时锁定";
    const currentAt = snapshot?.intradayQuote?.capturedAt || snapshot?.generatedAt;
    const currentLabel = currentAt ? `行情快照 ${compactTime(currentAt)}` : "最新可用行情";
    return `<tr><td class="price-cell reference-price" data-price-role="reference"><strong>${num(referencePrice)}</strong><small>${referenceLabel}</small><small>${compactTime(item.referencePriceAt)}</small></td><td class="price-cell current-price" data-price-role="current"><strong>${num(latest)}</strong><small>${currentLabel}</small></td><td class="stock-cell"><strong>${text(item.name)}</strong><small>${item.code} / ${text(item.sector)}</small></td><td>${formatTime(item.addedAt)}</td><td>${retCell(item.historicalTrend)}</td><td>${retCell(currentReturn)}</td><td>${retCell(returnAt(item, 3))}</td><td>${retCell(returnAt(item, 5))}</td><td>${retCell(returnAt(item, 20))}</td><td>${retCell(returnAt(item, 60))}</td><td><span class="state ${state.tone}">${state.label}</span></td><td><div class="watch-actions">${buyAction}<button class="remove-watch" data-code="${item.code}">${removeLabel}</button></div></td></tr>`;
  }).join("");

  $("watchOnlyRows").innerHTML = renderRows(watchRows, "watch")
    || '<tr><td colspan="12" class="empty">暂无未买观察。请在研究总览点击“加入观察”，系统会记录当时的观察价。</td></tr>';
  $("ownedWatchRows").innerHTML = renderRows(ownedRows, "owned")
    || '<tr><td colspan="12" class="empty">暂无已买观察。买入时点击“已买：填买入价”，填入真实成交价。</td></tr>';
  document.querySelectorAll(".watch-convert").forEach((button) => { button.onclick = () => openPurchaseDialog(button.dataset.code); });
  document.querySelectorAll(".remove-watch").forEach((button) => { button.onclick = () => removeWatch(button.dataset.code); });
}

function holdingMoney(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(n(value))
    ? `¥${n(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "--";
}

function holdingResearch(code) {
  const normalized = codeOf(code);
  const quality = candidateSource().find((row) => codeOf(row.code) === normalized) || {};
  const live = (snapshot?.candidates || []).find((row) => codeOf(row.code) === normalized) || {};
  return { ...live, ...quality };
}

function holdingState(row, research) {
  if (safe(row.available) <= 0) return { tone: "blue", label: "T+1 复核" };
  if (!research || !Object.keys(research).length) return { tone: "blue", label: "等研究覆盖" };
  const ranked = rankedCandidates().find((item) => codeOf(item.code) === codeOf(row.code));
  return ranked ? rowState(ranked) : { tone: "blue", label: "等确认" };
}

function renderHoldings() {
  const holdings = snapshot?.publicHoldings || {};
  const rows = Array.isArray(holdings.rows) ? holdings.rows : [];
  const portfolio = holdings.portfolio || {};
  $("holdingCount").textContent = `${safe(portfolio.holdingCount || rows.length)} 只`;
  $("holdingPhase").textContent = "公开持仓复核";
  $("holdingCostValue").textContent = holdingMoney(portfolio.costValue);
  $("holdingMarketValue").textContent = holdingMoney(portfolio.marketValue);
  const dailyLine = snapshot?.dailyLineSource || {};
  const dailyDate = String(dailyLine.targetDate || snapshot?.latestDate || "").replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
  $("holdingDate").textContent = dailyLine.targetDate ? `通达信校准至 ${dailyDate}` : `日线截止 ${text(snapshot?.latestDate)}`;
  $("holdingPnlValue").textContent = holdingMoney(portfolio.pnlValue);
  $("holdingPnlValue").className = portfolio.pnlValue !== null && portfolio.pnlValue !== undefined && Number.isFinite(n(portfolio.pnlValue))
    ? (n(portfolio.pnlValue) >= 0 ? "positive-value" : "negative-value")
    : "";
  $("holdingPnlPct").textContent = `参考比例 ${pct(portfolio.pnlPct)}`;
  $("holdingSnapshotMeta").textContent = `仓位源 ${formatTime(holdings.sourceUpdatedAt)} / 实时行情 ${formatTime(holdings.quoteUpdatedAt || snapshot?.intradayQuote?.capturedAt)} / 研究快照 ${formatTime(snapshot?.generatedAt)}`;
  $("holdingSourceNotice").textContent = text(holdings.notice, "等待公开持仓快照。");

  $("holdingRows").innerHTML = rows.map((row) => {
    const research = holdingResearch(row.code);
    const state = holdingState(row, research);
    const shares = Number.isFinite(n(row.shares)) ? n(row.shares).toLocaleString("zh-CN") : "--";
    const available = Number.isFinite(n(row.available)) ? n(row.available).toLocaleString("zh-CN") : "--";
    const riskLine = research.risk_line ?? research.stop_line;
    const target1 = research.target1;
    const note = research.reason || research.explain || (safe(row.available) <= 0 ? "当日买入或不可卖，下一交易日再复核。" : "等待模型覆盖后给出风险复核。");
    const period = research.tier ? researchPeriod(research) : "等待研究复核";
    const pnlKnown = row.pnlPct !== null && row.pnlPct !== undefined && Number.isFinite(n(row.pnlPct));
    const pnlClass = pnlKnown ? (n(row.pnlPct) >= 0 ? "ret-up" : "ret-down") : "";
    return `<tr><td class="stock-cell"><strong>${text(row.name, row.code)}</strong><small>${codeOf(row.code)}</small></td><td>${shares} / ${available}</td><td>${num(row.costPrice)}</td><td>${num(row.price)}</td><td><span class="${pnlClass}">${holdingMoney(row.pnlValue)}<small>${pct(row.pnlPct)}</small></span></td><td><span class="state ${state.tone}">${state.label}</span></td><td>${num(riskLine)}</td><td>${num(target1)}</td><td>${period}</td><td>${text(row.quoteSource)}</td><td class="reason">${text(note)}</td></tr>`;
  }).join("") || '<tr><td colspan="11" class="empty">当前公开持仓表没有可显示的数量大于 0 的标的。</td></tr>';
}

function performanceMetric(performance) {
  const horizons = Array.isArray(performance?.available_horizons) ? performance.available_horizons.map(Number).filter(Number.isFinite).sort((a, b) => b - a) : [];
  const horizon = horizons[0];
  const value = horizon === undefined ? NaN : n(performance?.returns?.[String(horizon)]);
  const drawdown = horizon === undefined ? NaN : n(performance?.drawdowns?.[String(horizon)]);
  return { horizon: horizon === undefined ? "等待后验" : `${horizon}日`, value, drawdown };
}

function renderHistoryRows(data) {
  const performance = new Map((data?.candidatePerformanceRows || []).map((row) => [codeOf(row.code), row]));
  const rows = rankedCandidates(data).map((row) => {
    const review = performance.get(codeOf(row.code));
    return { row, review, post: performanceMetric(review) };
  });
  const valueFor = (item) => {
    if (historySort === "score") return n(item.row.research_score);
    if (historySort === "ret20") return n(item.row.ret20);
    if (historySort === "drawdown") return n(item.post.drawdown);
    return n(item.post.value);
  };
  rows.sort((left, right) => {
    const a = valueFor(left);
    const b = valueFor(right);
    if (!Number.isFinite(a)) return 1;
    if (!Number.isFinite(b)) return -1;
    return historySort === "drawdown" ? a - b : b - a;
  });
  $("historyRows").innerHTML = rows.map(({ row, review, post }) => `<tr><td><span class="tier-label t${row.tier}">${tierText(row.tier)}</span></td><td class="stock-cell"><strong>${text(row.name)}</strong><small>${codeOf(row.code)} / ${text(row.sector)}</small></td><td>${num(row.research_score)}</td><td>${Number.isFinite(post.value) ? rawPct(post.value) : "等待后验"}</td><td>${Number.isFinite(post.drawdown) ? rawPct(post.drawdown) : "--"}</td><td>${post.horizon}</td><td>${text(review?.review_status, "等待后验")}</td><td>${retCell(row.ret20)}</td><td class="reason">${text(review?.review_note, row.explain || row.quality_type)}</td></tr>`).join("") || '<tr><td colspan="9" class="empty">该日期没有可显示的候选。</td></tr>';
}

function methodEvidence(method) {
  const result = method?.localResult || {};
  if (!Object.keys(result).length) return method?.modelUse === "active_governance" ? "已作为研究治理规则启用" : "等待满足数据或消融条件";
  const items = [];
  if (Number.isFinite(n(result.total_return))) items.push(`样本收益 ${pct(result.total_return)}`);
  if (Number.isFinite(n(result.active_vs_equal_weight_total_return))) items.push(`同池主动 ${pct(result.active_vs_equal_weight_total_return)}`);
  if (Number.isFinite(n(result.max_drawdown))) items.push(`最大回撤 ${pct(result.max_drawdown)}`);
  if (Number.isFinite(n(result.worst_rolling_60d_return))) items.push(`最差60日 ${pct(result.worst_rolling_60d_return)}`);
  if (Number.isFinite(n(result.average_market_exposure))) items.push(`平均暴露 ${pct(result.average_market_exposure)}`);
  if (Number.isFinite(n(result.recommended_research_horizon_days))) items.push(`研究周期 ${n(result.recommended_research_horizon_days)}日`);
  if (typeof result.dedicated_promotion_gate_passed === "boolean") {
    const improved = Number.isFinite(n(result.evaluation_fold_active_improvements)) ? n(result.evaluation_fold_active_improvements) : "--";
    const required = Number.isFinite(n(result.required_evaluation_fold_active_improvements)) ? n(result.required_evaluation_fold_active_improvements) : "--";
    items.push(`专属晋级 ${result.dedicated_promotion_gate_passed ? "通过" : "未通过"} (${improved}/${required}阶段)`);
  }
  if (typeof result.component_retention_gate_passed === "boolean") {
    const improved = Number.isFinite(n(result.evaluation_fold_active_improvements)) ? n(result.evaluation_fold_active_improvements) : "--";
    const required = Number.isFinite(n(result.required_evaluation_fold_active_improvements)) ? n(result.required_evaluation_fold_active_improvements) : "--";
    items.push(`组件保留 ${result.component_retention_gate_passed ? "通过" : "未通过"} (${improved}/${required}阶段)`);
  }
  if (Number.isFinite(n(result.retained_weight))) items.push(`保留权重 ${n(result.retained_weight).toFixed(2)}`);
  if (Number.isFinite(n(result.anchored_total_return)) && Number.isFinite(n(result.removed_total_return))) {
    items.push(`含锚定 ${pct(result.anchored_total_return)} / 去锚定 ${pct(result.removed_total_return)}`);
  }
  if (Number.isFinite(n(result.anchored_max_drawdown)) && Number.isFinite(n(result.removed_max_drawdown))) {
    items.push(`回撤 ${pct(result.anchored_max_drawdown)} / ${pct(result.removed_max_drawdown)}`);
  }
  if (Number.isFinite(n(result.retained_total_return)) && Number.isFinite(n(result.removed_total_return)) && !Number.isFinite(n(result.anchored_total_return))) {
    items.push(`保留组件 ${pct(result.retained_total_return)} / 移除组件 ${pct(result.removed_total_return)}`);
  }
  if (Number.isFinite(n(result.retained_max_drawdown)) && Number.isFinite(n(result.removed_max_drawdown)) && !Number.isFinite(n(result.anchored_max_drawdown))) {
    items.push(`回撤 ${pct(result.retained_max_drawdown)} / ${pct(result.removed_max_drawdown)}`);
  }
  if (Number.isFinite(n(result.required_forward_signals))) items.push(`前验门槛 ${n(result.required_forward_signals)}个信号`);
  if (Number.isFinite(n(result.coverage))) items.push(`样本覆盖 ${pct(result.coverage)}`);
  if (Number.isFinite(n(result.primary_active_total_delta))) items.push(`相对冻结基线主动 ${pct(result.primary_active_total_delta)}`);
  if (Number.isFinite(n(result.primary_active_fold_improvements))) items.push(`改善阶段 ${n(result.primary_active_fold_improvements)}/3`);
  if (typeof result.horizon_direction_consistent === "boolean") items.push(`周期方向 ${result.horizon_direction_consistent ? "一致" : "不一致"}`);
  if (Number.isFinite(n(result.positive_horizon_count)) && Number.isFinite(n(result.horizon_count))) items.push(`有利周期 ${n(result.positive_horizon_count)}/${n(result.horizon_count)}`);
  if (result.long_horizon_warning === true) items.push("60日不外推");
  if (Number.isFinite(n(result.active_delta_45d)) && Number.isFinite(n(result.active_delta_60d))) items.push(`主动差 45日 ${pct(result.active_delta_45d)} / 60日 ${pct(result.active_delta_60d)}`);
  if (result.decision === "retain_component") items.push("裁决 保留组件");
  if (result.decision === "remove_component") items.push("裁决 移除组件");
  if (result.decision === "rejected") items.push("裁决 拒绝融合");
  return items.join(" / ") || text(result.decision, "等待本地结论");
}

function renderMethodRows(unified) {
  const methods = Array.isArray(unified?.methodCards) ? unified.methodCards : [];
  $("methodRows").innerHTML = methods.map((method) => {
    const horizon = Array.isArray(method.horizonDays) ? method.horizonDays.join("-") + " 日" : "--";
    const proxy = (method.localProxy || []).join(" · ") || "--";
    const failures = (method.failureModes || []).join("；") || "--";
    return `<tr><td class="method-source"><strong>${text(method.name)}</strong><a href="${text(method.url, "#")}" target="_blank" rel="noreferrer">${text(method.source, "原始来源")}</a></td><td>${text(proxy)}</td><td>${horizon}</td><td><span class="method-status">${text(method.status, "待复核")}</span></td><td class="reason">${methodEvidence(method)}</td><td class="reason">${text(failures)}</td></tr>`;
  }).join("") || '<tr><td colspan="6" class="empty">尚未登记可审计的方法证据。</td></tr>';
}

async function selectHistory(date) {
  const currentDate = archiveDate(snapshot);
  if (!date || date === currentDate) {
    historyData = snapshot;
  } else {
    try {
      const response = await fetch(`./history/${date}.json?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("历史归档暂不可用");
      historyData = await response.json();
    } catch {
      historyData = snapshot;
    }
  }
  renderHistoryRows(historyData);
}

async function loadHistoryIndex() {
  try {
    const response = await fetch(`./history/index.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("archive unavailable");
    historyIndex = await response.json();
  } catch {
    historyIndex = [];
  }
  const currentDate = archiveDate(snapshot);
  if (currentDate && !historyIndex.some((item) => item.date === currentDate)) historyIndex.unshift({ date: currentDate, generatedAt: snapshot?.generatedAt, candidateCount: rankedCandidates().length });
  const select = $("historySelect");
  const selected = select.value || currentDate;
  select.innerHTML = historyIndex.map((item) => `<option value="${text(item.date)}">${text(item.date)} / ${text(item.candidateCount, 0)} 只</option>`).join("") || '<option value="">暂无归档</option>';
  if (selected && historyIndex.some((item) => item.date === selected)) select.value = selected;
  await selectHistory(select.value);
}

function renderSnapshot(data) {
  snapshot = data;
  const unified = data.unifiedSwingModel || {};
  const fusion = data.fusionModelV73 || {};
  const selected = fusion.selectedResearchCore;
  const market = data.market || {};
  const researchGeneratedAt = unified.generatedAt || data.generatedAt;
  const generated = researchGeneratedAt ? formatTime(researchGeneratedAt) : "--";
  $("sideSnapshot").textContent = researchGeneratedAt ? `快照 ${generated}` : "等待快照";
  const intraday = data.intradayQuote || {};
  const quoteAt = intraday.capturedAt ? formatTime(intraday.capturedAt) : "--";
  $("updatedAt").textContent = intraday.capturedAt ? `${generated} / 实时价 ${quoteAt}` : generated;
  if (unified.modelName) {
    $("coreStatus").textContent = unified.robustnessGatePassed ? "分段研究门槛通过" : "风险门槛未通过";
    $("coreTitle").textContent = unified.modelName;
    $("coreSummary").textContent = unified.summary || "等待统一模型验证";
    $("formalStatus").textContent = unified.productionReady ? "已晋级" : "影子验证";
    $("dataEnd").textContent = text(unified.latestDate || data.latestDate);
    foldMetric(unified.performance?.validation_2025_h1, "m3");
    foldMetric(unified.performance?.validation_2025_h2, "m5");
    foldMetric(unified.performance?.holdout_2026_ytd, "m7");
  } else {
    $("coreStatus").textContent = selected ? "双样本研究通过" : "等待双样本验证";
    $("coreTitle").textContent = selected ? "趋势质量融合模型" : "暂无可用融合核心";
    $("coreSummary").textContent = fusion.summary || "等待融合验证";
    $("formalStatus").textContent = fusion.formalPromotion ? "已晋级" : "研究观察";
    $("dataEnd").textContent = text(data.dataReadiness?.history?.latestDate || data.latestDate);
    const coreRow = (fusion.rows || []).find((row) => row.layer === selected);
    const checks = coreRow?.checks || [];
    metric(checks.find((check) => check.horizon === 3), "m3");
    metric(checks.find((check) => check.horizon === 5), "m5");
    metric(checks.find((check) => check.horizon === 7), "m7");
  }
  const broad = n(market.up_ratio);
  const median = n(market.median_pct);
  if (unified.modelName && unified.marketOk === false) {
    $("marketStatus").textContent = "环境过滤未通过";
    $("marketSub").textContent = `统一模型完整日截面 ${text(unified.latestDate)}`;
  } else {
    $("marketStatus").textContent = broad >= .60 && median >= 0 ? "环境偏强" : broad >= .45 ? "环境中性" : "环境偏弱";
    $("marketSub").textContent = `上涨比 ${pct(broad)} / 中位涨幅 ${rawPct(median)}`;
  }
  $("dataNote").textContent = data.publicMirrorNotice || "本页面仅展示经发布的研究快照。";
  renderMethodRows(unified);
  renderAllLocal();
}

function renderAllLocal() {
  renderOverviewTables();
  renderWatchTable();
  renderHoldings();
  if (historyData) renderHistoryRows(historyData);
}

function applyView(view) {
  const active = VIEWS[view] ? view : "overview";
  document.querySelectorAll(".view").forEach((section) => { section.hidden = section.id !== `${active}View`; });
  document.querySelectorAll(".nav [data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === active));
  $("viewTitle").textContent = VIEWS[active].title;
  $("viewSubtitle").textContent = VIEWS[active].subtitle;
  if (active === "history") loadHistoryIndex();
}

function setView(view) {
  location.hash = view;
}

async function load() {
  let data;
  try {
    const response = await fetch(`./snapshot.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`快照请求失败（HTTP ${response.status}）`);
    data = await response.json();
  } catch (error) {
    $("coreTitle").textContent = "快照读取失败";
    $("coreSummary").textContent = error.message || "无法读取 snapshot.json。";
    $("sideSnapshot").textContent = "快照请求失败";
    return false;
  }
  try {
    renderSnapshot(data);
    await loadHistoryIndex();
  } catch (error) {
    console.error("Dashboard render failed", error);
    $("coreTitle").textContent = "快照已读取，但页面渲染异常";
    $("coreSummary").textContent = error.message || "请刷新页面；已记录到浏览器控制台。";
    $("sideSnapshot").textContent = "快照已读取，渲染异常";
    return false;
  }
  return true;
}

$("refreshNow").onclick = load;
$("clearWatchOnly").onclick = () => { if (confirm("清空本机浏览器中的未买观察？")) { clearWatchOnly(); renderAllLocal(); } };
$("clearOwnedWatch").onclick = () => { if (confirm("清空本机浏览器中的已买观察？")) { clearOwnedWatch(); renderAllLocal(); } };
$("purchaseCancel").onclick = () => $("purchaseDialog").close();
$("purchaseForm").onsubmit = (event) => {
  event.preventDefault();
  const price = n($("purchasePrice").value);
  if (!pendingPurchaseCode || !Number.isFinite(price) || price <= 0) {
    $("purchasePriceError").textContent = "请输入大于 0 的实际买入价。";
    return;
  }
  addWatch(pendingPurchaseCode, "owned", price);
  $("purchaseDialog").close();
  pendingPurchaseCode = null;
};
$("historySelect").onchange = (event) => selectHistory(event.target.value);
$("historySort").onchange = (event) => { historySort = event.target.value; if (historyData) renderHistoryRows(historyData); };
document.querySelectorAll("[data-history-sort]").forEach((button) => { button.onclick = () => { historySort = button.dataset.historySort; $("historySort").value = historySort; if (historyData) renderHistoryRows(historyData); }; });
document.querySelectorAll(".nav [data-view]").forEach((button) => { button.onclick = () => setView(button.dataset.view); });
window.addEventListener("hashchange", () => applyView(location.hash.replace("#", "")));
if (!location.hash) location.hash = "overview";
applyView(location.hash.replace("#", ""));
load();
setInterval(load, 60000);
