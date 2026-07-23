import { requestUrl } from "obsidian";
import { GpxPoint, downsample } from "./gpx";

export type TileProviderId = "carto" | "osm";

export interface StaticMapOptions {
	width: number; // css px
	height: number; // css px
	dark: boolean;
	provider: TileProviderId;
}

const SUBDOMAINS = ["a", "b", "c", "d"];
const TILE_SIZE = 256; // css px per tile
const PADDING = 32; // css px kept clear around the track
const MAX_ZOOM = 16;
const DPR = 2; // render everything at 2x for crisp output

interface Projected {
	x: number;
	y: number;
}

/** Web Mercator projection to world coordinates in [0, 1]. */
function project(p: GpxPoint): Projected {
	const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, p.lat));
	const sin = Math.sin((clampedLat * Math.PI) / 180);
	return {
		x: (p.lon + 180) / 360,
		y: 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI),
	};
}

function tileUrl(provider: TileProviderId, dark: boolean, z: number, x: number, y: number): string {
	if (provider === "osm") {
		return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
	}
	const style = dark ? "dark_all" : "light_all";
	const s = SUBDOMAINS[Math.abs(x + y) % SUBDOMAINS.length];
	return `https://${s}.basemaps.cartocdn.com/${style}/${z}/${x}/${y}@2x.png`;
}

// OSM's tile usage policy requires a User-Agent identifying the application;
// without it the servers return 418 "Access blocked" tiles.
const USER_AGENT =
	"ObsidianGpxPreview/1.0 (+https://github.com/tschoffelen/obsidian-gpx-preview)";

async function loadTile(url: string): Promise<ImageBitmap | null> {
	try {
		const res = await requestUrl({
			url,
			headers: { "User-Agent": USER_AGENT },
			throw: false,
		});
		const type = res.headers["content-type"] ?? res.headers["Content-Type"] ?? "";
		if (res.status !== 200 || !type.startsWith("image/")) {
			console.warn(`GPX Preview: tile request failed (${res.status})`, url);
			return null;
		}
		return await createImageBitmap(new Blob([res.arrayBuffer]));
	} catch (e) {
		console.warn("GPX Preview: failed to load tile", url, e);
		return null;
	}
}

export async function renderStaticMap(
	points: GpxPoint[],
	opts: StaticMapOptions
): Promise<ArrayBuffer> {
	const { width: W, height: H } = opts;
	const track = downsample(points, 2500);
	const projected = track.map(project);

	let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
	for (const p of projected) {
		if (p.x < minX) minX = p.x;
		if (p.x > maxX) maxX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.y > maxY) maxY = p.y;
	}

	// Largest integer zoom at which the track fits inside the padded viewport.
	let zoom = 2;
	for (let z = MAX_ZOOM; z >= 2; z--) {
		const scale = TILE_SIZE * 2 ** z;
		if (
			(maxX - minX) * scale <= W - PADDING * 2 &&
			(maxY - minY) * scale <= H - PADDING * 2
		) {
			zoom = z;
			break;
		}
	}

	const scale = TILE_SIZE * 2 ** zoom;
	const tiles = 2 ** zoom;
	// Top-left of the viewport in world pixels at this zoom.
	const tlx = ((minX + maxX) / 2) * scale - W / 2;
	const tly = ((minY + maxY) / 2) * scale - H / 2;

	const canvas = createEl("canvas");
	canvas.width = W * DPR;
	canvas.height = H * DPR;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Could not create canvas context");
	ctx.scale(DPR, DPR);

	ctx.fillStyle = opts.dark ? "#1c1d21" : "#e9e6df";
	ctx.fillRect(0, 0, W, H);

	// Fetch and draw all covering tiles.
	const x0 = Math.floor(tlx / TILE_SIZE);
	const x1 = Math.floor((tlx + W) / TILE_SIZE);
	const y0 = Math.floor(tly / TILE_SIZE);
	const y1 = Math.floor((tly + H) / TILE_SIZE);

	let failed = 0;
	const jobs: Promise<void>[] = [];
	for (let tx = x0; tx <= x1; tx++) {
		for (let ty = y0; ty <= y1; ty++) {
			if (ty < 0 || ty >= tiles) continue;
			const wrappedX = ((tx % tiles) + tiles) % tiles;
			const url = tileUrl(opts.provider, opts.dark, zoom, wrappedX, ty);
			const dx = tx * TILE_SIZE - tlx;
			const dy = ty * TILE_SIZE - tly;
			jobs.push(
				loadTile(url).then((img) => {
					if (img) {
						ctx.drawImage(img, dx, dy, TILE_SIZE, TILE_SIZE);
						img.close();
					} else {
						failed++;
					}
				})
			);
		}
	}
	await Promise.all(jobs);
	// An incomplete basemap must not end up in the offline cache — bail so
	// the next view retries instead.
	if (failed > 0) {
		throw new Error(`${failed} map tile(s) could not be loaded`);
	}

	// Route line with a casing underneath for contrast, Apple Maps style.
	const path = projected.map((p) => ({
		x: p.x * scale - tlx,
		y: p.y * scale - tly,
	}));

	ctx.lineJoin = "round";
	ctx.lineCap = "round";

	ctx.beginPath();
	ctx.moveTo(path[0].x, path[0].y);
	for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);

	ctx.strokeStyle = opts.dark ? "rgba(8, 10, 14, 0.6)" : "rgba(255, 255, 255, 0.9)";
	ctx.lineWidth = 8;
	ctx.stroke();

	ctx.strokeStyle = "#d6ae1e";
	ctx.lineWidth = 4.5;
	ctx.stroke();

	if (path.length > 1) {
		drawDot(ctx, path[0], "#30d158", opts.dark);
		drawDot(ctx, path[path.length - 1], "#ff453a", opts.dark);
	}

	const blob = await new Promise<Blob>((resolve, reject) =>
		canvas.toBlob(
			(b) => (b ? resolve(b) : reject(new Error("Canvas export failed"))),
			"image/png"
		)
	);
	return await blob.arrayBuffer();
}

function drawDot(
	ctx: CanvasRenderingContext2D,
	p: { x: number; y: number },
	color: string,
	dark: boolean
) {
	ctx.beginPath();
	ctx.arc(p.x, p.y, 6.5, 0, Math.PI * 2);
	ctx.fillStyle = dark ? "#1c1d21" : "#ffffff";
	ctx.fill();
	ctx.beginPath();
	ctx.arc(p.x, p.y, 4.25, 0, Math.PI * 2);
	ctx.fillStyle = color;
	ctx.fill();
}
