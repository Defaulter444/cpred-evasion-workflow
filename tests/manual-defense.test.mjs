import test from "node:test";
import assert from "node:assert/strict";
import { ID, promptHarness } from "./module-harness.mjs";

test("player-owned manual melee offers a whispered choice and uses untrained defense", async () => {
  const h = await promptHarness();
  await h.module.onPrompt(h.payload);
  assert.equal(h.messages[0].whisper[0], "player");
  assert.equal(h.rolls.length, 0);
  await h.render().click("evade");
  assert.equal(h.rolls.length, 1);
  assert.equal(h.rolls[0].untrained, true);
  assert.equal(h.results[0].kind, "meleeDodged");
  assert.equal(h.results[0].payload.untrainedDefense, true);
  assert.equal(h.messages[0].flags[ID].resolutionState, "resolved");
});

test("manual melee failure produces one melee hit", async () => {
  const h = await promptHarness({ roll: () => ({ ok: true, dodged: false, evasionTotal: 7 }) });
  await h.module.onPrompt(h.payload);
  await h.render().click("evade");
  assert.equal(h.results.length, 1);
  assert.equal(h.results[0].kind, "meleeHit");
});

test("missing usable melee roll retains the existing no-skill result", async () => {
  const h = await promptHarness({ roll: () => ({ ok: false }) });
  await h.module.onPrompt(h.payload);
  await h.render().click("evade");
  assert.equal(h.results[0].kind, "meleeHit");
  assert.equal(h.results[0].payload.noSkill, true);
});

test("manual melee Tank accepts a hit without rolling or using a ranged DV", async () => {
  const h = await promptHarness();
  await h.module.onPrompt({ ...h.payload, dv: 99 });
  await h.render().click("tank");
  assert.equal(h.rolls.length, 0);
  assert.equal(h.results.length, 1);
  assert.equal(h.results[0].kind, "tanked");
});

test("ranged Tank still checks its DV; ranged Evade does not enable untrained defense", async () => {
  const h = await promptHarness();
  await h.module.onPrompt({ ...h.payload, isMelee: false, dv: 20 });
  await h.render().click("tank");
  assert.equal(h.results[0].kind, "missedAnyway");
  await h.module.onPrompt({ ...h.payload, requestId: "second", isMelee: false });
  await h.render().click("evade");
  assert.equal(h.rolls[0].untrained, false);
  assert.equal(h.results[1].kind, "dodged");
});

test("an injury/REF-disabled Evade cannot be invoked; Tank remains available", async () => {
  const h = await promptHarness();
  await h.module.onPrompt({ ...h.payload, canEvadeRanged: false });
  const html = h.render();
  await html.click("evade");
  assert.equal(h.rolls.length, 0);
  await html.click("tank");
  assert.equal(h.results.length, 1);
});

test("only the addressed owner can act, including ownership lost after render", async () => {
  const h = await promptHarness();
  await h.module.onPrompt(h.payload);
  const html = h.render();
  h.game.userId = "other-player";
  await html.click("tank");
  assert.equal(h.results.length, 0);
  h.game.userId = "player";
  h.options.owner = false;
  await html.click("tank");
  assert.equal(h.results.length, 0);
  assert.equal(h.warnings.length, 1);
});

test("double click and timeout compete for one resolution", async () => {
  let release;
  const pendingRoll = new Promise((resolve) => { release = resolve; });
  const h = await promptHarness({ settings: { promptTimeoutSeconds: 1 }, roll: () => pendingRoll });
  await h.module.onPrompt(h.payload);
  const timeout = [...h.timers.values()][0];
  const html = h.render();
  const first = html.click("evade");
  await html.click("tank");
  timeout();
  release({ ok: true, dodged: false, evasionTotal: 4 });
  await first;
  assert.equal(h.rolls.length, 1);
  assert.equal(h.results.length, 1);
  assert.equal(h.timers.size, 0);
});

test("timeout alone claims a manual melee Tank exactly once", async () => {
  const h = await promptHarness({ settings: { promptTimeoutSeconds: 1 } });
  await h.module.onPrompt(h.payload);
  [...h.timers.values()][0]();
  await new Promise((resolve) => setImmediate(resolve));
  await h.render().click("evade");
  assert.equal(h.results.length, 1);
  assert.equal(h.results[0].kind, "tanked");
  assert.equal(h.rolls.length, 0);
});

