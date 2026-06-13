import { spawn } from "child_process";
import { createGzip } from "zlib";
import { objectStorageClient } from "./objectStorage";

const PG_DUMP_PATH = "/nix/store/bgwr5i8jf8jpg75rr53rz3fqv5k8yrwp-postgresql-16.10/bin/pg_dump";

function getBackupBucket(): string {
  const privateDir = process.env.PRIVATE_OBJECT_DIR || "";
  const bucketName = privateDir.replace(/^\//, "").split("/")[0];
  if (!bucketName) throw new Error("Cannot determine GCS bucket name from PRIVATE_OBJECT_DIR");
  return bucketName;
}

export async function runDatabaseBackup(): Promise<{ filename: string; bucket: string; sizeMb: string }> {
  const bucketName = getBackupBucket();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL not set");

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `db-backups/spectio-${stamp}.sql.gz`;

  const bucket = objectStorageClient.bucket(bucketName);
  const file = bucket.file(filename);

  await new Promise<void>((resolve, reject) => {
    const dump = spawn(PG_DUMP_PATH, ["--no-password", "--format=plain", dbUrl], {
      env: { ...process.env },
    });

    const gzip = createGzip({ level: 6 });
    const gcsStream = file.createWriteStream({ resumable: false, contentType: "application/gzip" });

    dump.stdout.pipe(gzip).pipe(gcsStream);

    let stderrBuf = "";
    dump.stderr.on("data", (d: Buffer) => { stderrBuf += d.toString(); });

    dump.on("error", reject);
    gzip.on("error", reject);
    gcsStream.on("error", reject);
    gcsStream.on("finish", () => {
      dump.on("close", (code) => {
        if (code !== 0) reject(new Error(`pg_dump exited ${code}: ${stderrBuf}`));
        else resolve();
      });
    });

    dump.on("close", (code) => {
      if (code !== 0) reject(new Error(`pg_dump exited ${code}: ${stderrBuf}`));
    });
  });

  const [metadata] = await file.getMetadata();
  const bytes = Number(metadata.size ?? 0);
  const sizeMb = (bytes / 1024 / 1024).toFixed(2);

  return { filename, bucket: bucketName, sizeMb };
}

export async function listDatabaseBackups(): Promise<Array<{ filename: string; sizeMb: string; created: string }>> {
  const bucketName = getBackupBucket();
  const bucket = objectStorageClient.bucket(bucketName);
  const [files] = await bucket.getFiles({ prefix: "db-backups/" });

  return files
    .map((f) => ({
      filename: f.name,
      sizeMb: (Number(f.metadata.size ?? 0) / 1024 / 1024).toFixed(2),
      created: String(f.metadata.timeCreated ?? ""),
    }))
    .sort((a, b) => b.created.localeCompare(a.created));
}
