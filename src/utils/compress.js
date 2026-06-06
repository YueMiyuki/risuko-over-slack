import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGzip, gzip } from "node:zlib";
import { stat, unlink } from "node:fs/promises";

export async function compressAndPickSmallest(sourcePath) {
	const gzipPath = `${sourcePath}.gz`;

	await pipeline(
		createReadStream(sourcePath),
		createGzip({ level: 0 }),
		createWriteStream(gzipPath),
	);

	const originalSize = (await stat(sourcePath)).size;
	const gzipSize = (await stat(gzipPath)).size;

	if (gzipSize < originalSize) {
		await unlink(sourcePath);
		return gzipPath;
	}

	await unlink(gzipPath);
	return sourcePath;
}
