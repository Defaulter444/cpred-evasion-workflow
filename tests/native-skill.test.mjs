import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

// Optional installed-system integration. No CPR/Foundry source is copied into this repository.
// Set CPR_SYSTEM_ROOT to a local cyberpunk-red-core directory to run these checks.
// Files are read only; no Foundry server, UI, world or database is opened.
const systemRoot = process.env.CPR_SYSTEM_ROOT;
const nativeTest = systemRoot ? test : test.skip;

async function nativeHarness({ trained = false, physical = false } = {}) {
  const root = pathToFileURL(path.resolve(systemRoot) + path.sep);
  const metadata = JSON.parse(await readFile(new URL("system.json", root), "utf8"));
  assert.equal(metadata.id, "cyberpunk-red-core");
  const documents = [], cards = [], statReads = [], armorStats = [], roleSkillNames = [];
  let evaluatedDice = 0;
  // Replace only Foundry's document/dice/browser boundaries; the CPR Item factory,
  // CPRItem dispatcher, CPRSkillItem builder, CPRMod and CPRRoll classes remain real.
  class Document {
    constructor(data, options = {}) {
      Object.assign(this, structuredClone(data));
      this.parent = options.parent;
      this.id = data._id ?? null;
      this.effects = [];
      documents.push(this);
      this.prepareDerivedData();
    }
    prepareDerivedData() {}
    static create() { assert.fail("No document may be persisted by an untrained roll"); }
    update() { assert.fail("Native integration must remain read-only"); }
  }
  class DialogBase { constructor(_data, options = {}) { this.options = options; } async getData() { return {}; } }
  class FixedRoll {
    constructor() { this.total = 6; this.terms = [{ formula: "1d10", total: 6, faces: 10, results: [{ result: 6 }] }]; }
    async evaluate() { evaluatedDice++; return this; }
  }
  const utils = {
    Localize: key => key, Format: key => key,
    slugify: name => name[0].toLowerCase() + name.slice(1).replaceAll(" ", ""),
    getMixins: () => [], hasMixin: () => false,
    getPrototypeChain: value => {
      const names = [];
      for (let proto = Object.getPrototypeOf(value); proto; proto = Object.getPrototypeOf(proto)) names.push(proto.constructor.name);
      return names;
    },
  };
  const game = { system: { id: metadata.id }, settings: { get: () => false },
    i18n: { localize: () => "Уклонение", format: (key, params) =>
      key.endsWith(".roll.physicalBase") ? `${params.skill} (base)` : key } };
  const CONFIG = { Item: {} };
  const context = vm.createContext({ game, CONFIG, canvas: {}, Item: Document, Roll: FixedRoll,
    foundry: { utils: { mergeObject: Object.assign } }, console });
  const stubs = {
    "cpr-logger.js": { default: { warn() {}, error() {}, debug() {} } },
    "cpr-dice-handler.js": { default: { handle3dDice: async () => {} } },
    "cpr-systemUtils.js": { default: utils },
    "config.js": { default: { statList: { dex: "DEX", ref: "REF" }, defaultSituationalMods: {} } },
    "cpr-dialog-application.js": { default: DialogBase },
    "overrides.js": { validateOverride() { return true; } },
    "settings.js": { Settings: { get: () => true } },
    "cprSystem.js": { getSkillRollType: () => "skill", getRenderRollCard: () => async roll => cards.push(roll) },
  };
  const cache = new Map();
  async function load(url) {
    if (cache.has(url.href)) return cache.get(url.href);
    const basename = url.pathname.split("/").at(-1);
    let stub = stubs[basename];
    if (url.pathname.includes("/modules/actor/") ||
        (url.pathname.includes("/item/types/") && basename !== "cpr-skill.js")) stub = { default: class UnusedDocument {} };
    if (url.pathname.includes("/item/mixins/")) stub = { default() {}, ContainerUtils: {} };
    const mod = stub
      ? new vm.SyntheticModule(Object.keys(stub), function () {
        for (const [key, value] of Object.entries(stub)) this.setExport(key, value);
      }, { context, identifier: url.href })
      : new vm.SourceTextModule(await readFile(url, "utf8"), { context, identifier: url.href });
    cache.set(url.href, mod);
    return mod;
  }
  const linker = (specifier, parent) => load(new URL(specifier, parent.identifier));
  const factory = await load(new URL("modules/entity-factory.js", root));
  await factory.link(linker);
  await factory.evaluate();
  CONFIG.Item.documentClass = factory.namespace.itemConstructor;
  function effect(id, key, value, { situational = false, on = true, disabled = false, suppressed = false } = {}) {
    return { id, name: id, disabled, system: { isSuppressed: suppressed }, changes: [{ key, value, mode: 2 }],
      flags: { [game.system.id]: { changes: { cats: ["skill"], situational: [{ isSituational: situational, onByDefault: on }] } } } };
  }
  const effects = [
    effect("permanent", "bonuses.evasion", 2),
    effect("default-on", "bonuses.evasion", 3, { situational: true }),
    effect("default-off", "bonuses.evasion", 40, { situational: true, on: false }),
    effect("disabled", "bonuses.evasion", 100, { disabled: true }),
    effect("suppressed", "bonuses.evasion", 100, { suppressed: true }),
    effect("global", "bonuses.allActions", 2),
    effect("physical-only", "bonuses.физические", 100),
  ];
  const actor = { id: "defender", type: "mook", name: "Native modifiers test",
    system: { stats: { dex: { value: physical ? 3 : 8 }, int: { value: 0 } } },
    getStat: name => { statReads.push(name); assert.equal(name, "dex"); return physical ? 3 : 8; },
    allApplicableEffects: () => effects,
    getArmorPenaltyMods: stat => { armorStats.push(stat); return -1; }, getWoundStateMods: () => -2,
    itemTypes: { skill: [], role: [{ getRoleMods: skill => {
      roleSkillNames.push(skill);
      return [{ id: "role", value: 1, source: "Role", isSituational: false }];
    } }] },
    createEmbeddedDocuments: () => assert.fail("No embedded document writes"),
  };
  const actors = [actor];
  actors.get = id => actors.find(value => value.id === id);
  game.actors = actors;
  game.items = [];
  game.scenes = new Map([["scene", { tokens: new Map([["token", { id: "token", actor }]]) }]]);
  const data = { name: "Evasion", type: "skill", system: { stat: "dex", level: trained ? 4 : 0,
    category: "fightingSkills", core: true, basic: true } };
  if (trained || physical) actor.itemTypes.skill.push(new CONFIG.Item.documentClass({ ...data, _id: "evasion" }, { parent: actor }));
  if (physical) actor.itemTypes.skill.push(new CONFIG.Item.documentClass({
    _id: "physical", name: "Физические", type: "skill",
    system: { level: 9, stat: "int", core: false, category: "awarenessSkills", skillType: "generic" },
    flags: { core: { sourceId: "Item.DOHBotVfb7OAFZuq" } },
  }, { parent: actor }));
  const resolve = await load(new URL("../scripts/resolve.js", import.meta.url));
  await resolve.link(linker);
  await resolve.evaluate();
  return { module: resolve.namespace, actor, cards, documents, data, effects, statReads, armorStats, roleSkillNames,
    ItemClass: CONFIG.Item.documentClass,
    Dialog: cache.get(new URL("modules/dialog/cpr-roll-dialog.js", root).href).namespace.CPRRollDialog,
    diceCount: () => evaluatedDice,
    payload: { defActorId: actor.id, defSceneId: "scene", defTokenId: "token", attackTotal: 18, untrained: true } };
}

