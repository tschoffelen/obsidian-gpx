import { MarkdownRenderChild, TFile, setIcon } from "obsidian";
import type GpxPreviewPlugin from "./main";
import { GpxData, GpxStats, parseGpx } from "./gpx";
import {
	formatDistance,
	formatDuration,
	formatElevation,
	formatPace,
	formatSpeed,
	Units,
} from "./format";
import { renderStaticMap, TileProviderId } from "./staticmap";
import { hasAppleCredentials, renderAppleSnapshot } from "./apple";

export const MAP_WIDTH = 640;
export const MAP_HEIGHT = 320;

export interface StatDef {
	key: keyof GpxPreviewPlugin["settings"]["stats"];
	label: string;
	value: (stats: GpxStats, units: Units) => string | undefined;
}

export const STAT_DEFS: StatDef[] = [
	{
		key: "distance",
		label: "Distance",
		value: (s, u) => (s.distance > 0 ? formatDistance(s.distance, u) : undefined),
	},
	{
		key: "duration",
		label: "Duration",
		value: (s) => (s.duration ? formatDuration(s.duration) : undefined),
	},
	{
		key: "movingTime",
		label: "Moving time",
		value: (s) => (s.movingTime ? formatDuration(s.movingTime) : undefined),
	},
	{
		key: "avgSpeed",
		label: "Avg speed",
		value: (s, u) => (s.avgSpeed ? formatSpeed(s.avgSpeed, u) : undefined),
	},
	{
		key: "pace",
		label: "Avg pace",
		value: (s, u) => (s.avgSpeed ? formatPace(s.avgSpeed, u) : undefined),
	},
	{
		key: "maxSpeed",
		label: "Max speed",
		value: (s, u) => (s.maxSpeed ? formatSpeed(s.maxSpeed, u) : undefined),
	},
	{
		key: "elevationGain",
		label: "Elevation gain",
		value: (s, u) =>
			s.elevationGain !== undefined ? formatElevation(s.elevationGain, u) : undefined,
	},
];

export class GpxCard extends MarkdownRenderChild {
	private objectUrl: string | null = null;
	private cardEl: HTMLElement | null = null;
	private renderToken = 0;

	constructor(
		private plugin: GpxPreviewPlugin,
		containerEl: HTMLElement,
		private file: TFile,
		private title?: string
	) {
		super(containerEl);
	}

	onload() {
		this.plugin.activeCards.add(this);
		void this.render();
	}

	onunload() {
		this.plugin.activeCards.delete(this);
		this.revokeUrl();
		this.cardEl?.remove();
		this.cardEl = null;
	}

	private revokeUrl() {
		if (this.objectUrl) {
			URL.revokeObjectURL(this.objectUrl);
			this.objectUrl = null;
		}
	}

	async render() {
		const token = ++this.renderToken;
		this.revokeUrl();
		this.cardEl?.remove();

		const card = (this.cardEl = this.containerEl.createDiv("gpx-preview-card"));
		const mapEl = card.createDiv("gpx-preview-map");
		const infoEl = card.createDiv("gpx-preview-info");

		let data: GpxData;
		try {
			data = parseGpx(await this.plugin.app.vault.read(this.file));
		} catch (e) {
			this.renderError(mapEl, `Could not read GPX file: ${(e as Error).message}`);
			infoEl.remove();
			return;
		}
		if (token !== this.renderToken) return;

		this.renderInfo(infoEl, data);
		await this.renderMap(mapEl, data, token);
	}

	private renderInfo(infoEl: HTMLElement, data: GpxData) {
		const { settings } = this.plugin;

		if (this.title) {
			infoEl.createDiv({ cls: "gpx-preview-title", text: this.title });
		}

		const statsEl = infoEl.createDiv("gpx-preview-stats");
		let shown = 0;
		for (const def of STAT_DEFS) {
			if (!settings.stats[def.key]) continue;
			const value = def.value(data.stats, settings.units);
			if (value === undefined) continue;
			const statEl = statsEl.createDiv("gpx-preview-stat");
			statEl.createDiv({ cls: "gpx-preview-stat-label", text: def.label });
			statEl.createDiv({ cls: "gpx-preview-stat-value", text: value });
			shown++;
		}
		if (!shown && !this.title) infoEl.remove();
	}

	private async renderMap(mapEl: HTMLElement, data: GpxData, token: number) {
		const { settings } = this.plugin;
		const dark = document.body.hasClass("theme-dark");

		const useApple =
			settings.provider === "apple" && hasAppleCredentials(settings);
		const tileProvider: TileProviderId =
			settings.provider === "osm" ? "osm" : "carto";
		const provider = useApple ? "apple" : tileProvider;
		if (settings.provider === "apple" && !useApple) {
			console.warn(
				"GPX Preview: Apple Maps selected but credentials are incomplete, falling back to CARTO"
			);
		}

		const variant = `${provider}_${dark ? "dark" : "light"}_${MAP_WIDTH}x${MAP_HEIGHT}v2`;
		const cacheName = this.plugin.cache.name(this.file, variant);

		mapEl.addClass("is-loading");
		let png = settings.cacheMaps ? await this.plugin.cache.get(cacheName) : null;
		let fresh = false;

		if (!png) {
			try {
				if (useApple) {
					png = await renderAppleSnapshot(
						data.points,
						{ width: MAP_WIDTH, height: MAP_HEIGHT, dark },
						settings
					);
				} else {
					png = await renderStaticMap(data.points, {
						width: MAP_WIDTH,
						height: MAP_HEIGHT,
						dark,
						provider: tileProvider,
					});
				}
				fresh = true;
			} catch (e) {
				console.error("GPX Preview: map render failed", e);
			}
		}
		if (token !== this.renderToken) return;
		mapEl.removeClass("is-loading");

		if (!png) {
			this.renderError(
				mapEl,
				"Map unavailable — check your connection or map settings."
			);
			return;
		}

		if (fresh && settings.cacheMaps) {
			void this.plugin.cache.put(this.file, cacheName, png);
		}

		this.objectUrl = URL.createObjectURL(new Blob([png], { type: "image/png" }));
		const img = mapEl.createEl("img", { cls: "gpx-preview-map-img" });
		img.alt = this.title ?? this.file.basename;
		img.src = this.objectUrl;
	}

	private renderError(mapEl: HTMLElement, message: string) {
		mapEl.removeClass("is-loading");
		mapEl.addClass("has-error");
		const errorEl = mapEl.createDiv("gpx-preview-error");
		const iconEl = errorEl.createDiv("gpx-preview-error-icon");
		setIcon(iconEl, "map-off");
		errorEl.createDiv({ cls: "gpx-preview-error-text", text: message });
	}
}
