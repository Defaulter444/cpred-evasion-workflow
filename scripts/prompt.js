/**
 * cpred-evasion-workflow - receiver handlers (run on the DEFENDER's responsible client).
 *
 * onMelee  -> resolve immediately (no prompt).
 * onPrompt -> post an interactive whispered Evade/Tank card; wire button clicks;
 *             auto-resolve to Tank after promptTimeoutSeconds (0 = wait indefinitely).
 *
 * Both dedupe on requestId via a module-level Set (one-shot guard #1). The result card
 * is created by resolve.postResult on THIS client; Foundry natively broadcasts it to all
 * clients, so no socket round-trip is needed for the result.
 */
import { MODULE_ID, LOG, KIND } from "./constants.js";
import { Settings } from "./settings.js";
import { resolveEvasion, postResult } from "./resolve.js";

// One-shot guard: a given requestId is processed exactly once on this client.
const processed = new Set();

// Tracks pending prompt timeouts so a click can cancel the auto-Tank.
const pendingTimeouts = new Map();
// Tracks which requestIds already had a button acted on (prevents double-click race).
const actedPrompts = new Set();

// Before persisted prompt states existed, completed results already carried this
// requestId. Respect those records when an old prompt is rendered after an update.
function hasRecordedResult(requestId) {
  return !!game.messages?.find((message) => {
    const flag = message.flags?.[MODULE_ID];
    return flag?.result && flag.requestId === requestId;
  });
}

/** MELEE receiver: immediately roll opposed Evasion and post the result. */
export async function onMelee(payload) {
  const { requestId } = payload;
  if (processed.has(requestId)) return;
  processed.add(requestId);

  console.log(`${LOG} | onMelee`, payload);
  // untrained:true asks resolveEvasion to roll a bare DEX+d10 (Evasion level 0) opposed
  // check when the actor has NO Evasion skill item, because in CP:R melee is always opposed
  // and an untrained defender still rolls their governing stat. Many mook/imported NPCs ship
  // without the Evasion item; they must still get to defend rather than be auto-hit.
  const { evasionTotal, dodged, ok, untrainedDefense } = await resolveEvasion({
    ...payload,
    untrained: true,
  });
  if (!ok) {
    // Could not build ANY roll (e.g. missing DEX stat / roll classes) -> hit stands,
    // flagged noSkill so the card reads correctly instead of "Evasion 0".
    await postResult(KIND.MELEE_HIT, { ...payload, evasionTotal: 0, noSkill: true });
    return;
  }
  await postResult(dodged ? KIND.MELEE_DODGED : KIND.MELEE_HIT, {
    ...payload,
    evasionTotal,
    untrainedDefense: !!untrainedDefense,
  });
}

/** Ranged or manual melee receiver: whisper the choice to the responsible user. */
export async function onPrompt(payload) {
  const { requestId, atkName, defName, canEvadeRanged } = payload;
  if (processed.has(requestId) || hasRecordedResult(requestId)) return;
  // Persisted prompts survive a reload; do not create a second actionable card.
  if (game.messages?.find((m) => m.flags?.[MODULE_ID]?.prompt &&
      m.flags[MODULE_ID].requestId === requestId)) return;
  processed.add(requestId);

  console.log(`${LOG} | onPrompt`, payload);

  const body = game.i18n.format(`${MODULE_ID}.prompt.body`, {
    attacker: atkName,
    target: defName,
  });
  const cannotEvade = game.i18n.localize(`${MODULE_ID}.prompt.cannotEvade`);

  const evadeDisabledAttrs = canEvadeRanged
    ? ""
    : `disabled data-tooltip="${cannotEvade}"`;

  const content = `
<div class="cpr-evasion-prompt" data-request-id="${requestId}">
  <div class="cpr-evasion-title">${game.i18n.localize(`${MODULE_ID}.prompt.title`)}</div>
  <div class="cpr-evasion-body">${body}</div>
  <div class="cpr-evasion-buttons">
    <button type="button" class="cpr-evasion-btn evade" data-action="cpr-evade" data-request-id="${requestId}" ${evadeDisabledAttrs}>
      ${game.i18n.localize(`${MODULE_ID}.prompt.evade`)}
    </button>
    <button type="button" class="cpr-evasion-btn tank" data-action="cpr-tank" data-request-id="${requestId}">
      ${game.i18n.localize(`${MODULE_ID}.prompt.tank`)}
    </button>
  </div>
</div>`;

  // Whisper the prompt to this user only (the responsible defender user).
  let message;
  try {
    message = await ChatMessage.create({
      content,
      whisper: [game.userId],
      speaker: { alias: game.i18n.localize(`${MODULE_ID}.prompt.title`) },
      flags: {
        [MODULE_ID]: {
          prompt: true,
          requestId,
          payload,
          defenderUserId: game.userId,
        },
      },
    });
  } catch (error) {
    processed.delete(requestId); // No card or effects: delivery may safely be retried.
    throw error;
  }

  // Timeout -> default to Tank.
  // KNOWN LIMITATION: this auto-Tank timer is in-memory on the defender client. If that
  // client reloads/crashes before clicking, the timer is lost; a returning defender can
  // still click the persisted card, but the auto-Tank guarantee lapses. Documented as-is.
  const timeoutSecs = Number(Settings.get("promptTimeoutSeconds")) || 0;
  if (timeoutSecs > 0) {
    const handle = setTimeout(() => {
      pendingTimeouts.delete(requestId);
      console.log(`${LOG} | prompt ${requestId} timed out -> Tank`);
      void chooseDefense(message, "tank");
    }, timeoutSecs * 1000);
    pendingTimeouts.set(requestId, handle);
  }
}

/**
 * Resolve a chosen Evasion using the same melee rules as the automatic path.
 */
