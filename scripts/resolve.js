/**
 * cpred-evasion-workflow - headless Evasion roll + result card (runs on the DEFENDER's client).
 *
 * resolveEvasion: locate the Evasion skill by canonical English name ("Evasion"), with a
 * fallback to the current client's localized name for renamed items,
 * build the roll via the skill item's own createRoll (so DEX + level + wound/armor/role/AE
 * mods are auto-included), roll headlessly (NO handleRollDialog -> no verify dialog), read
 * resultTotal, render the standard CPR skill card, and compute dodged per the tie setting.
 *
 * If the actor has NO Evasion skill item and untrained:true is passed (melee path), fall
 * back to an ephemeral native Evasion item at level 0. Its createRoll includes DEX and the
 * defender's applicable native modifiers without adding an item to the actor or world.
 *
 * postResult: post ONE flagged result card. Created here (defender client) and natively
 * broadcast by Foundry to all clients. For a HIT (KIND in HIT_KINDS) it FIRST runs the optional
 * auto-damage step (GM-routed via socketlib) and then appends the appropriate damage sentence
 * (auto-applied vs "roll manually") to the result text.
 *
 * The deep system imports (rollTypes / CPRChat) live in cprSystem.js so this file
 * and damage.js share one guarded copy.
 */
import { MODULE_ID, LOG, KIND, HIT_KINDS, EVASION_SKILL_NAME } from "./constants.js";
import { Settings } from "./settings.js";
import { getSkillRollType, getRenderRollCard } from "./cprSystem.js";
import { findEvasionSkill, selectDefenseSkill } from "./defense-skill.js";

/**
 * Discover Evasion's governing stat from a recognized skill item in the world.
 * When none exists, use DEX, as defined by the core Evasion skill in CPR v0.92.4.
 * This fallback is only for untrained melee defense; it does not add a skill level.
 * @returns {string} the stat key
 */
function findEvasionStat() {
  const fromWorldItem = findEvasionSkill(game.items?.filter((item) => item.type === "skill"));
  if (fromWorldItem?.system?.stat) return fromWorldItem.system.stat;
  for (const a of game.actors ?? []) {
    const s = findEvasionSkill(a.itemTypes?.skill);
    if (s?.system?.stat) return s.system.stat;
  }
  return "dex";
}

/**
 * Roll the defender's Evasion and compare against the attack total.
 * @param {object} payload {defActorId, defTokenId, defSceneId, attackTotal, untrained?, ...}
 * @returns {Promise<{evasionTotal:number, dodged:boolean, ok:boolean, untrainedDefense?:boolean}>}
 */
