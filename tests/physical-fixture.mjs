// Minimal synthetic schema, not a copied actor/compendium record.
export function physicalSkill(overrides = {}) {
  return {
    id: "physical", name: "Физические", type: "skill",
    system: { level: 9, stat: "int", core: false, category: "awarenessSkills", skillType: "generic" },
    flags: { core: { sourceId: "Item.DOHBotVfb7OAFZuq" } },
    ...overrides,
  };
}

export function evasionSkill(level = 0, name = "Evasion") {
  return { id: "evasion", name, type: "skill", system: { level, stat: "dex", core: true } };
}
