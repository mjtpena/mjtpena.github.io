---
title: "Fabric Data Agent Accuracy Is a Distribution, Not a Number"
author: Michael John Peña
draft: false
date: 2026-10-29
description: "I asked a Fabric data agent 24 questions in three wordings, ten times each, on real AEMO data. It scored 82%, but only 39% of wordings were always right."
tags:
  - Microsoft Fabric
  - AI Agents
  - Evaluation
  - Python
  - Power BI
---

I asked a Fabric data agent "What was Queensland's highest demand over the last quarter?" ten times, each in a fresh conversation. Once it said 8,187.54 MW, which is correct. Nine times it said 5,993.13 MW, a single five-minute interval from 1 October. Across all three wordings it was right 14 times in 30, so for this question a one-off evaluation run is close to a coin toss.

Marc's [post on data-marc.com](https://data-marc.com/2026/10/27/can-you-trust-your-fabric-data-agent-programmatically-testing-accuracy-and-determinism/) makes the case for automated tests that store the query producing the expected answer rather than the answer itself. He names determinism as the goal but doesn't measure it. So I did: 24 questions, three wordings each, ten runs per wording, on real Australian electricity market data, with every stage of the agent's work captured. **Accuracy is a distribution**, and the number your evaluation prints is one draw from it.

## The rig

The data is AEMO's [aggregated price and demand data](https://www.aemo.com.au/energy-systems/electricity/national-electricity-market-nem/data-nem/aggregated-data): five-minute regional prices and demand for all five NEM regions from January 2025 to September 2026, 918,720 intervals, used with attribution under AEMO's copyright permissions. It lands in a lakehouse as a small star schema, with a Direct Lake semantic model on top carrying six measures. One data agent has both sources attached.

<figure class="ff">
<svg class="ff-svg" viewBox="0 0 900 400" role="img" aria-label="Test rig architecture. AEMO 5-minute price and demand CSVs are loaded into the LH_NEM lakehouse as three Delta tables. A Direct Lake semantic model, SM_NEM, sits over the lakehouse SQL analytics endpoint. The DA_NEM data agent has both the lakehouse and the semantic model attached. A local Python harness asks every question in a fresh conversation through the Responses API, then sends the SDK's judge prompt as a second turn. Ground truth is computed at run time by stored SQL against the SQL analytics endpoint and cross-checked with an independent pandas recomputation.">
<defs>
<marker id="daF" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0,0 L6.5,3 L0,6 Z" class="ff-ah-flow"/></marker>
<marker id="daR" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0,0 L6.5,3 L0,6 Z" class="ff-ah-read"/></marker>
<marker id="daW" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0,0 L6.5,3 L0,6 Z" class="ff-ah-write"/></marker>
<marker id="daD" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0,0 L6.5,3 L0,6 Z" class="ff-ah-dash"/></marker>
</defs>
<rect x="20" y="20" width="560" height="232" rx="16" class="ff-zone ff-zone-flow"/>
<text x="40" y="42" class="ff-zlabel">FABRIC WORKSPACE · F16 · AUSTRALIA EAST</text>
<rect x="40" y="60" width="150" height="76" rx="11" class="ff-node"/>
<text x="115" y="90" text-anchor="middle" class="ff-title">AEMO NEM data</text>
<text x="115" y="108" text-anchor="middle" class="ff-sub">105 monthly CSVs</text>
<text x="115" y="124" text-anchor="middle" class="ff-tok">5 regions · 5-min</text>
<rect x="222" y="60" width="160" height="76" rx="11" class="ff-node ff-node-az"/>
<image href="/icons/fabric/lakehouse_48_item.svg" x="234" y="70" width="22" height="22"/>
<text x="262" y="86" class="ff-title">LH_NEM</text>
<text x="234" y="110" class="ff-sub">3 Delta tables</text>
<text x="234" y="126" class="ff-tok">918,720 intervals</text>
<rect x="414" y="60" width="150" height="76" rx="11" class="ff-node ff-node-az"/>
<image href="/icons/fabric/semantic_model_48_item.svg" x="426" y="70" width="22" height="22"/>
<text x="454" y="86" class="ff-title">SM_NEM</text>
<text x="426" y="110" class="ff-sub">Direct Lake model</text>
<text x="426" y="126" class="ff-tok">6 measures</text>
<rect x="222" y="172" width="342" height="64" rx="11" class="ff-node ff-node-cy"/>
<image href="/icons/fabric/data_agent_48_item.svg" x="236" y="183" width="22" height="22"/>
<text x="266" y="199" class="ff-title">DA_NEM data agent</text>
<text x="236" y="224" class="ff-sub">GPT-5.1 orchestrator · both sources attached · published</text>
<line x1="192" y1="98" x2="220" y2="98" class="ff-edge-flow" marker-end="url(#daF)"/>
<line x1="384" y1="98" x2="412" y2="98" class="ff-edge-flow" marker-end="url(#daF)"/>
<text x="398" y="90" text-anchor="middle" class="ff-lgd">SQL</text>
<line x1="302" y1="138" x2="302" y2="170" class="ff-edge-read" marker-end="url(#daR)"/>
<line x1="489" y1="138" x2="489" y2="170" class="ff-edge-read" marker-end="url(#daR)"/>
<text x="310" y="158" class="ff-lgd">T-SQL</text>
<text x="497" y="158" class="ff-lgd">DAX</text>
<rect x="620" y="20" width="260" height="232" rx="16" class="ff-zone ff-zone-write"/>
<text x="640" y="42" class="ff-zlabel">LOCAL PYTHON HARNESS</text>
<rect x="640" y="60" width="220" height="76" rx="11" class="ff-node ff-node-am"/>
<image href="/icons/python.svg" x="652" y="70" width="20" height="20"/>
<text x="680" y="85" class="ff-title">Repeat loop</text>
<text x="652" y="108" class="ff-sub">72 wordings · ×10 (v0) · ×5 (v1)</text>
<text x="652" y="124" class="ff-tok">FabricOpenAIResponses</text>
<rect x="640" y="172" width="220" height="64" rx="11" class="ff-node ff-node-am"/>
<text x="652" y="196" class="ff-title">SDK judge, turn 2</text>
<text x="652" y="222" class="ff-sub">same conversation, same agent</text>
<path d="M638,98 C 610,98 600,204 566,204" class="ff-edge-write" marker-end="url(#daW)"/>
<path d="M638,214 C 610,214 600,214 566,214" class="ff-edge-write" marker-end="url(#daW)"/>
<text x="604" y="150" text-anchor="middle" class="ff-lgd">question,</text>
<text x="604" y="163" text-anchor="middle" class="ff-lgd">new conversation</text>
<text x="602" y="234" text-anchor="middle" class="ff-lgd">judge prompt</text>
<rect x="20" y="276" width="860" height="86" rx="16" class="ff-zone ff-zone-read"/>
<text x="40" y="298" class="ff-zlabel">DYNAMIC GROUND TRUTH · COMPUTED AT RUN TIME</text>
<rect x="40" y="310" width="300" height="40" rx="10" class="ff-node ff-node-cy"/>
<text x="56" y="335" class="ff-sub">Stored T-SQL → SQL analytics endpoint</text>
<rect x="360" y="310" width="250" height="40" rx="10" class="ff-node"/>
<text x="376" y="335" class="ff-sub">pandas recompute from raw CSVs</text>
<rect x="630" y="310" width="230" height="40" rx="10" class="ff-node"/>
<text x="646" y="335" class="ff-sub">Grade · fingerprint each stage</text>
<line x1="342" y1="330" x2="358" y2="330" class="ff-edge-dash" marker-end="url(#daD)"/>
<line x1="612" y1="330" x2="628" y2="330" class="ff-edge-dash" marker-end="url(#daD)"/>
<line x1="750" y1="238" x2="750" y2="308" class="ff-edge-dash" marker-end="url(#daD)"/>
<text x="30" y="386" class="ff-lgd" style="fill:#6f787f">official Microsoft Fabric icons · data © AEMO (NEM price and demand, Jan 2025 – Sep 2026), used with attribution</text>
</svg>
<figcaption><strong>Figure 1.</strong> The test rig. Real AEMO data lands in a lakehouse, a Direct Lake model sits on top, and the data agent can reach both. A local harness asks every question in a brand-new conversation, then grades the answer the way <code>evaluate_data_agent</code> does. Expected values come from stored queries run at evaluation time, and every one was cross-checked against an independent recomputation.</figcaption>
</figure>