export async function resolveEvasion(payload) {
  const { defActorId, defTokenId, defSceneId, attackTotal, untrained } = payload;

  const scene = defSceneId ? game.scenes.get(defSceneId) : canvas.scene;
  const defToken = scene?.tokens?.get(defTokenId) ?? null;
  const defActor = defToken?.actor ?? game.actors.get(defActorId);

  if (!defActor) {
    console.warn(`${LOG} | resolveEvasion: defender actor not found`, payload);
    return { evasionTotal: 0, dodged: false, ok: false };
  }

  const defense = selectDefenseSkill(defActor);
  const evasion = defense.kind === "evasion" ? defense.item : null;

  let cprRoll;
  let untrainedDefense = false;

  if (evasion) {
    // Build the roll via the skill item's own createRoll (auto-includes stat + mods).
    // Headless: we deliberately DO NOT call cprRoll.handleRollDialog() (the verify dialog).
    cprRoll = evasion.createRoll(getSkillRollType(), defActor);
  } else if (defense.kind === "physical" || untrained) {
    // Construct only in memory: never create/update an embedded or world Item. Using the
    // native skill builder preserves armor, wounds, role and default-on effect modifiers.
    const ItemClass = globalThis.CONFIG?.Item?.documentClass;
    if (typeof ItemClass !== "function") {
      console.warn(`${LOG} | resolveEvasion: native Item constructor unavailable`, payload);
      return { evasionTotal: 0, dodged: false, ok: false };
    }
    const temporaryEvasion = new ItemClass({
      name: EVASION_SKILL_NAME,
      type: "skill",
      system: {
        level: 0, stat: defense.kind === "physical" ? "dex" : findEvasionStat(), category: "fightingSkills",
        core: true, basic: true, skillType: "generic", difficulty: "typical",
      },
    }, { parent: defActor });
    cprRoll = temporaryEvasion.createRoll(getSkillRollType(), defActor);
    if (!cprRoll || typeof cprRoll.roll !== "function" || !Number.isFinite(cprRoll.statValue)) {
      console.warn(`${LOG} | resolveEvasion: native untrained skill roll unavailable`, payload);
      return { evasionTotal: 0, dodged: false, ok: false };
    }
    if (defense.kind === "physical") {
      // The pack's Physical value is already a complete base. Build a native DEX
      // Evasion first so armor and Evasion-specific effects/role bonuses are correct,
      // then substitute only the base terms before the system rolls any dice.
      // No actor/item data or modifier list is changed, and DEX is not added twice.
      cprRoll.statValue = defense.base;
      cprRoll.skillValue = 0;
      cprRoll.statName = game.i18n.format(`${MODULE_ID}.roll.physicalBase`, { skill: defense.item.name });
      cprRoll.rollTitle = `${game.i18n.localize("CPR.global.itemType.skill.evasion")} — ${cprRoll.statName}`;
    } else {
      untrainedDefense = true;
    }
  } else {
    // Ranged Evade with no skill item (should be gated by canEvadeRanged upstream).
    console.warn(
      `${LOG} | ${game.i18n.format(`${MODULE_ID}.error.noEvasionSkill`, { target: defActor.name })}`
    );
    return { evasionTotal: 0, dodged: false, ok: false };
  }

  await cprRoll.roll();
  const evasionTotal = cprRoll.resultTotal;

  // Speaker resolution for the standard skill card.
  cprRoll.entityData = {
    actor: defActor.id,
    token: defToken ? defToken.id : null,
    tokens: [],
    item: evasion ? evasion.id : null,
  };

  const render = getRenderRollCard();
  if (render) {
    await render(cprRoll);
  } else {
    console.warn(`${LOG} | RenderRollCard unavailable - skipping standard skill card render`);
  }

  const tie = Settings.get("tieGoesToDefender");
  const dodged = tie ? evasionTotal >= attackTotal : evasionTotal > attackTotal;

  return { evasionTotal, dodged, ok: true, untrainedDefense };
}

/**
 * Optional auto-damage step. Runs (on a GM client, via socketlib) only when the autoDamage
 * setting is on AND the shot was flagged damageEligible upstream. Returns the GM handler's
 * result ({applied, total, ...}) on success, or null so the caller uses the manual wording.
 * A rejected executeAsGM (no active GM) is caught and also yields null.
 * @param {object} ctx the result context (carries attacker/weapon/target ids + damageEligible)
 * @returns {Promise<object|null>}
 */
async function maybeApplyDamage(ctx) {
  if (!Settings.get("autoDamage")) return null;
  if (!ctx.damageEligible) return null;

  // Dynamic import avoids a static import cycle (sockets.js -> prompt.js -> resolve.js).
  const { Sockets } = await import("./sockets.js");
  try {
    const res = await Sockets.executeGMDamage({
      requestId: ctx.requestId,
      attackerActorId: ctx.attackerActorId,
      attackerTokenId: ctx.attackerTokenId,
      attackerSceneId: ctx.attackerSceneId,
      weaponId: ctx.weaponId,
      defActorId: ctx.defActorId,
      defTokenId: ctx.defTokenId,
      defSceneId: ctx.defSceneId,
      aimed: ctx.aimed,
      autofire: ctx.autofire,
      autofireMult: ctx.autofireMult,
    });
    if (res && res.applied) return res;
    console.warn(`${LOG} | auto-damage not applied (falling back to manual)`, res);
    return null;
  } catch (e) {
    console.warn(`${LOG} | executeGMDamage failed (no active GM?) - manual damage fallback`, e);
    return null;
  }
}

