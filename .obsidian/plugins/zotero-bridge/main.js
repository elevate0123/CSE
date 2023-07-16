var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __markAsModule = (target) => __defProp(target, "__esModule", { value: true });
var __export = (target, all) => {
  __markAsModule(target);
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __reExport = (target, module2, desc) => {
  if (module2 && typeof module2 === "object" || typeof module2 === "function") {
    for (let key of __getOwnPropNames(module2))
      if (!__hasOwnProp.call(target, key) && key !== "default")
        __defProp(target, key, { get: () => module2[key], enumerable: !(desc = __getOwnPropDesc(module2, key)) || desc.enumerable });
  }
  return target;
};
var __toModule = (module2) => {
  return __reExport(__markAsModule(__defProp(module2 != null ? __create(__getProtoOf(module2)) : {}, "default", module2 && module2.__esModule && "default" in module2 ? { get: () => module2.default, enumerable: true } : { value: module2, enumerable: true })), module2);
};
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// src/main.ts
__export(exports, {
  ZoteroItem: () => ZoteroItem,
  default: () => main_default
});

// src/ZoteroBridge.ts
var import_obsidian4 = __toModule(require("obsidian"));

// node_modules/@vanakat/plugin-api/index.js
function registerAPI(name, api, plugin) {
  window["PluginApi"] = window["PluginApi"] || {};
  window["PluginApi"][name] = api;
  plugin.register(() => {
    delete window["PluginApi"][name];
  });
}

// src/ZoteroBridgeSettings.ts
var DEFAULT_SETTINGS = {
  host: "localhost",
  port: "23119"
};

// src/ZoteroAdapter.ts
var import_obsidian2 = __toModule(require("obsidian"));

// src/ZoteroItem.ts
var import_obsidian = __toModule(require("obsidian"));
var ZoteroItem = class {
  constructor(raw) {
    this.raw = raw;
  }
  getKey() {
    return this.raw.key;
  }
  getTitle() {
    return this.raw.shortTitle || this.raw.title || this.getNoteExcerpt() || "[No Title]";
  }
  getAuthors() {
    return this.getCreators().filter((creator) => creator.creatorType === "author").map(this.normalizeName);
  }
  getAuthor() {
    return this.getAuthors()[0];
  }
  getCreators() {
    return this.raw.creators || [];
  }
  getDate() {
    return this.raw.date ? this.formatDate(this.raw.date) : "";
  }
  getNoteExcerpt() {
    if (this.raw.note) {
      const div = document.createElement("div");
      div.appendChild((0, import_obsidian.sanitizeHTMLToDom)(this.raw.note));
      return (div.textContent || div.innerText || "").trim().substring(0, 50) + "...";
    }
    return "";
  }
  normalizeName(creator) {
    const names = {
      firstName: creator.firstName,
      lastName: creator.lastName,
      fullName: ""
    };
    if (creator.hasOwnProperty("name")) {
      const delimiter = creator.name.lastIndexOf(" ");
      names.firstName = creator.name.substring(0, delimiter + 1).trim();
      names.lastName = creator.name.substring(delimiter).trim();
      names.fullName = creator.name;
    } else {
      names.fullName = `${names.firstName} ${names.lastName}`;
    }
    return names;
  }
  formatDate(date) {
    const dateObject = new Date(date);
    return {
      year: dateObject.getFullYear(),
      month: dateObject.getMonth(),
      day: dateObject.getDate()
    };
  }
  getValues() {
    return {
      key: this.getKey(),
      title: this.getTitle(),
      date: this.getDate(),
      authors: this.getAuthors(),
      firstAuthor: this.getAuthor()
    };
  }
};

// src/ZoteroAdapter.ts
var ZoteroAdapter = class {
  constructor(settings) {
    this.settings = settings;
  }
  get baseUrl() {
    return `http://${this.settings.host}:${this.settings.port}/zotserver`;
  }
  searchEverything(query) {
    return this.search([{
      condition: "quicksearch-everything",
      value: query
    }]);
  }
  search(conditions) {
    return (0, import_obsidian2.request)({
      url: `${this.baseUrl}/search`,
      method: "post",
      contentType: "application/json",
      body: JSON.stringify(conditions)
    }).then(JSON.parse).then((items) => items.filter((item) => !["attachment", "note"].includes(item.itemType)).map((item) => new ZoteroItem(item))).catch(() => {
      new import_obsidian2.Notice(`Couldn't connect to Zotero, please check the app is open and ZotServer is installed`);
      return [];
    });
  }
};

// src/ZoteroSuggestModal.ts
var import_obsidian3 = __toModule(require("obsidian"));
var ZoteroSuggestModal = class extends import_obsidian3.SuggestModal {
  constructor(app, adapter, onSelect) {
    super(app);
    this.adapter = adapter;
    this.onSelect = onSelect;
  }
  getSuggestions(query) {
    return this.adapter.searchEverything(query);
  }
  renderSuggestion(item, el) {
    el.createEl("div", { text: item.getTitle() });
    el.createEl("small", { text: item.getKey() });
  }
  onChooseSuggestion(item) {
    this.onSelect(item);
  }
};
function promisedZoteroSuggestModal(...args) {
  return new Promise((resolve, reject) => {
    try {
      new ZoteroSuggestModal(...args, (item) => resolve(item)).open();
    } catch (e) {
      reject(e);
    }
  });
}

// src/plugin-api/ZoteroBridgeApiV1.ts
var ZoteroBridgeApiV1 = class {
  constructor(plugin) {
    this.plugin = plugin;
  }
  search() {
    return promisedZoteroSuggestModal(this.plugin.app, this.plugin.zoteroAdapter);
  }
};

// src/ZoteroBridgeApi.ts
var ZoteroBridgeApi = class {
  constructor(plugin) {
    this.plugin = plugin;
  }
  v1() {
    return new ZoteroBridgeApiV1(this.plugin);
  }
};

// src/ZoteroBridge.ts
var ZoteroBridge = class extends import_obsidian4.Plugin {
  onload() {
    return __async(this, null, function* () {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, yield this.loadData());
      this.zoteroAdapter = new ZoteroAdapter(this.settings);
      registerAPI("ZoteroBridge", new ZoteroBridgeApi(this), this);
    });
  }
  saveSettings(newSettings) {
    return __async(this, null, function* () {
      Object.assign(this.settings, newSettings);
      yield this.saveData(this.settings);
    });
  }
};

// src/main.ts
var main_default = ZoteroBridge;
