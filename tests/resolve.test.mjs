import test from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "./module-harness.mjs";
import { physicalSkill, evasionSkill } from "./physical-fixture.mjs";

async function resolver({ type = "mook", localized = false, tokenActor = true } = {}) {
  const calls = [], cards = [];
  const roll = {
    statValue: 6, skillValue: 4,
    async roll() { calls.push("roll"); this.resultTotal = 16; },
  };
  const evasion = {
    id: "evasion", name: localized ? "Уклонение" : "Evasion", type: "skill",
    system: { level: 4, stat: "dex", category: "fightingSkills" },
    createRoll(rollType, actor) {
      calls.push({ rollType, actor });
      return roll;
    },
  };
  const actor = {
    id: "defender", type, name: "NPC", itemTypes: { skill: [evasion] },
    getStat() { assert.fail("The adapter must not add another stat outside Item.createRoll"); },
  };
  const unrelatedWorldActor = {
    id: actor.id, type, itemTypes: { skill: [] },
    getStat() { assert.fail("Synthetic token actor must take priority over the same-ID world actor"); },
  };
  const token = { id: "token", actor };
  const game = {
    scenes: new Map([["scene", { tokens: new Map(tokenActor ? [[token.id, token]] : []) }]]),
    actors: new Map([[actor.id, tokenActor ? unrelatedWorldActor : actor]]),
    i18n: { localize: () => "Уклонение" },
  };
  const module = await loadModule("resolve.js", { game, canvas: {} }, {
    "settings.js": { Settings: { get: () => true } },
    "cprSystem.js": {
      getSkillRollType: () => "skill",
      getCPRSkillRoll: () => { assert.fail("A trained native skill must not use bare-stat fallback"); },
      getRenderRollCard: () => async (value) => cards.push(value),
    },
  });
  return { module, actor, roll, calls, cards, payload: {
    defActorId: actor.id, defTokenId: token.id, defSceneId: "scene", attackTotal: 16, untrained: true,
  } };
}

for (const type of ["character", "mook"]) {
  test(`${type} Evasion uses the native skill pipeline once without adding DEX or level again`, async () => {
    const h = await resolver({ type });
    const result = await h.module.resolveEvasion(h.payload);
    assert.equal(result.ok, true);
    assert.equal(result.evasionTotal, 16);
    assert.equal(result.dodged, true);
    assert.equal(result.untrainedDefense, false);
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[0].rollType, "skill");
    assert.equal(h.calls[0].actor, h.actor);
    assert.equal(h.calls[1], "roll");
    assert.equal(h.roll.statValue, 6);
    assert.equal(h.roll.skillValue, 4);
    assert.equal(h.cards[0], h.roll);
    assert.equal(h.roll.entityData.item, "evasion");
    assert.equal(h.roll.entityData.token, "token");
  });
}

test("a localized Evasion item also retains its native skill roll", async () => {
  const h = await resolver({ localized: true });
  const result = await h.module.resolveEvasion(h.payload);
  assert.equal(result.evasionTotal, 16);
  assert.equal(h.calls[0].actor, h.actor);
  assert.equal(h.roll.entityData.item, "evasion");
});

test("actor fallback without a token still uses native Evasion", async () => {
  const h = await resolver({ tokenActor: false });
  const result = await h.module.resolveEvasion(h.payload);
  assert.equal(result.evasionTotal, 16);
  assert.equal(h.calls[0].actor, h.actor);
  assert.equal(h.roll.entityData.token, null);
});

