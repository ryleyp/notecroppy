import Anthropic from "@anthropic-ai/sdk";
import { applyCorrections, applyReplacements } from "@/lib/sanitize";
import { scrubWithExceptions } from "@/lib/scrub";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { BATCH_TEMPORAL_RULE, TEMPORAL_ACCURACY_RULE, dateSortValue } from "@/lib/synthesisPolicy";
import {
  DEFAULT_MODEL,
  budgetChars,
  contextLimit as contextTokens,
  firstTextBlock,
  maxOutputTokens,
} from "@/lib/models";

function buildExclusionList(accountName, allAccounts) {
  if (!allAccounts?.length) return "";
  const others = allAccounts.filter((a) => a.name !== accountName && a.name !== "Internal");
  if (!others.length) return "";

  const accountLines = others.map((a) => {
    const aliases = (a.aliases || []).join(", ");
    return aliases ? `  - ${a.name} (also referred to as: ${aliases})` : `  - ${a.name}`;
  });

  const keywordLines = others
    .filter((a) => a.keywords?.length)
    .map((a) => `  - ${a.keywords.join(", ")} → belong to ${a.name}, do not include in this summary`);

  let out = `\nOther customer accounts — NEVER mention them by name or alias:\n${accountLines.join("\n")}\n`;

  if (keywordLines.length) {
    out += `\nFORBIDDEN KEYWORDS — these terms are exclusively tied to other accounts. If you see them in a source, skip that content entirely. Do NOT write them anywhere in the output:\n${keywordLines.join("\n")}\n`;
  }

  return out;
}