for (const trained of [false, true]) {
  nativeTest(`${trained ? "trained Evasion takes precedence over" : "recognized ready-base"} Physical preserves installed CPR defense modifiers and source documents`, async () => {
    const h = await nativeHarness({ physical: true, trained });
    const sourceItems = [...h.actor.itemTypes.skill];
    const snapshot = () => JSON.stringify({
      actor: h.actor.system,
      effects: h.effects,
      skills: h.actor.itemTypes.skill.map(item => ({ id: item.id, name: item.name, system: item.system, flags: item.flags })),
    });
    const before = snapshot();
    // Ready-base Physical also qualifies without the melee-only untrained fallback.
    const result = await h.module.resolveEvasion({ ...h.payload, untrained: false });
    const roll = h.cards[0];
    assert.equal(result.ok, true);
    assert.equal(result.evasionTotal, trained ? 18 : 20,
      trained ? "DEX3 + Evasion4 + die6 + native modifiers5" : "Physical base9 + die6 + native modifiers5; no extra DEX or INT");
    assert.equal(result.untrainedDefense, false);
    assert.equal(result.dodged, true, "the tie setting is respected for trained Evasion18 against attack18");
    assert.equal(h.diceCount(), 1);
    assert.deepEqual(h.statReads, ["dex"]);
    assert.deepEqual(h.armorStats, ["dex"], "armor retains Evasion's governing stat even when its base is replaced");
    assert.deepEqual(h.roleSkillNames, ["Evasion"], "role modifiers still target native Evasion");
    assert.equal(roll.statValue, trained ? 3 : 9);
    assert.equal(roll.skillValue, trained ? 4 : 0);
    assert.equal(roll.skillName, "Evasion");
    assert.equal(roll.statName, trained ? "DEX" : "Физические (base)");
    if (!trained) assert.equal(roll.rollTitle, "Уклонение — Физические (base)", "the base must not be mislabeled as DEX");
    assert.equal(roll.totalMods(), 5);
    assert.equal(roll.mods.length, 6);
    assert.equal(roll.mods.some(mod => ["physical-only", "disabled", "suppressed", "default-off"].includes(mod.source)), false);
    assert.equal(roll.mods.some(mod => mod.source === "permanent"), true, "Evasion-specific active effect is retained");
    assert.equal(roll.mods.some(mod => mod.source === "default-on"), true, "default-on Evasion effect is retained");
    assert.equal(h.documents.length, trained ? 2 : 3, "Physical adds only an ephemeral native Evasion when needed");
    assert.equal(h.actor.itemTypes.skill.length, 2);
    for (let i = 0; i < sourceItems.length; i++) assert.equal(h.actor.itemTypes.skill[i], sourceItems[i]);
    assert.equal(snapshot(), before, "actor, original skill documents and active effects are unchanged");
    assert.equal(roll.entityData.item, trained ? "evasion" : null, "an ephemeral roll cannot impersonate the Physical item");
  });
}

