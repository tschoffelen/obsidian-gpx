import { requestUrl } from "obsidian";
import { GpxPoint, downsample } from "./gpx";

export interface AppleCredentials {
	teamId: string;
	keyId: string;
	privateKey: string; // contents of the .p8 file from Apple Developer
}

export function hasAppleCredentials(c: AppleCredentials): boolean {
	return !!(c.teamId.trim() && c.keyId.trim() && c.privateKey.trim());
}

export interface AppleSnapshotOptions {
	width: number; // points, max 640
	height: number; // points, max 640
	dark: boolean;
}

/**
 * Fetch a PNG from Apple's Maps Web Snapshots API. The request is signed
 * locally with the user's MapKit private key (ES256), so no token server
 * is needed. See https://developer.apple.com/documentation/snapshots
 */
export async function renderAppleSnapshot(
	points: GpxPoint[],
	opts: AppleSnapshotOptions,
	creds: AppleCredentials
): Promise<ArrayBuffer> {
	// Snapshot URLs are limited to ~8k characters, so thin the track.
	const track = downsample(points, 140).map(
		(p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`
	);

	const overlays = [
		{
			points: track,
			strokeColor: opts.dark ? "0A84FF" : "007AFF",
			lineWidth: 3,
		},
	];
	const annotations = [
		{ point: track[0], color: "30D158", markerStyle: "dot" },
		{ point: track[track.length - 1], color: "FF453A", markerStyle: "dot" },
	];

	const params = new URLSearchParams({
		center: "auto",
		size: `${opts.width}x${opts.height}`,
		scale: "2",
		colorScheme: opts.dark ? "dark" : "light",
		overlays: JSON.stringify(overlays),
		annotations: JSON.stringify(annotations),
		teamId: creds.teamId.trim(),
		keyId: creds.keyId.trim(),
	});

	const path = `/api/v1/snapshot?${params.toString()}`;
	const signature = await signES256(path, creds.privateKey);
	const url = `https://snapshot.apple-mapkit.com${path}&signature=${signature}`;

	const res = await requestUrl({ url, throw: false });
	const type = res.headers["content-type"] ?? res.headers["Content-Type"] ?? "";
	if (res.status !== 200 || !type.startsWith("image/")) {
		throw new Error(
			`Apple snapshot request failed (${res.status}): ${res.text?.slice(0, 200) || "no details"}`
		);
	}
	return res.arrayBuffer;
}

async function signES256(data: string, privateKeyPem: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"pkcs8",
		pemToDer(privateKeyPem),
		{ name: "ECDSA", namedCurve: "P-256" },
		false,
		["sign"]
	);
	const signature = await crypto.subtle.sign(
		{ name: "ECDSA", hash: { name: "SHA-256" } },
		key,
		new TextEncoder().encode(data)
	);
	return base64url(new Uint8Array(signature));
}

function pemToDer(pem: string): ArrayBuffer {
	const base64 = pem
		.replace(/-----BEGIN [A-Z ]+-----/g, "")
		.replace(/-----END [A-Z ]+-----/g, "")
		.replace(/\s+/g, "");
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes.buffer;
}

function base64url(bytes: Uint8Array): string {
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