function buildSynthesisPrompt(notes, today, accountName, allAccounts) {
  const threeMonthsAgo = new Date(today);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const rangeLabel = `${threeMonthsAgo.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} – ${new Date(today).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;

  const acct = accountName && accountName !== "Internal" ? accountName : null;

  const noteBlocks = notes
    .map((n) => {
      const tag = n.source === "cross-vault" ? ` [${n.sourceLabel}]` : "";
      return `### ${n.date} — ${n.title}${tag}${n._dayLabel || ""}\n\n${n.content}`;
    })
    .join("\n\n---\n\n");

  const accountScope = acct
    ? `This is an Account Status report for **${acct} ONLY**.

CRITICAL ACCOUNT SCOPING RULES — these override everything else:
- Report exclusively on ${acct}. Do NOT discuss, compare to, or mention any other customer account by any name or alias.
- Some sources come from other folders and may contain content about other accounts. Use ONLY the portions that pertain to ${acct}. Ignore everything about any other account, even within the same note.
- If a source mentions ${acct} only in passing, extract just the ${acct}-relevant parts.
- If a source has no ${acct} content, ignore it entirely.
- Never write a sentence that is about another account. The reader only cares about ${acct}.
- ATTRIBUTION RULE: Lines and sections mentioning other accounts were removed before these notes reached you, so some sources (especially internal or multi-account meetings like site-level reviews and team syncs) may contain orphaned fragments whose account is no longer identifiable. NEVER assume such content is about ${acct}. Only attribute content to ${acct} when the surrounding text explicitly names ${acct} or an unambiguous ${acct} identifier. When the subject is unclear, LEAVE IT OUT — do not rewrite another account's content to sound like it happened at ${acct}.
${buildExclusionList(acct, allAccounts)}
`
    : "";

  return `You are a NI Software Customer Success Manager analyzing ${notes.length} meeting notes and transcripts from the past quarter (${rangeLabel}). Produce a detailed Account Status summary scoped to NI Software.

${accountScope}Scope rules:
- Focus on NI Software products, licenses, adoption, and CS activities${acct ? ` at ${acct}` : ""}
- Third-party software: mention briefly if relevant to NI context
- Hardware: mention only when directly tied to NI software usage
- Omit purely hardware or non-NI topics
- **Demo sessions and user groups:** If a source is a demo session, NI user group, or similar event, do NOT include generic product details or feature overviews from it. Only include content from those sources if there was a specific customer discussion, question, reaction, or account-relevant context around a product — e.g. a customer asked about it, expressed interest, raised a concern, or it was discussed in relation to their environment.

Sources include Obsidian meeting notes and notes from other folders that mention this account [folder name].

---
SOURCES:

${noteBlocks}

---

Generate the Account Status document using EXACTLY this structure. Be specific — reference actual names, dates, products, and details from the sources. Do not be vague.${acct ? ` Remember: ${acct} ONLY — never mention another account.` : ""}

**Source ordering:** Sources below are in chronological order — oldest first, newest last. Within a single day, meetings tagged *(earliest same-day meeting)* happened before those tagged *(latest same-day meeting)*. The last source to address any topic is the most recent and authoritative.

**Output ordering:** Within every section, present information newest-first. Lead with the most recent developments, then older context below.

**Citation rule:** When referencing a specific note, cite it by its session date (e.g. "per the 2026-05-14 meeting" or "as of 2026-04-02"). Do NOT use "Source 1", "Source 2", or any numbered references.

${TEMPORAL_ACCURACY_RULE}

# ${acct ? `${acct} ` : ""}Account Status — ${rangeLabel}

*Synthesized from ${notes.length} sources*

---

## Recent Highlights

Key decisions, outcomes, and notable updates from the quarter scoped to NI Software. Group by theme or project. Include specifics — names, dates, numbers, product names.

---

## Open Action Items

Aggregate ALL unchecked action items (- [ ]) from across all sources. Include owner and source date. Omit items resolved in a later note.

- [ ] [Action item] — **Owner:** [Name] | **From:** [Date]

---

## Pillars of Account Health

For each pillar: assign a **G/Y/R** rating, explain it in 1–2 sentences, then list all relevant details as bullets with sub-bullets. Write "Nothing noted this quarter." if no relevant information exists.

---

### Proficiency & Self Service — [G/Y/R]

*Are we building NI tool skill and self-service capability at this account? How are we scaling it?*

**Strategy sub-areas:**
- **Proficiency Plans** — Are there plans for new and/or experienced users? What's the status?
- **L&D Integration** — Is NI collateral embedded into the account's learning & development approach?
- **Onboarding** — Is NI being injected into the account's new-hire or team onboarding process?

[Details from sources]

---

### Adoption — [G/Y/R]

*What opportunities exist to drive new users or new NI products into successful use? What's needed to make them successful?*

**Strategy sub-areas:**
- **Evaluations & Pilots** — Any active SW evaluations or pilots? Are we providing hypercare?
- **Deployment Strategies** — Are we working with sponsors on SW deployment plans?
- **Access Enablement** — Has access been customized to the account's structure or needs?
- **Support & Case Trends** — Are there recurring support issues or case trends we should address?

[Details from sources]

---

### Sponsors & End Users — [G/Y/R]

*What relationships are we building? How are we elevating trust and closeness with key people?*

**Strategy sub-areas:**
- **Sponsor Engagement** — Who are the influential sponsors? What's our engagement strategy?
- **End-User Outreach** — Are we capturing end-user insight? Any outreach strategy in place?
- **Interaction Cadence** — What travel, meetings, or comms cadence do we have with this account?

[Details from sources]

---

### Expansion — [G/Y/R]

*What parts of the NI Software portfolio is the customer not using today? Why? How could we introduce them?*

**Strategy sub-areas:**
- **Whitespace Assessment** — What NI SW products/licenses are they not using? Why?
- **Expansion Investigation** — What potential expansion areas have been identified or discussed?
- **Success Collateral** — Have we created or shared NI success content to support growth conversations?

[Details from sources]

---

### Renewal Readiness — [G/Y/R]

*What risks and opportunities should we address before the next EA/VLA renewal?*

**Strategy sub-areas:**
- **Risk Identification** — What renewal risks exist? Are they being actively managed?
- **SSM Negotiation Points** — Are SSMs equipped with the right talking points for renewal?
- **Sponsor Leverage** — Are we using sponsor relationships to reduce churn risk?

[Details from sources]

---

### Overall CS Score — [G/Y/R]

**Overall Health:** [2–4 sentence description of the account's CS posture based on all five pillars]

**Overall Risks & Areas Requiring CS or AM Support:**
- [bullet list of key risks and escalation needs]

**Renewal Status:** [Low / Medium / High / No Risk] — [1–2 sentence rationale]

**Expansion Pipeline:**
- [bullet list of any mentioned expansion opportunities, scoped to NI SW]

---

## Digital Progress

Summarize what is known about the account's software and OS environment from the sources. Include versions, lab or location names, and any upgrade or migration activity mentioned. If nothing is noted, write "No software/OS environment details noted this quarter."

**Software Versions in Use:**
- [Product/tool name] — [version or tier, lab/location if known]

**Operating Systems:**
- [OS name and version] — [lab/location or team if known]

**Upgrade or Migration Activity:**
- [Any mentioned upgrades, planned migrations, or version-change discussions]

---

## Key Themes & Trends

3–5 bullets identifying recurring topics, risks, or patterns across multiple sources this quarter.

---

## Information Changes

List any cases where a newer source contradicts, reverses, or materially updates something stated in an older source. If none exist, write "No contradictions or reversals noted this quarter."

- **[Topic]** — Previously (as of [older date]): [old info]. Updated (as of [newer date]): [new info].

---

## Recommended Next Steps

Highest-priority next steps for the CS team in the coming weeks, in priority order. Scoped to NI Software activities.`;
}

