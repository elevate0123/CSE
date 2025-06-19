const { Plugin, PluginSettingTab, Setting, MarkdownView, WorkspaceLeaf } = require('obsidian');

const DEFAULT_SETTINGS = {
  showProgressBar: true,
  showStatusText: true,
  calculationMethod: 'scroll',
  barPosition: 'top',
  barColor: '#3498db',
  barThickness: '3px',
  statusTextFormat: 'Reading: {progress}%',
};

class ReadingProgressPlugin extends Plugin {
  settings;
  statusBarItemEl;
  progressBars = new WeakMap();
  
  // Keep a direct reference to the current listener to ensure it can be removed
  currentScrollListener = null;
  currentEditorListener = null;
  currentLeaf = null;

  async onload() {
    await this.loadSettings();
    this.statusBarItemEl = this.addStatusBarItem();
    this.addSettingTab(new ReadingProgressSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(this.app.workspace.on('active-leaf-change', this.handleLeafChange, this));
      // Initialize for the currently active leaf when the plugin loads
      this.handleLeafChange(this.app.workspace.activeLeaf);
    });
  }

  onunload() {
    this.removeListeners(); // Clean up any lingering listeners
    // Clean up all created progress bars
    this.app.workspace.iterateAllLeaves(leaf => {
      if (this.progressBars.has(leaf)) {
        this.progressBars.get(leaf).remove();
        this.progressBars.delete(leaf);
      }
    });
  }

  // --- The New, Robust Event Handling Core ---

  handleLeafChange(leaf) {
    // 1. ALWAYS remove old listeners before doing anything else.
    this.removeListeners();
    this.currentLeaf = leaf;

    // 2. Check if the new leaf is a markdown view.
    if (leaf && leaf.view instanceof MarkdownView) {
      const view = leaf.view;
      
      // 3. Create a progress bar if it doesn't exist for this pane.
      this.createProgressBarForLeaf(leaf);

      // 4. Define and attach the new listeners directly.
      this.currentScrollListener = () => this.updateProgress();
      this.currentEditorListener = () => this.updateProgress();
      
      view.scrollEl.addEventListener('scroll', this.currentScrollListener);
      this.registerEvent(this.app.workspace.on('editor-change', this.currentEditorListener));

      // 5. Run an initial update.
      this.updateProgress();
    } else {
      // If it's not a markdown view, hide everything.
      this.hideUI();
    }
  }

  removeListeners() {
    if (this.currentLeaf && this.currentLeaf.view instanceof MarkdownView) {
      if (this.currentScrollListener) {
        this.currentLeaf.view.scrollEl.removeEventListener('scroll', this.currentScrollListener);
      }
    }
    // The editor-change listener is managed by Obsidian's event system, 
    // but we'll clear our reference to be safe.
    this.currentScrollListener = null;
    this.currentEditorListener = null;
  }

  // --- UI and Calculation (Largely unchanged, but now called by a working engine) ---

  createProgressBarForLeaf(leaf) {
    if (!this.progressBars.has(leaf)) {
      const bar = document.createElement('div');
      bar.classList.add('reading-progress-bar');
      leaf.containerEl.appendChild(bar);
      this.progressBars.set(leaf, bar);
      this.updateBarAppearance(leaf);
    }
  }

  updateProgress() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      this.hideUI();
      return;
    }

    const editor = view.editor;
    let progress = 0;

    if (this.settings.calculationMethod === 'scroll') {
      const scrollEl = view.scrollEl;
      const scrollableHeight = scrollEl.scrollHeight - scrollEl.clientHeight;
      progress = scrollableHeight > 0 ? scrollEl.scrollTop / scrollableHeight : 0;
    } else { // 'cursor'
      const lineCount = editor.lineCount();
      progress = lineCount > 1 ? editor.getCursor().line / (lineCount - 1) : 0;
    }

    const percentage = Math.min(100, Math.max(0, progress * 100));
    this.updateUI(view.leaf, percentage);
  }

  updateUI(activeLeaf, percentage) {
    // Update Status Bar
    if (this.settings.showStatusText) {
      const displayText = this.settings.statusTextFormat.replace('{progress}', String(Math.round(percentage)));
      this.statusBarItemEl.setText(displayText);
    } else {
      this.statusBarItemEl.setText('');
    }

    // Update Progress Bar
    const bar = this.progressBars.get(activeLeaf);
    if (this.settings.showProgressBar && bar) {
      bar.style.setProperty('--reading-progress-width', `${percentage}%`);
      bar.style.display = 'block';
    } else if (bar) {
      bar.style.display = 'none';
    }
  }

  hideUI() {
    this.statusBarItemEl.setText('');
    // Explicitly hide the bar of the last active leaf if we switch to a non-markdown view
    if(this.currentLeaf && this.progressBars.has(this.currentLeaf)) {
        const bar = this.progressBars.get(this.currentLeaf);
        if (bar) bar.style.display = 'none';
    }
  }
  
  updateBarAppearance(leaf) {
    const bar = this.progressBars.get(leaf);
    if (!bar) return;
    bar.style.setProperty('--reading-progress-color', this.settings.barColor);
    bar.style.setProperty('--reading-progress-thickness', this.settings.barThickness);
    bar.className = 'reading-progress-bar';
    bar.classList.add(`position-${this.settings.barPosition}`);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.app.workspace.iterateAllLeaves(leaf => {
      if (this.progressBars.has(leaf)) {
        this.updateBarAppearance(leaf);
      }
    });
    this.updateProgress();
  }
}

class ReadingProgressSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Reading Progress Settings' });

    new Setting(containerEl)
      .setName('Calculation Method')
      .setDesc('Choose how progress is calculated.')
      .addDropdown(dd => dd
        .addOption('scroll', 'By Scroll Position')
        .addOption('cursor', 'By Cursor Position')
        .setValue(this.plugin.settings.calculationMethod)
        .onChange(async (value) => {
          this.plugin.settings.calculationMethod = value;
          await this.plugin.saveSettings();
        }));

    containerEl.createEl('h3', { text: 'Progress Bar' });

    new Setting(containerEl)
      .setName('Show Progress Bar')
      .setDesc('Display a visual bar in the note pane.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showProgressBar)
        .onChange(async (value) => {
          this.plugin.settings.showProgressBar = value;
          await this.plugin.saveSettings();
        }));
        
    new Setting(containerEl)
      .setName('Bar Position')
      .addDropdown(dd => dd
        .addOption('top', 'Top of pane')
        .addOption('bottom', 'Bottom of pane')
        .setValue(this.plugin.settings.barPosition)
        .onChange(async (value) => {
          this.plugin.settings.barPosition = value;
          await this.plugin.saveSettings();
        }));
        
    new Setting(containerEl)
      .setName('Bar Color')
      .addColorPicker(picker => picker
        .setValue(this.plugin.settings.barColor)
        .onChange(async (value) => {
          this.plugin.settings.barColor = value;
          await this.plugin.saveSettings();
        }));
        
    new Setting(containerEl)
      .setName('Bar Thickness')
      .addText(text => text
        .setValue(this.plugin.settings.barThickness)
        .setPlaceholder('e.g., 3px')
        .onChange(async (value) => {
          this.plugin.settings.barThickness = value;
          await this.plugin.saveSettings();
        }));

    containerEl.createEl('h3', { text: 'Status Bar' });
    
    new Setting(containerEl)
      .setName('Show Status Bar Text')
      .setDesc('Display progress text in the main status bar.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showStatusText)
        .onChange(async (value) => {
          this.plugin.settings.showStatusText = value;
          await this.plugin.saveSettings();
        }));
        
    new Setting(containerEl)
      .setName('Status Text Format')
      .setDesc('Set your custom text format. Use {progress} as the placeholder for the percentage value.')
      .addText(text => text
        .setValue(this.plugin.settings.statusTextFormat)
        .setPlaceholder('e.g., Reading: {progress}%')
        .onChange(async (value) => {
          this.plugin.settings.statusTextFormat = value;
          await this.plugin.saveSettings();
        }));
  }
}

module.exports = ReadingProgressPlugin;