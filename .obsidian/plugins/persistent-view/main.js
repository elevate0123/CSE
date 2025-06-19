const { Plugin, PluginSettingTab, Setting, Notice, MarkdownView, TFile } = require('obsidian');

const DEFAULT_SETTINGS = {
  // What to save
  shouldSaveCursor: true,
  shouldSaveScroll: true,
  shouldSaveFolds: true,
  // How to save
  saveTrigger: 'onSwitch',
  periodicSaveInterval: 5,
  // UI Feedback
  showSaveIndicator: true,
  // Data Management
  enableAutomaticPruning: false,
  pruningMethod: 'byAge',
  pruningMaxAgeDays: 90,
  pruningMaxFiles: 500,
};

class PersistentViewPlugin extends Plugin {
  settings;
  data; // Will hold both settings and fileStates
  statusBarIndicator;
  periodicSaveIntervalId = null;

  async onload() {
    console.log('Loading Persistent View Pro Max');
    await this.loadPluginData();

    this.addSettingTab(new PersistentViewSettingTab(this.app, this));
    this.addCommands();
    this.statusBarIndicator = this.addStatusBarItem();

    // --- Event Listeners ---
    this.registerEvent(this.app.workspace.on('file-open', this.onFileOpen, this));
    this.registerEvent(this.app.vault.on('rename', this.onFileRename, this));
    this.registerEvent(this.app.vault.on('delete', this.onFileDelete, this));

    this.setupSaveTriggers();

    // Run pruning on startup if enabled
    if (this.settings.enableAutomaticPruning) {
      this.runPruning();
    }
  }

  onunload() {
    console.log('Unloading Persistent View Pro Max');
    this.saveCurrentViewState();
    if (this.periodicSaveIntervalId) {
      window.clearInterval(this.periodicSaveIntervalId);
    }
  }

  // --- Event Handlers ---