function buildProductPrompt(notes, today, product, accountName, allAccounts) {
  const threeMonthsAgo = new Date(today);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const rangeLabel = `${threeMonthsAgo.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} – ${new Date(today).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;

  const acct = accountName && accountName !== "Internal" ? accountName : null;

  const noteBlocks = notes
    .map((n) => {
      const tag = n.source === "cross-vault" ? ` [${n.sourceLabel}]` : "";
      return `### ${n.date} — ${n.title}${tag}${n._dayLabel || ""}\n\n${n.content}`;
    })
    .join("\n\n---\n\n");

  const p = product.name;
  const aliases = product.aliases?.join(", ") || p;

  const accountScope = acct
    ? `This report covers **${p} at ${acct} ONLY**.

CRITICAL ACCOUNT SCOPING RULES — these override everything else:
- Report exclusively on ${acct}'s use of ${p}. Do NOT discuss, compare to, or mention any other customer account by any name or alias.
- Some sources come from other folders and may contain content about other accounts. Use ONLY the portions about ${acct}. Ignore everything about any other account, even within the same note.
- If a source has no ${acct} + ${p} content, ignore it entirely.
- Never write a sentence about ${p} at another account. The reader only cares about ${acct}.
- ATTRIBUTION RULE: Lines and sections mentioning other accounts were removed before these notes reached you, so some sources may contain orphaned fragments whose account is no longer identifiable. NEVER assume such content is about ${acct}. Only attribute content to ${acct} when the surrounding text explicitly names ${acct} or an unambiguous ${acct} identifier. When the subject is unclear, LEAVE IT OUT — do not rewrite another account's content to sound like it happened at ${acct}.
${buildExclusionList(acct, allAccounts)}
`
    : "";

  return `You are a NI Software Customer Success Manager reviewing ${notes.length} meeting notes and transcripts from the past quarter (${rangeLabel}). Produce a focused **${p} Account Status**${acct ? ` for ${acct}` : ""} covering only content relevant to ${p} (also referred to as: ${aliases}).

${accountScope}Scope rules:
- Focus exclusively on ${p}${acct ? ` at ${acct}` : ""} — licensing, adoption, deployment, support, training, and expansion
- Mention integrations with other NI tools only when directly tied to ${p}
- Omit topics unrelated to ${p}
- **Demo sessions and user groups:** If a source is a demo session, NI user group, or similar event, do NOT include generic ${p} product details or feature overviews from it. Only include content from those sources if there was a specific customer discussion, question, reaction, or account-relevant context — e.g. a customer asked about ${p}, expressed interest, raised a concern, or it was discussed in relation to their environment.

---
SOURCES:

${noteBlocks}

---

Generate the ${p} Account Status using EXACTLY this structure. Be specific — reference actual names, dates, product tiers, and details from the sources.${acct ? ` Remember: ${acct} ONLY — never mention another account.` : ""}

**Source ordering:** Sources below are in chronological order — oldest first, newest last. Within a single day, meetings tagged *(earliest same-day meeting)* happened before those tagged *(latest same-day meeting)*. The last source to address any topic is the most recent and authoritative.

**Output ordering:** Within every section, present information newest-first. Lead with the most recent developments, then older context below.

**Citation rule:** When referencing a specific note, cite it by its session date (e.g. "per the 2026-05-14 meeting" or "as of 2026-04-02"). Do NOT use "Source 1", "Source 2", or any numbered references.

${TEMPORAL_ACCURACY_RULE}

# ${p} Account Status${acct ? ` — ${acct}` : ""} — ${rangeLabel}

*Synthesized from ${notes.length} sources*

---

## Recent Highlights

Key decisions, outcomes, and updates related to ${p} this quarter. Include names, dates, product tiers (e.g. Base, Pro, SLS, SLE), and specifics.

---

## Open Action Items

Aggregate ALL unchecked action items (- [ ]) related to ${p} from across all sources.

- [ ] [Action item] — **Owner:** [Name] | **From:** [Date]

---

## ${p} Pillars

### Proficiency & Self Service — [G/Y/R]

*Are users building skill with ${p}? Is the account moving toward self-service?*

- **Proficiency Plans** — Training status for new and experienced ${p} users
- **L&D Integration** — Is ${p} content embedded in the account's learning approach?
- **Onboarding** — Is ${p} part of new-hire or team onboarding?

[Details from sources, or "Nothing noted this quarter."]

---

### Adoption — [G/Y/R]

*What is the current ${p} footprint? Who is using it and how actively?*

- **Active Tiers / SKUs** — Which ${p} products/tiers are deployed and in use?
- **Evaluations & Pilots** — Any active ${p} evaluations? Are we providing hypercare?
- **Deployment & Access** — Is ${p} deployed broadly? Any access or config blockers?
- **Support & Case Trends** — Any recurring ${p} support issues or open cases?

[Details from sources, or "Nothing noted this quarter."]

---

### Sponsors & End Users — [G/Y/R]

*Who owns and champions ${p} at this account? Who are the power users?*

- **${p} Sponsor(s)** — Who is the internal champion? How engaged are they?
- **End-User Insight** — Are we capturing feedback from ${p} end users?
- **Engagement Cadence** — How frequently are we meeting with ${p} stakeholders?

[Details from sources, or "Nothing noted this quarter."]

---

### Expansion — [G/Y/R]

*What ${p} tiers, modules, or use cases are untapped at this account?*

- **Whitespace** — Which ${p} tiers or add-ons are they NOT using? Why?
- **Expansion Opportunities** — Any discussed or identified growth areas?
- **Success Collateral** — Have we shared ${p} success stories or ROI content?

[Details from sources, or "Nothing noted this quarter."]

---

### Renewal Readiness — [G/Y/R]

*What is the ${p} renewal risk or opportunity heading into the next EA/VLA?*

- **Risk Factors** — Any dissatisfaction, low usage, or competitive threats related to ${p}?
- **SSM Talking Points** — What renewal narrative supports ${p} value?
- **Sponsor Leverage** — Are we using relationships to protect ${p} in renewal?

[Details from sources, or "Nothing noted this quarter."]

---

### Overall ${p} Health Score — [G/Y/R]

**Health Summary:** [2–3 sentences on the account's ${p} posture based on the five pillars above]

**Risks & Escalation Needs:**
- [bullet list]

**Renewal Status:** [Low / Medium / High / No Risk] — [1–2 sentence rationale]

**Expansion Pipeline:**
- [bullet list of ${p}-specific expansion opportunities]

---

## Digital Progress

Summarize what is known about the account's ${p} software and OS environment from the sources. Include versions, lab or location names, and any upgrade or migration activity mentioned. If nothing is noted, write "No software/OS environment details noted this quarter."

**${p} Versions in Use:**
- [Version or tier] — [lab/location or team if known]

**Operating Systems:**
- [OS name and version] — [lab/location or team if known]

**Upgrade or Migration Activity:**
- [Any mentioned upgrades, planned migrations, or version-change discussions related to ${p}]

---

## Key Themes & Trends

3–5 bullets on recurring ${p}-related patterns or risks across sources this quarter.

---

## Information Changes

List any cases where a newer source contradicts, reverses, or materially updates something stated in an older source. If none exist, write "No contradictions or reversals noted this quarter."

- **[Topic]** — Previously (as of [older date]): [old info]. Updated (as of [newer date]): [new info].

---

## Recommended Next Steps

Priority actions for the CS team related to ${p} in the coming weeks.`;
}

