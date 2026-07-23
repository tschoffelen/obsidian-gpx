import { App, Notice, PluginSettingTab, Setting } from "obsidian";
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

export class GpxPreviewSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: GpxPreviewPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Units")
			.setDesc("Used for distance, speed, pace and elevation.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("metric", "Metric (km, km/h)")
					.addOption("imperial", "Imperial (mi, mph)")
					.setValue(this.plugin.settings.units)
					.onChange(async (value) => {
						this.plugin.settings.units = value as Units;
						await this.save();
					})
			);

		new Setting(containerEl).setName("Stats").setHeading();
		for (const def of STAT_DEFS) {
			new Setting(containerEl).setName(def.label).addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.stats[def.key])
					.onChange(async (value) => {
						this.plugin.settings.stats[def.key] = value;
						await this.save();
					})
			);
		}

		new Setting(containerEl).setName("Map").setHeading();

		new Setting(containerEl)
			.setName("Map provider")
			.setDesc(
				"CARTO and OpenStreetMap are free and need no configuration. Apple Maps requires MapKit credentials below."
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("carto", "CARTO (default)")
					.addOption("osm", "OpenStreetMap")
					.addOption("apple", "Apple Maps")
					.setValue(this.plugin.settings.provider)
					.onChange(async (value) => {
						this.plugin.settings.provider =
							value as GpxPreviewSettings["provider"];
						await this.save();
						this.display();
					})
			);

		if (this.plugin.settings.provider === "apple") {
			const desc = containerEl.createEl("p", {
				cls: "setting-item-description gpx-preview-settings-note",
			});
			desc.appendText(
				"Maps are fetched from Apple's Web Snapshots API, signed locally with your MapKit key. Create a key with the MapKit JS service enabled at "
			);
			desc.createEl("a", {
				text: "developer.apple.com",
				href: "https://developer.apple.com/account/resources/authkeys/list",
			});
			desc.appendText(", then fill in your Team ID, the Key ID and the contents of the downloaded .p8 file.");

			new Setting(containerEl)
				.setName("Apple team ID")
				.setDesc("The 10-character team ID from your Apple Developer account.")
				.addText((text) =>
					text
						.setPlaceholder("A1B2C3D4E5")
						.setValue(this.plugin.settings.teamId)
						.onChange(async (value) => {
							this.plugin.settings.teamId = value.trim();
							await this.save();
						})
				);

			new Setting(containerEl)
				.setName("Apple key ID")
				.setDesc("The ID of your MapKit JS key.")
				.addText((text) =>
					text
						.setPlaceholder("ABC123DEFG")
						.setValue(this.plugin.settings.keyId)
						.onChange(async (value) => {
							this.plugin.settings.keyId = value.trim();
							await this.save();
						})
				);

			new Setting(containerEl)
				.setName("Apple private key")
				.setDesc("Paste the full contents of the .p8 key file.")
				.addTextArea((text) => {
					text
						.setPlaceholder("-----BEGIN PRIVATE KEY-----\n…")
						.setValue(this.plugin.settings.privateKey)
						.onChange(async (value) => {
							this.plugin.settings.privateKey = value;
							await this.save();
						});
					text.inputEl.rows = 5;
					text.inputEl.addClass("gpx-preview-settings-key");
				});
		}

		new Setting(containerEl).setName("Offline cache").setHeading();

		new Setting(containerEl)
			.setName("Cache rendered maps")
			.setDesc(
				"Save each map as a PNG on first load so previews keep working offline."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.cacheMaps)
					.onChange(async (value) => {
						this.plugin.settings.cacheMaps = value;
						await this.save();
					})
			);

		new Setting(containerEl)
			.setName("Clear map cache")
			.setDesc("Delete all cached map images. They are re-rendered on next view.")
			.addButton((button) =>
				button.setButtonText("Clear cache").onClick(async () => {
					const removed = await this.plugin.cache.clear();
					new Notice(`GPX Preview: removed ${removed} cached map${removed === 1 ? "" : "s"}.`);
					this.plugin.refreshCards();
				})
			);
	}

	private async save() {
		await this.plugin.saveSettings();
		this.plugin.refreshCards();
	}
}
