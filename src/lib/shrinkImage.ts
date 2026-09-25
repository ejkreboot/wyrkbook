/**
 * Re-encodes a photo in the browser before it is uploaded.
 *
 * Two ceilings make this necessary rather than nice: Vercel refuses a request
 * body over 4.5 MB at the edge, and the Anthropic API refuses any image over
 * 5 MB — a single modern phone photo can break either. Claude reads at most
 * 2576 px on the long edge, so shrinking to around 2000 px costs a textbook
 * page nothing it would have used.
 *
 * Decoding goes through an <img>, not createImageBitmap, because that is the
 * path on which Safari reads HEIC — so an iPhone photo AirDropped to a Mac
 * works there. Chrome and Firefox cannot decode HEIC at all; those files fail
 * here with a message that says so, instead of failing on the server.
 */

export type ShrinkOptions = {
	/** Longest edge in pixels. */
	maxEdge?: number;
	/** JPEG quality, 0–1. */
	quality?: number;
	/** Keep stepping the size down until the file fits. */
	maxBytes?: number;
};

export async function shrinkImage(
	file: File,
	{ maxEdge = 2000, quality = 0.82, maxBytes = Infinity }: ShrinkOptions = {}
): Promise<File> {
	const img = await decode(file);
	const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';

	let edge = Math.min(maxEdge, Math.max(img.naturalWidth, img.naturalHeight));
	for (;;) {
		const blob = await encode(img, edge, quality);
		if (blob.size <= maxBytes || edge <= 1000) return new File([blob], name, { type: 'image/jpeg' });
		edge = Math.round(edge * 0.85);
	}
}

async function decode(file: File): Promise<HTMLImageElement> {
	const url = URL.createObjectURL(file);
	try {
		const img = new Image();
		img.src = url;
		await img.decode();
		return img;
	} catch {
		const heic = /\.(heic|heif)$/i.test(file.name) || /hei[cf]/i.test(file.type);
		throw new Error(
			heic
				? `${file.name} is a HEIC photo, which this browser can't read. Open the page in Safari, or export the photo as JPEG.`
				: `${file.name || 'That file'} isn't an image this browser can read.`
		);
	} finally {
		// The decoded pixels stay with the element; the URL is no longer needed.
		URL.revokeObjectURL(url);
	}
}

async function encode(img: HTMLImageElement, edge: number, quality: number): Promise<Blob> {
	const scale = Math.min(1, edge / Math.max(img.naturalWidth, img.naturalHeight));
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
	canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('This browser could not process the photo.');
	ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
	if (!blob) throw new Error('This browser could not process the photo.');
	return blob;
}

/** Leaves room under Vercel's 4.5 MB body for the other fields and multipart framing. */
export const UPLOAD_BUDGET = 4_000_000;
