import { afterEach, describe, expect, it } from "vitest";
import { ObjectStorageService } from "./objectStorage";

const originalReportsBucketId = process.env.REPORTS_OBJECT_STORAGE_BUCKET_ID;
const originalPrivateObjectDir = process.env.PRIVATE_OBJECT_DIR;

afterEach(() => {
  if (originalReportsBucketId === undefined) {
    delete process.env.REPORTS_OBJECT_STORAGE_BUCKET_ID;
  } else {
    process.env.REPORTS_OBJECT_STORAGE_BUCKET_ID = originalReportsBucketId;
  }

  if (originalPrivateObjectDir === undefined) {
    delete process.env.PRIVATE_OBJECT_DIR;
  } else {
    process.env.PRIVATE_OBJECT_DIR = originalPrivateObjectDir;
  }
});

describe("ObjectStorageService", () => {
  it("uses the dedicated reports bucket instead of a legacy private directory", () => {
    process.env.REPORTS_OBJECT_STORAGE_BUCKET_ID = "reports-bucket";
    process.env.PRIVATE_OBJECT_DIR = "/legacy-bucket/.private";

    expect(new ObjectStorageService().getPrivateObjectDir()).toBe(
      "/reports-bucket",
    );
  });

  it("uses the legacy private directory until a reports bucket is configured", () => {
    delete process.env.REPORTS_OBJECT_STORAGE_BUCKET_ID;
    process.env.PRIVATE_OBJECT_DIR = "/legacy-bucket/.private";

    expect(new ObjectStorageService().getPrivateObjectDir()).toBe(
      "/legacy-bucket/.private",
    );
  });
});