function buildCSMActivityPrompt(notes, today, accountName, allAccounts, range, resumeRows) {
  let rangeStart = range?.start ? new Date(range.start) : null;
  if (rangeStart && isNaN(rangeStart.getTime())) rangeStart = null;
  if (!rangeStart) {
    rangeStart = new Date(today);
    rangeStart.setMonth(rangeStart.getMonth() - 4);
  }
  let rangeEnd = range?.end ? new Date(range.end) : null;
  if (rangeEnd && isNaN(rangeEnd.getTime())) rangeEnd = null;
  if (!rangeEnd) rangeEnd = new Date(today);
  const fmt = (d) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const rangeLabel = `${fmt(rangeStart)} – ${fmt(rangeEnd)}`;

  const acct = accountName && accountName !== "Internal" ? accountName : "this account";

  const noteBlocks = notes
    .map((n) => {
      const tag = n.source === "cross-vault" ? ` [${n.sourceLabel}]` : "";
      return `### ${n.date} — ${n.title}${tag}${n._dayLabel || ""}\n\n${n.content}`;
    })
    .join("\n\n---\n\n");

  const exclusion = buildExclusionList(acct, allAccounts);

  return `You are a NI Software Customer Success Manager creating an EA Engagement Activity Report for **${acct}** based on ${notes.length} meeting notes and transcripts from the reporting period ${rangeLabel}.
${exclusion ? `\n${exclusion}` : ""}
CRITICAL ACCOUNT SCOPING RULES — these override everything else:
- Report exclusively on **${acct}**. Do NOT include any activity that belongs to another customer account.
- Some notes may mention other accounts or come from shared folders. Extract ONLY activities that involve ${acct}. Ignore everything else, even within the same note.
- Never write a row about another account. If an activity does not involve ${acct}, skip it entirely.
- Do not mention any other account name, alias, or keyword in any field.
- ATTRIBUTION RULE: Lines and sections mentioning other accounts were removed before these notes reached you, so some sources (especially internal or multi-account meetings like site-level reviews and team syncs) may contain orphaned fragments whose account is no longer identifiable. NEVER assume such content is about ${acct}. Only report an activity as ${acct}'s when the surrounding text explicitly names ${acct} or an unambiguous ${acct} identifier (a site, program, or contact you can see belongs to ${acct} in the same source). When the subject is unclear, SKIP the activity entirely — do not rewrite another account's activity to sound like it happened at ${acct}. A partial report is correct; a misattributed row is a serious error.

TASK: Identify all meaningful, reportable CSM activities from these sources and output an EA Engagement Activity Report. Do NOT include routine emails, low-value check-ins, or any activity that wouldn't impress an executive reader. If two notes describe the same session, produce only one activity — no duplicates.
${resumeRows?.length ? `
ALREADY REPORTED — a previous run already produced the activities below. Do NOT output them again. Continue with the remaining activities only:
${resumeRows.map((r) => `- ${r.eventDate}: ${r.title}`).join("\n")}
` : ""}
OUTPUT FORMAT — output ONLY newline-delimited JSON (NDJSON): exactly one JSON object per line, one line per activity. No Markdown, no code fences, no intro or commentary, no blank lines between objects. Each line has exactly these keys:

{"eventDate":"YYYY-MM-DD","title":"...","type":"...","subtype":"...","comments":"...","sourceTitle":"...","review":false,"reviewReason":""}

Field rules:
- **eventDate**: the date of the note this activity came from (YYYY-MM-DD, taken from the ### heading of the source)
- **sourceTitle**: the exact title of the source note this activity came from, copied verbatim from its ### heading (the part after the date). Every row MUST cite its source.
- **title**: short descriptive name matching the style of these real examples — "Beacon Systems RF User Group - March 2026", "CSM / FAE Cardinal Account Interlock", "NI Connect Promotional Email", "Acme Aerospace Proficiency Plan - LabVIEW Core Training Scheduling"
- **type** and **subtype**: must exactly match one option from the taxonomy below
- **comments**: max 800 characters. Write for an executive audience. CSM is the active subject (e.g. "CSM coordinated...", "CSM submitted..."). Name specific contacts and titles. Lead with what happened and why it matters. Connect to adoption, expansion, renewal, or risk.
- **review**: set to true ONLY when you are genuinely unsure of the type/subtype classification (e.g. a session that could be either Demo Days or User Group), with a short reviewReason explaining the ambiguity. When confident, use false and an empty reviewReason.

CLASSIFICATION PROCESS — for each activity, evaluate ALL 6 Type options before selecting. Do not stop at the first type that seems plausible:

IMPORTANT DEFINITION — **EA Admin**: a customer-side IT administrator (employed by the customer account, not by NI) who runs the EA or maintains NI licensing on their company's behalf. EA Admins are NOT NI employees. Any meeting with an EA Admin is a customer-facing activity — never Internal Alignment.
NI-side roles are NOT EA Admins: AMs (Account Managers), FAEs (Field Application Engineers), CSMs, and any other NI employee. A meeting attended only by NI-side roles (e.g. a CSM/FAE or CSM/AM sync with no customer contact present) is Internal Alignment & Collaboration, NOT an EA Admin Sync. Only classify something as EA Admin Sync or EA Admin Onboarding when an actual customer-side EA Admin is involved.

1. **Entitlement Awareness & Promotion** — Is this about promoting EA entitlement awareness or usage? (emails, newsletters, training plans, shared portals)
2. **Internal Alignment & Collaboration** — Was this NI-internal only with NO customer present? Did it produce a concrete decision or outcome? (If no clear outcome, skip it.) Any session that includes an EA Admin or any other customer contact is NOT internal.
3. **Onboarding & Kick-Off** — Was this specifically onboarding a new EA Admin (customer-side) or new end users to the EA scope and entitlements?
4. **Strategic Relationship Management** — Was this a 1:1 or small-group customer-facing governance or relationship sync that doesn't qualify as a User Group or Onboarding?
5. **User Groups** — Was this a group session with multiple attendees (demo, user group, or planning/coordination for one)?
6. **Value Realization & Success Stories** — Was the primary purpose to capture or communicate customer ROI, outcomes, or a success story?

Tiebreaker rules:
- If NI-internal only (zero customer contacts present) → Internal Alignment & Collaboration (not Strategic)
- If group session with multiple attendees → User Groups (not Strategic)
- If onboarding a new EA Admin (customer-side) or new end users → Onboarding & Kick-Off (not Strategic)
- If capturing/writing ROI or a success story → Value Realization (not Strategic)
- Strategic Relationship Management is a catch-all for customer-facing relationship activities only after ruling out all more-specific types above

For each activity, silently verify your choice by asking: "Is there a more specific type that fits better than what I'm about to pick?" Only then write the row.

EA ENGAGEMENT TYPE TAXONOMY — use the EXACT text shown below for both Type and Subtype (copy it character-for-character). Read descriptions and examples before picking.

**Type: Entitlement Awareness & Promotion** — activities promoting awareness or use of EA entitlements:
  - Digital Campaign/Promotion — email/digital outreach campaigns promoting training, events, or EA awareness (e.g. NI Connect promo emails, training registration drives, event promotions)
    Example: "Launched NI Connect promotional email campaign to NGC contacts, targeting registration and identifying potential presenters for the NGC-sponsored session. Campaign supports expansion positioning."
  - MidTerm Reviews — formal midpoint EA review with the customer covering usage and ROI
  - Newsletters — quarterly newsletters to account contacts covering product highlights, events, training, key POCs
    Example: "Distributed Q1 FY26 EA Quarterly Newsletter to Beacon Systems contacts. Content included NI product highlights, NI Connect event promotion, Beacon-specific upcoming events, training resources, and key NI POC information. Reinforced EA value awareness."
  - Shared Space Set-up/Update — setting up or updating a shared portal or resource hub
  - Training/Support Plans — creating or scheduling a formal training plan across sites/teams
    Example: "Sync with Jordan (GTS, Acme Aerospace), Priya, and Marcus (NI Education Services) to scope LabVIEW Core 1 and Core 2 training across Acme sites. Acme holds ~7,600 EA training credits over 3 years. Confirmed in-person, instructor-led format."
  - Training/Support Webinar — delivering a live training or support session to users
  - Other

**Type: Internal Alignment & Collaboration** — NI-internal sessions (no customer present). Only log if a clear decision or outcome resulted:
  - Account Planning — CSM/FAE interlock, account strategy sessions, NI Connect planning calls, internal alignment that produced a defined outcome
    Example: "CSM/FAE FY26 account interlock for Cardinal Defense. Reviewed CS focus areas, current usage data trends, and CS execution plan including site-level priorities. Identified specific gaps in FAE workflow where CSM provides strategic coverage."
  - Account Team Kick-Off — formal kickoff session with the full internal account team (CSM, FAE, AM, etc.)
    Example: "CSM/FAE Interlock for FY 2026, reviewing CS Focus Areas, overview of usage data trends, CS execution plans including site level and event calendar, and brainstorming session on where CS can help fill in gaps in the FAE workflow."
  - Product Feedback — internal session to escalate or document customer product feedback
  - Other — recurring internal team syncs (e.g. biweekly account team calls) when they produced a concrete outcome

**Type: Onboarding & Kick-Off** — onboarding new admins or users:
  - EA Admin Onboarding — onboarding a new customer-side EA Admin (customer IT administrator who runs the EA or maintains NI licensing for their company) to EA scope, entitlements, and governance. This is always a customer-facing meeting.
    Example: "EA Admin onboarding session for two new Beacon Systems EA Admins who recently took over the role. Session covered the full scope of the EA (software entitlements, training credits, etc.), admin Q&A, and established understanding of internal processes."
  - EA End-User Kick-Off — introduction or review of EA terms, entitlements, and inclusions with customer end users
  - Other

**Type: Strategic Relationship Management** — high-touch customer-facing relationship and governance activities:
  - EA Admin Sync — recurring or ad-hoc sync with the customer-side EA Admin (customer IT administrator who runs the EA or maintains NI licensing for their company) or other key customer stakeholders. These contacts are NOT NI employees.
    Example: "Delta Microsystems TestStand Pilot Check In and EA Renewal Alignment — Meeting with the EA Admin to review pilot status and align on renewal timeline."
  - Escalation/Risk Management — active risk mitigation, escalations, or at-risk situations
    Example: "Active R&D escalation on behalf of a test engineer at Cardinal Defense related to an IVI driver issue preventing LabVIEW control of a bench oscilloscope. Original FAE ticket stalled after R&D contacts left NI. CSM submitted an R&D Advocacy request to unblock."
  - QBRs/EBRs — formal quarterly or executive business review
  - Roadmap Review — session reviewing NI product roadmap with customer stakeholders
  - SLE Governance — SystemLink Enterprise governance meetings
  - Other

**Type: User Groups** — group sessions with multiple attendees. Pick subtype based on who led the session:
  - Demo Days — NI-led session where NI/FAE presents or demos products to the customer
    Comment format: "[Title] — Region: [X], Attendees: [#]. [Description of session content and who led it.] Outcome: [adoption / expansion / risk reduction / customer momentum]"
    Example: "Beacon Systems RF User Group — Region: AMER, Attendees: 22. FAE and AM led users through an overview of NI RF Hardware Platforms and demoed InstrumentStudio. Session targeted RF-focused sites. Outcome: Drove direct product exposure across the RF engineering community and generated adoption momentum at targeted sites."
  - User Group — customer-sponsored recurring session; may include NI content but customer drives cadence/agenda
    Comment format: "[Title] — Region: [X], Attendees: [#]. [Description]. Outcome: [impact]"
    Example: "LMS User Group — Region: AMER, Participants: TBD. Conducted an LMS user group session focused on important updates to the LMS NI EA and entitlements. Maintained customer momentum and reinforced awareness of EA value."
  - Other — planning or brainstorming sessions tied to user group execution (e.g. pre-UG sponsor sync)
  ⚠️ NI-led demo sessions = Demo Days. Customer-sponsored recurring groups = User Group. Pre-UG planning calls = Other.

**Type: Value Realization & Success Stories** — capturing or communicating customer outcomes and ROI:
  - Case Study — written or formal case study in progress or completed
    Example: "Initiated SystemLink case study with the IT Admin Lead at Beacon Systems documenting the successful deployment of SystemLink Server at their Florida sites. Sessions held 3/11 and 3/12 to capture deployment scope, outcomes, and measurable value."
  - Customer Testimonial — capturing a customer success quote or formal testimonial
  - Outcome Review — reviewing measured outcomes and value delivered
  - SLE ROI Review — formal ROI review specific to SystemLink Enterprise
  - Other

**Type: Other** — only use if truly none of the above types fit.

COMMENT REQUIREMENTS:
- Use "CSM" as the active subject (e.g., "CSM coordinated...", "CSM submitted...", "CSM/FAE interlock...") — never I/we/my
- Name specific people by name and title when available (e.g., "Dana Whitfield, IT Admin Lead")
- Every comment must answer: what happened, who was involved, and why it matters — do not just describe logistics
- State outcomes explicitly: what did this drive? (adoption, expansion signal, renewal positioning, risk reduction, customer momentum)
- Show CSM ownership and leadership — describe what CSM drove, defined, or decided, not just that a meeting occurred
- Connect to revenue where possible — note how the activity ties to expansion, adoption health, or renewal
- Be specific — reference actual product names, site names, topics discussed, decisions made
- For Demo Days and User Groups: always include Region, Attendees (or TBD), topics, and Outcome
- Keep comments under 800 characters but use the full space when the detail is there — do not be artificially brief
- Skip activities that are purely logistics with no outcome (routine calendar holds, placeholder reminders with no substance)

SOURCES (${rangeLabel}):

${noteBlocks}`;
}