/**
 * Post ONE flagged result card. Created on the defender client and broadcast natively.
 * For a HIT kind it first runs the optional auto-damage step and appends the matching damage
 * sentence.
 * @param {string} kind one of KIND.*
 * @param {object} ctx {requestId, atkName, defName, evasionTotal, attackTotal, dv?, noSkill?,
 *                      untrainedDefense?, attackerUserId?, defActorId?, defTokenId?, defSceneId?,
 *                      damageEligible?, attackerActorId?, attackerTokenId?, attackerSceneId?, weaponId?}
 */
export async function postResult(kind, ctx) {
  const {
    requestId,
    atkName,
    defName,
    evasionTotal,
    attackTotal,
    noSkill,
    untrainedDefense,
  } = ctx;

  const stateClass =
    {
      [KIND.DODGED]: "dodged",
      [KIND.FAILED]: "hit",
      [KIND.TANKED]: "tanked",
      [KIND.MISSED_ANYWAY]: "dodged",
      [KIND.MELEE_DODGED]: "dodged",
      [KIND.MELEE_HIT]: "hit",
    }[kind] ?? "tanked";

  // Confirmed hit -> run the optional auto-damage step BEFORE composing the text so the card can
  // state the applied total. dodged/missed kinds never reach this.
  const isHit = HIT_KINDS.has(kind);
  const damage = isHit ? await maybeApplyDamage(ctx) : null;

  // Base sentence.
  let message;
  if (noSkill) {
    // "no usable Evasion" narrative (used for a hit the defender could not roll against).
    message = game.i18n.format(`${MODULE_ID}.error.noEvasionSkill`, { target: defName });
  } else {
    const untrainedKey = `${kind}Untrained`;
    const useUntrained =
      untrainedDefense && game.i18n.has(`${MODULE_ID}.result.${untrainedKey}`);
    const resolvedKey = useUntrained ? untrainedKey : kind;
    message = game.i18n.format(`${MODULE_ID}.result.${resolvedKey}`, {
      attacker: atkName,
      target: defName,
      evasion: evasionTotal ?? 0,
      attack: attackTotal ?? 0,
      dv: ctx.dv ?? 0,
    });
  }

  // Damage sentence (hit kinds only): auto-applied total vs "roll manually".
  if (isHit) {
    if (damage && damage.applied) {
      message += ` ${game.i18n.format(`${MODULE_ID}.result.damageAuto`, {
        damage: damage.total ?? 0,
      })}`;
    } else {
      message += ` ${game.i18n.localize(`${MODULE_ID}.result.damageManual`)}`;
    }
  }

  const content = `<div class="cpr-evasion-result ${stateClass}">${message}</div>`;

  const chatData = {
    content,
    speaker: { alias: defName },
    flags: { [MODULE_ID]: { result: true, requestId } },
  };

  const whisperMode = Settings.get("whisperResult");
  if (whisperMode === "gm") {
    chatData.whisper = ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
  } else if (whisperMode === "both") {
    // GM + everyone involved in the attack: the GM(s), this defender client, every active
    // OWNER of the defender actor (co-owners), and the ATTACKER user (carried in the payload
    // as attackerUserId - postResult runs on the defender, so game.userId is NOT the attacker).
    const involved = new Set(
      ChatMessage.getWhisperRecipients("GM").map((u) => u.id)
    );
    involved.add(game.userId);
    if (ctx.attackerUserId) involved.add(ctx.attackerUserId);

    // Add active owners of the defender actor so a co-owner also sees the result.
    const scene = ctx.defSceneId ? game.scenes.get(ctx.defSceneId) : canvas.scene;
    const defToken = scene?.tokens?.get(ctx.defTokenId) ?? null;
    const defActor = defToken?.actor ?? game.actors.get(ctx.defActorId);
    if (defActor) {
      for (const u of game.users) {
        if (u.active && defActor.testUserPermission(u, "OWNER")) involved.add(u.id);
      }
    }
    chatData.whisper = Array.from(involved);
  }
  // 'public' -> no whisper key (visible to all).

  await ChatMessage.create(chatData);
}