<img src="/images/blog/2026-10-29-fabric-data-agent-determinism/workspace.webp" alt="The WS-DATAAGENT-DETERMINISM workspace in the Fabric portal listing the DA_NEM data agent, the LH_NEM lakehouse with its SQL analytics endpoint, the NB_Evaluate_Repeats notebook and the SM_NEM semantic model." loading="lazy" />

<img src="/images/blog/2026-10-29-fabric-data-agent-determinism/agent-config.webp" alt="The DA_NEM data agent in the Fabric portal with LH_NEM and SM_NEM ticked as sources, the Standard runtime selected, and Fabric's banner saying the agent now runs on GPT 5.1 and recommending validation with test prompts and expected outputs." loading="lazy" />

The questions include real traps. AEMO timestamps mark the **end** of each interval, so September's last row is stamped 00:00 on 1 October. My ground truth follows the date dimension and assigns each row to the date on its stamp. "Average price" can mean the simple mean of intervals or the demand-weighted price, and for South Australia in 2025 those are $86.73/MWh and $117.95/MWh. The financial year runs July to June. Every expected value comes from a stored T-SQL query run against the SQL analytics endpoint at evaluation time (Marc's dynamic ground truth), and all 24 matched an independent pandas recomputation from the raw CSVs exactly.

The harness calls the published agent through `FabricOpenAIResponses` (SDK [0.1.33a0](https://pypi.org/project/fabric-data-agent-sdk/), which added headless credentials; see [how the Responses API client changed](/blog/2026-09-08-fabric-data-agent-responses-api-migration/)) in a new conversation for every ask. It records the rewritten question, data source, generated query and answer, and grades each answer twice: with the SDK's judge prompt as a second turn, as [`evaluate_data_agent`](https://learn.microsoft.com/en-us/fabric/data-science/evaluate-data-agent) does, and with a deterministic numeric comparator. Throttled attempts were re-asked. `evaluate_data_agent` can repeat questions itself (`num_query_repeats`), and its `_steps` table records each tool call's natural-language query, but it doesn't report pass^k.

The agent ran on the Standard runtime, not the preview runtime; the API runs used F16 and the 29 October notebook and portal checks used F4. The SDK and `evaluate_data_agent` are in preview (0.1.33a0 is an alpha on PyPI), and these results cover 24 questions on one dataset.

## 82% accurate, 39% dependable

Across 720 runs the agent was right 82.4% of the time. Scored one pass at a time, the same 72 wordings came in anywhere from 73.6% to 86.1%. And only 28 of the 72 wordings were right on all ten runs. Forty were flaky: right on some runs, wrong on others, with nothing changed in between.

<figure class="ff">
<svg class="ff-svg" viewBox="0 0 900 752" role="img" aria-label="Dot plot of pass rate per question for config v0, three wordings per question.">
<text x="30.0" y="30.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:14px;font-weight:600;fill:#e8ecef" >Pass rate per question across repeated runs</text>
<text x="30.0" y="48.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11px;font-weight:400;fill:#98a2ab" >Config v0 · each dot is one wording of the question · 10 fresh conversations per wording</text>
<line x1="300.0" x2="300.0" y1="84" y2="706" stroke="#262d34" stroke-width="1"/>
<text x="300.0" y="722.0" text-anchor="middle" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:400;fill:#6f787f" >0%</text>
<line x1="440.0" x2="440.0" y1="84" y2="706" stroke="#262d34" stroke-width="1"/>
<text x="440.0" y="722.0" text-anchor="middle" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:400;fill:#6f787f" >25%</text>
<line x1="580.0" x2="580.0" y1="84" y2="706" stroke="#262d34" stroke-width="1"/>
<text x="580.0" y="722.0" text-anchor="middle" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:400;fill:#6f787f" >50%</text>
<line x1="720.0" x2="720.0" y1="84" y2="706" stroke="#262d34" stroke-width="1"/>
<text x="720.0" y="722.0" text-anchor="middle" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:400;fill:#6f787f" >75%</text>
<line x1="860.0" x2="860.0" y1="84" y2="706" stroke="#262d34" stroke-width="1"/>
<text x="860.0" y="722.0" text-anchor="middle" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:400;fill:#6f787f" >100%</text>
<rect x="300.6" y="84" width="558.9" height="622" fill="rgba(224,160,74,0.05)"/>
<text x="580.0" y="76.0" text-anchor="middle" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:400;fill:#c9a46a" >← flaky: right on some runs, wrong on others →</text>
<text x="30.0" y="106.0" text-anchor="start" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:400;fill:#6f787f" letter-spacing="1.2">LOOKUP</text>
<text x="30.0" y="125.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >L1  NSW peak demand 2025</text>
<line x1="748.0" x2="804.0" y1="121.0" y2="121.0" stroke="#48525c" stroke-width="2" stroke-linecap="round"/>
<circle cx="804.0" cy="121.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>L1 wording 1: &quot;What was the peak demand in NSW1 in calendar year 2025?&quot; (9 correct, 1 declined)</title></circle>
<circle cx="804.0" cy="121.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>L1 wording 2: &quot;Highest 5-minute demand recorded in New South Wales during 2025?&quot; (9 correct, 1 declined)</title></circle>
<circle cx="748.0" cy="121.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>L1 wording 3: &quot;nsw peak demand 2025&quot; (8 correct, 2 declined)</title></circle>
<text x="30.0" y="147.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >L2  SA max price Jul 2025</text>
<line x1="804.0" x2="860.0" y1="143.0" y2="143.0" stroke="#48525c" stroke-width="2" stroke-linecap="round"/>
<circle cx="860.0" cy="143.0" r="5" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>L2 wording 1: &quot;What was the highest price in SA1 in July 2025?&quot; (10 correct)</title></circle>
<circle cx="804.0" cy="143.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>L2 wording 2: &quot;What&#x27;s the maximum 5-minute spot price South Australia hit in July 2025?&quot; (9 correct, 1 declined)</title></circle>
<circle cx="860.0" cy="143.0" r="5" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>L2 wording 3: &quot;sa max price jul 2025&quot; (10 correct)</title></circle>
<text x="30.0" y="169.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >L3  VIC min price Sep 2026</text>
<circle cx="860.0" cy="165.0" r="5" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>L3 wording 1: &quot;What was the lowest price in VIC1 in September 2026?&quot; (10 correct)</title></circle>
<circle cx="860.0" cy="165.0" r="5" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>L3 wording 2: &quot;How low did the Victorian spot price go in September 2026?&quot; (10 correct)</title></circle>
<circle cx="860.0" cy="165.0" r="5" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>L3 wording 3: &quot;vic min price sep 2026&quot; (10 correct)</title></circle>
<text x="30.0" y="191.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >L4  SA negative intervals Sep 2026</text>
<line x1="804.0" x2="860.0" y1="187.0" y2="187.0" stroke="#48525c" stroke-width="2" stroke-linecap="round"/>
<circle cx="860.0" cy="187.0" r="5" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>L4 wording 1: &quot;How many 5-minute intervals had a negative price in SA1 in September 2026?&quot; (10 correct)</title></circle>
<circle cx="804.0" cy="187.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>L4 wording 2: &quot;In September 2026, how many dispatch intervals in South Australia cleared below zero?&quot; (9 correct, 1 declined)</title></circle>
<circle cx="804.0" cy="187.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>L4 wording 3: &quot;count negative price intervals sa sep 2026&quot; (9 correct, 1 declined)</title></circle>
<text x="30.0" y="213.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >L5  VIC peak demand Jun 2026</text>
<line x1="804.0" x2="860.0" y1="209.0" y2="209.0" stroke="#48525c" stroke-width="2" stroke-linecap="round"/>
<circle cx="860.0" cy="209.0" r="5" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>L5 wording 1: &quot;What was the peak demand in VIC1 in June 2026?&quot; (10 correct)</title></circle>
<circle cx="804.0" cy="209.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>L5 wording 2: &quot;What was Victoria&#x27;s highest demand in June 2026?&quot; (9 correct, 1 declined)</title></circle>
<circle cx="860.0" cy="209.0" r="5" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>L5 wording 3: &quot;vic peak demand june 2026&quot; (10 correct)</title></circle>
<text x="30.0" y="235.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >L6  QLD max price Jan 2026</text>
<line x1="804.0" x2="860.0" y1="231.0" y2="231.0" stroke="#48525c" stroke-width="2" stroke-linecap="round"/>
<circle cx="860.0" cy="231.0" r="5" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>L6 wording 1: &quot;What was the highest price in QLD1 in January 2026?&quot; (10 correct)</title></circle>
<circle cx="860.0" cy="231.0" r="5" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>L6 wording 2: &quot;What was the top spot price in Queensland in January 2026?&quot; (10 correct)</title></circle>
<circle cx="804.0" cy="231.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>L6 wording 3: &quot;qld max price jan 2026&quot; (9 correct, 1 declined)</title></circle>
<text x="30.0" y="256.0" text-anchor="start" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:400;fill:#6f787f" letter-spacing="1.2">AGGREGATION</text>
<text x="30.0" y="275.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >A1  TAS average demand 2025</text>
<line x1="748.0" x2="804.0" y1="271.0" y2="271.0" stroke="#48525c" stroke-width="2" stroke-linecap="round"/>
<circle cx="804.0" cy="271.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>A1 wording 1: &quot;What was the average demand in TAS1 in calendar year 2025?&quot; (9 correct, 1 wrong)</title></circle>
<circle cx="748.0" cy="271.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>A1 wording 2: &quot;On average, how much demand did Tasmania have across 2025?&quot; (8 correct, 2 declined)</title></circle>
<circle cx="804.0" cy="271.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>A1 wording 3: &quot;tas average demand 2025&quot; (9 correct, 1 declined)</title></circle>
<text x="30.0" y="297.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >A2  NEM negative intervals FY2026</text>
<line x1="804.0" x2="860.0" y1="293.0" y2="293.0" stroke="#48525c" stroke-width="2" stroke-linecap="round"/>
<circle cx="860.0" cy="293.0" r="5" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>A2 wording 1: &quot;How many negative price intervals were there across all NEM regions in FY2026?&quot; (10 correct)</title></circle>
<circle cx="804.0" cy="293.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>A2 wording 2: &quot;Across the whole NEM, how many region-intervals had a negative price in the 2025-26 financial year?&quot; (9 correct, 1 declined)</title></circle>
<circle cx="804.0" cy="293.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>A2 wording 3: &quot;total negative price intervals all regions fy2026&quot; (9 correct, 1 declined)</title></circle>
<text x="30.0" y="319.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >A3  SA intervals over $300, 2025</text>
<line x1="692.0" x2="860.0" y1="315.0" y2="315.0" stroke="#48525c" stroke-width="2" stroke-linecap="round"/>
<circle cx="860.0" cy="315.0" r="5" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>A3 wording 1: &quot;How many intervals in SA1 had a price above 300 AUD/MWh in calendar year 2025?&quot; (10 correct)</title></circle>
<circle cx="804.0" cy="315.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>A3 wording 2: &quot;In 2025, how many times did South Australia&#x27;s 5-minute price exceed $300/MWh?&quot; (9 correct, 1 wrong)</title></circle>
<circle cx="692.0" cy="315.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>A3 wording 3: &quot;sa intervals over $300 in 2025&quot; (7 correct, 3 declined)</title></circle>
<text x="30.0" y="341.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >A4  Most negative prices, Jul–Sep 2026</text>
<line x1="748.0" x2="860.0" y1="337.0" y2="337.0" stroke="#48525c" stroke-width="2" stroke-linecap="round"/>
<circle cx="860.0" cy="337.0" r="5" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>A4 wording 1: &quot;Which region had the most negative price intervals between July and September 2026?&quot; (10 correct)</title></circle>
<circle cx="804.0" cy="337.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>A4 wording 2: &quot;From July to September 2026, which NEM region recorded the most intervals with negative prices?&quot; (9 correct, 1 declined)</title></circle>
<circle cx="748.0" cy="337.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>A4 wording 3: &quot;region with most negative prices jul-sep 2026&quot; (8 correct, 2 declined)</title></circle>
<text x="30.0" y="363.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >A5  NSW weekend demand 2025</text>
<line x1="300.0" x2="860.0" y1="359.0" y2="359.0" stroke="#48525c" stroke-width="2" stroke-linecap="round"/>
<circle cx="860.0" cy="359.0" r="5" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>A5 wording 1: &quot;What was the average demand in NSW1 on weekends in calendar year 2025?&quot; (10 correct)</title></circle>
<circle cx="300.0" cy="359.0" r="5" fill="#e0554a" stroke="#0e1114" stroke-width="2"><title>A5 wording 2: &quot;How much demand did New South Wales average on Saturdays and Sundays in 2025?&quot; (9 wrong, 1 declined)</title></circle>
<circle cx="860.0" cy="359.0" r="5" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>A5 wording 3: &quot;nsw weekend average demand 2025&quot; (10 correct)</title></circle>
<text x="30.0" y="385.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >A6  NSW month of peak, 2025</text>
<line x1="748.0" x2="860.0" y1="381.0" y2="381.0" stroke="#48525c" stroke-width="2" stroke-linecap="round"/>
<circle cx="860.0" cy="381.0" r="5" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>A6 wording 1: &quot;Which month in calendar year 2025 had the highest peak demand in NSW1?&quot; (10 correct)</title></circle>
<circle cx="748.0" cy="381.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>A6 wording 2: &quot;In 2025, in which month did New South Wales hit its highest demand?&quot; (8 correct, 2 declined)</title></circle>
<circle cx="860.0" cy="381.0" r="5" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>A6 wording 3: &quot;nsw month of max demand 2025&quot; (10 correct)</title></circle>
<text x="30.0" y="406.0" text-anchor="start" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:400;fill:#6f787f" letter-spacing="1.2">TIME SEMANTICS</text>
<text x="30.0" y="425.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >T1  VIC average demand FY2025</text>
<circle cx="804.0" cy="421.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>T1 wording 1: &quot;What was the average demand in VIC1 in FY2025?&quot; (9 correct, 1 declined)</title></circle>
<circle cx="804.0" cy="421.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>T1 wording 2: &quot;What was Victoria&#x27;s average demand for the 2024-25 financial year?&quot; (9 correct, 1 declined)</title></circle>
<circle cx="804.0" cy="421.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>T1 wording 3: &quot;vic avg demand fy2025&quot; (9 correct, 1 wrong)</title></circle>
<text x="30.0" y="447.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >T2  QLD peak demand ‘last quarter’</text>
<line x1="356.0" x2="748.0" y1="443.0" y2="443.0" stroke="#48525c" stroke-width="2" stroke-linecap="round"/>
<circle cx="748.0" cy="443.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>T2 wording 1: &quot;What was the peak demand in QLD1 last quarter?&quot; (8 correct, 1 wrong, 1 declined)</title></circle>
<circle cx="356.0" cy="443.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>T2 wording 2: &quot;What was Queensland&#x27;s highest demand over the last quarter?&quot; (9 wrong, 1 correct)</title></circle>
<circle cx="580.0" cy="443.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>T2 wording 3: &quot;qld peak demand last quarter&quot; (5 wrong, 5 correct)</title></circle>
<text x="30.0" y="469.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >T3  VIC negative intervals ‘last month’</text>
<line x1="692.0" x2="804.0" y1="465.0" y2="465.0" stroke="#48525c" stroke-width="2" stroke-linecap="round"/>
<circle cx="804.0" cy="465.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>T3 wording 1: &quot;How many negative price intervals did VIC1 have last month?&quot; (9 correct, 1 wrong)</title></circle>
<circle cx="804.0" cy="465.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>T3 wording 2: &quot;Last month, how many 5-minute intervals in Victoria had negative prices?&quot; (9 correct, 1 wrong)</title></circle>
<circle cx="692.0" cy="465.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>T3 wording 3: &quot;vic negative intervals last month&quot; (7 correct, 3 wrong)</title></circle>
<text x="30.0" y="491.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >T4  NSW price at 18:00, 15 Jan 2026</text>
<line x1="804.0" x2="860.0" y1="487.0" y2="487.0" stroke="#48525c" stroke-width="2" stroke-linecap="round"/>
<circle cx="860.0" cy="487.0" r="5" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>T4 wording 1: &quot;What was the NSW1 price for the 5-minute interval ending at 18:00 on 15 January 2026?&quot; (10 correct)</title></circle>
<circle cx="804.0" cy="487.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>T4 wording 2: &quot;What was the New South Wales spot price at 6pm on 15 January 2026?&quot; (9 correct, 1 declined)</title></circle>
<circle cx="860.0" cy="487.0" r="5" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>T4 wording 3: &quot;nsw price 15 jan 2026 18:00&quot; (10 correct)</title></circle>
<text x="30.0" y="513.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >T5  NSW energy on 1 Sep 2026</text>
<line x1="636.0" x2="804.0" y1="509.0" y2="509.0" stroke="#48525c" stroke-width="2" stroke-linecap="round"/>
<circle cx="636.0" cy="509.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>T5 wording 1: &quot;How much energy in MWh did NSW1 consume on 1 September 2026?&quot; (6 correct, 3 declined, 1 wrong)</title></circle>
<circle cx="804.0" cy="509.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>T5 wording 2: &quot;What was New South Wales&#x27; total energy demand on 1 September 2026, in MWh?&quot; (9 correct, 1 declined)</title></circle>
<circle cx="804.0" cy="509.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>T5 wording 3: &quot;nsw energy mwh 1 sep 2026&quot; (9 correct, 1 declined)</title></circle>
<text x="30.0" y="535.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >T6  SA peak demand, Q2 of FY2026</text>
<circle cx="860.0" cy="531.0" r="5" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>T6 wording 1: &quot;What was the peak demand in SA1 in Q2 of FY2026?&quot; (10 correct)</title></circle>
<circle cx="860.0" cy="531.0" r="5" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>T6 wording 2: &quot;What was South Australia&#x27;s highest demand in the second quarter of the 2025-26 financial year?&quot; (10 correct)</title></circle>
<circle cx="860.0" cy="531.0" r="5" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>T6 wording 3: &quot;sa peak demand fy26 q2&quot; (10 correct)</title></circle>
<text x="30.0" y="556.0" text-anchor="start" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:400;fill:#6f787f" letter-spacing="1.2">DEFINITIONAL</text>
<text x="30.0" y="575.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >D1  Highest average price, FY2026</text>
<circle cx="860.0" cy="571.0" r="5" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>D1 wording 1: &quot;Which region had the highest average price in FY2026?&quot; (10 correct)</title></circle>
<circle cx="860.0" cy="571.0" r="5" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>D1 wording 2: &quot;In the 2025-26 financial year, which NEM region was the most expensive on average?&quot; (10 correct)</title></circle>
<circle cx="860.0" cy="571.0" r="5" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>D1 wording 3: &quot;highest avg price region fy2026&quot; (10 correct)</title></circle>
<text x="30.0" y="597.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >D2  SA average price 2025</text>
<circle cx="300.0" cy="593.0" r="5" fill="#e0554a" stroke="#0e1114" stroke-width="2"><title>D2 wording 1: &quot;What was the average price in SA1 in calendar year 2025?&quot; (9 alternative: simple avg, 1 declined)</title></circle>
<circle cx="300.0" cy="593.0" r="5" fill="#e0554a" stroke="#0e1114" stroke-width="2"><title>D2 wording 2: &quot;What did South Australian wholesale power cost on average in 2025?&quot; (10 alternative: simple avg)</title></circle>
<circle cx="300.0" cy="593.0" r="5" fill="#e0554a" stroke="#0e1114" stroke-width="2"><title>D2 wording 3: &quot;sa average price 2025&quot; (9 alternative: simple avg, 1 declined)</title></circle>
<text x="30.0" y="619.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >D3  NEM average price Sep 2026</text>
<line x1="412.0" x2="636.0" y1="615.0" y2="615.0" stroke="#48525c" stroke-width="2" stroke-linecap="round"/>
<circle cx="636.0" cy="615.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>D3 wording 1: &quot;What was the average price across the NEM in September 2026?&quot; (6 correct, 3 alternative: simple avg, 1 wrong)</title></circle>
<circle cx="468.0" cy="615.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>D3 wording 2: &quot;What was the NEM-wide average wholesale price in September 2026?&quot; (7 alternative: simple avg, 3 correct)</title></circle>
<circle cx="412.0" cy="615.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>D3 wording 3: &quot;nem average price sep 2026&quot; (8 alternative: simple avg, 2 correct)</title></circle>
<text x="30.0" y="641.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >D4  VIC total demand May 2026</text>
<line x1="636.0" x2="860.0" y1="637.0" y2="637.0" stroke="#48525c" stroke-width="2" stroke-linecap="round"/>
<circle cx="636.0" cy="637.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>D4 wording 1: &quot;What was the total demand in VIC1 in May 2026?&quot; (6 correct, 3 declined, 1 alternative: sum mw)</title></circle>
<circle cx="860.0" cy="637.0" r="5" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>D4 wording 2: &quot;How much electricity did Victoria use in total in May 2026?&quot; (10 correct)</title></circle>
<circle cx="860.0" cy="637.0" r="5" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>D4 wording 3: &quot;vic total demand may 2026&quot; (10 correct)</title></circle>
<text x="30.0" y="663.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >D5  SA hours of negative prices 2025</text>
<line x1="692.0" x2="748.0" y1="659.0" y2="659.0" stroke="#48525c" stroke-width="2" stroke-linecap="round"/>
<circle cx="748.0" cy="659.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>D5 wording 1: &quot;How many hours of negative prices did SA1 have in calendar year 2025?&quot; (8 correct, 1 wrong, 1 declined)</title></circle>
<circle cx="692.0" cy="659.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>D5 wording 2: &quot;In 2025, for how many hours were South Australian prices negative?&quot; (7 correct, 2 alternative: distinct clock hours, 1 declined)</title></circle>
<circle cx="748.0" cy="659.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>D5 wording 3: &quot;sa negative price hours 2025&quot; (8 correct, 1 wrong, 1 declined)</title></circle>
<text x="30.0" y="685.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >D6  Cheapest region Q2 2026</text>
<line x1="804.0" x2="860.0" y1="681.0" y2="681.0" stroke="#48525c" stroke-width="2" stroke-linecap="round"/>
<circle cx="804.0" cy="681.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>D6 wording 1: &quot;Which region was the cheapest in Q2 2026?&quot; (9 correct, 1 declined)</title></circle>
<circle cx="804.0" cy="681.0" r="5" fill="#e0a04a" stroke="#0e1114" stroke-width="2"><title>D6 wording 2: &quot;Which NEM region had the lowest average price in the second quarter of 2026?&quot; (9 correct, 1 declined)</title></circle>
<circle cx="860.0" cy="681.0" r="5" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>D6 wording 3: &quot;cheapest region q2 2026&quot; (10 correct)</title></circle>
<circle cx="34" cy="740" r="5" fill="#00a0ab"/><text x="44.0" y="744.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:10.5px;font-weight:400;fill:#98a2ab" >always right</text>
<circle cx="144" cy="740" r="5" fill="#e0a04a"/><text x="154.0" y="744.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:10.5px;font-weight:400;fill:#98a2ab" >flaky</text>
<circle cx="214" cy="740" r="5" fill="#e0554a"/><text x="224.0" y="744.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:10.5px;font-weight:400;fill:#98a2ab" >never right</text>
<text x="330.0" y="744.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:10.5px;font-weight:400;fill:#6f787f" >a grey bar joins the wordings of one question when they disagree</text>
</svg>
<figcaption><strong>Figure 2.</strong> Pass rate for each of the 72 wordings over ten fresh conversations, config v0. Teal dots were right every time, amber dots were flaky and red dots were never right. A grey bar joins the three wordings of a question when they disagree. Hover a dot for the wording and its outcome counts.</figcaption>
</figure>

The metric that captures this is **pass^k** from the [τ-bench paper](https://arxiv.org/abs/2406.12045): the chance that all *k* independent attempts at a task succeed, averaged across tasks. Pass^10 here is 38.9%.

<figure class="ff">
<svg class="ff-svg" viewBox="0 0 900 330" role="img" aria-label="Line chart of pass-hat-k falling as k grows, per configuration.">
<text x="30.0" y="30.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:14px;font-weight:600;fill:#e8ecef" >pass^k: the chance a question is answered correctly on every one of k asks</text>
<text x="30.0" y="48.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11px;font-weight:400;fill:#98a2ab" >Averaged over all wordings; unbiased estimator from the repeated runs (k=1 is ordinary accuracy)</text>
<line x1="80" x2="640" y1="270.0" y2="270.0" stroke="#262d34"/>
<text x="70.0" y="274.0" text-anchor="end" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:400;fill:#6f787f" >20%</text>
<line x1="80" x2="640" y1="243.8" y2="243.8" stroke="#262d34"/>
<text x="70.0" y="247.8" text-anchor="end" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:400;fill:#6f787f" >30%</text>
<line x1="80" x2="640" y1="217.5" y2="217.5" stroke="#262d34"/>
<text x="70.0" y="221.5" text-anchor="end" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:400;fill:#6f787f" >40%</text>
<line x1="80" x2="640" y1="191.2" y2="191.2" stroke="#262d34"/>
<text x="70.0" y="195.2" text-anchor="end" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:400;fill:#6f787f" >50%</text>
<line x1="80" x2="640" y1="165.0" y2="165.0" stroke="#262d34"/>
<text x="70.0" y="169.0" text-anchor="end" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:400;fill:#6f787f" >60%</text>
<line x1="80" x2="640" y1="138.8" y2="138.8" stroke="#262d34"/>
<text x="70.0" y="142.8" text-anchor="end" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:400;fill:#6f787f" >70%</text>
<line x1="80" x2="640" y1="112.5" y2="112.5" stroke="#262d34"/>
<text x="70.0" y="116.5" text-anchor="end" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:400;fill:#6f787f" >80%</text>
<line x1="80" x2="640" y1="86.3" y2="86.3" stroke="#262d34"/>
<text x="70.0" y="90.3" text-anchor="end" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:400;fill:#6f787f" >90%</text>
<line x1="80" x2="640" y1="60.0" y2="60.0" stroke="#262d34"/>
<text x="70.0" y="64.0" text-anchor="end" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:400;fill:#6f787f" >100%</text>
<text x="80.0" y="288.0" text-anchor="middle" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:400;fill:#6f787f" >1</text>
<text x="142.2" y="288.0" text-anchor="middle" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:400;fill:#6f787f" >2</text>
<text x="204.4" y="288.0" text-anchor="middle" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:400;fill:#6f787f" >3</text>
<text x="266.7" y="288.0" text-anchor="middle" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:400;fill:#6f787f" >4</text>
<text x="328.9" y="288.0" text-anchor="middle" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:400;fill:#6f787f" >5</text>
<text x="391.1" y="288.0" text-anchor="middle" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:400;fill:#6f787f" >6</text>
<text x="453.3" y="288.0" text-anchor="middle" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:400;fill:#6f787f" >7</text>
<text x="515.6" y="288.0" text-anchor="middle" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:400;fill:#6f787f" >8</text>
<text x="577.8" y="288.0" text-anchor="middle" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:400;fill:#6f787f" >9</text>
<text x="640.0" y="288.0" text-anchor="middle" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:400;fill:#6f787f" >10</text>
<text x="360.0" y="310.0" text-anchor="middle" style="font-family:Inter,system-ui,sans-serif;font-size:10.5px;font-weight:400;fill:#6f787f" >k = number of times the same question is asked</text>
<path d="M80.0,106.3 L142.2,127.6 L204.4,144.5 L266.7,158.9 L328.9,171.6 L391.1,183.1 L453.3,193.5 L515.6,203.1 L577.8,212.0 L640.0,220.4" fill="none" stroke="#8a939b" stroke-width="2"/>
<circle cx="80.0" cy="106.3" r="4" fill="#8a939b" stroke="#0e1114" stroke-width="2"><title>v0: pass^1 = 82.4%</title></circle>
<circle cx="142.2" cy="127.6" r="4" fill="#8a939b" stroke="#0e1114" stroke-width="2"><title>v0: pass^2 = 74.3%</title></circle>
<circle cx="204.4" cy="144.5" r="4" fill="#8a939b" stroke="#0e1114" stroke-width="2"><title>v0: pass^3 = 67.8%</title></circle>
<circle cx="266.7" cy="158.9" r="4" fill="#8a939b" stroke="#0e1114" stroke-width="2"><title>v0: pass^4 = 62.3%</title></circle>
<circle cx="328.9" cy="171.6" r="4" fill="#8a939b" stroke="#0e1114" stroke-width="2"><title>v0: pass^5 = 57.5%</title></circle>
<circle cx="391.1" cy="183.1" r="4" fill="#8a939b" stroke="#0e1114" stroke-width="2"><title>v0: pass^6 = 53.1%</title></circle>
<circle cx="453.3" cy="193.5" r="4" fill="#8a939b" stroke="#0e1114" stroke-width="2"><title>v0: pass^7 = 49.2%</title></circle>
<circle cx="515.6" cy="203.1" r="4" fill="#8a939b" stroke="#0e1114" stroke-width="2"><title>v0: pass^8 = 45.5%</title></circle>
<circle cx="577.8" cy="212.0" r="4" fill="#8a939b" stroke="#0e1114" stroke-width="2"><title>v0: pass^9 = 42.1%</title></circle>
<circle cx="640.0" cy="220.4" r="4" fill="#8a939b" stroke="#0e1114" stroke-width="2"><title>v0: pass^10 = 38.9%</title></circle>
<text x="652.0" y="224.4" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:600;fill:#e8ecef" >v0  pass^10 = 38.9%</text>
<text x="84.0" y="136.3" text-anchor="start" style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:400;fill:#98a2ab" >v0 82.4%</text>
<path d="M80.0,99.4 L142.2,121.6 L204.4,137.7 L266.7,150.4 L328.9,162.1" fill="none" stroke="#00a0ab" stroke-width="2"/>
<circle cx="80.0" cy="99.4" r="4" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>v1: pass^1 = 85.0%</title></circle>
<circle cx="142.2" cy="121.6" r="4" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>v1: pass^2 = 76.5%</title></circle>
<circle cx="204.4" cy="137.7" r="4" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>v1: pass^3 = 70.4%</title></circle>
<circle cx="266.7" cy="150.4" r="4" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>v1: pass^4 = 65.6%</title></circle>
<circle cx="328.9" cy="162.1" r="4" fill="#00a0ab" stroke="#0e1114" stroke-width="2"><title>v1: pass^5 = 61.1%</title></circle>
<text x="340.9" y="166.1" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:600;fill:#e8ecef" >v1  pass^5 = 61.1%</text>
<text x="84.0" y="87.4" text-anchor="start" style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:400;fill:#98a2ab" >v1 85.0%</text>
</svg>
<figcaption><strong>Figure 3.</strong> Pass^k falls steadily as you ask the same question more times. The v1 configuration starts higher and falls at almost the same rate, so better instructions raised the curve without flattening it.</figcaption>
</figure>

Only 3 of the 24 questions were right every time under all three wordings.

## The variance enters before the query is written

The Responses API returns every tool call. In the trace, the orchestrator rewrites the question into a fuller instruction, picks a source, generates and runs a query, then writes the answer.

<figure class="ff">
<svg class="ff-svg" viewBox="0 0 900 330" role="img" aria-label="The data agent's answer pipeline with measured variance at each stage, config v0, 72 question wordings by 10 runs. Rewrite: the rewritten question differed on almost every run (median 10 distinct rewrites per 10 runs). Route: the semantic model was chosen in 717 of 720 runs. Query: median 9 distinct DAX texts per 10 runs. Answer: 21 of 72 wordings returned more than one distinct number. Verdict: 17 of 72 wordings flipped between right and wrong among answered runs. Separately, 42 runs, 5.8 percent, declined because the tool produced no query. The rewrite is where the interpretation is fixed.">
<defs>
<marker id="dpN" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0,0 L6.5,3 L0,6 Z" class="ff-ah"/></marker>
<marker id="dpD" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0,0 L6.5,3 L0,6 Z" class="ff-ah-dash"/></marker>
</defs>
<text x="30" y="34" class="ff-zlabel">ONE ASK · WHAT VARIED ACROSS 10 FRESH RUNS OF THE SAME WORDING (V0, 72 WORDINGS)</text>
<rect x="148" y="52" width="150" height="196" rx="16" class="ff-zone ff-zone-danger"/>
<text x="223" y="72" text-anchor="middle" class="ff-zlabel" style="fill:#e0857c">DECIDED HERE</text>
<rect x="24" y="86" width="110" height="74" rx="11" class="ff-node"/>
<text x="79" y="116" text-anchor="middle" class="ff-title">Question</text>
<text x="79" y="136" text-anchor="middle" class="ff-sub">same text</text>
<rect x="160" y="86" width="126" height="74" rx="11" class="ff-node ff-node-dn"/>
<text x="223" y="112" text-anchor="middle" class="ff-title">Rewrite</text>
<text x="223" y="132" text-anchor="middle" class="ff-sub">fuller instruction</text>
<text x="223" y="148" text-anchor="middle" class="ff-sub">to the tool</text>
<rect x="306" y="86" width="116" height="74" rx="11" class="ff-node"/>
<image href="/icons/fabric/semantic_model_48_item.svg" x="318" y="96" width="18" height="18"/>
<text x="342" y="110" class="ff-title">Route</text>
<text x="364" y="136" text-anchor="middle" class="ff-sub">lakehouse or</text>
<text x="364" y="150" text-anchor="middle" class="ff-sub">semantic model</text>
<rect x="442" y="86" width="116" height="74" rx="11" class="ff-node"/>
<text x="500" y="116" text-anchor="middle" class="ff-title">Query</text>
<text x="500" y="136" text-anchor="middle" class="ff-sub">generated DAX</text>
<rect x="578" y="86" width="116" height="74" rx="11" class="ff-node"/>
<text x="636" y="116" text-anchor="middle" class="ff-title">Answer</text>
<text x="636" y="136" text-anchor="middle" class="ff-sub">number + words</text>
<rect x="714" y="86" width="162" height="74" rx="11" class="ff-node ff-node-cy"/>
<text x="795" y="116" text-anchor="middle" class="ff-title">Verdict</text>
<text x="795" y="136" text-anchor="middle" class="ff-sub">right or wrong</text>
<line x1="136" y1="123" x2="158" y2="123" class="ff-edge" marker-end="url(#dpN)"/>
<line x1="288" y1="123" x2="304" y2="123" class="ff-edge" marker-end="url(#dpN)"/>
<line x1="424" y1="123" x2="440" y2="123" class="ff-edge" marker-end="url(#dpN)"/>
<line x1="560" y1="123" x2="576" y2="123" class="ff-edge" marker-end="url(#dpN)"/>
<line x1="696" y1="123" x2="712" y2="123" class="ff-edge" marker-end="url(#dpN)"/>
<text x="223" y="190" text-anchor="middle" class="ff-title ff-amt">~every run</text>
<text x="223" y="208" text-anchor="middle" class="ff-sub">median 10 distinct</text>
<text x="223" y="222" text-anchor="middle" class="ff-sub">rewrites per 10 runs</text>
<text x="364" y="190" text-anchor="middle" class="ff-title ff-cyt">717 / 720</text>
<text x="364" y="208" text-anchor="middle" class="ff-sub">runs picked the</text>
<text x="364" y="222" text-anchor="middle" class="ff-sub">semantic model</text>
<text x="500" y="190" text-anchor="middle" class="ff-title ff-amt">median 9</text>
<text x="500" y="208" text-anchor="middle" class="ff-sub">distinct DAX texts,</text>
<text x="500" y="222" text-anchor="middle" class="ff-sub">mostly harmless</text>
<text x="636" y="190" text-anchor="middle" class="ff-title ff-amt">21 / 72</text>
<text x="636" y="208" text-anchor="middle" class="ff-sub">wordings gave more</text>
<text x="636" y="222" text-anchor="middle" class="ff-sub">than one number</text>
<text x="795" y="190" text-anchor="middle" class="ff-title ff-amt">17 / 72</text>
<text x="795" y="208" text-anchor="middle" class="ff-sub">wordings flipped</text>
<text x="795" y="222" text-anchor="middle" class="ff-sub">right ↔ wrong</text>
<path d="M500,248 L500,272 L560,272" class="ff-edge-dash" marker-end="url(#dpD)"/>
<rect x="562" y="256" width="314" height="34" rx="9" class="ff-node"/>
<text x="576" y="278" class="ff-sub">Declined: 42 runs (5.8%) · the tool produced no query</text>
<text x="30" y="314" class="ff-lgd" style="fill:#6f787f">Variance is everywhere upstream; most of it washes out. The rewrite fixes the interpretation, and the DAX then executes it faithfully.</text>
</svg>
<figcaption><strong>Figure 4.</strong> Where the variance enters, config v0. Rewrites and DAX text vary on almost every run; far fewer wordings end up with a different number or verdict.</figcaption>
</figure>

The rewrite and the DAX text differed on almost every run, yet most of that variation is harmless: aliases, column choices and formatting that return the same number. Routing barely moved. Only 3 of 720 runs touched the lakehouse, even though it was attached.

In the two questions I traced end to end, what decided the answer was the **rewrite**. For the Queensland question, runs whose rewrite said "the most recent calendar quarter available in the data" returned the 1 October interval; runs that said "the last completed calendar quarter relative to today" returned the right peak. That one phrase predicted the outcome in 26 of 29 answered runs. For "the average price across the NEM in September 2026", the agent used the demand-weighted measure in all 11 runs where the rewrite contained the word "weighted", and the simple-average measure in 18 of the 19 where it didn't.

<div class="cl cl-key"><div class="cl-tag">Takeaway</div><div class="cl-body">

Generated query text is the wrong thing to diff between runs. Log the rewritten question. It's where an ambiguous request becomes a specific one, and it's the first step your instructions influence.

</div></div>

## Four ways it went wrong

**Definitional drift.** In v0, 27% of definitional runs returned a defensible number under a different definition, usually the simple average where the business meant demand-weighted. Every South Australia 2025 run that produced a query (28 of 30) used the measure literally named `[Average Price]`, and six of those answers described the result as "volume-weighted". The label matched the business definition and the number didn't, which is exactly how a wrong answer gets past a reviewer.

The portal's test chat found a third reading. With the v0 settings in the draft, "What was the average price across the NEM in September 2026?" came back as $53.63/MWh, labelled volume-weighted, five times in a row. That is the unweighted mean of the five regional demand-weighted prices, which counts Tasmania the same as New South Wales. It never appeared in any of the 45 API runs of that question. (The test chat keeps one thread, so those answers could see each other.)

<img src="/images/blog/2026-10-29-fabric-data-agent-determinism/chat-nem-average.webp" alt="The Fabric data agent test chat answering What was the average price across the NEM in September 2026 with: The average volume-weighted price across the NEM in September 2026 was $53.63/MWh (AUD)." loading="lazy" />

**Data-edge artefacts.** The single 00:00 interval on 1 October exists because AEMO stamps interval ends. Half the Queensland runs treated it as a quarter of data, and the portal chat went further, reporting the period covered as 1 October to 31 December 2026.

<img src="/images/blog/2026-10-29-fabric-data-agent-determinism/chat-last-quarter.webp" alt="The Fabric data agent test chat answering qld peak demand last quarter twice: 5,993.13 MW in the last available calendar quarter, Q4 2026, period covered 1 October 2026 to 31 December 2026." loading="lazy" />

**Prior knowledge leaking in.** The NEM moved to five-minute settlement on 1 October 2021. Eight rewrites still described half-hourly or 30-minute intervals, and two answers to "how many hours of negative prices" divided the interval count by two, returning 15,940 hours instead of 2,656.7.

**Declines.** In 42 runs (5.8%) the semantic model tool produced no query, and the agent said so rather than guessing. That's the right failure, but it hit 32 of the 72 wordings, so it shows up as flakiness on otherwise reliable questions.

<figure class="ff">
<svg class="ff-svg" viewBox="0 0 900 376" role="img" aria-label="Stacked bars of outcome shares per question category and configuration.">
<text x="30.0" y="30.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:14px;font-weight:600;fill:#e8ecef" >What the wrong answers actually were</text>
<text x="30.0" y="48.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11px;font-weight:400;fill:#98a2ab" >Share of all runs per category · &#x27;defensible&#x27; = matches an alternative reading (e.g. simple vs demand-weighted average)</text>
<text x="30.0" y="92.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >Lookup</text><text x="218.0" y="92.0" text-anchor="end" style="font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:400;fill:#6f787f" >v0</text>
<rect x="230.0" y="78" width="596.5" height="18" rx="3" fill="#00a0ab"><title>Lookup v0: correct 95% of 180 runs</title></rect>
<text x="236.0" y="91.0" text-anchor="start" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;fill:#0e1114" >95%</text>
<rect x="828.5" y="78" width="29.5" height="18" rx="3" fill="#5b646c"><title>Lookup v0: declined (no query produced) 5% of 180 runs</title></rect>
<text x="30.0" y="118.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >Lookup</text><text x="218.0" y="118.0" text-anchor="end" style="font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:400;fill:#6f787f" >v1</text>
<rect x="230.0" y="104" width="593.0" height="18" rx="3" fill="#00a0ab"><title>Lookup v1: correct 94% of 90 runs</title></rect>
<text x="236.0" y="117.0" text-anchor="start" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;fill:#0e1114" >94%</text>
<rect x="825.0" y="104" width="5.0" height="18" rx="3" fill="#e0554a"><title>Lookup v1: wrong 1% of 90 runs</title></rect>
<rect x="832.0" y="104" width="26.0" height="18" rx="3" fill="#5b646c"><title>Lookup v1: declined (no query produced) 4% of 90 runs</title></rect>
<text x="30.0" y="154.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >Aggregation</text><text x="218.0" y="154.0" text-anchor="end" style="font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:400;fill:#6f787f" >v0</text>
<rect x="230.0" y="140" width="540.5" height="18" rx="3" fill="#00a0ab"><title>Aggregation v0: correct 86% of 180 runs</title></rect>
<text x="236.0" y="153.0" text-anchor="start" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;fill:#0e1114" >86%</text>
<rect x="772.5" y="140" width="36.5" height="18" rx="3" fill="#e0554a"><title>Aggregation v0: wrong 6% of 180 runs</title></rect>
<text x="778.5" y="153.0" text-anchor="start" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;fill:#0e1114" >6%</text>
<rect x="811.0" y="140" width="47.0" height="18" rx="3" fill="#5b646c"><title>Aggregation v0: declined (no query produced) 8% of 180 runs</title></rect>
<text x="817.0" y="153.0" text-anchor="start" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;fill:#0e1114" >8%</text>
<text x="30.0" y="180.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >Aggregation</text><text x="218.0" y="180.0" text-anchor="end" style="font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:400;fill:#6f787f" >v1</text>
<rect x="230.0" y="166" width="474.0" height="18" rx="3" fill="#00a0ab"><title>Aggregation v1: correct 76% of 90 runs</title></rect>
<text x="236.0" y="179.0" text-anchor="start" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;fill:#0e1114" >76%</text>
<rect x="706.0" y="166" width="96.0" height="18" rx="3" fill="#e0554a"><title>Aggregation v1: wrong 16% of 90 runs</title></rect>
<text x="712.0" y="179.0" text-anchor="start" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;fill:#0e1114" >16%</text>
<rect x="804.0" y="166" width="54.0" height="18" rx="3" fill="#5b646c"><title>Aggregation v1: declined (no query produced) 9% of 90 runs</title></rect>
<text x="810.0" y="179.0" text-anchor="start" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;fill:#0e1114" >9%</text>
<text x="30.0" y="216.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >Time semantics</text><text x="218.0" y="216.0" text-anchor="end" style="font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:400;fill:#6f787f" >v0</text>
<rect x="230.0" y="202" width="519.5" height="18" rx="3" fill="#00a0ab"><title>Time semantics v0: correct 83% of 180 runs</title></rect>
<text x="236.0" y="215.0" text-anchor="start" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;fill:#0e1114" >83%</text>
<rect x="751.5" y="202" width="75.0" height="18" rx="3" fill="#e0554a"><title>Time semantics v0: wrong 12% of 180 runs</title></rect>
<text x="757.5" y="215.0" text-anchor="start" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;fill:#0e1114" >12%</text>
<rect x="828.5" y="202" width="29.5" height="18" rx="3" fill="#5b646c"><title>Time semantics v0: declined (no query produced) 5% of 180 runs</title></rect>
<text x="30.0" y="242.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >Time semantics</text><text x="218.0" y="242.0" text-anchor="end" style="font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:400;fill:#6f787f" >v1</text>
<rect x="230.0" y="228" width="509.0" height="18" rx="3" fill="#00a0ab"><title>Time semantics v1: correct 81% of 90 runs</title></rect>
<text x="236.0" y="241.0" text-anchor="start" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;fill:#0e1114" >81%</text>
<rect x="741.0" y="228" width="5.0" height="18" rx="3" fill="#9a7ae6"><title>Time semantics v1: defensible, different definition 1% of 90 runs</title></rect>
<rect x="748.0" y="228" width="96.0" height="18" rx="3" fill="#e0554a"><title>Time semantics v1: wrong 16% of 90 runs</title></rect>
<text x="754.0" y="241.0" text-anchor="start" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;fill:#0e1114" >16%</text>
<rect x="846.0" y="228" width="12.0" height="18" rx="3" fill="#5b646c"><title>Time semantics v1: declined (no query produced) 2% of 90 runs</title></rect>
<text x="30.0" y="278.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >Definitional</text><text x="218.0" y="278.0" text-anchor="end" style="font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:400;fill:#6f787f" >v0</text>
<rect x="230.0" y="264" width="411.0" height="18" rx="3" fill="#00a0ab"><title>Definitional v0: correct 66% of 180 runs</title></rect>
<text x="236.0" y="277.0" text-anchor="start" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;fill:#0e1114" >66%</text>
<rect x="643.0" y="264" width="169.5" height="18" rx="3" fill="#9a7ae6"><title>Definitional v0: defensible, different definition 27% of 180 runs</title></rect>
<text x="649.0" y="277.0" text-anchor="start" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;fill:#0e1114" >27%</text>
<rect x="814.5" y="264" width="8.5" height="18" rx="3" fill="#e0554a"><title>Definitional v0: wrong 2% of 180 runs</title></rect>
<rect x="825.0" y="264" width="33.0" height="18" rx="3" fill="#5b646c"><title>Definitional v0: declined (no query produced) 6% of 180 runs</title></rect>
<text x="831.0" y="277.0" text-anchor="start" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;fill:#0e1114" >6%</text>
<text x="30.0" y="304.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;font-weight:400;fill:#98a2ab" >Definitional</text><text x="218.0" y="304.0" text-anchor="end" style="font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:400;fill:#6f787f" >v1</text>
<rect x="230.0" y="290" width="558.0" height="18" rx="3" fill="#00a0ab"><title>Definitional v1: correct 89% of 90 runs</title></rect>
<text x="236.0" y="303.0" text-anchor="start" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;fill:#0e1114" >89%</text>
<rect x="790.0" y="290" width="47.0" height="18" rx="3" fill="#9a7ae6"><title>Definitional v1: defensible, different definition 8% of 90 runs</title></rect>
<text x="796.0" y="303.0" text-anchor="start" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;fill:#0e1114" >8%</text>
<rect x="839.0" y="290" width="5.0" height="18" rx="3" fill="#e0554a"><title>Definitional v1: wrong 1% of 90 runs</title></rect>
<rect x="846.0" y="290" width="12.0" height="18" rx="3" fill="#5b646c"><title>Definitional v1: declined (no query produced) 2% of 90 runs</title></rect>
<rect x="30" y="352" width="10" height="10" rx="2" fill="#00a0ab"/><text x="46.0" y="361.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:10.5px;font-weight:400;fill:#98a2ab" >correct</text>
<rect x="103.19999999999999" y="352" width="10" height="10" rx="2" fill="#9a7ae6"/><text x="119.2" y="361.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:10.5px;font-weight:400;fill:#98a2ab" >defensible, different definition</text>
<rect x="316.4" y="352" width="10" height="10" rx="2" fill="#e0554a"/><text x="332.4" y="361.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:10.5px;font-weight:400;fill:#98a2ab" >wrong</text>
<rect x="378.4" y="352" width="10" height="10" rx="2" fill="#5b646c"/><text x="394.4" y="361.0" text-anchor="start" style="font-family:Inter,system-ui,sans-serif;font-size:10.5px;font-weight:400;fill:#98a2ab" >declined (no query produced)</text>
</svg>
<figcaption><strong>Figure 5.</strong> Outcome mix by question category. In v0 the definitional failures are mostly defensible alternative readings. In v1 most of those become correct, while aggregation picks up new wrong answers.</figcaption>
</figure>

## What instructions fixed, and what they broke

For v1 I did what the guidance suggests: definitions in the agent instructions, data source instructions naming the right measure for each term, and three example queries on the lakehouse. Every wording ran five times, compared with v0's first five runs.

<div class="code-title">v1 agent instructions (excerpt)</div>

```text
- "Average price" means the demand-weighted (volume-weighted) average:
  SUM(rrp * demand) / SUM(demand). Say that you used the demand-weighted average.
- "Peak demand" means the highest 5-minute total demand in MW.
- Financial year means the Australian financial year, 1 July to 30 June.
- settlement_date is the END of each 5-minute interval in AEST (UTC+10, no daylight saving).
- Report prices to 2 decimal places and demand to 1 decimal place. Give one final number per question.
```

| Five runs per wording | v0 | v1 |
|---|---|---|
| Accuracy (pass^1) | 81.7% | 85.0% |
| Wordings right on all five runs | 37 of 72 | 44 of 72 |
| Definitional questions correct | 66.7% | 88.9% |
| Aggregation questions correct | 85.6% | 75.6% |
| Wrong answers (not alternative definitions) | 5.0% | 8.3% |
| Wordings flipping right/wrong among answered runs | 10 | 15 |
| Runs routed to the lakehouse | 2 of 360 | 45 of 360 |

The definitions worked where they were aimed. South Australia's 2025 average price went from 0 correct in 15 runs to 12 of 15. They also leaked into questions about average *demand*: 16 of 45 rewrites asked for a "demand-weighted average demand", against none in v0, and the agent dutifully computed one. Tasmania's 2025 average demand came back as 1,069.0 MW instead of 1,049.7 MW in seven of 15 runs. Aggregation accuracy fell ten points.

The routing hint sent all 15 timestamp lookups to the lakehouse, and the 45 lakehouse runs were right 91% of the time. The Queensland "last quarter" question got no instruction, and two of its three wordings were wrong on all five v1 runs.

<div class="cl cl-warn"><div class="cl-tag">Watch for</div><div class="cl-body">

An instruction is a global edit to every rewrite the agent will ever make. After changing one, re-run the whole distribution, not just the questions you meant to fix. Here the mean went up 3.3 points, but a bootstrap over the 72 wordings puts the 95% interval at −3 to +10 points, while the number of flipping wordings went up by half. The category shifts are the real signal.

</div></div>

Microsoft's own tooling reproduces the label problem. I put three of the shakiest v1 wordings through `evaluate_data_agent` in a Fabric notebook, with `num_query_repeats=5` against the published v1 agent. It marked 12 of 15 answers as not matching, one right in five for each question. Three South Australia answers read "the demand-weighted average price … was $86.73/MWh", and four NEM answers gave $47.16 the same way: the instruction's label on the simple average. The SDK's own `_steps` table shows how, with a rewrite asking for "the NEM-wide demand-weighted average wholesale price … using the predefined Average Price measure".

<img src="/images/blog/2026-10-29-fabric-data-agent-determinism/notebook-repeats.webp" alt="A Fabric notebook cell running evaluate_data_agent with num_query_repeats=5 against DA_NEM, followed by the SDK output listing twelve conversation links under: The result does not match the provided ground truth(s)." loading="lazy" />

## The judge held up, with two sharp edges

I expected the SDK's judge to be a source of noise. It wasn't. Across all 1,080 runs in both configurations it replied with a bare "Yes", "No" or "Unclear". Its verdict matched my deterministic comparator on 1,079 runs; the other was a single "Unclear" on a wrong answer. To test the judge on its own, I held 60 stored v1 answers fixed (30 correct, 30 not) and re-ran the judge five times on each by branching off the stored answer with `previous_response_id`. All 300 replays returned the original verdict.

Two details in 0.1.33a0 are still worth knowing. First, the judge is the data agent itself: `evaluate_data_agent` sends the grading prompt as a second message in the same conversation, and the default prompt asks about "the most recent answer". The verdict is then parsed with `"no" in message.lower()` before checking for "yes", so a judge that ever says "Yes, but note…" scores a fail. Second, the `critic_prompt` example on Microsoft Learn uses an `{actual_answer}` placeholder the SDK never fills. It raises `KeyError` after the agent has answered, and because results are written only at the end, the run is lost. Here it is in a Fabric notebook, 31 seconds in:

<img src="/images/blog/2026-10-29-fabric-data-agent-determinism/notebook-keyerror.webp" alt="A Fabric notebook cell defining the critic_prompt example from Microsoft Learn with an actual_answer placeholder and calling evaluate_data_agent, failing with KeyError: actual_answer." loading="lazy" />

Until that changes, write a custom critic prompt the way the default one works: refer to the most recent answer and use only `{query}` and `{expected_answer}`.

## The harness

<div class="code-title">repeat_eval.py</div>

```python
import json
from azure.identity import AzureCliCredential
from fabric.dataagent.client import FabricOpenAIResponses

client = FabricOpenAIResponses(
    artifact_name="<your-data-agent-name>",
    workspace_name="<your-workspace-id>",  # name or ID; an ID avoids lookup ambiguity
    ai_skill_stage="production",
    credential=AzureCliCredential(),  # fine for a few hundred calls; use a caching credential for more
)

def ask_fresh(question: str) -> dict:
    """One question, one brand-new conversation, every step kept."""
    conversation = client.conversations.create()
    response = client.responses.create(input=question, conversation=conversation.id)
    steps = [
        {"tool": item.name, "args": json.loads(item.arguments)}
        for item in response.output
        if item.type == "function_call"
    ]
    rewrite = next((s["args"].get("query") for s in steps if s["tool"].startswith("trace.")), None)
    code = [s["args"]["code"] for s in steps if "code" in s["args"]]
    return {"answer": response.output_text, "rewrite": rewrite, "code": code}

runs = [ask_fresh("What was Queensland's highest demand over the last quarter?") for _ in range(10)]
client.close()
```

Tool names like `trace.analyze_semantic_model` aren't a documented contract; print your own agent's item types first.

The pass^k estimator is one line per question wording:

```python
from math import comb

def pass_hat_k(n: int, correct: int, k: int) -> float:
    """Unbiased estimate that k independent asks are all correct (tau-bench)."""
    if k > n:
        raise ValueError("k must be <= n")
    return comb(correct, k) / comb(n, k)
```

## What I'd do on Monday

- Run every evaluation question at least five times in fresh conversations, and report pass^5 next to accuracy. `evaluate_data_agent` takes `num_query_repeats` and logs the rewrite in the `function_queries` column of its `_steps` table, so pass^k is a group-by over its output, not a custom harness.
- Ask each important question in two or three wordings. Wording moved the Queensland question from 8 in 10 right to 1 in 10.
- Name measures for their definition. Without instructions, 101 of 120 average-price runs picked the measure called `Average Price`.
- Write definitions into the agent instructions and back them with example queries, then rerun the same distribution, not a single pass.
- Grade numbers with a deterministic comparator, and keep the LLM judge for wording.
- Treat a decline as a failure in your metric but a safe one in your risk review.

Your data agent is still only as good as your data, as Marc says. It is also only as dependable as its least stable rewrite, and you won't see that until you ask the same question more than once.
