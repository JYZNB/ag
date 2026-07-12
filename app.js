const $ = (id) => document.getElementById(id);
const n = (v) => Number.isFinite(Number(v)) ? Number(v) : NaN;
const pct = (v) => Number.isFinite(n(v)) ? `${n(v) >= 0 ? "+" : ""}${(n(v) * 100).toFixed(2)}%` : "--";
const num = (v) => Number.isFinite(n(v)) ? n(v).toFixed(2) : "--";
const text = (v, d = "--") => v === undefined || v === null || v === "" ? d : String(v);

function metric(check, id) { const q=check?.qfq||{}, r=check?.tdxRaw||{}; $(id).textContent=pct(q.avgReturn); $(`${id}sub`).textContent=`前复权 ${pct(q.winRate)} 胜率 / 通达信 ${pct(r.winRate)} 胜率`; }
function render(s) {
  const f=s.fusionModelV73||{}, selected=f.selectedResearchCore;
  $("updatedAt").textContent=s.generatedAt ? new Date(s.generatedAt).toLocaleString("zh-CN") : "--";
  $("coreStatus").textContent=selected ? "双样本研究通过" : "等待双样本验证";
  $("coreTitle").textContent=selected === "V50_momentum_quality" ? "趋势质量融合模型" : "暂无可用融合核心";
  $("coreSummary").textContent=f.summary || "等待融合验证";
  $("formalStatus").textContent=f.formalPromotion ? "已晋级" : "研究观察";
  $("dataEnd").textContent=text(s.dataReadiness?.history?.latestDate || s.latestDate);
  const row=(f.rows||[]).find(x=>x.layer===selected); const checks=row?.checks||[];
  metric(checks.find(x=>x.horizon===3),"m3"); metric(checks.find(x=>x.horizon===5),"m5"); metric(checks.find(x=>x.horizon===7),"m7");
  const h=s.dataReadiness?.history||{}; $("dataStatus").textContent=text(h.status,"观察"); $("dataSub").textContent=`覆盖 ${text(h.coverage,"--")} / ${text(h.coverageRatio,"--")}`;
  $("dataNote").textContent=s.publicMirrorNotice || "本页面仅展示经发布的研究快照。";
  const rows=(s.momentumQuality?.candidates||[]).slice(0,20); $("candidateCount").textContent=`${rows.length} 只研究观察`;
  $("candidateRows").innerHTML=rows.map(r=>`<tr><td><strong>${text(r.name)}</strong><small>${text(r.code)}</small></td><td>${text(r.sector)}</td><td>${text(r.quality_type)}</td><td>${num(r.quality_score)}</td><td>${num(r.close)}</td><td>${num(r.entry_low)} - ${num(r.entry_high)}</td><td>${num(r.risk_line)}</td><td>${text(r.explain)}</td></tr>`).join("") || `<tr><td colspan="8">当前没有符合过滤条件的研究观察样本。</td></tr>`;
}
fetch("./snapshot.json",{cache:"no-store"}).then(r=>r.json()).then(render).catch(e=>{$("coreTitle").textContent="快照读取失败";$("coreSummary").textContent=e.message});
