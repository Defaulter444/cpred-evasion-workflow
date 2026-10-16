# Cyberpunk RED – Evasion Workflow

**0.6.1 · community fork maintained at [Defaulter444/cpred-evasion-workflow](https://github.com/Defaulter444/cpred-evasion-workflow)**

Based on [Vec97/cpred-evasion-workflow](https://github.com/Vec97/cpred-evasion-workflow) by
**yioxar**. This is a community-maintained fork, not an upstream release. The original MIT
license and copyright notice are retained. The module ID remains `cpred-evasion-workflow`,
so existing settings and chat flags are preserved.

A standalone [Foundry VTT](https://foundryvtt.com/) **v12** companion module for the
**cyberpunk-red-core** system (verified on v0.92.4). It turns the "does it hit?" moment into an
interactive, automated flow: the target is asked to **Evade** or **Tank** an incoming attack, the
Evasion roll is made for them, and — optionally — the weapon damage is rolled and applied to the
token automatically.

It **coexists with** [`diwako-cpred-additions`](https://github.com/diwako/foundry-cyberpunk-red-core-additions)
without modifying it, and works standalone (Diwako is only *recommended*).

## Features

### Blind Evade / Tank decision (ranged)
When a ranged attack targets a token, the target's controlling user is asked — **before** the
hit/miss is revealed — whether they want to **Evade (Ausweichen)** or **Tank (Tanken)** the hit,
so they cannot metagame the roll:

- The attack roll card is whispered to the GM and attacker only, so the defending **player** never
  sees how high the roll is before choosing (`Hide the attack roll from the defending player`).
  NPC targets are never blinded — the GM decides for them and may see the roll.
- Diwako's plain hit/miss chat line is suppressed so it cannot spoil the result either
  (`Hide Diwako's hit/miss line`).
- **Evade** → the target's Evasion skill is rolled through the system's own roll pipeline (DEX/REF +
  skill level + wound/armor/role/active-effect mods) and compared to the attack total. Dodged if the
  Evasion total meets/beats the attack (configurable tie rule).
- **Tank** → the shot is resolved against its DV (computed on the attacker's client and shipped
  along), so a tanked shot that actually missed reports "missed anyway" with no damage.

### Automatic or manual melee defense
With **Auto-resolve melee defense** enabled, melee and thrown-in-melee attacks resolve an opposed
Evasion roll automatically, without a prompt. Turn it off to give the controlling player an
**Evade / Tank** prompt instead. Evade uses the same opposed roll; Tank accepts the hit without
rolling Evasion or checking a ranged DV. If the target has no Evasion skill item (common on trimmed
mook/imported NPCs), Evade uses an untrained bare-stat defense. The bullet REF gate never applies
to melee. Damage still follows the separate **Auto-roll and apply damage on a hit** setting.

### Auto‑roll and apply damage (optional)
On a confirmed hit, the module can automatically roll the weapon's damage **and apply it** to the
target via the system's own damage pipeline (armor SP, ablation, head/brain location, HP), so there
is no separate *Roll Damage* → *Apply* clicking (`Auto-roll and apply damage on a hit`).

- Runs on a **GM client** (via socketlib), which has the rights to read the attacker and mutate the
  target. Damage math is **never** reimplemented — it uses `Actor#_applyDamage`.
- **Aimed shots** are rolled as an aimed (located) damage roll, using the location the attacker
  aimed at (default head, headshot damage rules applied).
- **Autofire** is rolled as a `2d6` autofire roll multiplied by how much the attack beat the
  autofire DV (capped at the weapon's autofire max). If the autofire DV can't be determined, it
  falls back to manual.
- **Multiple targets:** if the attacker has several tokens targeted, each one gets its own
  Evade/Tank prompt (or auto-melee) and its own damage resolution against the shared attack roll.
- **Excluded** (fall back to the manual *Roll Damage* button): grenade/rocket launchers and thrown
  weapons. Regular ranged (single-shot, aimed, autofire) and melee weapons are eligible. If no GM
  is connected, it also falls back to manual.
- **Critical injuries:** on a crit (two or more 6s on the damage), the matching critical injury
  table (head or body by hit location) is rolled and the resulting injury is posted to chat —
  **informational only, not added to the sheet**. Optional (*Announce the critical injury on a crit*).

Result cards are intentionally **low-key** (a muted accent + faint tint, not bold red/green blocks)
and theme-aware for a light or dark chat log.

## Requirements

- Foundry VTT **v12**, minimum and verified build **12.331** for this fork. Upstream declared
  12.343 support; that build was not separately tested for this patch.
- System **cyberpunk-red-core** (v0.89+, verified v0.92.4)
- **[socketlib](https://foundryvtt.com/packages/socketlib)** — required (cross-client routing)
- **[diwako-cpred-additions](https://foundryvtt.com/packages/diwako-cpred-additions)** — optional /
  recommended (DV display, cover tokens, etc.)

## Install

1. Install and enable **socketlib**.
2. Install using this fork's manifest URL:

   `https://github.com/Defaulter444/cpred-evasion-workflow/releases/latest/download/module.json`

   For a manual install, extract this fork's `module.zip` to `Data/modules/cpred-evasion-workflow`
   so `module.json` sits directly in that folder.
3. Enable **Cyberpunk RED – Evasion Workflow** (and socketlib) in *Manage Modules*.
4. **Restart Foundry / reload the world** after first enabling it, so socketlib picks up the
   module's `"socket": true` flag.
5. Configure under *Game Settings → Configure Settings → Cyberpunk RED – Evasion Workflow*.

## Updating from upstream

Use the **new manifest URL above** to switch to this fork; the upstream manifest continues to
follow Vec97's releases. Keep a single installation of `cpred-evasion-workflow` and confirm that
its manifest points to `Defaulter444` after updating. Refresh connected clients after installing.
The module ID, settings keys and MIT attribution are unchanged. Installing two copies under
other folder names is not supported.

For manual melee defense, disable **Auto-resolve melee defense**. The defender then receives
an **Evade / Tank** choice; the separate damage setting still controls automatic damage.

## Settings (all world-scoped)

| Setting | Default | Effect |
|---|---|---|
| Prompt on ranged attack | on | Ranged attack → prompt the target to Evade/Tank (before hit/miss). |
| Auto-resolve melee defense | on | On: automatic opposed melee Evasion. Off: manual Evade/Tank prompt for the defender. |
| Require REF 8+ to dodge bullets | off | Ranged Evade only offered at REF 8+ (Dodging Bullets). |
| Prompt timeout (seconds) | 0 | Auto-default to Tank after N seconds; 0 = wait forever. |
| Result visibility | public | public / GM only / GM + involved players. |
| Ties favor the defender | on | Evasion ≥ Attack = dodged (else must strictly beat). |
| Auto-roll and apply damage on a hit | on | Roll + apply weapon damage automatically (see exclusions). |
| Hide Diwako's hit/miss line | on | Suppress Diwako's spoiler hit/miss chat line. |
| Hide the attack roll from the defending player | on | Whisper the attack roll away from the defender player (anti-metagame). |
| Announce the critical injury on a crit | on | On a crit (2+ sixes), roll & post which critical injury resulted (not applied to the sheet). |
| Log attacks with no target | off | Console note when an attack has no target. |

## How it works (technical)

- Detection runs on the **attacker's client** via `Hooks.on("createChatMessage")`, guarded by
  `game.userId != message._source.author`. It scrapes the attack total from the card DOM, resolves
  the weapon/target like Diwako, and branches on the weapon item
  (`isRanged && weaponType !== "thrownWeapon"` → ranged prompt; else melee).
- Cross-client routing uses **socketlib**: the prompt/melee resolution is sent to the target's
  single responsible user (`executeAsUser`), and the optional damage step is sent to a GM
  (`executeAsGM`). Result cards are created on the resolving client and broadcast natively.
- Blinding is done in `preCreateChatMessage` by re-whispering the attack card; the deep system
  imports (roll types, `CPRChat.RenderRollCard`, `CPRSkillRoll`) live in a single `cprSystem.js`
  shim with guarded fallbacks.
- The Evasion skill is found by its canonical English name `"Evasion"` (core skill items keep their
  English name even on a localized client), never the localized label.

## Limitations

- Diwako's Sequencer hit/miss **animations** (if you run them) are not suppressed — only the text
  line and the attack-roll card are hidden.
- The GM may see a harmless "no target selected" notice when a damage roll is auto-made.
- The blind-decision auto-Tank timeout is an in-memory timer on the defender's client; if that
  client reloads before choosing, the timeout will not fire (the persisted prompt can still be
  clicked).
- A chosen prompt is saved before resolution and stays locked after reload, so clicking an old
  prompt does not apply damage again. Existing result cards also protect completed prompts from
  older releases that have no saved resolution state. Pending prompts are interactive on the
  initial chat render after reload, while completed prompts remain disabled. If resolution fails after it starts, check existing rolls
  and damage with the GM and finish manually; the module reports the failure and deliberately
  does not retry potentially applied damage. Use one connected browser tab per defending user.
- If a player can still hover the target with Diwako's DV display active, they can read the DV; turn
  that off if you want a fully blind table.

## Validation and packaging

- Automated checks: **28/28 tests** covering manual/automatic melee routing, ranged behavior,
  permission checks, click/timeout races, saved choices, legacy completed cards and initial chat
  rendering after reload.
- Run tests with `node --experimental-vm-modules --test tests/*.test.mjs`. The VM modules flag
  is required by the isolated Foundry test harness.
- Tested in an isolated Foundry **12.331** world with Cyberpunk RED **0.92.4**, including manual
  melee Evade and Tank decisions and GM-routed damage affecting HP.
- Build with `python tools/package.py`. It produces `dist/module.json`, `dist/module.zip` and
  `dist/SHA256SUMS.txt`; fixed ZIP metadata makes repeated builds from identical files reproducible.
  The archive includes only runtime scripts, CSS, language files, the manifest and license/docs.
  Tests, build tools, Git files and world data are excluded.

## License

MIT.
