import test from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "./module-harness.mjs";
import { physicalSkill, evasionSkill } from "./physical-fixture.mjs";

const module = await loadModule("defense-skill.js", { game: { i18n: { localize: () => "Уклонение" } } });
const select = (skills, type = "mook") => module.selectDefenseSkill({ type, itemTypes: { skill: skills } });

for (const marker of ["legacy", "compendium", "v12"]) {
  test(`known Physical ready base replaces the pack's zero Evasion placeholder (${marker} provenance)`, () => {
    const item = physicalSkill();
    if (marker === "compendium") item.flags.core.sourceId = "Compendium.world.mook-skills.Item.DOHBotVfb7OAFZuq";
    if (marker === "v12") { item.flags = {}; item._stats = { compendiumSource: "Compendium.world.mook-skills.Item.DOHBotVfb7OAFZuq" }; }
    const selected = select([evasionSkill(), item]);
    assert.equal(selected.kind, "physical");
    assert.equal(selected.item, item);
    assert.equal(selected.base, 9);
  });
}

test("recognized Physical supports renamed source items and missing Evasion, without guessing names", () => {
  assert.equal(select([physicalSkill({ name: "Physical" })]).kind, "physical");
  assert.equal(select([physicalSkill({ flags: {}, _stats: { compendiumSource: "Item.DOHBotVfb7OAFZuq" } })]).kind, "physical");
  assert.equal(select([physicalSkill({ flags: {} })]).kind, "untrained");
  assert.equal(select([physicalSkill({ flags: { core: { sourceId: "Item.other" } } })]).kind, "untrained");
  assert.equal(select([physicalSkill({ flags: { core: { sourceId: "Item.DOHBotVfb7OAFZuq-extra" } } })]).kind, "untrained");
  assert.equal(select([physicalSkill({ flags: { core: { sourceId: "Actor.DOHBotVfb7OAFZuq" } } })]).kind, "untrained");
});

test("trained canonical/current-localized Evasion takes priority, and player characters retain Evasion0", () => {
  for (const name of ["Evasion", "Уклонение"]) {
    const trained = evasionSkill(4, name);
    assert.equal(select([physicalSkill(), trained]).item, trained);
  }
  const zero = evasionSkill();
  assert.equal(select([physicalSkill(), zero], "character").item, zero);
  assert.equal(select([physicalSkill()], "character").kind, "untrained");
});

test("ambiguous duplicate Physical items retain ordinary Evasion instead of choosing an arbitrary base", () => {
  const zero = evasionSkill();
  assert.equal(select([zero, physicalSkill(), physicalSkill({ id: "duplicate" })]).item, zero);
  assert.equal(select([physicalSkill(), physicalSkill({ id: "duplicate" })]).kind, "untrained");
});

test("invalid Physical values/schema cannot override ordinary Evasion", () => {
  const zero = evasionSkill();
  for (const patch of [
    { level: -1 }, { level: NaN }, { level: Infinity }, { level: "9" }, { level: null },
    { level: 2.5 }, { stat: "dex" }, { core: true }, { skillType: "language" }, { category: "fightingSkills" },
  ]) {
    const item = physicalSkill(); Object.assign(item.system, patch);
    assert.equal(select([zero, item]).item, zero, JSON.stringify(patch));
  }
  assert.equal(select([zero, physicalSkill({ type: "gear" })]).item, zero);
});
