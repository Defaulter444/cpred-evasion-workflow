import { EVASION_SKILL_NAME } from "./constants.js";

/** Canonical core names take priority over names matching the current client language. */
export function findEvasionSkill(skills) {
  const canonical = skills?.find((skill) => skill.name === EVASION_SKILL_NAME);
  if (canonical) return canonical;
  const localizedName = game.i18n.localize("CPR.global.itemType.skill.evasion");
  return skills?.find((skill) => skill.name === localizedName);
}

// The four-skill mooks from Night City Gang and Corp Mook Pack use Physical as a
// complete base, stored in a generic INT skill while their ordinary Evasion is 0.
// Recognize the original Item identity, not an arbitrary skill with a similar name.
const PHYSICAL_SOURCE = /^(?:Item|Compendium\.[^.]+\.[^.]+\.Item)\.DOHBotVfb7OAFZuq$/;

function findPhysicalBase(actor) {
  if (actor.type !== "mook") return null;
  const candidates = (actor.itemTypes?.skill ?? []).filter((item) =>
    [item.flags?.core?.sourceId, item._stats?.compendiumSource].some((source) =>
      typeof source === "string" && PHYSICAL_SOURCE.test(source)));
  // Ambiguous duplicates or changed schema are not sufficient evidence for replacing
  // a normal skill. The caller safely retains ordinary Evasion/untrained behavior.
  if (candidates.length !== 1) return null;
  const item = candidates[0], data = item.system;
  if (item.type !== "skill" || data?.core !== false || data.stat !== "int" ||
      data.category !== "awarenessSkills" || data.skillType !== "generic" ||
      !Number.isFinite(data.level) || !Number.isInteger(data.level) || data.level < 0) return null;
  return item;
}

/** One selection rule for defense resolution and the ranged prompt's skill gate. */
export function selectDefenseSkill(actor) {
  const evasion = findEvasionSkill(actor.itemTypes?.skill);
  // An explicitly trained skill expresses the GM's more specific choice.
  if (Number(evasion?.system?.level) > 0) return { kind: "evasion", item: evasion };
  const physical = findPhysicalBase(actor);
  if (physical) return { kind: "physical", item: physical, base: physical.system.level };
  return evasion ? { kind: "evasion", item: evasion } : { kind: "untrained", item: null };
}
