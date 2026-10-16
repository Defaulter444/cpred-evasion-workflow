# Changelog

## 0.6.1 — community fork: manual melee defense and persistent choices

- Based on Vec97/cpred-evasion-workflow 0.6.0 by yioxar. The module ID and MIT license remain unchanged; release and update URLs now point to Defaulter444/cpred-evasion-workflow.
- Disabling **Auto-resolve melee defense** now presents an **Evade / Tank** choice instead of leaving melee unresolved. Evade uses opposed Evasion, including untrained melee defense when the skill item is absent. Tank accepts the hit without an Evasion roll or a ranged DV check. The bullet REF gate remains ranged-only.
- Manual melee stays manual on GM fallback. Disabling ranged prompts no longer routes ranged attacks into melee handling. Existing thrown-weapon damage exclusions and the separate automatic-damage setting remain in effect.
- Defense choices are saved before rolling or applying damage. Duplicate clicks and timeout races resolve once; ownership is rechecked before a choice. A failed claim starts no effects, while a failure after resolution begins is reported without retrying potentially applied damage.
- Previously completed cards are protected after reload, including legacy prompts without a saved state when their matching result card is retained. Pending and completed prompt buttons are wired on the initial chat render: pending cards remain usable and completed cards remain disabled.
- Updated the English/German setting description and README for optional manual melee defense. The fork declares minimum/verified Foundry **12.331**, the build tested with Cyberpunk RED **0.92.4**; upstream's 12.343 declaration is documented separately.
- **28/28 automated tests passed**, including routing, permission/ownership checks, duplicate prevention, persisted/legacy cards and reload hook registration. Isolated live QA exercised manual Evade/Tank and system damage application.
- Added deterministic packaging of the runtime files, manifest, MIT license, README and changelog, with a SHA-256 checksum. No world data is included.
