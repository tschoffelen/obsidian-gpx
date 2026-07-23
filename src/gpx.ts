export interface GpxPoint {
	lat: number;
	lon: number;
	ele?: number;
	time?: number; // ms since epoch
}

export interface GpxStats {
	/** Total distance in meters */
	distance: number;
	/** Elapsed time in seconds (first to last timestamped point) */
	duration?: number;
	/** Time in seconds spent moving faster than ~1 km/h */
	movingTime?: number;
	/** Average speed in m/s (distance / duration) */
	avgSpeed?: number;
	/** Max smoothed speed in m/s */
	maxSpeed?: number;
	/** Total ascent in meters */
	elevationGain?: number;
	startTime?: number;
}

export interface GpxData {
	name?: string;
	points: GpxPoint[];
	stats: GpxStats;
}

const EARTH_RADIUS = 6371008.8;

export function haversine(a: GpxPoint, b: GpxPoint): number {
	const toRad = Math.PI / 180;
	const dLat = (b.lat - a.lat) * toRad;
	const dLon = (b.lon - a.lon) * toRad;
	const sinLat = Math.sin(dLat / 2);
	const sinLon = Math.sin(dLon / 2);
	const h =
		sinLat * sinLat +
		Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * sinLon * sinLon;
	return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(h));
}

export function parseGpx(xml: string): GpxData {
	const doc = new DOMParser().parseFromString(xml, "application/xml");
	if (doc.querySelector("parsererror")) {
		throw new Error("Not a valid GPX file");
	}

	let nodes = Array.from(doc.querySelectorAll("trkpt"));
	if (!nodes.length) nodes = Array.from(doc.querySelectorAll("rtept"));
	if (!nodes.length) nodes = Array.from(doc.querySelectorAll("wpt"));

	const points: GpxPoint[] = [];
	for (const node of nodes) {
		const lat = parseFloat(node.getAttribute("lat") ?? "");
		const lon = parseFloat(node.getAttribute("lon") ?? "");
		if (!isFinite(lat) || !isFinite(lon)) continue;

		const point: GpxPoint = { lat, lon };
		const eleText = node.querySelector("ele")?.textContent;
		if (eleText) {
			const ele = parseFloat(eleText);
			if (isFinite(ele)) point.ele = ele;
		}
		const timeText = node.querySelector("time")?.textContent;
		if (timeText) {
			const time = Date.parse(timeText.trim());
			if (isFinite(time)) point.time = time;
		}
		points.push(point);
	}

	if (!points.length) {
		throw new Error("GPX file contains no track points");
	}

	const name =
		doc.querySelector("trk > name")?.textContent?.trim() ||
		doc.querySelector("metadata > name")?.textContent?.trim() ||
		undefined;

	return { name, points, stats: computeStats(points) };
}

const MOVING_THRESHOLD = 0.3; // m/s, ~1 km/h

function computeStats(points: GpxPoint[]): GpxStats {
	let distance = 0;
	let movingTime = 0;
	let maxSpeed = 0;

	const cumulative: number[] = [0];
	for (let i = 1; i < points.length; i++) {
		const d = haversine(points[i - 1], points[i]);
		distance += d;
		cumulative.push(distance);

		const t0 = points[i - 1].time;
		const t1 = points[i].time;
		if (t0 !== undefined && t1 !== undefined && t1 > t0) {
			const dt = (t1 - t0) / 1000;
			if (d / dt > MOVING_THRESHOLD) movingTime += dt;
		}
	}

	// Max speed over a small window to smooth out GPS jitter.
	const window = Math.min(3, points.length - 1);
	for (let i = window; i < points.length; i++) {
		const t0 = points[i - window].time;
		const t1 = points[i].time;
		if (t0 === undefined || t1 === undefined || t1 <= t0) continue;
		const speed = (cumulative[i] - cumulative[i - window]) / ((t1 - t0) / 1000);
		if (speed > maxSpeed) maxSpeed = speed;
	}

	const first = points.find((p) => p.time !== undefined);
	const last = [...points].reverse().find((p) => p.time !== undefined);
	let duration: number | undefined;
	if (first?.time !== undefined && last?.time !== undefined && last.time > first.time) {
		duration = (last.time - first.time) / 1000;
	}

	const stats: GpxStats = { distance };
	if (duration) {
		stats.duration = duration;
		stats.movingTime = movingTime || undefined;
		stats.avgSpeed = distance / duration;
		stats.maxSpeed = maxSpeed || undefined;
		stats.startTime = first?.time;
	}

	const gain = elevationGain(points);
	if (gain !== undefined) stats.elevationGain = gain;

	return stats;
}

function elevationGain(points: GpxPoint[]): number | undefined {
	const eles = points.map((p) => p.ele).filter((e): e is number => e !== undefined);
	if (eles.length < 2) return undefined;

	// Moving average to suppress barometer/GPS noise.
	const smoothed: number[] = [];
	const half = 2;
	for (let i = 0; i < eles.length; i++) {
		let sum = 0;
		let n = 0;
		for (let j = Math.max(0, i - half); j <= Math.min(eles.length - 1, i + half); j++) {
			sum += eles[j];
			n++;
		}
		smoothed.push(sum / n);
	}

	let gain = 0;
	for (let i = 1; i < smoothed.length; i++) {
		const delta = smoothed[i] - smoothed[i - 1];
		if (delta > 0) gain += delta;
	}
	return Math.round(gain);
}

/** Reduce a track to at most `max` points, always keeping the endpoints. */
export function downsample(points: GpxPoint[], max: number): GpxPoint[] {
	if (points.length <= max) return points;
	const result: GpxPoint[] = [];
	const step = (points.length - 1) / (max - 1);
	for (let i = 0; i < max; i++) {
		result.push(points[Math.round(i * step)]);
	}
	return result;
}
