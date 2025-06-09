import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, MarkdownView, MetadataCache, Plugin, TAbstractFile, TFile, Vault, setIcon } from 'obsidian';

// Types for index entries
type IndexEntryType = 'title' | 'heading' | 'block' | 'tag';
type IndexEntry = {
    type: IndexEntryType;
    notePath: string;
    noteTitle: string;
    target: string;
    displayText: string;
    score?: number;
};

// Simple fuzzy match implementation
function fuzzyMatch(query: string, text: string): boolean {
    const queryChars = query.toLowerCase().split('');
    const textLower = text.toLowerCase();
    let searchIndex = 0;
    
    for (const char of queryChars) {
        const foundIndex = textLower.indexOf(char, searchIndex);
        if (foundIndex === -1) return false;
        searchIndex = foundIndex + 1;
    }
    return true;
}

export default class SmartAutoLinkerPro extends Plugin {
    private index: Map<string, IndexEntry[]> = new Map();
    private metadataCache: MetadataCache;
    private vault: Vault;
    private isIndexing = false;
    private debounceTimeout?: number;

    private normalizeText(text: string): string {
        return text
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]/gu, ''); // Remove non-alphanumeric
    }

    private async deleteFromIndex(file: TFile) {
        for (const [key, entries] of this.index.entries()) {
            const filtered = entries.filter(entry => entry.notePath !== file.path);
            if (filtered.length > 0) {
                this.index.set(key, filtered);
            } else {
                this.index.delete(key);
            }
        }
    }

    private renameInIndex(file: TFile, oldPath: string) {
        for (const [key, entries] of this.index.entries()) {
            const updatedEntries = entries.map(entry => {
                if (entry.notePath === oldPath) {
                    return {
                        ...entry,
                        notePath: file.path,
                        noteTitle: file.basename
                    };
                }
                return entry;
            });
            this.index.set(key, updatedEntries);
        }
    }

    async onload() {
        this.metadataCache = this.app.metadataCache;
        this.vault = this.app.vault;

        // Initial index build
        await this.buildFullIndex();

        // Register events for live updates (debounced)
        this.registerEvent(this.metadataCache.on('changed', (file) => this.debouncedIndexUpdate(file)));
        this.registerEvent(this.vault.on('create', (file) => {
            if (file instanceof TFile) this.debouncedIndexUpdate(file);
        }));
        this.registerEvent(this.vault.on('delete', (file) => {
            if (file instanceof TFile) this.deleteFromIndex(file);
        }));
        this.registerEvent(this.vault.on('rename', (file, oldPath) => {
            if (file instanceof TFile) this.renameInIndex(file, oldPath);
        }));

        // Register editor suggest
        this.registerEditorSuggest(new SmartAutoLinkerProSuggest(this));
    }

    private async buildFullIndex() {
        if (this.isIndexing) return;
        this.isIndexing = true;
        this.index.clear();

        const markdownFiles = this.vault.getMarkdownFiles();
        for (const file of markdownFiles) await this.indexFile(file);
        this.isIndexing = false;
    }

    private async indexFile(file: TFile) {
        if (file.extension !== 'md') return;
        const noteTitle = file.basename;
        const notePath = file.path;

        // Index note title
        this.addToIndex(noteTitle, {
            type: 'title',
            notePath,
            noteTitle,
            target: noteTitle,
            displayText: noteTitle,
        });

        // Index frontmatter tags
        const metadata = this.metadataCache.getFileCache(file);
        if (metadata?.frontmatter?.tags) {
            const tags = Array.isArray(metadata.frontmatter.tags)
                ? metadata.frontmatter.tags
                : metadata.frontmatter.tags.split(',').map((t: string) => t.trim());
            tags.forEach((tag: string) => {
                this.addToIndex(tag, {
                    type: 'tag',
                    notePath,
                    noteTitle,
                    target: tag,
                    displayText: `#${tag}`,
                });
            });
        }

        // Index headings and blocks
        if (metadata?.headings) {
            metadata.headings.forEach((heading) => {
                this.addToIndex(heading.heading, {
                    type: 'heading',
                    notePath,
                    noteTitle,
                    target: heading.heading,
                    displayText: `${noteTitle} > ${heading.heading}`,
                });
            });
        }

        if (metadata?.sections) {
            metadata.sections.forEach((section) => {
                if (section.id) {
                    this.addToIndex(section.id, {
                        type: 'block',
                        notePath,
                        noteTitle,
                        target: section.id,
                        displayText: `${noteTitle} > #${section.id}`,
                    });
                }
            });
        }
    }

    private addToIndex(key: string, entry: IndexEntry) {
        const normalizedKey = this.normalizeText(key);
        const entries = this.index.get(normalizedKey) || [];
        if (!entries.some(e => e.type === entry.type && e.notePath === entry.notePath && e.target === entry.target)) {
            entries.push(entry);
        }
        this.index.set(normalizedKey, entries);
    }

    private debouncedIndexUpdate(file: TFile) {
        if (this.debounceTimeout) clearTimeout(this.debounceTimeout);
        this.debounceTimeout = window.setTimeout(() => {
            this.deleteFromIndex(file);
            this.indexFile(file);
        }, 300);
    }

    public getSuggestions(query: string): IndexEntry[] {
        const normalizedQuery = this.normalizeText(query);
        if (!normalizedQuery) return [];

        // Priority 1: Exact start-of-word matches
        const exactMatches: IndexEntry[] = [];
        for (const [key, entries] of this.index.entries()) {
            if (key.startsWith(normalizedQuery)) {
                exactMatches.push(...entries.map(e => ({ ...e, score: 0 })));
            }
        }

        // Priority 2: Fuzzy matches
        const fuzzyMatches: IndexEntry[] = [];
        for (const [key, entries] of this.index.entries()) {
            if (fuzzyMatch(normalizedQuery, key)) {
                fuzzyMatches.push(...entries.map(e => ({ ...e, score: 0.5 })));
            }
        }

        // Combine & deduplicate
        const allMatches = [...exactMatches, ...fuzzyMatches];
        const uniqueMatches = allMatches.filter(
            (match, index, self) => index === self.findIndex(m => 
                m.type === match.type && 
                m.notePath === match.notePath && 
                m.target === match.target
            )
        );

        return uniqueMatches.slice(0, 100);
    }
}