for (const trained of [false, true]) {
  nativeTest(`${trained ? "existing" : "ephemeral level-zero"} Evasion uses installed CPR armor, wound, role and default-on effect modifiers`, async () => {
    const h = await nativeHarness({ trained });
    const result = await h.module.resolveEvasion(h.payload);
    const roll = h.cards[0];
    assert.equal(result.evasionTotal, trained ? 23 : 19, "DEX8 + level + die6 + armor(-1)/wound(-2)/role1/effect2/defaultOn3/global2");
    assert.equal(result.untrainedDefense, !trained);
    assert.equal(h.diceCount(), 1);
    assert.equal(roll.statValue, 8);
    assert.equal(roll.skillValue, trained ? 4 : 0);
    assert.equal(roll.totalMods(), 5);
    assert.equal(roll.mods.length, 6);
    assert.equal(roll.mods.some(mod => ["disabled", "suppressed", "default-off"].includes(mod.source)), false);
    assert.equal(h.documents.length, 1, "one existing or ephemeral document; no duplicates");
    assert.equal(h.documents[0].constructor.name, "CPRSkillItem", "native factory selects the system's skill subclass");
    assert.equal(h.documents[0].parent, h.actor);
    assert.equal(h.actor.itemTypes.skill.length, trained ? 1 : 0);
    assert.equal(roll.entityData.item, trained ? "evasion" : null);
  });
}

nativeTest("installed CPR dialog initialization and Ctrl-skip do not add missing default modifiers", async () => {
  const h = await nativeHarness();
  const totals = [];
  for (const mode of ["direct", "skip", "dialog"]) {
    const item = new h.ItemClass(h.data, { parent: h.actor });
    const roll = item.createRoll("skill", h.actor);
    if (mode === "skip") await roll.handleRollDialog({ type: "click", ctrlKey: true }, h.actor, item);
    if (mode === "dialog") {
      const data = await new h.Dialog(roll, h.actor, item, {}).getData();
      assert.equal(data.filteredMods.some(mod => mod.source === "default-off"), true, "off modifiers are offered for a deliberate user choice");
    }
    await roll.roll();
    totals.push(roll.resultTotal);
  }
  assert.deepEqual(totals, [19, 19, 19]);
});