  onFileOpen(file) {
    if (file) {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view) {
        setTimeout(() => this.loadViewState(file, view), 100);
      }
    }
  }

  async onFileRename(file, oldPath) {
    if (this.data.fileStates[oldPath]) {
      this.data.fileStates[file.path] = this.data.fileStates[oldPath];
      delete this.data.fileStates[oldPath];
      await this.saveData(this.data);
      console.log(`Persistent View: Migrated state from ${oldPath} to ${file.path}`);
    }
  }

  async onFileDelete(file) {
    if (this.data.fileStates[file.path]) {
      delete this.data.fileStates[file.path];
      await this.saveData(this.data);
      console.log(`Persistent View: Cleared state for deleted file ${file.path}`);
    }
  }

  // --- Core Logic ---

  setupSaveTriggers() {
    if (this.periodicSaveIntervalId) {
      window.clearInterval(this.periodicSaveIntervalId);
      this.periodicSaveIntervalId = null;
    }

    if (this.settings.saveTrigger === 'onSwitch') {
      this.registerEvent(
        this.app.workspace.on('active-leaf-change', (leaf, oldLeaf) => {
          if (oldLeaf && oldLeaf.view instanceof MarkdownView && oldLeaf.view.file) {
            this.saveViewState(oldLeaf.view.file, oldLeaf.view);
          }
        })
      );
    } else if (this.settings.saveTrigger === 'periodic') {
      this.periodicSaveIntervalId = window.setInterval(
        () => this.saveCurrentViewState(),
        this.settings.periodicSaveInterval * 1000
      );
      this.registerInterval(this.periodicSaveIntervalId);
    }
  }

  async saveCurrentViewState() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view && view.file) {
      await this.saveViewState(view.file, view);
    }
  }

  async saveViewState(file, view) {
    if (!file || !view || !view.editor) return;

    const path = file.path;
    const editor = view.editor;
    const currentState = this.data.fileStates[path] || {};

    if (this.settings.shouldSaveCursor) currentState.cursor = editor.getCursor();
    if (this.settings.shouldSaveScroll) currentState.scroll = view.currentMode.getScroll();
    if (this.settings.shouldSaveFolds) {
      const foldInfo = editor.getFoldInfo();
      currentState.folds = foldInfo ? foldInfo.folds : [];
    }
    
    // Add timestamp for pruning
    currentState.lastSaved = Date.now();

    this.data.fileStates[path] = currentState;
    await this.saveData(this.data);
    this.showSaveIndicator();
  }

  loadViewState(file, view) {
    const state = this.data.fileStates[file.path];
    if (!state) return;

    const editor = view.editor;

    if (this.settings.shouldSaveFolds && state.folds) {
      editor.transaction({
        changes: state.folds.map(fold => { editor.fold(fold[0]); return null; }).filter(Boolean)
      });
    }
    if (this.settings.shouldSaveScroll && state.scroll) view.currentMode.applyScroll(state.scroll.top);
    if (this.settings.shouldSaveCursor && state.cursor) editor.setCursor(state.cursor);
  }

  // --- Data & Settings Management ---

  async loadPluginData() {
    const loadedData = await this.loadData();
    this.data = {
      settings: { ...DEFAULT_SETTINGS, ...(loadedData?.settings || {}) },
      fileStates: loadedData?.fileStates || {},
    };
    this.settings = this.data.settings;
  }

  async saveSettings() {
    this.data.settings = this.settings;
    await this.saveData(this.data);
  }

  async runPruning() {
    let changed = false;
    const states = Object.entries(this.data.fileStates);
    let prunedCount = 0;

    if (this.settings.pruningMethod === 'byAge') {
      const cutoff = Date.now() - (this.settings.pruningMaxAgeDays * 24 * 60 * 60 * 1000);
      states.forEach(([path, state]) => {
        if (!state.lastSaved || state.lastSaved < cutoff) {
          delete this.data.fileStates[path];
          prunedCount++;
          changed = true;
        }
      });
    } else if (this.settings.pruningMethod === 'byNumber') {
      if (states.length > this.settings.pruningMaxFiles) {
        const sortedStates = states.sort((a, b) => a[1].lastSaved - b[1].lastSaved);
        const toDeleteCount = states.length - this.settings.pruningMaxFiles;
        for (let i = 0; i < toDeleteCount; i++) {
          delete this.data.fileStates[sortedStates[i][0]];
          prunedCount++;
          changed = true;
        }
      }
    }

    if (changed) {
      await this.saveData(this.data);
      new Notice(`Persistent View: Pruned ${prunedCount} old file states.`);
    }
  }

  // --- UI & Commands ---

  addCommands() {
    this.addCommand({
      id: 'save-current-view-state', name: 'Save view state for the current file',
      callback: () => { this.saveCurrentViewState(); new Notice('Current view state saved!'); },
    });
    this.addCommand({
      id: 'clear-current-view-state', name: 'Clear view state for the current file',
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (file) {
          delete this.data.fileStates[file.path];
          await this.saveData(this.data);
          new Notice(`Cleared view state for ${file.basename}`);
        }
      },
    });
  }

  showSaveIndicator() {
    if (!this.settings.showSaveIndicator) return;
    this.statusBarIndicator.setText('💾 View saved');
    setTimeout(() => this.statusBarIndicator.setText(''), 2000);
  }
}

class PersistentViewSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Persistent View Pro Max Settings' });

    // --- WHAT TO SAVE ---
    containerEl.createEl('h3', { text: 'What to Save' });
    new Setting(containerEl).setName('Remember Cursor Position').addToggle(t => t.setValue(this.plugin.settings.shouldSaveCursor).onChange(async v => { this.plugin.settings.shouldSaveCursor = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('Remember Scroll Position').addToggle(t => t.setValue(this.plugin.settings.shouldSaveScroll).onChange(async v => { this.plugin.settings.shouldSaveScroll = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('Remember Folded Headings').addToggle(t => t.setValue(this.plugin.settings.shouldSaveFolds).onChange(async v => { this.plugin.settings.shouldSaveFolds = v; await this.plugin.saveSettings(); }));

    // --- HOW TO SAVE ---
    containerEl.createEl('h3', { text: 'How to Save' });
    new Setting(containerEl).setName('Save Trigger').addDropdown(d => d.addOption('onSwitch', 'On Tab/Pane Switch (Recommended)').addOption('periodic', 'Periodically').setValue(this.plugin.settings.saveTrigger).onChange(async v => { this.plugin.settings.saveTrigger = v; await this.plugin.saveSettings(); this.plugin.setupSaveTriggers(); this.display(); }));
    if (this.plugin.settings.saveTrigger === 'periodic') {
      new Setting(containerEl).setName('Periodic Save Interval').setDesc('How often to save, in seconds.').addText(t => t.setValue(String(this.plugin.settings.periodicSaveInterval)).onChange(async v => { const n = Number(v); if (!isNaN(n) && n > 0) { this.plugin.settings.periodicSaveInterval = n; await this.plugin.saveSettings(); this.plugin.setupSaveTriggers(); } }));
    }

    // --- USER INTERFACE ---
    containerEl.createEl('h3', { text: 'User Interface' });
    new Setting(containerEl).setName('Show Save Indicator').setDesc('Briefly show a "View saved" message in the status bar.').addToggle(t => t.setValue(this.plugin.settings.showSaveIndicator).onChange(async v => { this.plugin.settings.showSaveIndicator = v; await this.plugin.saveSettings(); }));

    // --- DATA MANAGEMENT ---
    containerEl.createEl('h3', { text: 'Data Management' });
    new Setting(containerEl).setName('Enable Automatic Pruning').setDesc('Automatically remove old/excess view state data.').addToggle(t => t.setValue(this.plugin.settings.enableAutomaticPruning).onChange(async v => { this.plugin.settings.enableAutomaticPruning = v; await this.plugin.saveSettings(); this.display(); }));
    if (this.plugin.settings.enableAutomaticPruning) {
      new Setting(containerEl).setName('Pruning Method').addDropdown(d => d.addOption('byAge', 'By Age').addOption('byNumber', 'By Number of Files').setValue(this.plugin.settings.pruningMethod).onChange(async v => { this.plugin.settings.pruningMethod = v; await this.plugin.saveSettings(); this.display(); }));
      if (this.plugin.settings.pruningMethod === 'byAge') {
        new Setting(containerEl).setName('Max Data Age').setDesc('Forget view state for files not opened in this many days.').addText(t => t.setValue(String(this.plugin.settings.pruningMaxAgeDays)).onChange(async v => { const n = Number(v); if (!isNaN(n) && n > 0) { this.plugin.settings.pruningMaxAgeDays = n; await this.plugin.saveSettings(); } }));
      } else if (this.plugin.settings.pruningMethod === 'byNumber') {
        new Setting(containerEl).setName('Max Number of Files').setDesc('Only remember the view state for this many of the most recent files.').addText(t => t.setValue(String(this.plugin.settings.pruningMaxFiles)).onChange(async v => { const n = Number(v); if (!isNaN(n) && n > 0) { this.plugin.settings.pruningMaxFiles = n; await this.plugin.saveSettings(); } }));
      }
    }
    new Setting(containerEl).setName('Clear All Saved View States').setDesc('This will erase all saved positions for all files. This action cannot be undone.').addButton(b => b.setButtonText('Clear All Data').setWarning().onClick(async () => { if (confirm('Are you sure you want to clear all saved view state data?')) { this.plugin.data.fileStates = {}; await this.plugin.saveData(this.plugin.data); new Notice('All saved view states have been cleared.'); } }));
  }
}

module.exports = PersistentViewPlugin;