test("saved choice survives a fresh module/client instance and blocks repeat damage", async () => {
  const h = await promptHarness();
  await h.module.onPrompt(h.payload);
  await h.render().click("tank");
  const reloaded = await promptHarness({ messages: h.messages });
  await reloaded.module.onPrompt(h.payload);
  assert.equal(reloaded.messages.length, 1);
  const html = reloaded.render();
  assert.equal(html.buttons.tank.disabled, true);
  await html.click("tank");
  assert.equal(reloaded.results.length, 0);
});

test("initial chat rendered before ready disables a completed prompt after reload", async () => {
  const h = await promptHarness();
  await h.module.onPrompt(h.payload);
  await h.render().click("tank");
  // Foundry's initial ChatLog render can precede Hooks.ready on reconnect.
  const reloaded = await promptHarness({ messages: h.messages, fireReady: false });
  const html = reloaded.render(h.messages[0]);
  assert.equal(html.buttons.evade.disabled, true);
  assert.equal(html.buttons.tank.disabled, true);
  await html.click("tank");
  assert.equal(reloaded.results.length, 0);
});

test("initial chat rendered before ready wires a still-pending prompt after reload", async () => {
  const h = await promptHarness();
  await h.module.onPrompt(h.payload);
  const reloaded = await promptHarness({ messages: h.messages, fireReady: false });
  const html = reloaded.render(h.messages[0]);
  assert.equal(typeof html.buttons.evade.handler, "function");
  assert.equal(typeof html.buttons.tank.handler, "function");
  await html.click("tank");
  assert.equal(reloaded.results.length, 1);
  assert.equal(reloaded.results[0].kind, "tanked");
});

test("failure saving a claim starts no effects and permits a safe explicit retry", async () => {
  const h = await promptHarness({ saveFails: true });
  await h.module.onPrompt(h.payload);
  const html = h.render();
  await html.click("tank");
  assert.equal(h.results.length, 0);
  assert.equal(html.buttons.tank.disabled, false);
  h.options.saveFails = false;
  await html.click("tank");
  assert.equal(h.results.length, 1);
});

test("legacy completed result blocks an old prompt after reload without a resolutionState", async () => {
  const h = await promptHarness();
  await h.module.onPrompt({ ...h.payload, isMelee: false });
  const oldPrompt = h.messages[0];
  h.messages.push({ flags: { [ID]: { result: true, requestId: h.payload.requestId } } });
  const reloaded = await promptHarness({ messages: h.messages });
  const html = reloaded.render(oldPrompt);
  assert.equal(oldPrompt.flags[ID].resolutionState, undefined);
  assert.equal(html.buttons.evade.disabled, true);
  assert.equal(html.buttons.tank.disabled, true);
  await html.click("tank");
  assert.equal(reloaded.results.length, 0);
  assert.equal(reloaded.rolls.length, 0);
});

test("a legacy result arriving after render also prevents the bound click from resolving again", async () => {
  const h = await promptHarness();
  await h.module.onPrompt(h.payload);
  const html = h.render();
  h.messages.push({ flags: { [ID]: { result: true, requestId: h.payload.requestId } } });
  await html.click("evade");
  assert.equal(h.results.length, 0);
  assert.equal(h.rolls.length, 0);
  assert.equal(html.buttons.tank.disabled, true);
});

test("a legacy result does not block a different attack request", async () => {
  const h = await promptHarness();
  h.messages.push({ flags: { [ID]: { result: true, requestId: "other-attack-token" } } });
  await h.module.onPrompt(h.payload);
  await h.render().click("tank");
  assert.equal(h.results.length, 1);
});

test("failure after resolution starts is visible and cannot retry potential damage", async () => {
  const h = await promptHarness({ resultFails: true });
  await h.module.onPrompt(h.payload);
  const html = h.render();
  await html.click("tank");
  await html.click("tank");
  assert.equal(h.results.length, 1);
  assert.equal(h.messages[0].flags[ID].resolutionState, "failed");
  assert.equal(h.errors.length, 1);
  assert.match(h.errors[0][0], /defenseFailed$/);
});

test("failure creating the prompt can safely retry delivery", async () => {
  const h = await promptHarness({ createFails: true });
  await assert.rejects(h.module.onPrompt(h.payload), /Cannot create/);
  h.options.createFails = false;
  await h.module.onPrompt(h.payload);
  await h.module.onPrompt(h.payload);
  assert.equal(h.messages.length, 1);
});

test("automatic melee remains prompt-free and deduplicated", async () => {
  const h = await promptHarness();
  await h.module.onMelee(h.payload);
  await h.module.onMelee(h.payload);
  assert.equal(h.messages.length, 0);
  assert.equal(h.rolls.length, 1);
  assert.equal(h.rolls[0].untrained, true);
  assert.equal(h.results[0].kind, "meleeDodged");
});
