export const FLASH_MODEL = process.env.DEEPSEEK_FLASH_MODEL || "deepseek-flash";
export const PRO_MODEL = process.env.DEEPSEEK_PRO_MODEL || "deepseek-v4-pro";

export function selectModel({ messages = [], taskMode = "", outputMode = "text" } = {}) {
  if (outputMode === "spoken") return FLASH_MODEL;
  if (taskMode === "persona_analysis" || taskMode === "complex_reasoning") return PRO_MODEL;
  const latest = [...messages].reverse().find((item) => item?.role === "user")?.content || "";
  if (/\b(analy[sz]e|reconcile|audit|compare all|summari[sz]e my (full|complete) (persona|preferences)|build a complete persona report)\b/i.test(latest)) {
    return PRO_MODEL;
  }
  return FLASH_MODEL;
}
