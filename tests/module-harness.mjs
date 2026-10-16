import { readFile } from "node:fs/promises";
import vm from "node:vm";

export const ID = "cpred-evasion-workflow";

/** Load the actual browser ESM with only Foundry/service boundaries replaced. */
export async function loadModule(file, globals, stubs = {}) {
  const context = vm.createContext({ console: { log() {}, warn() {}, error() {} }, ...globals });
  const cache = new Map();
  async function get(url) {
    if (cache.has(url.href)) return cache.get(url.href);
    const stub = stubs[url.pathname.split("/").at(-1)];
    const module = stub
      ? new vm.SyntheticModule(Object.keys(stub), function () {
        for (const [key, value] of Object.entries(stub)) this.setExport(key, value);
      }, { context, identifier: url.href })
      : new vm.SourceTextModule(await readFile(url, "utf8"), {
        context, identifier: url.href,
        importModuleDynamically: async (specifier, parent) => {
          const dependency = await get(new URL(specifier, parent.identifier));
          if (dependency.status === "unlinked") await dependency.link(linker);
          if (dependency.status === "linked") await dependency.evaluate();
          return dependency;
        },
      });
    cache.set(url.href, module);
    return module;
  }
  const linker = (specifier, parent) => get(new URL(specifier, parent.identifier));
  const module = await get(new URL(`../scripts/${file}`, import.meta.url));
  await module.link(linker);
  await module.evaluate();
  return module.namespace;
}

export function hookBus() {
  const handlers = new Map();
  return {
    once(name, fn) { handlers.set(name, fn); },
    on(name, fn) { handlers.set(name, fn); },
    fire(name, ...args) { return handlers.get(name)?.(...args); },
  };
}

/** Minimal jQuery event surface: disabled properties and bound click callbacks. */
export class PromptHtml {
  constructor() {
    this.buttons = { evade: { disabled: false }, tank: { disabled: false } };
  }
  find(selector) {
    const keys = selector.includes("cpr-evade") ? ["evade"]
      : selector.includes("cpr-tank") ? ["tank"] : ["evade", "tank"];
    const result = {
      off: () => { for (const key of keys) delete this.buttons[key].handler; return result; },
      on: (_event, fn) => { for (const key of keys) this.buttons[key].handler = fn; return result; },
      prop: (name, value) => { for (const key of keys) this.buttons[key][name] = value; return result; },
    };
    return result;
  }
  click(key) { return this.buttons[key].handler?.({ preventDefault() {} }); }
}

export async function promptHarness(options = {}) {
  const Hooks = hookBus();
  const messages = options.messages ?? [];
  const results = [], rolls = [], errors = [], warnings = [], timers = new Map();
  const settings = { promptTimeoutSeconds: 0, ...options.settings };
  let timerCounter = 0;
  const actor = { testUserPermission: () => options.owner !== false };
  const game = {
    userId: "player", user: { id: "player", isGM: false }, messages,
    scenes: new Map([["scene", { tokens: new Map([["token", { actor }]]) }]]),
    actors: new Map([["actor", actor]]),
    i18n: { localize: (key) => key, format: (key) => key },
  };
  const ChatMessage = {
    async create(data) {
      if (options.createFails) throw Error("Cannot create chat");
      const message = {
        ...data,
        async update(changes) {
          if (options.saveFails) throw Error("Cannot save chat");
          for (const [key, value] of Object.entries(changes)) this.flags[ID][key.split(".").at(-1)] = value;
          return this;
        },
      };
      messages.push(message);
      return message;
    },
  };
  const module = await loadModule("prompt.js", {
    game, canvas: { scene: game.scenes.get("scene") }, Hooks, ChatMessage,
    jQuery: PromptHtml, $: (value) => value,
    ui: { notifications: { error: (...args) => errors.push(args), warn: (...args) => warnings.push(args) } },
    setTimeout: (fn) => { const id = ++timerCounter; timers.set(id, fn); return id; },
    clearTimeout: (id) => timers.delete(id),
  }, {
    "settings.js": { Settings: { get: (key) => settings[key] } },
    "resolve.js": {
      resolveEvasion: async (payload) => {
        rolls.push(payload);
        return options.roll ? options.roll(payload) : { ok: true, dodged: true, evasionTotal: 18, untrainedDefense: !!payload.untrained };
      },
      postResult: async (kind, payload) => {
        results.push({ kind, payload });
        if (options.resultFails) throw Error("Cannot post result after potential damage");
      },
    },
  });
  if (options.fireReady !== false) Hooks.fire("ready");
  const payload = {
    requestId: "attack-token", atkName: "Attacker", defName: "Defender",
    defActorId: "actor", defTokenId: "token", defSceneId: "scene",
    attackTotal: 15, isMelee: true, canEvadeRanged: true,
  };
  function render(message = messages.at(-1)) {
    const html = new PromptHtml();
    Hooks.fire("renderChatMessage", message, html);
    return html;
  }
  return { module, game, payload, messages, render, rolls, results, errors, warnings, timers, options };
}