class SmartAutoLinkerProSuggest extends EditorSuggest<IndexEntry> {
    constructor(private plugin: SmartAutoLinkerPro) {
        super(plugin.app);
    }

    onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
        const line = editor.getLine(cursor.line);
        if (!line) return null;

        // Auto-detect dates (e.g., "2025-06-07" → [[2025-06-07]])
        const dateMatch = line.match(/\b\d{4}-\d{2}-\d{2}\b/);
        if (dateMatch) {
            const [date] = dateMatch;
            return {
                start: { line: cursor.line, ch: line.indexOf(date) },
                end: { line: cursor.line, ch: line.indexOf(date) + date.length },
                query: date,
            };
        }

        // Standard word/phrase detection
        let start = cursor.ch;
        while (start > 0 && !/[\s\p{P}]/u.test(line.charAt(start - 1))) start--;
        let end = cursor.ch;
        while (end < line.length && !/[\s\p{P}]/u.test(line.charAt(end))) end++;

        const query = line.substring(start, end);
        return query ? { start: { line: cursor.line, ch: start }, end: { line: cursor.line, ch: end }, query } : null;
    }

    async getSuggestions(context: EditorSuggestContext): Promise<IndexEntry[]> {
        return this.plugin.getSuggestions(context.query);
    }

    renderSuggestion(item: IndexEntry, el: HTMLElement) {
        const container = el.createDiv({ cls: 'smart-autolinker-suggestion' });
        
        // Add icon based on type
        const iconMap: Record<IndexEntryType, string> = { 
            title: 'file-text', 
            heading: 'heading', 
            block: 'link', 
            tag: 'tag' 
        };
        const icon = container.createDiv({ cls: 'smart-autolinker-icon' });
        setIcon(icon, iconMap[item.type]);

        // Highlighted text
        const textEl = container.createDiv({ cls: 'smart-autolinker-text' });
        textEl.createEl('strong', { text: item.displayText });

        // Subtext (type + note)
        container.createEl('small', {
            text: `${item.type === 'tag' ? 'Tag' : item.type} in ${item.noteTitle}`,
            cls: 'smart-autolinker-subtext',
        });
    }

    selectSuggestion(item: IndexEntry) {
        if (!this.context) return;
        const { editor, start, end, query } = this.context;

        let linkText = '';
        switch (item.type) {
            case 'title': linkText = `[[${item.target}|${query}]]`; break;
            case 'heading': linkText = `[[${item.noteTitle}#${item.target}|${query}]]`; break;
            case 'block': linkText = `[[${item.noteTitle}#^${item.target}|${query}]]`; break;
            case 'tag': linkText = `[[${item.target}|${query}]]`; break;
        }

        editor.replaceRange(linkText, start, end);
        this.close();
    }
}