// Model capabilities (context, max output, char budget) come from
// @/lib/models — see the import at the top of this file.

function fitNotes(notes, model) {
  // Per-note cap scales with the model's context — large-context models can
  // hold much bigger individual notes before a single one needs trimming.
  const perNoteCap = contextTokens(model) >= 1_000_000 ? 300_000 : 80_000;
  const maxChars = budgetChars(model);

  const capped = notes.map((n) => ({
    ...n,
    content: n.content.length > perNoteCap ? n.content.slice(0, perNoteCap) + "\n\n[truncated — note exceeds per-source limit]" : n.content,
  }));

  let total = 0;
  const kept = [];
  for (const n of capped) {
    const size = (n.title?.length || 0) + n.content.length + 200;
    if (total + size > maxChars && kept.length > 0) break;
    kept.push(n);
    total += size;
  }
  return { kept, dropped: notes.length - kept.length };
}

function combineUsage(a = {}, b = {}) {
  return {
    input_tokens: (a.input_tokens || 0) + (b.input_tokens || 0),
    output_tokens: (a.output_tokens || 0) + (b.output_tokens || 0),
  };
}

function noteDateKey(note) {
  return dateSortValue(note.date);
}

function noteRangeLabel(notes) {
  const dates = notes.map((n) => n.date).filter(Boolean).sort();
  if (!dates.length) return "undated older notes";
  const first = dates[0];
  const last = dates[dates.length - 1];
  return first === last ? first : `${first} to ${last}`;
}

