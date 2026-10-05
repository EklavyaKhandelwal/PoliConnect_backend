import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const storageRoot = process.env.FILE_STORAGE_DIR || join(process.cwd(), "storage");
const publicBaseUrl = process.env.FILE_BASE_URL || "http://localhost:5001/uploads";

export async function uploadFile(
  buffer: Buffer,
  path: string,
  _contentType: string,
): Promise<string> {
  const safePath = path.replaceAll("\\", "/").replace(/^\/+/, "");
  const destination = join(storageRoot, safePath);

  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, buffer);

  return `${publicBaseUrl.replace(/\/+$/, "")}/${safePath}`;
}

export async function deleteFile(path: string): Promise<void> {
  const safePath = path.replaceAll("\\", "/").replace(/^\/+/, "");
  await unlink(join(storageRoot, safePath));
}
