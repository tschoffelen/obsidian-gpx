import {
	Component,
	FileView,
	Plugin,
	TFile,
	WorkspaceLeaf,
	debounce,
} from "obsidian";
import { GpxCard } from "./card";
import { GpxDataCache, MapCache } from "./cache";
import {
	DEFAULT_SETTINGS,
	GpxPreviewSettings,
	GpxPreviewSettingTab,
} from "./settings";

const VIEW_TYPE_GPX = "gpx-preview-view";

export default class GpxPreviewPlugin extends Plugin {
	settings!: GpxPreviewSettings;
	cache!: MapCache;
	gpxData!: GpxDataCache;
	activeCards = new Set<GpxCard>();

	async onload() {
		await this.loadSettings();
		this.cache = new MapCache(this);
		this.gpxData = new GpxDataCache(this.app);
		this.addSettingTab(new GpxPreviewSettingTab(this.app, this));

		// A simple view so .gpx files are indexed by the vault and can be
		// opened directly from the file explorer.
		this.registerView(VIEW_TYPE_GPX, (leaf) => new GpxFileView(leaf, this));
		try {
			this.registerExtensions(["gpx"], VIEW_TYPE_GPX);
		} catch (e) {
			console.warn("GPX Preview: .gpx extension already registered", e);
		}

		this.registerEmbedHandler();

		// Re-render maps when the theme flips between light and dark.
		this.registerEvent(
			this.app.workspace.on(
				"css-change",
				debounce(() => this.refreshCards(), 400, true)
			)
		);
	}

	/**
	 * Register a renderer for ![](file.gpx) and ![[file.gpx]] embeds.
	 * Obsidian's embed registry (used by both reading mode and live preview)
	 * is not part of the public API, so fall back to a markdown
	 * post-processor for reading mode if it is unavailable.
	 */
	private registerEmbedHandler() {
		const registry = (this.app as any).embedRegistry;
		if (registry?.registerExtensions && registry?.unregisterExtensions) {
			registry.registerExtensions(
				["gpx"],
				(ctx: { containerEl: HTMLElement }, file: TFile) =>
					new GpxEmbed(this, ctx.containerEl, file)
			);
			this.register(() => registry.unregisterExtensions(["gpx"]));
			return;
		}

		this.registerMarkdownPostProcessor((el, ctx) => {
			const embeds = el.querySelectorAll<HTMLElement>("span.internal-embed");
			for (const span of Array.from(embeds)) {
				const src = span.getAttribute("src");
				if (!src || !src.toLowerCase().endsWith(".gpx")) continue;
				const file = this.app.metadataCache.getFirstLinkpathDest(
					decodeURIComponent(src),
					ctx.sourcePath
				);
				if (!(file instanceof TFile)) continue;
				span.empty();
				span.addClass("gpx-preview-embed");
				ctx.addChild(
					new GpxCard(this, span, file, cleanTitle(span.getAttribute("alt"), file))
				);
			}
		});
	}

	refreshCards() {
		for (const card of this.activeCards) void card.render();
	}

	async loadSettings() {
		const data = (await this.loadData()) ?? {};
		this.settings = {
			...DEFAULT_SETTINGS,
			...data,
			stats: { ...DEFAULT_SETTINGS.stats, ...(data.stats ?? {}) },
		};
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

/** The alt text is the optional card title; drop it when it's just the file name. */
function cleanTitle(alt: string | null, file: TFile): string | undefined {
	const title = alt?.trim();
	if (!title) return undefined;
	if (title === file.name || title === file.basename || title === file.path) {
		return undefined;
	}
	return title;
}

/** Component created by Obsidian's embed registry for each .gpx embed. */
class GpxEmbed extends Component {
	constructor(
		private plugin: GpxPreviewPlugin,
		private containerEl: HTMLElement,
		private file: TFile
	) {
		super();
	}

	// Called by Obsidian once the embed should render its file.
	async loadFile() {
		this.containerEl.empty();
		this.containerEl.addClass("gpx-preview-embed");
		const alt =
			this.containerEl.getAttribute("alt") ??
			this.containerEl.closest(".internal-embed")?.getAttribute("alt") ??
			null;
		this.addChild(
			new GpxCard(this.plugin, this.containerEl, this.file, cleanTitle(alt, this.file))
		);
	}
}

class GpxFileView extends FileView {
	allowNoFile = false;

	constructor(leaf: WorkspaceLeaf, private plugin: GpxPreviewPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_GPX;
	}

	canAcceptExtension(extension: string): boolean {
		return extension === "gpx";
	}

	async onLoadFile(file: TFile) {
		this.contentEl.empty();
		const wrapper = this.contentEl.createDiv("gpx-preview-view-wrapper");
		this.addChild(new GpxCard(this.plugin, wrapper, file));
	}

	async onUnloadFile() {
		this.contentEl.empty();
	}
}