async function untrainedResolver({ type = "mook", worldItems = [], otherSkills = [], nativeAvailable = true, nativeError = null, nativeMods = [] } = {}) {
  const rolls = [], cards = [], statReads = [], temporaryItems = [];
  const actor = {
    id: "untrained", type, name: "Untrained defender", itemTypes: { skill: [] },
    system: { stats: { dex: { value: 8 }, ref: { value: 3 } } },
  };
  actor.getStat = (name) => { statReads.push(name); return actor.system.stats[name].value; };
  actor.createEmbeddedDocuments = () => assert.fail("Untrained defense must not persist an Item");
  actor.update = () => assert.fail("Constructing an ephemeral skill must not update its actor");
  // Foundry Collections iterate their document values, unlike JavaScript Map entries.
  const actors = [actor, { id: "other", itemTypes: { skill: otherSkills } }];
  actors.get = id => actors.find(value => value.id === id);
  class SkillRoll {
    constructor(statName, statValue, skillName, skillValue) {
      Object.assign(this, { statName, statValue, skillName, skillValue });
      this.mods = nativeMods;
      rolls.push(this);
    }
    async roll() { this.resultTotal = 6 + this.statValue + this.skillValue + this.mods.reduce((sum, mod) => sum + mod.value, 0); }
  }
  class NativeItem {
    constructor(data, options) {
      Object.assign(this, data);
      this.parent = options.parent;
      temporaryItems.push(this);
    }
    static create() { assert.fail("Temporary skills must use construction, not persistence"); }
    createRoll(rollType, defender) {
      if (nativeError) throw nativeError;
      assert.equal(rollType, "skill");
      assert.equal(defender, actor);
      assert.equal(this.parent, actor);
      return new SkillRoll(this.system.stat, defender.getStat(this.system.stat), this.name, this.system.level);
    }
  }
  const game = {
    actors, items: worldItems,
    scenes: new Map([["scene", { tokens: new Map([["token", { id: "token", actor }]]) }]]),
    i18n: { localize: () => "Уклонение", format: (key, data) => key.endsWith(".physicalBase") ? `${data.skill} (base)` : key },
  };
  const module = await loadModule("resolve.js", { game, canvas: {}, CONFIG: { Item: { documentClass: nativeAvailable ? NativeItem : null } } }, {
    "settings.js": { Settings: { get: () => true } },
    "cprSystem.js": { getSkillRollType: () => "skill", getCPRSkillRoll: () => SkillRoll,
      getRenderRollCard: () => async value => cards.push(value) },
  });
  return { module, rolls, cards, statReads, temporaryItems, actor, payload: {
    defActorId: actor.id, defTokenId: "token", defSceneId: "scene", attackTotal: 12, untrained: true,
  } };
}

for (const type of ["mook", "character"]) {
  test(`${type} without any world Evasion uses DEX 8 + fixed d10 6 = 14, not REF 3 + 6 = 9`, async () => {
    const h = await untrainedResolver({ type });
    const result = await h.module.resolveEvasion(h.payload);
    assert.equal(result.ok, true);
    assert.equal(result.untrainedDefense, true);
    assert.equal(result.evasionTotal, 14);
    assert.equal(result.dodged, true);
    assert.deepEqual(h.statReads, ["dex"]);
    assert.equal(h.rolls.length, 1);
    assert.equal(h.rolls[0].skillValue, 0);
    assert.equal(h.cards[0], h.rolls[0]);
    assert.equal(h.rolls[0].entityData.item, null);
  });
}

test("untrained fallback creates only an ephemeral level-zero native skill belonging to the defender", async () => {
  const h = await untrainedResolver();
  assert.equal((await h.module.resolveEvasion(h.payload)).evasionTotal, 14);
  assert.equal(h.temporaryItems.length, 1);
  const item = h.temporaryItems[0];
  assert.equal(item.name, "Evasion");
  assert.equal(item.type, "skill");
  assert.equal(item.system.stat, "dex");
  assert.equal(item.system.level, 0);
  assert.equal(item.system.category, "fightingSkills");
  assert.equal(item.system.core, true);
  assert.equal(item.parent, h.actor);
  assert.equal(item._id, undefined);
  assert.equal(h.actor.itemTypes.skill.length, 0);
  assert.equal(h.rolls[0].entityData.item, null);
});

test("untrained resolution retains all modifiers returned by the native skill builder exactly once", async () => {
  const nativeMods = [{ value: -2, source: "Armor" }, { value: -2, source: "Wound" }, { value: 5, source: "Native effect" }];
  const h = await untrainedResolver({ nativeMods });
  const result = await h.module.resolveEvasion(h.payload);
  assert.equal(result.evasionTotal, 15);
  assert.equal(h.rolls[0].mods, nativeMods);
  assert.equal(h.rolls[0].mods.length, 3);
  assert.deepEqual(h.statReads, ["dex"]);
});

test("a missing native Item constructor does not perform a partial bare-stat roll", async () => {
  const h = await untrainedResolver({ nativeAvailable: false });
  const result = await h.module.resolveEvasion(h.payload);
  assert.equal(result.ok, false);
  assert.equal(h.rolls.length, 0);
  assert.equal(h.cards.length, 0);
});

