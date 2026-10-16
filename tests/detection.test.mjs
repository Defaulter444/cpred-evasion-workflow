import test from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "./module-harness.mjs";
import { physicalSkill, evasionSkill } from "./physical-fixture.mjs";

async function detectHarness({ ranged = false, thrown = false, autoMelee = false,
  rangedPrompt = true, responsible = "player", gm = false, failDelivery = false } = {}) {
  const calls = [];
  const defender = { id: "defender", name: "Defender", system: { stats: { ref: { value: 2 } } },
    getSkillLevel: () => 0, itemTypes: { skill: [] } };
  const weapon = { id: "weapon", system: { isRanged: ranged, weaponType: thrown ? "thrownWeapon" : ranged ? "heavyPistol" : "mediumMeleeWeapon" } };
  const attacker = { id: "attacker", name: "Attacker", prototypeToken: { name: "Attacker" }, items: new Map([["weapon", weapon]]) };
  const scene = { id: "scene", tokens: new Map() };
  const attackerToken = { id: "attacker-token", name: "Attacker", actor: attacker, parent: scene };
  scene.tokens.set(attackerToken.id, attackerToken);
  scene.tokens.getName = () => attackerToken;
  const target = { document: { id: "defender-token", name: "Defender", actor: defender, parent: scene } };
  const settings = { enableAutoMelee: autoMelee, enableRangedPrompt: rangedPrompt, enforceRef8Gate: true };
  const Sockets = {
    resolveResponsibleUser: () => responsible,
    emitPrompt: async (user, payload) => { if (failDelivery) throw Error("User disconnected"); calls.push({ type: "prompt", user, payload }); },
    emitMelee: async (user, payload) => { if (failDelivery) throw Error("User disconnected"); calls.push({ type: "melee", user, payload }); },
  };
  const game = {
    userId: "attacking-user", user: { isGM: gm },
    actors: new Map([["attacker", attacker]]),
    i18n: { localize: (key) => key, format: (key) => key },
  };
  const module = await loadModule("detect.js", {
    game, canvas: { scene }, ui: { notifications: { warn: (key) => calls.push({ type: "warning", key }) } },
    document: { createElement: () => ({
      querySelector(selector) {
        if (selector.startsWith("[data-tooltip=")) return {};
        if (selector === "[data-action=rollDamage]") return { dataset: { actorId: "attacker", itemId: "weapon", tokenId: "attacker-token" } };
        if (selector.startsWith("span.clickable")) return { innerHTML: "15" };
        return null;
      },
    }) },
  }, {
    "settings.js": { Settings: { get: (key) => settings[key] } },
    "sockets.js": { Sockets },
    "utils.js": { Utils: { getRangedDV: async () => { calls.push({ type: "dv" }); return { dv: 13 }; } } },
    "prompt.js": {
      onPrompt: async (payload) => calls.push({ type: "local-prompt", payload }),
      onMelee: async (payload) => calls.push({ type: "local-melee", payload }),
    },
  });
  async function attack() {
    await module.onCreateChatMessage({ id: "attack", _source: { author: game.userId },
      author: { targets: new Set([target]) }, speaker: { token: attackerToken.id }, content: "attack card" });
  }
  return { calls, attack, module, defender, settings, game };
}

test("auto-melee off routes player-owned melee to manual prompt without ranged gate/DV", async () => {
  const h = await detectHarness();
  await h.attack();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].type, "prompt");
  assert.equal(h.calls[0].user, "player");
  assert.equal(h.calls[0].payload.isMelee, true);
  assert.equal(h.calls[0].payload.canEvadeRanged, true);
  assert.equal(h.calls[0].payload.damageEligible, true);
});

test("auto-melee on keeps the existing automatic path", async () => {
  const h = await detectHarness({ autoMelee: true });
  await h.attack();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].type, "melee");
});

test("thrown-in-melee uses the manual choice but retains damage exclusion", async () => {
  const h = await detectHarness({ ranged: true, thrown: true });
  await h.attack();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].type, "prompt");
  assert.equal(h.calls[0].payload.isMelee, true);
  assert.equal(h.calls[0].payload.damageEligible, false);
});

test("ranged prompt still applies REF/skill gating and carries ranged DV", async () => {
  const h = await detectHarness({ ranged: true });
  await h.attack();
  const prompt = h.calls.find((call) => call.type === "prompt");
  assert.equal(prompt.payload.isMelee, false);
  assert.equal(prompt.payload.canEvadeRanged, false);
  assert.equal(prompt.payload.dv, 13);
});

for (const autoMelee of [false, true]) {
  test(`ranged disabled does not become melee (autoMelee=${autoMelee}, no responsible user)`, async () => {
    const h = await detectHarness({ ranged: true, rangedPrompt: false, autoMelee, responsible: null, gm: true });
    await h.attack();
    assert.equal(h.calls.some((call) => call.type !== "dv"), false);
  });
}

for (const failure of [false, true]) {
  test(`manual melee GM fallback remains manual (${failure ? "delivery rejected" : "no responsible user"})`, async () => {
    const h = await detectHarness({ gm: true, responsible: failure ? "player" : null, failDelivery: failure });
    await h.attack();
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].type, "local-prompt");
    assert.equal(h.calls[0].payload.isMelee, true);
    assert.equal(h.calls[0].payload.canEvadeRanged, true);
  });
}

test("delivery failure on a player does not resolve or damage without authority", async () => {
  const h = await detectHarness({ failDelivery: true });
  await h.attack();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].type, "warning");
});

for (const ref of [3, 8]) {
  test(`Physical ready base satisfies only the ranged skill gate; REF${ref} still controls bullet eligibility`, async () => {
    const h = await detectHarness({ ranged: true });
    Object.assign(h.defender, { type: "mook" });
    h.defender.system.stats.ref.value = ref;
    h.defender.itemTypes.skill.push(evasionSkill(), physicalSkill());
    await h.attack();
    const payload = h.calls.find(call => call.type === "prompt").payload;
    assert.equal(payload.canEvadeRanged, ref >= 8);
    assert.equal(payload.dv, 13);
    assert.equal(payload.isMelee, false);
  });
}

test("disabling the REF gate still requires a positive recognized defense base", async () => {
  const h = await detectHarness({ ranged: true });
  h.defender.type = "mook";
  h.settings.enforceRef8Gate = false;
  const physical = physicalSkill();
  h.defender.itemTypes.skill.push(evasionSkill(), physical);
  await h.attack();
  assert.equal(h.calls.find(call => call.type === "prompt").payload.canEvadeRanged, true);
  h.calls.length = 0; physical.system.level = 0;
  await h.attack();
  assert.equal(h.calls.find(call => call.type === "prompt").payload.canEvadeRanged, false);
});

test("localized trained Evasion uses the same current-language lookup for ranged eligibility and resolution", async () => {
  const h = await detectHarness({ ranged: true });
  h.game.i18n.localize = () => "Уклонение";
  h.defender.system.stats.ref.value = 8;
  h.defender.itemTypes.skill.push(evasionSkill(4, "Уклонение"));
  await h.attack();
  assert.equal(h.calls.find(call => call.type === "prompt").payload.canEvadeRanged, true);
});
