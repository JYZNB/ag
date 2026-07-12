# 模型学习源队列 2026-07-12

目标：把外部经验转成可验证规则。任何新规则都先进入学习版，不能直接替代正式买卖信号。

## 已入库来源

| 来源 | 类型 | 吸收内容 | 当前处理 |
|---|---|---|---|
| Microsoft Qlib | GitHub / quant platform | 成熟量化系统把数据、特征、模型、回测、报告和监控拆成闭环，而不是临时每天问一次。 | 已入库：工程治理规则，不直接生成买入信号。 |
| QuantConnect LEAN | GitHub / trading engine | 成熟交易引擎把 universe、alpha、portfolio、risk、execution 分开，避免把选股分数误当仓位和下单。 | 已入库：架构约束，不直接生成买入信号。 |
| Backtrader | GitHub / backtesting framework | 策略、数据、指标和分析器要分离，回测结果要能复现、审计和比较。 | 已入库：验证流程规则，不直接生成买入信号。 |
| vectorbt | GitHub / vectorized research engine | 快速批量实验适合发现参数敏感性，但成交、费用、滑点和时间顺序仍必须单独审计。 | 已入库：研究效率规则，不直接生成买入信号。 |
| MLFinLab Purged Cross-Validation | GitHub / financial-machine-learning validation | 金融标签和持有期会重叠，普通随机切分会泄漏未来信息；需要按时间顺序 purge 与 embargo，并对多次试验的回测表现折扣。 | 已入库：反过拟合治理规则，不直接生成买入信号。 |
| Riskfolio-Lib | GitHub / portfolio risk optimization | 候选质量和组合风险是两件事；波动、下行风险、回撤、集中度需要独立衡量。 | 已入库：组合风险约束，不直接生成买入信号。 |
| PyPortfolioOpt | GitHub / portfolio construction | 预期收益估计误差会放大仓位错误，稳健约束通常比追求理论最优权重更重要。 | 已入库：仓位隔离规则，不直接生成买入信号。 |
| QuantStats | GitHub / performance analytics | 策略评价必须同时展示收益、回撤、波动、胜率和相对基准，不能只挑最好看的累计收益。 | 已入库：绩效审计规则，不直接生成买入信号。 |
| AQR Time Series Momentum | investment-manager research | 动量证据应来自资产自身多个周期的过去表现，不能把单日拉升等同于趋势成立。 | 已入库：趋势证据规则，仍需市场和风险过滤。 |
| AQR Trend Following Evidence | investment-manager research | 趋势跟随的价值来自长样本、跨周期和纪律，而不是几次短线反馈。 | 已入库：晋级纪律规则。 |
| Goldman Sachs Insights | investment-bank public research | 机构研究更重视宏观环境、风险偏好和行业叙事；主题强度不能只看涨幅。 | 已入库：板块叙事过滤，暂不晋级买入权重。 |
| J.P. Morgan Guide to the Markets | investment-bank market guide | 市场周期、估值、利率和风险资产偏好会改变同一个技术信号的意义。 | 已入库：市场状态闸门。 |
| BlackRock Investment Institute | asset-manager public research | 同一趋势信号在增长、通胀、利率和风险偏好环境下含义不同，跨资产分化是市场状态的一部分。 | 已入库：市场状态解释层，不直接生成买入信号。 |
| Howard Marks / Oaktree Memos | investment practitioner / cycle and risk | 预测必须同时写出不知道什么、市场可能已经计价什么，以及判断被证伪的条件。 | 已入库：不确定性与反证纪律，不直接生成买入信号。 |
| Kenneth French Data Library | academic factor data | 动量、规模和价值暴露需要与个股特异收益区分，不能把板块贝塔误当作选股能力。 | 已入库：因子归因规则，不直接生成买入信号。 |
| Rob Carver Systematic Trading | systematic trader | 系统交易要长期、组合化、规则化地承认不确定性，不能因为几次亏损不断追着样本改口径。 | 已入库：失败归因和防过拟合纪律。 |
| Investor's Business Daily CAN SLIM | public growth-stock method | 强势股方法重视市场方向、买点、卖出纪律和基本面/成长性组合。 | 已入库：强势股观察规则。 |

## 进入模型顺序

1. 来源入库：记录链接、类型、核心观点、适用边界。
2. 规则翻译：把观点拆成可计算变量，例如市场闸门、板块扩散、涨停质量、回撤、流动性。
3. 反例检查：先找容易误伤、追高、幸存者偏差或数据污染的场景。
4. 学习版前验：只进入观察池，不直接输出可买。
5. 晋级门槛：跑赢基准、回撤可控、样本足够、执行可行，才允许进入正式模型。

## 当前结论

V31 仍是正式底座；V48/V50/V57 是持续观察层；V65 负责把扩展学习源、规则补丁和晋级纪律持续同步到线上表盘。
