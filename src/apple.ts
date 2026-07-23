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
	const key = await importPrivateKey(privateKeyPem);
	const signature = await crypto.subtle.sign(
		{ name: "ECDSA", hash: { name: "SHA-256" } },
		key,
		new TextEncoder().encode(data)
	);
	return base64url(new Uint8Array(signature));
}

const EC_PARAMS = { name: "ECDSA", namedCurve: "P-256" } as const;

async function importPrivateKey(pem: string): Promise<CryptoKey> {
	const der = new Uint8Array(pemToDer(pem));
	try {
		return await crypto.subtle.importKey("pkcs8", der, EC_PARAMS, false, ["sign"]);
	} catch (e) {
		// WebKit (Obsidian mobile) rejects Apple's PKCS#8 layout — the inner
		// ECPrivateKey embeds the optional public key — with a DataError.
		// Extract the raw key material and import it as a JWK instead.
		const jwk = pkcs8ToJwk(der);
		if (!jwk) throw e;
		return await crypto.subtle.importKey("jwk", jwk, EC_PARAMS, false, ["sign"]);
	}
}

/**
 * Pull the P-256 private scalar and public point out of an Apple .p8 key.
 * In Apple's DER layout the 32-byte scalar always follows the ECPrivateKey
 * version marker `02 01 01 04 20`, and the 64-byte uncompressed public point
 * follows the context-1 BIT STRING header `a1 44 03 42 00 04`.
 */
function pkcs8ToJwk(der: Uint8Array): JsonWebKey | null {
	const d = bytesAfter(der, [0x02, 0x01, 0x01, 0x04, 0x20], 32);
	const pub = bytesAfter(der, [0xa1, 0x44, 0x03, 0x42, 0x00, 0x04], 64);
	if (!d || !pub) return null;
	return {
		kty: "EC",
		crv: "P-256",
		d: base64url(d),
		x: base64url(pub.slice(0, 32)),
		y: base64url(pub.slice(32)),
	};
}

function bytesAfter(
	haystack: Uint8Array,
	pattern: number[],
	length: number
): Uint8Array | null {
	outer: for (let i = 0; i <= haystack.length - pattern.length - length; i++) {
		for (let j = 0; j < pattern.length; j++) {
			if (haystack[i + j] !== pattern[j]) continue outer;
		}
		const start = i + pattern.length;
		return haystack.slice(start, start + length);
	}
	return null;
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
