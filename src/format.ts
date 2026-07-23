export type Units = "metric" | "imperial";

const KM_PER_MI = 1.609344;
const FT_PER_M = 3.28084;

export function formatDistance(meters: number, units: Units): string {
	if (units === "imperial") {
		const mi = meters / 1000 / KM_PER_MI;
		if (mi < 0.2) return `${Math.round(meters * FT_PER_M)} ft`;
		return `${mi.toFixed(mi >= 100 ? 0 : 2)} mi`;
	}
	if (meters < 1000) return `${Math.round(meters)} m`;
	const km = meters / 1000;
	return `${km.toFixed(km >= 100 ? 0 : 2)} km`;
}

export function formatDuration(seconds: number): string {
	const s = Math.round(seconds);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	if (h > 0) return `${h}:${pad(m)}:${pad(sec)}`;
	return `${m}:${pad(sec)}`;
}

export function formatSpeed(mps: number, units: Units): string {
	if (units === "imperial") {
		return `${((mps * 3.6) / KM_PER_MI).toFixed(1)} mph`;
	}
	return `${(mps * 3.6).toFixed(1)} km/h`;
}

export function formatPace(mps: number, units: Units): string {
	if (mps <= 0) return "–";
	const secondsPerUnit =
		units === "imperial" ? (1000 * KM_PER_MI) / mps : 1000 / mps;
	if (secondsPerUnit > 5940) return "–"; // slower than 99 min, meaningless
	const m = Math.floor(secondsPerUnit / 60);
	const s = Math.round(secondsPerUnit % 60);
	const suffix = units === "imperial" ? "/mi" : "/km";
	return `${m}:${pad(s)} ${suffix}`;
}

export function formatElevation(meters: number, units: Units): string {
	if (units === "imperial") return `${Math.round(meters * FT_PER_M)} ft`;
	return `${Math.round(meters)} m`;
}

function pad(n: number): string {
	return n < 10 ? `0${n}` : `${n}`;
}