test("native skill builder errors propagate without posting a misleading defense card", async () => {
  const h = await untrainedResolver({ nativeError: new Error("Invalid native skill") });
  await assert.rejects(h.module.resolveEvasion(h.payload), /Invalid native skill/);
  assert.equal(h.rolls.length, 0);
  assert.equal(h.cards.length, 0);
  assert.equal(h.actor.itemTypes.skill.length, 0);
});

for (const source of ["worldItems", "otherSkills"]) {
  test(`untrained lookup recognizes the current localized skill name in ${source}`, async () => {
    // An explicit world definition may customize the stat. A DEX-only fixture would not
    // distinguish successful localized lookup from falling through to the new default.
    const skill = { name: "Уклонение", type: "skill", system: { stat: "ref", level: 7 } };
    const h = await untrainedResolver({ [source]: [skill] });
    const result = await h.module.resolveEvasion(h.payload);
    assert.equal(result.evasionTotal, 9);
    assert.deepEqual(h.statReads, ["ref"]);
    assert.equal(h.rolls[0].skillValue, 0, "another actor's skill level must not be borrowed");
  });

  test(`canonical Evasion takes priority over a localized duplicate in ${source}`, async () => {
    const skills = [
      { name: "Уклонение", type: "skill", system: { stat: "ref" } },
      { name: "Evasion", type: "skill", system: { stat: "dex" } },
    ];
    const h = await untrainedResolver({ [source]: skills });
    assert.equal((await h.module.resolveEvasion(h.payload)).evasionTotal, 14);
    assert.deepEqual(h.statReads, ["dex"]);
  });
}

test("a world non-skill item named Evasion cannot change the fallback stat", async () => {
  const h = await untrainedResolver({ worldItems: [{ name: "Evasion", type: "gear", system: { stat: "ref" } }] });
  assert.equal((await h.module.resolveEvasion(h.payload)).evasionTotal, 14);
});

test("ranged resolution without an Evasion item still refuses the untrained fallback", async () => {
  const h = await untrainedResolver();
  const result = await h.module.resolveEvasion({ ...h.payload, untrained: false });
  assert.equal(result.ok, false);
  assert.equal(h.rolls.length, 0);
  assert.equal(h.cards.length, 0);
  assert.deepEqual(h.statReads, []);
});

for (const untrained of [true, false]) {
  test(`Physical9 with DEX3 and Evasion0 rolls 9+d10, without duplicate DEX or persisted Items (${untrained ? "melee" : "ranged"})`, async () => {
    const h = await untrainedResolver();
    h.actor.system.stats.dex.value = 3;
    const physical = physicalSkill(), zero = evasionSkill();
    zero.createRoll = () => assert.fail("The pack's Evasion0 placeholder must not suppress Physical");
    h.actor.itemTypes.skill.push(zero, physical);
    const before = structuredClone(physical);
    const result = await h.module.resolveEvasion({ ...h.payload, untrained });
    assert.equal(result.evasionTotal, 15, "ready base9 + fixed die6; not DEX3+6 or DEX3+base9+6");
    assert.equal(result.untrainedDefense, false);
    assert.equal(result.dodged, true);
    assert.equal(h.cards[0].statName, "Физические (base)");
    assert.equal(h.cards[0].rollTitle, "Уклонение — Физические (base)");
    assert.equal(h.cards[0].skillValue, 0);
    assert.equal(h.cards[0].entityData.item, null, "the zero Evasion item must not be mistaken for the temporary adapted roll");
    assert.deepEqual(h.statReads, ["dex"], "native DEX builder prepares defense penalties before base substitution");
    assert.equal(h.temporaryItems.length, 1);
    assert.equal(h.actor.itemTypes.skill.length, 2);
    assert.deepEqual(physical, before);
    assert.equal(zero.system.level, 0);
  });
}

test("explicitly trained Evasion remains native when the mook also carries generic Physical", async () => {
  const h = await resolver();
  h.actor.itemTypes.skill.push(physicalSkill());
  assert.equal((await h.module.resolveEvasion(h.payload)).evasionTotal, 16);
  assert.equal(h.calls[0].actor, h.actor);
  assert.equal(h.roll.entityData.item, "evasion");
});
