import type { App, Plugin, TFile } from "obsidian";
import { GpxData, parseGpx } from "./gpx";

/**
 * Length-capped in-memory LRU cache of parsed GPX files, keyed by path +
 * mtime. Repeat renders (theme flips, settings changes, note re-opens) skip
 * the file read and XML parse. Deliberately not persisted to disk: the stats
 * depend on the parsing algorithm, and a disk cache would silently serve
 * stale numbers after every algorithm tweak.
 */
export class GpxDataCache {
	private entries = new Map<string, GpxData>();

	constructor(private app: App, private capacity = 20) {}

	async get(file: TFile): Promise<GpxData> {
		const key = `${file.path}:${file.stat.mtime}`;
		const hit = this.entries.get(key);
		if (hit) {
			// Re-insert to mark as most recently used.
			this.entries.delete(key);
			this.entries.set(key, hit);
			return hit;
		}
		// Parse errors propagate uncached, so a fixed file re-parses cleanly.
		const data = parseGpx(await this.app.vault.read(file));
		this.entries.set(key, data);
		while (this.entries.size > this.capacity) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) break;
			this.entries.delete(oldest);
		}
		return data;
	}
}

/**
 * Disk cache for rendered map PNGs, stored inside the plugin's own folder so
 * maps keep working offline and don't clutter the user's vault.
 */
export class MapCache {
	constructor(private plugin: Plugin) {}

	private get dir(): string {
		return `${this.plugin.manifest.dir}/cache`;
	}

	fileKey(file: TFile): string {
		return hash(file.path);
	}

	/** Cache file name for a given source file + render variant. */
	name(file: TFile, variant: string): string {
		return `${this.fileKey(file)}_${file.stat.mtime}_${variant}.png`;
	}

	async get(name: string): Promise<ArrayBuffer | null> {
		const adapter = this.plugin.app.vault.adapter;
		const path = `${this.dir}/${name}`;
		try {
			if (!(await adapter.exists(path))) return null;
			return await adapter.readBinary(path);
		} catch {
			return null;
		}
	}

	async put(file: TFile, name: string, data: ArrayBuffer): Promise<void> {
		const adapter = this.plugin.app.vault.adapter;
		try {
			if (!(await adapter.exists(this.dir))) {
				await adapter.mkdir(this.dir);
			}
			await this.prune(file);
			await adapter.writeBinary(`${this.dir}/${name}`, data);
		} catch (e) {
			console.warn("GPX Preview: could not write map cache", e);
		}
	}

	/** Remove cached renders of this file that belong to an older mtime. */
	private async prune(file: TFile): Promise<void> {
		const adapter = this.plugin.app.vault.adapter;
		const prefix = `${this.fileKey(file)}_`;
		const current = `${prefix}${file.stat.mtime}_`;
		try {
			const listing = await adapter.list(this.dir);
			for (const path of listing.files) {
				const base = path.substring(path.lastIndexOf("/") + 1);
				if (base.startsWith(prefix) && !base.startsWith(current)) {
					await adapter.remove(path);
				}
			}
		} catch {
			// best effort
		}
	}

	async clear(): Promise<number> {
		const adapter = this.plugin.app.vault.adapter;
		let removed = 0;
		try {
			if (!(await adapter.exists(this.dir))) return 0;
			const listing = await adapter.list(this.dir);
			for (const path of listing.files) {
				await adapter.remove(path);
				removed++;
			}
		} catch (e) {
			console.warn("GPX Preview: could not clear cache", e);
		}
		return removed;
	}
}

/** Small non-cryptographic hash, stable across sessions. */
function hash(s: string): string {
	let h1 = 5381;
	let h2 = 52711;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		h1 = (h1 * 33) ^ c;
		h2 = (h2 * 33) ^ c;
	}
	return (
		(h1 >>> 0).toString(16).padStart(8, "0") +
		(h2 >>> 0).toString(16).padStart(8, "0")
	);
}