async function onEvadeClick(payload) {
  const { requestId } = payload;
  console.log(`${LOG} | evade clicked for ${requestId}`);
  const melee = payload.isMelee === true;
  const { evasionTotal, dodged, ok, untrainedDefense } = await resolveEvasion({
    ...payload,
    untrained: melee,
  });
  if (!ok) {
    await postResult(melee ? KIND.MELEE_HIT : KIND.FAILED,
      { ...payload, evasionTotal: 0, noSkill: true });
    return;
  }
  const kind = melee
    ? (dodged ? KIND.MELEE_DODGED : KIND.MELEE_HIT)
    : (dodged ? KIND.DODGED : KIND.FAILED);
  await postResult(kind, { ...payload, evasionTotal, untrainedDefense: !!untrainedDefense });
}

/**
 * Resolve a Tank choice (also used by the timeout auto-Tank). NO Evasion roll: the shot's
 * hit/miss was decided by the DV computed on the attacker client and shipped in the payload
 * (blind decision). hit -> TANKED (a hit, so the damage step runs); miss -> MISSED_ANYWAY
 * (the tanked shot simply missed - no damage). dv=null (undeterminable) counts as a hit.
 */
async function resolveTank(payload) {
  const { dv, attackTotal } = payload;
  // Accepting a melee hit skips the opposed roll, never consults a ranged DV,
  // and uses TANKED so the result does not invent an Evasion roll of zero.
  const hit = payload.isMelee === true || dv == null || attackTotal > dv;
  await postResult(hit ? KIND.TANKED : KIND.MISSED_ANYWAY, payload);
}

function clearPromptTimeout(requestId) {
  const handle = pendingTimeouts.get(requestId);
  if (handle) {
    clearTimeout(handle);
    pendingTimeouts.delete(requestId);
  }
}

/**
 * Claim the persisted prompt BEFORE rolling/applying damage. The local Set closes
 * click/timeout races; the flag prevents an old card from applying damage again
 * after reload. Once effects may have begun, an error needs GM adjudication, not
 * a retry: the GM damage handler cannot promise that a failed response did nothing.
 */
async function chooseDefense(message, choice, root = null) {
  const flag = message.flags?.[MODULE_ID];
  if (!flag?.prompt || game.userId !== flag.defenderUserId) return;
  const payload = flag.payload;
  const { requestId } = payload;
  if (flag.resolutionState || actedPrompts.has(requestId) || hasRecordedResult(requestId)) {
    if (root) disableButtons(root);
    return;
  }
  if (choice === "evade" && !payload.canEvadeRanged) return;

  const scene = payload.defSceneId ? game.scenes.get(payload.defSceneId) : canvas.scene;
  const actor = scene?.tokens?.get(payload.defTokenId)?.actor ?? game.actors.get(payload.defActorId);
  if (!actor || (!game.user.isGM && !actor.testUserPermission(game.user, "OWNER"))) {
    ui.notifications?.warn(game.i18n.localize(`${MODULE_ID}.error.noDefensePermission`));
    return;
  }
  actedPrompts.add(requestId);
  clearPromptTimeout(requestId);
  if (root) disableButtons(root);
  try {
    await message.update({ [`flags.${MODULE_ID}.resolutionState`]: "resolving", [`flags.${MODULE_ID}.choice`]: choice });
  } catch (error) {
    // No roll/damage has started. Permit a later explicit click after write failure.
    actedPrompts.delete(requestId);
    if (root) {
      root.find("button[data-action=cpr-tank]").prop("disabled", false);
      root.find("button[data-action=cpr-evade]").prop("disabled", !payload.canEvadeRanged);
    }
    console.error(`${LOG} | could not claim defense prompt`, error);
    ui.notifications?.error(game.i18n.localize(`${MODULE_ID}.error.promptSaveFailed`));
    return;
  }
  try {
    if (choice === "evade") await onEvadeClick(payload);
    else await resolveTank(payload);
    await message.update({ [`flags.${MODULE_ID}.resolutionState`]: "resolved" });
  } catch (error) {
    console.error(`${LOG} | defense resolution failed; do not repeat possible damage`, error);
    try { await message.update({ [`flags.${MODULE_ID}.resolutionState`]: "failed" }); }
    catch (saveError) { console.error(`${LOG} | could not save failed defense state`, saveError); }
    ui.notifications?.error(game.i18n.localize(`${MODULE_ID}.error.defenseFailed`), { permanent: true });
  }
}

/**
 * renderChatMessage hook: wire the prompt buttons on the defender's client.
 * Registered while this ES module loads, before Foundry renders the initial chat.
 */
function bindPromptButtons(msg, html) {
  const flag = msg.flags?.[MODULE_ID];
  if (!flag?.prompt) return;
  if (game.userId !== flag.defenderUserId) return;

  const root = html instanceof jQuery ? html : $(html);
  if (flag.resolutionState || actedPrompts.has(flag.payload.requestId) || hasRecordedResult(flag.payload.requestId)) {
    disableButtons(root);
    return;
  }

  root.find("button[data-action=cpr-evade]").off("click.cprEvasion").on("click.cprEvasion", (ev) => {
    ev.preventDefault();
    return chooseDefense(msg, "evade", root);
  });
  root.find("button[data-action=cpr-tank]").off("click.cprEvasion").on("click.cprEvasion", (ev) => {
    ev.preventDefault();
    return chooseDefense(msg, "tank", root);
  });
}

function disableButtons(root) {
  root.find("button.cpr-evasion-btn").prop("disabled", true);
}

// ESM is evaluated once. Foundry can render persisted chat messages before ready,
// so waiting for ready would leave old prompts unwired and resolved buttons active.
Hooks.on("renderChatMessage", bindPromptButtons);