function groupNotesForSummary(notes, model) {
  const batchBudget = contextTokens(model) >= 1_000_000 ? 260_000 : 90_000;
  const chronological = [...notes].sort((a, b) => noteDateKey(a).localeCompare(noteDateKey(b)));
  const batches = [];
  let current = [];
  let currentSize = 0;

  for (const note of chronological) {
    const size = (note.title?.length || 0) + (note.content?.length || 0) + 200;
    if (current.length && currentSize + size > batchBudget) {
      batches.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(note);
    currentSize += size;
  }

  if (current.length) batches.push(current);
  return batches;
}

function buildBatchSummaryPrompt(notes, productFocus, accountName) {
  const label = noteRangeLabel(notes);
  const scope = productFocus
    ? `${productFocus.name}${accountName ? ` for ${accountName}` : ""}`
    : `${accountName || "the selected account"} account status`;
  const noteBlocks = notes
    .map((n) => `### ${n.date || "undated"} — ${n.title}\n\n${n.content}`)
    .join("\n\n---\n\n");

  return `Compress these older source notes for a later ${scope} report.

Preserve facts, dates, owners, open/closed action items, product/version details, risks, decisions, and relationship context. Do not invent anything.

${BATCH_TEMPORAL_RULE}

Return Markdown with this structure only:

# Source Summary — ${label}

## Current Facts From This Batch
- [dated facts, newest/current interpretation where possible]

## Updates And Corrections Within This Batch
- [newer date] corrected/updated [older date]: [what changed]

## Open Items Still Relevant
- [unchecked or unresolved item] — **Owner:** [owner] | **From:** [date]

## Historical Context
- [older context that may still matter, clearly marked as historical]

---
SOURCES:

${noteBlocks}`;
}

async function summarizeOverflowNotes(client, model, notes, productFocus, accountName) {
  if (!notes.length) return { summaryNotes: [], usage: { input_tokens: 0, output_tokens: 0 } };

  const batches = groupNotesForSummary(notes, model);
  let usage = { input_tokens: 0, output_tokens: 0 };
  const summaryNotes = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const msg = await client.messages.create({
      model,
      max_tokens: Math.min(maxOutputTokens(model), 12_000),
      system: "You compress dated meeting notes for a later synthesis step. Preserve dated changes and newest-current facts. Respond with only Markdown.",
      messages: [{ role: "user", content: buildBatchSummaryPrompt(batch, productFocus, accountName) }],
    });

    usage = combineUsage(usage, msg.usage);
    summaryNotes.push({
      filename: `summary-${i + 1}.md`,
      date: batch[batch.length - 1]?.date || batch[0]?.date || "0000-00-00",
      title: `Compressed older context (${noteRangeLabel(batch)})`,
      content: firstTextBlock(msg),
      source: "summary",
      sourceLabel: "Compressed older notes",
      _summaryCount: batch.length,
    });
  }

  return { summaryNotes, usage };
}

