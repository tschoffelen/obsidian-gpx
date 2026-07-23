import { App, Notice, PluginSettingTab, SettingDefinitionItem } from "obsidian";
import type GpxPreviewPlugin from "./main";
import { STAT_DEFS } from "./card";
import type { Units } from "./format";

export interface GpxPreviewSettings {
	units: Units;
	stats: {
		distance: boolean;
		duration: boolean;
		movingTime: boolean;
		avgSpeed: boolean;
		pace: boolean;
		maxSpeed: boolean;
		elevationGain: boolean;
	};
	provider: "carto" | "osm" | "apple";
	teamId: string;
	keyId: string;
	privateKey: string;
	cacheMaps: boolean;
}

export const DEFAULT_SETTINGS: GpxPreviewSettings = {
	units: "metric",
	stats: {
		distance: true,
		duration: true,
		movingTime: false,
		avgSpeed: true,
		pace: false,
		maxSpeed: false,
		elevationGain: false,
	},
	provider: "carto",
	teamId: "",
	keyId: "",
	privateKey: "",
	cacheMaps: true,
};

type StatKey = keyof GpxPreviewSettings["stats"];
const STATS_PREFIX = "stats.";

export class GpxPreviewSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: GpxPreviewPlugin) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const isApple = () => this.plugin.settings.provider === "apple";

		const appleDesc = createFragment((frag) => {
			frag.appendText(
				"Maps are fetched from Apple's Web Snapshots API, signed locally with your MapKit key. Create a key with the MapKit JS service enabled at "
			);
			frag.createEl("a", {
				text: "developer.apple.com",
				href: "https://developer.apple.com/account/resources/authkeys/list",
			});
			frag.appendText(
				", then fill in your Team ID, the Key ID and the contents of the downloaded .p8 file."
			);
		});

		return [
			{
				name: "Units",
				desc: "Used for distance, speed, pace and elevation.",
				control: {
					type: "dropdown",
					key: "units",
					options: {
						metric: "Metric (km, km/h)",
						imperial: "Imperial (mi, mph)",
					},
				},
			},
			{
				type: "group",
				heading: "Stats",
				items: STAT_DEFS.map((def) => ({
					name: def.label,
					control: {
						type: "toggle" as const,
						key: `${STATS_PREFIX}${def.key}`,
					},
				})),
			},
			{
				type: "group",
				heading: "Map",
				items: [
					{
						name: "Map provider",
						desc: "CARTO and OpenStreetMap are free and need no configuration. Apple Maps requires MapKit credentials below.",
						control: {
							type: "dropdown",
							key: "provider",
							options: {
								carto: "CARTO (default)",
								osm: "OpenStreetMap",
								apple: "Apple Maps",
							},
						},
					},
					{
						name: "Apple Maps credentials",
						desc: appleDesc,
						visible: isApple,
					},
					{
						name: "Apple team ID",
						desc: "The 10-character team ID from your Apple Developer account.",
						visible: isApple,
						control: {
							type: "text",
							key: "teamId",
							placeholder: "A1B2C3D4E5",
						},
					},
					{
						name: "Apple key ID",
						desc: "The ID of your MapKit JS key.",
						visible: isApple,
						control: {
							type: "text",
							key: "keyId",
							placeholder: "ABC123DEFG",
						},
					},
					{
						name: "Apple private key",
						desc: "Paste the full contents of the .p8 key file.",
						visible: isApple,
						control: {
							type: "textarea",
							key: "privateKey",
							placeholder: "-----BEGIN PRIVATE KEY-----\n…",
							rows: 5,
						},
					},
				],
			},
			{
				type: "group",
				heading: "Offline cache",
				items: [
					{
						name: "Cache rendered maps",
						desc: "Save each map as a PNG on first load so previews keep working offline.",
						control: { type: "toggle", key: "cacheMaps" },
					},
					{
						name: "Clear map cache",
						desc: "Delete all cached map images. They are re-rendered on next view.",
						action: () => void this.clearCache(),
					},
				],
			},
		];
	}

	getControlValue(key: string): unknown {
		const settings = this.plugin.settings;
		if (key.startsWith(STATS_PREFIX)) {
			return settings.stats[key.slice(STATS_PREFIX.length) as StatKey];
		}
		return settings[key as keyof GpxPreviewSettings];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const settings = this.plugin.settings;
		if (key.startsWith(STATS_PREFIX)) {
			settings.stats[key.slice(STATS_PREFIX.length) as StatKey] =
				value as boolean;
		} else {
			switch (key) {
				case "units":
					settings.units = value as Units;
					break;
				case "provider":
					settings.provider = value as GpxPreviewSettings["provider"];
					break;
				case "teamId":
					settings.teamId = (value as string).trim();
					break;
				case "keyId":
					settings.keyId = (value as string).trim();
					break;
				case "privateKey":
					settings.privateKey = value as string;
					break;
				case "cacheMaps":
					settings.cacheMaps = value as boolean;
					break;
			}
		}
		await this.plugin.saveSettings();
		this.plugin.refreshCards();
		// The Apple credential fields are only visible for the Apple provider.
		if (key === "provider") this.refreshDomState();
	}

	private async clearCache(): Promise<void> {
		const removed = await this.plugin.cache.clear();
		new Notice(
			`GPX Preview: removed ${removed} cached map${removed === 1 ? "" : "s"}.`
		);
		this.plugin.refreshCards();
	}
}
