const state = {
  snapshot: null,
  live: null,
  quotesByCode: new Map(),
  quoteStatus: null,
};

const $ = (id) => document.getElementById(id);

function num(value, fallback = NaN) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function fmt(value, digits = 2) {
  const n = num(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "--";
}

function pct(value, alreadyPercent = false) {
  const n = num(value);
  if (!Number.isFinite(n)) return "--";
  const p = alreadyPercent ? n : n * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`;
}

function money(value) {
  const n = num(value);
  if (!Number.isFinite(n)) return "--";
  if (Math.abs(n) >= 100000000) return `${(n / 100000000).toFixed(1)}亿`;
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return n.toFixed(0);
}

function text(value, fallback = "--") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function normalizeCode(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? digits.padStart(6, "0").slice(-6) : "";
}

function quoteFor(row) {
  return state.quotesByCode.get(normalizeCode(row.code));
}

function livePriceText(row, dailyField = "close") {
  const q = quoteFor(row);
  const daily = fmt(row[dailyField]);
  if (!q) return daily;
  const cls = num(q.pct) >= 0 ? "rise" : "fall";
  return `${daily}<small class="live-sub ${cls}">实时 ${fmt(q.close)} / ${pct(q.pct, true)}</small>`;
}

function observerRealtimeStatus(row) {
  const q = quoteFor(row);
  if (!q) return "等待实时价";
  const price = num(q.close);
  const entryLow = num(row.entry_low);
  const entryHigh = num(row.entry_high);
  const riskLine = num(row.risk_line);
  if (Number.isFinite(riskLine) && price < riskLine) return "跌破风险";
  if (Number.isFinite(entryLow) && price < entryLow) return "未站回观察区";
  if (Number.isFinite(entryHigh) && price > entryHigh) return "高于观察区";
  if (Number.isFinite(entryLow) && Number.isFinite(entryHigh) && price >= entryLow && price <= entryHigh) return "实时在观察区";
  return "实时已刷新";
}

function actionText(action) {
  const map = {
    SMALL_WATCH: "可小仓",
    WAIT: "等确认",
    DROP: "放弃",
    HOLD: "持有",
    HOLD_T1: "T+1不可卖",
    REDUCE: "减仓",
    CLEAR: "清仓",
    VERIFY: "人工核对",
  };
  return map[action] || action || "观察";
}

function reasonText(reason) {
  const source = String(reason || "");
  const items = [];
  if (source.includes("too_far_above_entry")) items.push("远高于买入区");
  if (source.includes("above_entry_wait_pullback")) items.push("高于买入区，等回落确认");
  if (source.includes("below_entry_not_confirmed")) items.push("低于买入区，未确认");
  if (source.includes("market_hot_no_chase")) items.push("盘面高热，不追涨");
  if (source.includes("intraday_too_hot")) items.push("盘中涨幅过热");
  if (source.includes("below_first_risk")) items.push("跌破第一风险线");
  if (source.includes("below_stop")) items.push("跌破硬止损线");
  if (source.includes("deep_loss")) items.push("深亏弱势，不补仓");
  if (source.includes("available_zero_T1")) items.push("可卖为0，按T+1处理");
  if (source.includes("not_hit_risk")) items.push("尚未触发风险线");
  if (source.includes("大盘未通过")) items.push("大盘闸门未通过");
  if (source.includes("板块持续性不足") || source.includes("sector breadth weak")) items.push("板块持续性不足");
  if (source.includes("趋势结构不足")) items.push("趋势结构不足");
  if (source.includes("20日回撤过深")) items.push("20日回撤偏深");
  if (source.includes("距离20日线过远")) items.push("距离20日线过远");
  if (items.length) return [...new Set(items)].join("；");
  return source || "--";
}

function statusClass(value) {
  const s = String(value || "");
  if (["可小仓", "可关注", "可买", "有效", "强观察", "核心观察", "通过观察", "SMALL_WATCH"].some((x) => s.includes(x))) return "status status-positive";
  if (["等确认", "观察", "持有", "中风险", "次级观察", "仅记录", "等新数据", "待回测", "待组合", "待条件", "规则生效", "不产生直接信号", "HOLD", "WAIT", "T+1"].some((x) => s.includes(x))) return "status status-wait";
  if (["减仓", "清仓", "放弃", "失效", "高风险", "降权", "剔除", "排除", "不追高", "不晋级", "DROP", "REDUCE", "CLEAR"].some((x) => s.includes(x))) return "status status-danger";
  return "status";
}

function td(value, className = "") {
  return `<td${className ? ` class="${className}"` : ""}>${value ?? "--"}</td>`;
}

function stockCell(row) {
  return `<strong>${text(row.name || row.name_holding || row.code)}</strong><small>${text(row.code, "")}</small>`;
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function nextScheduledRefresh() {
  const now = new Date();
  const slots = [[8, 55], [18, 30]];
  for (let dayOffset = 0; dayOffset < 8; dayOffset += 1) {
    const day = new Date(now);
    day.setDate(day.getDate() + dayOffset);
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    for (const [hour, minute] of slots) {
      const candidate = new Date(day);
      candidate.setHours(hour, minute, 0, 0);
      if (candidate > now) return candidate;
    }
  }
  return now;
}

function shortDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function setOpsCardState(id, stateName) {
  const el = $(id)?.closest(".ops-card");
  if (el) el.className = `ops-card ${stateName}`;
}

function renderAutomationStatus(snapshot) {
  const refresh = snapshot.refreshStatus || {};
  const freshness = snapshot.dataFreshnessMetrics || {};
  const lastRun = refresh.generated_at || snapshot.generatedAt;
  const latestCoverage = Number.isFinite(num(snapshot.latestCoverage))
    ? `${snapshot.latestDate || "--"} / ${snapshot.latestCoverage}只`
    : (snapshot.latestDate || "--");
  const eligiblePassed = Boolean(freshness.eligiblePassed);
  const gateText = eligiblePassed
    ? `eligible ${text(freshness.eligibleDate)} 已达阈值`
    : `目标覆盖 ${text(freshness.targetRatio, 0)}%，仅作观察`;

  setText("autoRunState", "已启用");
  setText("autoSchedule", "工作日 08:55 轻刷新 / 18:30 学习刷新");
  setText("autoLastRun", shortDateTime(lastRun));
  setText("autoRunAge", lastRun ? "刷新链路已写入快照" : "尚无刷新记录");
  setText("autoNextRun", shortDateTime(nextScheduledRefresh()));
  setText("autoDataSlice", latestCoverage);
  setText("autoDataGate", gateText);
  setOpsCardState("autoRunState", lastRun ? "is-ok" : "is-warn");
  setOpsCardState("autoDataSlice", eligiblePassed ? "is-ok" : "is-warn");
}

function renderDataReadiness(snapshot) {
  const readiness = snapshot.dataReadiness || {};
  const rt = readiness.realtime || {};
  const history = readiness.history || {};
  setText("dataReadinessState", readiness.state || "等待刷新");
  setText("dataReadinessRt", rt.status === "ok" ? `${text(rt.mainboardRows)} 只` : "不可用");
  setText("dataReadinessRtNote", `${text(rt.source || "--")} / ${text(rt.quoteDate || "--")}`);
  setText("dataReadinessHistory", `${text(history.latestDate || "--")} / ${text(history.coverage || "--")}`);
  setText("dataReadinessHistoryNote", `${text(history.status || "--")} / 覆盖率 ${text(history.coverageRatio, 0)}`);
  setText("dataReadinessAllowed", readiness.allowedUse || "--");
  setText("dataReadinessGuardrail", readiness.mustNotInfer || "--");
}

function renderFusionModel(snapshot) {
  const fusion = snapshot.fusionModelV73 || {};
  const selected = fusion.selectedResearchCore || "无";
  setText("fusionModelStatus", selected === "V50_momentum_quality" ? "V50 通过双样本研究门槛" : "没有通过层");
  setText("fusionModelSummary", fusion.summary || "等待 qfq 与通达信历史日线双样本核验。");
  setText("fusionModelGuardrail", fusion.guardrail || "通过研究门槛不等于自动下单资格。");
}

function renderLiveCloseProxy(snapshot) {
  const proxy = snapshot.liveCloseProxyV66 || {};
  const review = snapshot.liveCloseProxyReviewV67 || {};
  setText("liveProxyStatus", proxy.status || "等待 RT 收盘快照");
  setText("liveProxyGuardrail", proxy.guardrail || "只在收盘后使用 RT OHLCV 生成最新观察截面；不写入前复权历史，不参与回测或正式分数。");
  const el = $("liveProxyRows");
  if (!el) return;
  const meta = proxy.proxy || {};
  const rows = proxy.rows || [];
  const archive = proxy.observationArchive || {};
  const metaText = meta.rows ? `代理覆盖 ${text(meta.rows)} 只 / 截面 ${text(meta.quoteDate || "--")}` : "暂无可用的收盘代理截面";
  const reviewText = `点时归档 ${text(review.archiveDays, 0)} 日 / 后验 ${text(review.reviewedRows, 0)} 条 / ${text(review.status, "等待归档")}`;
  el.innerHTML = `<div class="proxy-meta"><strong>${metaText}</strong><span>${text(meta.source || proxy.rtArchive || "等待归档")}</span><small>${reviewText}；${text(archive.status || "")}</small></div>` + rows.slice(0, 10).map((row) => (
    `<article class="proxy-row">
      <div><strong>${text(row.code)} ${text(row.name)}</strong><small>${text(row.sector)} / ${text(row.observer_type)}</small></div>
      <b>${fmt(row.close)}</b><span>${pct(row.pct_chg / 100)}</span><em class="status status-wait">仅观察</em>
      <small>${text(row.risk_note)}</small>
    </article>`
  )).join("") || `<div class="proxy-meta"><strong>${metaText}</strong><span>收盘快照不完整或尚未归档时，不生成代理观察。</span></div>`;
}

function renderAlternativeData(snapshot) {
  const data = snapshot.alternativeDataV64 || {};
  const rows = data.rows || [];
  setText("alternativeDataSummary", data.summary || "等待刷新");
  setText("alternativeDataGuardrail", data.guardrail || "--");
  setText("alternativeBacktestSummary", (snapshot.alternativeBacktestV64 || {}).summary || "等待另类因子历史数据后回测");
  const el = $("alternativeDataRows");
  if (!el) return;
  el.innerHTML = rows.map((row) => {
    const probe = row.probe || {};
    return `<article class="alternative-row">
      <div><strong>${text(row.name)}</strong><small>${text(row.category)} / ${text(row.status)}</small></div>
      <span class="${probe.status === "reachable" ? "status status-ok" : "status status-wait"}">${probe.status === "reachable" ? "入口可达" : text(probe.status || "待接入")}</span>
      <p>${text(row.feature)}<small>${text(row.use)}</small></p>
      <div><b>正式权重 ${pct(row.weight, false)}</b><small>执行：${text(row.executionStatus, "待审计")}</small><small>归档节奏 ${text((row.archivePlan || {}).cadence, "待定义")} / 映射 ${(row.archivePlan || {}).mappingLevel ? text((row.archivePlan || {}).mappingLevel) : "待定义"}</small><small>研究优先级 ${text(row.researchPriority, "--")} / 周期 ${text(row.expectedHorizon, "--")}</small><small>归档 ${text(row.historyDays, 0)} 日 / 上限 ${pct(row.weightCap, false)}</small><small>${text(row.backtestStatus)}</small></div>
      <small>${text(row.promotionBlock)}</small>
    </article>`;
  }).join("") || `<article class="alternative-row"><div><strong>暂无另类信息台账</strong><small>等待 V64 刷新</small></div></article>`;
}

function renderStrengthObserver(snapshot) {
  const observer = snapshot.strengthObserver || {};
  const rows = observer.candidates || [];
  setText("strengthTitle", `${observer.version || "V47"} 强势观察池`);
  const coverage = Number.isFinite(num(observer.latestCoverage)) && Number.isFinite(num(observer.universeRows))
    ? `覆盖 ${observer.latestCoverage}/${observer.universeRows}`
    : "";
  const summary = [
    observer.latestDate ? `日线 ${observer.latestDate}` : "",
    coverage,
    Number.isFinite(num(observer.poolCount)) ? `观察 ${observer.poolCount} 只` : "",
    Number.isFinite(num(observer.limitContinuationCount)) ? `涨停延续 ${observer.limitContinuationCount}` : "",
    Number.isFinite(num(observer.sustainedMomentumCount)) ? `持续上涨 ${observer.sustainedMomentumCount}` : "",
    state.quoteStatus?.ok ? `实时 ${state.quotesByCode.size} 只` : "",
  ].filter(Boolean).join(" / ");
  setText("strengthSummary", summary || "涨停延续 / 持续上涨，不等于买入信号");

  const tbody = $("strengthRows");
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = `<tr>${td("暂无强势观察池；这代表当前过滤后没有合格样本，不硬凑。", "muted-cell")}</tr>`;
    return;
  }
  tbody.innerHTML = rows.slice(0, 16).map((row) => {
    const realtime = observerRealtimeStatus(row);
    const realtimeClass = realtime.includes("跌破") ? "status-danger" : realtime.includes("观察区") ? "status-positive" : "status-wait";
    const scoreDetail = [
      Number.isFinite(num(row.trend_score)) ? `趋势 ${fmt(row.trend_score, 0)}` : "",
      Number.isFinite(num(row.sector_score)) ? `板块 ${fmt(row.sector_score, 0)}` : "",
      Number.isFinite(num(row.anti_chase_score)) ? `防追 ${fmt(row.anti_chase_score, 0)}` : "",
      Number.isFinite(num(row.risk_score)) ? `风控 ${fmt(row.risk_score, 0)}` : "",
    ].filter(Boolean).join(" / ");
    const note = `${reasonText(row.risk_note)}；${realtime}`;
    return `<tr>
      ${td(stockCell(row))}
      ${td(text(row.sector))}
      ${td(`<span class="${statusClass(row.observer_type)}">${text(row.observer_type)}</span><small class="${realtimeClass}">${realtime}</small>`)}
      ${td(`${fmt(row.score, 1)}<small>${scoreDetail}</small>`)}
      ${td(livePriceText(row, "close"))}
      ${td(pct(row.ret5), num(row.ret5) >= 0 ? "rise" : "fall")}
      ${td(pct(row.ret20), num(row.ret20) >= 0 ? "rise" : "fall")}
      ${td(`${fmt(row.entry_low)} - ${fmt(row.entry_high)}`)}
      ${td(fmt(row.risk_line))}
      ${td(note)}
    </tr>`;
  }).join("");
}

function renderMomentumQuality(snapshot) {
  const momentum = snapshot.momentumQuality || {};
  const rows = momentum.candidates || [];
  setText("momentumTitle", `${momentum.version || "V50"} 强势质量分层`);
  const bt = momentum.backtest || {};
  const bestHorizon = (bt.by_horizon || []).find((row) => row.horizon === 10) || (bt.by_horizon || [])[0];
  const summary = [
    momentum.latestDate ? `日线 ${momentum.latestDate}` : "",
    Number.isFinite(num(momentum.poolCount)) ? `质量池 ${momentum.poolCount} 只` : "",
    Number.isFinite(num(momentum.limitRelayCount)) ? `涨停延续 ${momentum.limitRelayCount}` : "",
    Number.isFinite(num(momentum.sustainedTrendCount)) ? `中继 ${momentum.sustainedTrendCount}` : "",
    bestHorizon ? `${bestHorizon.horizon}日均值 ${pct(bestHorizon.avg_return)}` : "",
    bestHorizon ? `胜率 ${pct(bestHorizon.win_rate)}` : "",
  ].filter(Boolean).join(" / ");
  setText("momentumSummary", summary || "涨停延续 / 持续上涨中继 / 强势回踩修复");

  const tbody = $("momentumRows");
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = `<tr>${td("暂无强势质量分层样本；这表示当前过滤后没有足够质量样本，不硬凑。", "muted-cell")}</tr>`;
    return;
  }
  tbody.innerHTML = rows.slice(0, 16).map((row) => {
    const detail = [
      Number.isFinite(num(row.trend_template_score)) ? `模板 ${fmt(row.trend_template_score, 0)}` : "",
      Number.isFinite(num(row.stage_score)) ? `阶段 ${fmt(row.stage_score, 0)}` : "",
      Number.isFinite(num(row.relay_score)) ? `接力 ${fmt(row.relay_score, 0)}` : "",
      Number.isFinite(num(row.sector_rotation_score)) ? `板块 ${fmt(row.sector_rotation_score, 0)}` : "",
      Number.isFinite(num(row.risk_control_score)) ? `风控 ${fmt(row.risk_control_score, 0)}` : "",
    ].filter(Boolean).join(" / ");
    return `<tr>
      ${td(stockCell(row))}
      ${td(text(row.sector))}
      ${td(`<span class="${statusClass(row.quality_type)}">${text(row.quality_type)}</span>`)}
      ${td(fmt(row.quality_score, 1))}
      ${td(detail)}
      ${td(livePriceText(row, "close"))}
      ${td(pct(row.ret20), num(row.ret20) >= 0 ? "rise" : "fall")}
      ${td(`${fmt(row.entry_low)} - ${fmt(row.entry_high)}`)}
      ${td(`${fmt(row.risk_line)}<small>失效 ${fmt(row.stop_line)}</small>`)}
      ${td(text(row.explain))}
    </tr>`;
  }).join("");
}

function renderSnapshot(snapshot) {
  setText("formalVersion", snapshot.formalVersion || "正式模型");
  const sourceVersion = snapshot.learningSourceVersion || "";
  const queueVersion = snapshot.learningVersion || "";
  setText(
    "learningVersion",
    [sourceVersion && `${sourceVersion} 学习源`, queueVersion].filter(Boolean).join(" · ") || "学习版本",
  );
  setText("marketState", snapshot.marketOk ? "大盘通过" : "大盘未通过");
  const marketState = $("marketState");
  if (marketState) marketState.className = snapshot.marketOk ? "pill green" : "pill red";
  setText("modelName", snapshot.modelName || "模型未命名");
  setText("modelNote", snapshot.note || "只做研究和风控提示，不承诺盈利，不执行下单。");
  const latestCoverage = Number.isFinite(num(snapshot.latestCoverage)) && Number.isFinite(num(snapshot.strengthObserver?.universeRows))
    ? `覆盖 ${snapshot.latestCoverage}/${snapshot.strengthObserver.universeRows}`
    : "";
  setText("latestDate", [snapshot.latestDate || "--", latestCoverage].filter(Boolean).join(" / "));
  setText("generatedAt", snapshot.generatedAt ? new Date(snapshot.generatedAt).toLocaleString("zh-CN") : "--");
  setText("learningVerdict", snapshot.learningVerdict || "--");
  const selectionAudit = snapshot.methodSelectionAudit || {};
  setText("methodBacktestSummary", [snapshot.methodBacktestSummary || "等待回测", selectionAudit.summary || ""].filter(Boolean).join(" / "));
  const refresh = snapshot.refreshStatus || {};
  const partialText = snapshot.dataMaxDate && snapshot.dataMaxDate !== snapshot.latestDate
    ? `局部缓存已到 ${snapshot.dataMaxDate}，但覆盖 ${snapshot.dataMaxCoverage || 0} 只，未用于正式观察池。`
    : "日线覆盖率满足正式观察池要求。";
  const refreshText = refresh.generated_at
    ? `最近刷新 ${new Date(refresh.generated_at).toLocaleString("zh-CN")}；${partialText}`
    : partialText;
  setText("freshnessNote", refreshText);
  renderAutomationStatus(snapshot);
  renderDataReadiness(snapshot);
  renderFusionModel(snapshot);
  renderLiveCloseProxy(snapshot);
  renderAlternativeData(snapshot);

  renderStrengthObserver(snapshot);
  renderMomentumQuality(snapshot);

  const intraday = snapshot.intraday1300 || {};
  const intradayCandidates = intraday.candidates || [];
  const baseCandidates = intradayCandidates.length ? intradayCandidates : (snapshot.candidates || []).slice(0, 14);
  $("candidateRows").innerHTML = baseCandidates.slice(0, 14).map((row) => {
    const status = actionText(row.action || row.status);
    return `<tr>
      ${td(stockCell(row))}
      ${td(text(row.sector))}
      ${td(`<span class="${statusClass(status)}">${status}</span>`)}
      ${td(fmt(row.score || row.selection_score || row.swing_score, 1))}
      ${td(`${fmt(row.entry_low || row.entry_zone_low)} - ${fmt(row.entry_high || row.entry_zone_high)}`)}
      ${td(fmt(row.stop_line))}
      ${td(fmt(row.target1))}
      ${td(reasonText(row.reason || row.veto))}
    </tr>`;
  }).join("");

  const holdings = intraday.holdings?.length ? intraday.holdings : snapshot.holdings || [];
  $("holdingRows").innerHTML = holdings.map((row) => {
    const q = quoteFor(row);
    const livePrice = q ? q.close : (row.live_price || row.close || row.screen_price);
    const livePnlPct = q && num(row.cost_price) > 0 ? ((num(livePrice) / num(row.cost_price)) - 1) * 100 : row.pnl_pct;
    const action = actionText(row.action || row.holding_action);
    const line = row.first_risk_line || row.stop_line ? `风险 ${fmt(row.first_risk_line)} / 止损 ${fmt(row.stop_line)}` : "人工核对";
    const pnl = num(livePnlPct);
    return `<tr>
      ${td(stockCell(row))}
      ${td(fmt(row.available, 0))}
      ${td(fmt(row.cost_price))}
      ${td(q ? `${fmt(livePrice)}<small class="live-sub">实时 ${pct(q.pct, true)}</small>` : fmt(livePrice))}
      ${td(pct(livePnlPct, true), pnl >= 0 ? "rise" : "fall")}
      ${td(`<span class="${statusClass(action)}">${action}</span>`)}
      ${td(line)}
    </tr>`;
  }).join("");

  $("sectorGrid").innerHTML = (snapshot.sectors || []).slice(0, 12).map((row) => {
    const q = Math.min(100, Math.max(4, num(row.sector_quality, 0) * 100));
    return `<div class="sector">
      <strong>${text(row.sector)}</strong>
      <div><span>20日 ${pct(row.sector_ret20)}</span><span>60日 ${pct(row.sector_ret60)}</span></div>
      <div class="bar"><i style="width:${q}%"></i></div>
    </div>`;
  }).join("");

  $("learningRows").innerHTML = (snapshot.learning || []).map((row) => (
    `<div class="learning-row"><strong>${text(row.version)}</strong><span>${text(row.summary)}</span><em>${text(row.verdict)}</em></div>`
  )).join("");

  const sourceEl = $("sourceRows");
  if (sourceEl) {
    sourceEl.innerHTML = (snapshot.learningSources || []).map((row) => (
      `<div class="source-row"><strong>${text(row.name)}</strong><span>${text(row.lesson)}</span><small>${text(row.rule, "")}</small><small>验证：${text(row.methodStatus, "未关联")} / 周期：${text(row.recommendedHorizon, "--")} ${text(row.horizonUnit, "")}</small><em>${text(row.status)}</em></div>`
    )).join("") || `<div class="source-row"><strong>等待学习源</strong><span>下一次脚本运行后会展示来源、吸收内容和模型处理。</span><em>待更新</em></div>`;
  }

  const rulePatchEl = $("rulePatchRows");
  if (rulePatchEl) {
    rulePatchEl.innerHTML = (snapshot.modelRulePatches || []).map((row) => (
      `<div class="rule-card">
        <strong>${text(row.rule_id)}</strong>
        <span>${text(row.scope)}</span>
        <p>${text(row.change)}</p>
        <em>${text(row.promotion)}</em>
      </div>`
    )).join("") || `<div class="rule-card"><strong>暂无新增补丁</strong><span>model_governance</span><p>等待下一次学习源更新。</p><em>待观察</em></div>`;
  }

  const pipelineEl = $("learningPipelineRows");
  if (pipelineEl) {
    pipelineEl.innerHTML = (snapshot.learningPipeline || []).map((item, index) => (
      `<div class="pipeline-step"><b>${index + 1}</b><span>${text(item)}</span></div>`
    )).join("");
  }

  const health = snapshot.learningSourceHealth || {};
  setText("sourceHealthSummary", health.total ? `${health.okCount || 0}/${health.total} 可访问，${health.blockedCount || 0} 个需复核` : "等待刷新");
  const healthEl = $("sourceHealthRows");
  if (healthEl) {
    healthEl.innerHTML = (health.sources || []).map((row) => {
      const ok = row.ok === true;
      const unknown = row.ok === null || row.ok === undefined;
      const cls = ok ? "status-positive" : unknown ? "status-wait" : "status-danger";
      const status = ok ? `OK ${row.status_code}` : unknown ? "未检查" : `复核 ${row.status_code || "--"}`;
      return `<div class="health-row">
        <strong>${text(row.name)}</strong>
        <span class="${cls}">${status}</span>
        <small>${text(row.title || row.error)}</small>
        <em>${Number.isFinite(num(row.latency_ms)) ? `${row.latency_ms}ms` : "--"}</em>
      </div>`;
    }).join("") || `<div class="health-row"><strong>暂无来源健康记录</strong><span class="status-wait">待刷新</span><small>下一次 V51 运行后展示。</small><em>--</em></div>`;
  }

  const backlogEl = $("learningBacklogRows");
  if (backlogEl) {
    backlogEl.innerHTML = (snapshot.learningBacklog || []).slice(0, 9).map((row) => (
      `<div class="backlog-row">
        <b>${text(row.priority)}</b>
        <div><strong>${text(row.source)}</strong><span>${text(row.task)}</span><small>${text(row.rule)}</small></div>
        <em class="${row.status === "需复核" ? "status-danger" : "status-wait"}">${text(row.status)}</em>
      </div>`
    )).join("") || `<div class="backlog-row"><b>0</b><div><strong>暂无待吸收项</strong><span>等待来源健康检查。</span></div><em class="status-wait">待刷新</em></div>`;
  }

  const reviews = snapshot.sourceLearningSummaries || [];
  setText("learningReviewSummary", reviews.length ? `${snapshot.learningReviewVersion || "V52"} / ${reviews.length} 个来源已摘要` : "等待刷新");
  const reviewEl = $("sourceLearningSummaryRows");
  if (reviewEl) {
    reviewEl.innerHTML = reviews.map((row) => {
      const danger = row.status === "需复核" || row.status === "闇€澶嶆牳";
      return `<div class="review-card">
        <div class="review-head"><strong>${text(row.name)}</strong><span class="${danger ? "status-danger" : "status-positive"}">${text(row.status)}</span></div>
        <p>${text(row.summary)}</p>
        <dl>
          <dt>吸收原则</dt><dd>${text(row.absorbed_principle)}</dd>
          <dt>规则候选</dt><dd>${text(row.rule_candidate)}</dd>
          <dt>验证门槛</dt><dd>${text(row.validation_gate)}</dd>
          <dt>不直接买入</dt><dd>${text(row.why_not_direct_buy)}</dd>
        </dl>
      </div>`;
    }).join("") || `<div class="review-card"><div class="review-head"><strong>暂无源摘要</strong><span class="status-wait">待刷新</span></div><p>下一次 V52 运行后会展示来源摘要、吸收原则和规则候选。</p></div>`;
  }

  const ledgerRows = snapshot.learningLedgerRows || [];
  setText("learningLedgerSummary", snapshot.learningLedgerSummary || (ledgerRows.length ? `${snapshot.learningLedgerVersion || "V62"} / ${ledgerRows.length} 条台账` : "等待刷新"));
  const ledgerEl = $("learningLedgerRows");
  if (ledgerEl) {
    ledgerEl.innerHTML = ledgerRows.map((row) => (`
      <article class="ledger-row">
        <div><strong>${text(row.source)}</strong><small>${text(row.tier)}</small></div>
        <span class="${statusClass(row.validationStatus)}">${text(row.validationStatus)}</span>
        <p><b>${text(row.validationType)}</b>${text(row.modelEffect)}</p>
        <small>${text(row.nextStep)}</small>
      </article>
    `)).join("") || `<article class="ledger-row"><div><strong>暂无台账</strong><small>等待 V62</small></div><span class="status-wait">待刷新</span><p>来源、规则和验证结果将在下一次刷新后建立关联。</p><small>--</small></article>`;
  }

  const methodRows = snapshot.candidateLearningLinks || [];
  setText("candidateLearningSummary", methodRows.length ? `${snapshot.candidateLearningVersion || "V53"} / ${methodRows.length} 个候选已映射` : "等待刷新");
  const methodEl = $("candidateLearningRows");
  if (methodEl) {
    methodEl.innerHTML = methodRows.slice(0, 18).map((row) => {
      const status = text(row.model_status);
      return `<div class="method-row">
        <div>
          <strong>${text(row.name)} <small>${text(row.code)}</small></strong>
          <span>${text(row.sector)} / ${text(row.candidate_type)} / ${text(row.pool)}</span>
        </div>
        <b>${fmt(row.fit_score, 1)}</b>
        <em class="${statusClass(status)}">${status}</em>
        <p>${text(row.why_visible)}</p>
        <small>来源：${(row.method_sources || []).slice(0, 4).map(text).join(" / ")}</small>
        <small>门槛：${(row.validation_gates || []).slice(0, 2).map(text).join("；")}</small>
        <small>限制：${text(row.why_not_direct_buy)}</small>
      </div>`;
    }).join("") || `<div class="method-row"><div><strong>暂无映射候选</strong><span>等待 V53 运行。</span></div><b>--</b><em class="status-wait">待刷新</em><p>下一次刷新会把涨停延续、持续趋势和回踩修复候选映射到方法论来源。</p></div>`;
  }

  const perfRows = snapshot.candidatePerformanceRows || [];
  setText("candidatePerformanceSummary", snapshot.candidatePerformanceSummary || "等待刷新");
  const typePerfEl = $("typePerformanceRows");
  if (typePerfEl) {
    typePerfEl.innerHTML = (snapshot.typePerformanceRows || []).map((row) => (
      `<div class="perf-card">
        <strong>${text(row.name)}</strong>
        <span>样本 ${text(row.sample_count)}</span>
        <b class="${num(row.h3_avg) >= 0 ? "rise" : "fall"}">3日 ${fmt(row.h3_avg)}%</b>
        <small>1日 ${fmt(row.h1_avg)}% / 胜率 ${fmt(row.h3_win_rate)}%</small>
      </div>`
    )).join("") || `<div class="perf-card"><strong>暂无类型复盘</strong><span>等待 V54 运行</span><b>--</b></div>`;
  }
  const perfEl = $("candidatePerformanceRows");
  if (perfEl) {
    perfEl.innerHTML = perfRows.slice(0, 18).map((row) => {
      const status = text(row.review_status);
      const h1 = row.returns ? row.returns["1"] : null;
      const h3 = row.returns ? row.returns["3"] : null;
      return `<div class="perf-row">
        <div><strong>${text(row.name)} <small>${text(row.code)}</small></strong><span>${text(row.candidate_type)} / ${text(row.model_status)}</span></div>
        <b class="${num(h1) >= 0 ? "rise" : "fall"}">${fmt(h1)}%</b>
        <b class="${num(h3) >= 0 ? "rise" : "fall"}">${fmt(h3)}%</b>
        <em class="${statusClass(status)}">${status}</em>
        <p>${text(row.review_note)}</p>
      </div>`;
    }).join("") || `<div class="perf-row"><div><strong>暂无后验样本</strong><span>等待 V54 运行。</span></div><b>--</b><b>--</b><em class="status-wait">待刷新</em><p>候选后续交易日出现后才会复盘。</p></div>`;
  }

  setText("methodBacktestSummary", [snapshot.methodBacktestSummary || "等待刷新", selectionAudit.summary || ""].filter(Boolean).join(" / "));
  const methodBacktestEl = $("methodBacktestRows");
  if (methodBacktestEl) {
    methodBacktestEl.innerHTML = (snapshot.methodBacktestRows || []).map((row) => {
      const horizon = row.recommendedHorizon ? `${text(row.recommendedHorizon)} ${text(row.horizonUnit, "交易日")}` : "无直接周期";
      const horizonItems = (row.horizons || []).map((item) => (
        `<i>${text(item.horizon)}日 / 均值 ${text(item.avgReturn)}% / 回撤 ${text(item.avgDrawdown)}%</i>`
      )).join("");
      const stability = row.walkForward || {};
      const stabilityText = stability.status === "passed"
        ? "时间稳定性：三折去重通过"
        : stability.status === "insufficient_purged_samples"
          ? "时间稳定性：去重后样本不足"
        : stability.status === "unstable"
          ? "时间稳定性：去重后未通过，已降级"
          : "时间稳定性：不适用或样本不足";
      const selection = row.selectionAudit || {};
      const selectionText = selection.block ? ` / ${text(selection.block)}` : "";
      return `<article class="method-backtest-card">
        <header><strong>${text(row.name)}</strong><em class="${statusClass(row.status)}">${text(row.status)}</em></header>
        <span>${text(row.validationType)} / ${text(row.source)} / 家族 ${text(row.methodFamily, "--")}</span>
        <b>${horizon}</b>
        <p>${text(row.verdict)}${selectionText}</p>
        <div class="horizon-row">${horizonItems || "<i>等待专项验证</i>"}</div>
        <small class="walk-forward ${stability.status === "passed" ? "rise" : "muted"}">${stabilityText}</small>
      </article>`;
    }).join("") || `<article class="method-backtest-card"><strong>暂无方法验证</strong><p>等待 V60 运行。</p></article>`;
  }

  const forward = snapshot.methodForwardValidationV69 || {};
  setText("methodForwardValidationSummary", forward.summary || "等待归档");
  setText("methodForwardValidationGuardrail", forward.guardrail || "仅以冻结的候选快照做后验，不使用事后名单。");
  const forwardEl = $("methodForwardValidationRows");
  if (forwardEl) {
    forwardEl.innerHTML = (forward.methodRows || []).map((row) => (
      `<article class="method-backtest-card">
        <header><strong>${text(row.source)}</strong><em class="status status-wait">前验中</em></header>
        <span>冻结样本 ${text(row.sampleCount, 0)} 只 / 下一交易日开盘进入</span>
        <b>10日 ${text(row.h10Average, "--")}%</b>
        <p>20日 ${text(row.h20Average, "--")}% / 30日 ${text(row.h30Average, "--")}%</p>
        <small>已到期样本不足时不做方法优劣结论。</small>
      </article>`
    )).join("") || `<article class="method-backtest-card"><strong>${forward.attributionStatus === "legacy_mapping_not_method_attributable" ? "旧队列仅保留，不作方法归因" : "等待首个严格冻结快照"}</strong><p>${forward.attributionStatus === "legacy_mapping_not_method_attributable" ? "下一次正式日线信号将按 signal / condition / governance 三类来源重建前验。" : "仅在正式日线信号日写入一次。"}</p></article>`;
  }

  const timelineEl = $("dailyDecisionTimeline");
  if (timelineEl) {
    timelineEl.innerHTML = (snapshot.dailyDecisionTimeline || []).map((row) => (
      `<div class="timeline-row"><time>${text(row.time)}</time><strong>${text(row.stage)}</strong><span>${text(row.purpose)}</span></div>`
    )).join("") || `<div class="timeline-row"><time>--</time><strong>等待时间表</strong><span>V60 运行后显示。</span></div>`;
  }
  const computeEl = $("computePolicyRows");
  const freshness = snapshot.backtestFreshness || {};
  const freshnessEl = $("backtestFreshness");
  if (freshnessEl) {
    const elapsed = freshness.elapsedTradingDays;
    freshnessEl.className = `freshness-note ${freshness.status === "当前可复用" ? "is-current" : "is-rebuild"}`;
    freshnessEl.innerHTML = `<strong>回测状态：${text(freshness.status, "等待核验")}</strong><span>${text(freshness.reason, "等待下一次刷新")}${elapsed === null || elapsed === undefined ? "" : `；已推进 ${text(elapsed)} 个交易日`}</span>`;
  }
  if (computeEl) {
    const labels = {
      liveQuotes: "实时行情",
      dailyPool: "每日候选池",
      sourceReview: "学习源",
      fullBacktest: "完整回测",
      promotion: "晋级门槛",
    };
    computeEl.innerHTML = Object.entries(snapshot.computePolicy || {}).map(([key, value]) => (
      `<div class="compute-row"><strong>${text(labels[key], key)}</strong><span>${text(value)}</span></div>`
    )).join("") || `<div class="compute-row"><strong>等待算力策略</strong><span>V60 运行后显示。</span></div>`;
  }

  const failureRows = snapshot.failureAttributionRows || [];
  setText("failureAttributionSummary", snapshot.failureAttributionSummary || "等待刷新");
  const causeEl = $("failureCauseRows");
  if (causeEl) {
    causeEl.innerHTML = (snapshot.failureCauseRows || []).slice(0, 6).map((row) => (
      `<div class="cause-card">
        <strong>${text(row.cause)}</strong>
        <span>样本 ${text(row.sample_count)} / 高风险 ${text(row.high_risk_count)}</span>
        <b class="${num(row.h3_avg) >= 0 ? "rise" : "fall"}">3日 ${fmt(row.h3_avg)}%</b>
        <small>${text(row.examples)}</small>
      </div>`
    )).join("") || `<div class="cause-card"><strong>暂无归因</strong><span>等待 V55 运行</span><b>--</b></div>`;
  }
  const failureEl = $("failureAttributionRows");
  if (failureEl) {
    failureEl.innerHTML = failureRows.slice(0, 18).map((row) => (
      `<div class="failure-row">
        <div><strong>${text(row.name)} <small>${text(row.code)}</small></strong><span>${text(row.sector)} / ${text(row.candidate_type)}</span></div>
        <em class="${statusClass(row.severity)}">${text(row.severity)}</em>
        <b>${text(row.primary_cause)}</b>
        <span class="${num(row.h3_return) >= 0 ? "rise" : "fall"}">${fmt(row.h3_return)}%</span>
        <p>${text(row.rule_effect)}<small>${(row.evidence || []).slice(0, 2).map(text).join("；")}</small></p>
      </div>`
    )).join("") || `<div class="failure-row"><div><strong>暂无失败归因</strong><span>等待 V55 运行。</span></div><em class="status-wait">待刷新</em><b>--</b><span>--</span><p>候选后验样本出现后才会归因。</p></div>`;
  }

  const freshness = snapshot.dataFreshnessMetrics || {};
  setText("dataFreshnessSummary", snapshot.dataFreshnessSummary || "等待刷新");
  const freshnessMetricEl = $("dataFreshnessMetrics");
  if (freshnessMetricEl) {
    const metricRows = [
      ["总缓存", freshness.total],
      ["目标日覆盖", `${text(freshness.targetCoverage, 0)} / ${text(freshness.targetRatio, 0)}%`],
      ["滞后数量", freshness.staleCount],
      ["eligible 截面", freshness.eligibleDate],
    ];
    freshnessMetricEl.innerHTML = metricRows.map(([label, value]) => (
      `<div class="freshness-card"><strong>${text(label)}</strong><b>${text(value)}</b></div>`
    )).join("");
  }
  const coverageEl = $("dataFreshnessCoverageRows");
  if (coverageEl) {
    coverageEl.innerHTML = (snapshot.dataFreshnessCoverageRows || []).map((row) => (
      `<div class="coverage-row">
        <strong>${text(row.date)}</strong>
        <span>${text(row.coverage)} 只</span>
        <em class="${row.isTarget ? "status status-positive" : "status status-wait"}">${row.isTarget ? "目标日" : "历史截面"}</em>
      </div>`
    )).join("") || `<div class="coverage-row"><strong>暂无覆盖数据</strong><span>等待 V58 运行</span><em class="status-wait">待刷新</em></div>`;
  }
  const repairEl = $("dataFreshnessRepairQueue");
  if (repairEl) {
    repairEl.innerHTML = (snapshot.dataFreshnessRepairQueue || []).slice(0, 10).map((row) => (
      `<div class="repair-row">
        <strong>${text(row.code)}</strong>
        <span>${text(row.tail_date)} / 滞后 ${text(row.lag_days)} 天</span>
        <b>${fmt(row.priority_score)}</b>
        <em>${text(row.reason)}</em>
      </div>`
    )).join("") || `<div class="repair-row"><strong>暂无修复队列</strong><span>当前未设置修复额度或已无滞后</span><b>--</b><em>待刷新</em></div>`;
  }

  const bestRows = snapshot.bestObservationQueueRows || [];
  setText("bestQueueSummary", snapshot.bestQueueSummary || "等待刷新");
  const fresh = snapshot.bestQueueFreshness || {};
  setText("bestQueueFreshness", fresh.note ? `数据新鲜度：${text(fresh.confidence)}。${text(fresh.note)}` : "等待数据新鲜度");
  const bestLaneEl = $("bestObservationLaneRows");
  if (bestLaneEl) {
    bestLaneEl.innerHTML = (snapshot.bestObservationLaneRows || []).map((row) => (
      `<div class="best-lane-card">
        <strong>${text(row.lane)}</strong>
        <span>数量 ${text(row.count)}</span>
        <b>${fmt(row.avg_queue_score)}</b>
      </div>`
    )).join("") || `<div class="best-lane-card"><strong>暂无队列</strong><span>等待 V57 运行</span><b>--</b></div>`;
  }
  const bestEl = $("bestObservationQueueRows");
  if (bestEl) {
    bestEl.innerHTML = bestRows.slice(0, 16).map((row) => (
      `<div class="best-queue-row">
        <div><strong>${text(row.name)} <small>${text(row.code)}</small></strong><span>${text(row.sector)} / ${text(row.horizon)}</span></div>
        <em class="${statusClass(row.lane)}">${text(row.lane)}</em>
        <b>${fmt(row.queue_score)}</b>
        <span class="${statusClass(row.watch_plan)}">${text(row.watch_plan)}</span>
        <p>${text(row.why)}<small>${text(row.watch_note)} ${text(row.instruction, "")}</small></p>
      </div>`
    )).join("") || `<div class="best-queue-row"><div><strong>暂无最佳观察队列</strong><span>等待 V57 运行。</span></div><em class="status-wait">待刷新</em><b>--</b><span>--</span><p>风险调整池更新后会生成持续观察队列。</p></div>`;
  }

  const riskRows = snapshot.riskAdjustedRows || [];
  setText("riskAdjustedSummary", snapshot.riskAdjustedSummary || "等待刷新");
  const riskStatusEl = $("riskAdjustedStatusRows");
  if (riskStatusEl) {
    riskStatusEl.innerHTML = (snapshot.riskAdjustedStatusRows || []).map((row) => (
      `<div class="risk-status-card">
        <strong>${text(row.status)}</strong>
        <span>数量 ${text(row.count)} / 平均扣分 ${fmt(row.avg_penalty)}</span>
        <b>${fmt(row.avg_adjusted_score)}</b>
      </div>`
    )).join("") || `<div class="risk-status-card"><strong>暂无风险调整</strong><span>等待 V56 运行</span><b>--</b></div>`;
  }
  const riskEl = $("riskAdjustedRows");
  if (riskEl) {
    riskEl.innerHTML = riskRows.slice(0, 18).map((row) => (
      `<div class="risk-adjusted-row">
        <div><strong>${text(row.name)} <small>${text(row.code)}</small></strong><span>${text(row.sector)} / ${text(row.quality_type)}</span></div>
        <em class="${statusClass(row.status)}">${text(row.status)}</em>
        <b>${fmt(row.adjusted_score)}</b>
        <span>${fmt(row.risk_penalty)}</span>
        <p>${text(row.note)}<small>${(row.risk_reasons || []).slice(0, 2).map(text).join("；") || text(row.instruction)}</small></p>
      </div>`
    )).join("") || `<div class="risk-adjusted-row"><div><strong>暂无风险调整样本</strong><span>等待 V56 运行。</span></div><em class="status-wait">待刷新</em><b>--</b><span>--</span><p>强势池更新后会按失败归因扣分重排。</p></div>`;
  }

  renderIntraday(intraday);
}

function renderIntraday(intraday) {
  if (!intraday || !Object.keys(intraday).length) {
    $("intradayAction").innerHTML = `<div class="line"><strong>暂无 13:00 跑批</strong><span class="muted">等待下一次盘中扫描。</span></div>`;
    return;
  }
  setText("intradayTime", intraday.generated_at || "13:00 跑批");
  const candidates = intraday.candidates || [];
  const holdings = intraday.holdings || [];
  const buyable = candidates.filter((row) => row.action === "SMALL_WATCH");
  const waits = candidates.filter((row) => row.action === "WAIT").slice(0, 4);
  const risks = holdings.filter((row) => ["REDUCE", "CLEAR"].includes(row.action));
  const candidateText = buyable.length
    ? buyable.map((row) => `${row.code} ${row.name}: 可小仓，买入区 ${fmt(row.entry_low)}-${fmt(row.entry_high)}`).join("<br>")
    : `当前没有可小仓票。观察：${waits.map((row) => `${row.code} ${row.name}`).join("、") || "无"}。`;
  const riskText = risks.length
    ? risks.map((row) => `${row.code} ${row.name}: ${actionText(row.action)}，${reasonText(row.reason)}`).join("<br>")
    : "持仓暂无硬性清仓信号，继续按风险线观察。";
  $("intradayAction").innerHTML = `
    <div class="line"><strong>新开仓</strong><span>${candidateText}</span></div>
    <div class="line"><strong>持仓</strong><span>${riskText}</span></div>
  `;
}

function renderLive(live) {
  setText("liveStatus", live.ok ? "Tushare 实时连接" : "实时失败 / 看快照");
  setText("autoLiveSource", live.ok ? "Tushare 已连接" : "静态快照");
  setText("autoLiveTime", live.generatedAt ? `${shortDateTime(live.generatedAt)} / 60秒刷新` : "每 60 秒刷新");
  setOpsCardState("autoLiveSource", live.ok ? "is-ok" : "is-warn");
  const dot = $("liveDot");
  if (dot) dot.className = live.ok ? "dot on" : "dot off";
  setText("liveMessage", live.message || "--");
  setText("liveTime", live.generatedAt ? new Date(live.generatedAt).toLocaleTimeString("zh-CN") : "--");

  const renderRows = (rows) => {
    if (!rows || rows.length === 0) return `<p class="muted">暂无样本</p>`;
    return rows.slice(0, 8).map((row) => `
      <div class="live-row">
        <div><strong>${text(row.name || row.code)}</strong><small>${text(row.code, "")}</small></div>
        <span class="${num(row.pct) >= 0 ? "rise" : "fall"}">${pct(row.pct, true)}</span>
        <span>${fmt(row.close)}</span>
      </div>
    `).join("");
  };
  $("strongRisers").innerHTML = renderRows(live.strongRisers);
  $("limitWatch").innerHTML = renderRows(live.limitWatch);
}

async function loadSnapshot() {
  const res = await fetch("/snapshot.json", { cache: "no-store" });
  state.snapshot = await res.json();
  renderSnapshot(state.snapshot);
  loadQuotes();
}

async function loadLive() {
  if (state.snapshot?.githubPagesStatic) {
    state.live = {
      ok: false,
      generatedAt: state.snapshot.generatedAt || new Date().toISOString(),
      message: "GitHub Pages 去敏静态镜像：不读取本机 Token；实时行情仅在本机/私有服务可用。",
      strongRisers: [],
      limitWatch: [],
    };
    renderLive(state.live);
    return;
  }
  try {
    const res = await fetch("/api/market", { cache: "no-store" });
    state.live = await res.json();
  } catch (error) {
    state.live = {
      ok: false,
      generatedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : "实时接口异常",
      strongRisers: [],
      limitWatch: [],
    };
  }
  renderLive(state.live);
}

function collectQuoteCodes(snapshot) {
  if (!snapshot) return [];
  const codes = [];
  const intraday = snapshot.intraday1300 || {};
  for (const row of (snapshot.strengthObserver?.candidates || []).slice(0, 40)) codes.push(row.code);
  for (const row of (intraday.candidates || snapshot.candidates || []).slice(0, 40)) codes.push(row.code);
  for (const row of (intraday.holdings || snapshot.holdings || [])) codes.push(row.code);
  return [...new Set(codes.map(normalizeCode).filter(Boolean))].slice(0, 120);
}

async function loadQuotes() {
  if (!state.snapshot) return;
  const codes = collectQuoteCodes(state.snapshot);
  if (!codes.length) return;
  try {
    const res = await fetch(`/api/quotes?codes=${encodeURIComponent(codes.join(","))}`, { cache: "no-store" });
    const payload = await res.json();
    state.quoteStatus = payload;
    state.quotesByCode = new Map((payload.rows || []).map((row) => [normalizeCode(row.code), row]));
  } catch (error) {
    state.quoteStatus = {
      ok: false,
      message: error instanceof Error ? error.message : "实时观察池刷新失败",
    };
    state.quotesByCode = new Map();
  }
  renderSnapshot(state.snapshot);
}

loadSnapshot().catch((error) => {
  setText("modelName", "快照读取失败");
  setText("modelNote", error instanceof Error ? error.message : "未知错误");
});
loadLive();
setInterval(loadLive, 60_000);
setInterval(loadQuotes, 60_000);
