export const TEMPORAL_ACCURACY_RULE = `**Temporal accuracy rule:** Sources are dated and older information may be stale. When a newer source contradicts, reverses, completes, cancels, or materially updates something in an older source, the newer source is authoritative. Use the newest dated fact in the body of the report, and mention the older fact only in Information Changes when the change matters. Do not repeat outdated information as if it is still current. Example: "As of [newer date], this changed from X to Y."`;

export const BATCH_TEMPORAL_RULE = "Temporal rule: notes are chronological and dated. If a newer note in this batch updates, reverses, resolves, or corrects an older note, state the newest current fact first and then record the change. Do not preserve stale older facts as current.";

export function dateSortValue(date) {
  return date || "0000-00-00";
}