function tagSameDayNotes(notes) {
  const dateCounts = {};
  for (const n of notes) dateCounts[n.date] = (dateCounts[n.date] || 0) + 1;
  const dateIndex = {};
  return notes.map((n) => {
    if (dateCounts[n.date] > 1) {
      dateIndex[n.date] = (dateIndex[n.date] || 0) + 1;
      const pos = dateIndex[n.date];
      const total = dateCounts[n.date];
      const label = pos === 1 ? " *(earliest same-day meeting)*" : pos === total ? " *(latest same-day meeting)*" : ` *(same-day meeting ${pos} of ${total})*`;
      return { ...n, _dayLabel: label };
    }
    return { ...n, _dayLabel: "" };
  });
}
export async function POST(request) {
  try {
    assertTrustedRequest(request);

    const body = await request.json();
    const { notes, apiKey, model, today, replacements = [], corrections = [], productFocus, promptType, accountName, allAccounts = [], restoredIds = [], rangeStart, rangeEnd, resumeRows = [] } = body;

    if (!notes || notes.length === 0) {
      return new Response(JSON.stringify({ error: "No notes provided" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const sanitizedNotes = notes.map((n) => ({
      ...n,
      title: applyReplacements(applyCorrections(n.title || "", corrections), replacements),
      content: applyReplacements(applyCorrections(n.content, corrections), replacements),
    }));

    // Resume rows come from the client with real names — sanitize like note content.
    const sanitizedResumeRows = (resumeRows || []).slice(0, 200).map((r) => ({
      eventDate: r?.eventDate || "",
      title: applyReplacements(applyCorrections(r?.title || "", corrections), replacements),
    }));

    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) {
      return new Response(JSON.stringify({ error: "Anthropic API key is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const selectedModel = model || DEFAULT_MODEL;
    const client = new Anthropic({ apiKey: key });
    const scrubbedNotes = scrubWithExceptions(sanitizedNotes, accountName, allAccounts, restoredIds);
    let { kept, dropped } = fitNotes(scrubbedNotes, selectedModel);
    let summarizedCount = 0;
    let mapReduceUsage = { input_tokens: 0, output_tokens: 0 };

    if (dropped > 0) {
      const overflowNotes = scrubbedNotes.slice(kept.length);
      const summarized = await summarizeOverflowNotes(client, selectedModel, overflowNotes, productFocus, accountName);
      summarizedCount = overflowNotes.length;
      mapReduceUsage = summarized.usage;
      ({ kept, dropped } = fitNotes([...kept, ...summarized.summaryNotes], selectedModel));
    }

    // Reverse to chronological order (oldest → newest) for the prompt.
    // fitNotes works newest-first to drop oldest when over budget; once
    // trimmed, chronological order helps Claude reason about what supersedes what.
    const chronological = [...kept].reverse();

    // Tag same-day notes with position labels so Claude knows which came first.
    const taggedNotes = tagSameDayNotes(chronological);
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        try {
          const systemPrompt = promptType === "csm-activity"
            ? "You are an expert at synthesizing meeting notes into structured activity reports. Respond with only newline-delimited JSON objects — no preamble, no Markdown, no code fences."
            : "You are an expert at synthesizing dated meeting notes into clear, actionable executive summaries. Newer dated sources override older dated sources when they conflict, resolve, or update a fact. Respond with only the Markdown document — no preamble.";
          const messageStream = client.messages.stream({
            model: selectedModel,
            max_tokens: maxOutputTokens(selectedModel),
            system: systemPrompt,
            messages: [{
              role: "user",
              content: promptType === "csm-activity"
                ? buildCSMActivityPrompt(taggedNotes, today || new Date().toISOString().split("T")[0], accountName, allAccounts, { start: rangeStart, end: rangeEnd }, sanitizedResumeRows)
                : productFocus
                ? buildProductPrompt(taggedNotes, today || new Date().toISOString().split("T")[0], productFocus, accountName, allAccounts)
                : buildSynthesisPrompt(taggedNotes, today || new Date().toISOString().split("T")[0], accountName, allAccounts),
            }],
          });

          for await (const event of messageStream) {
            if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
              send({ type: "delta", text: event.delta.text });
            }
          }

          const final = await messageStream.finalMessage();
          send({
            type: "done",
            noteCount: kept.length,
            droppedCount: dropped,
            summarizedCount,
            usage: combineUsage(final.usage, mapReduceUsage),
            model: selectedModel,
          });
        } catch (error) {
          send({ type: "error", message: error?.message || "Synthesis failed" });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error?.message || "Synthesis failed" }), { status: error?.status || 500, headers: { "Content-Type": "application/json" } });
  }
}
