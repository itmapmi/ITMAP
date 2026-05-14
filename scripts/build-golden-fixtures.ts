/**
 * One-shot generator for the golden datasheet PDF fixtures used by
 * scripts/test-datasheet-extraction.ts.
 *
 * Writes three minimal but realistic vendor datasheet PDFs and a manifest with
 * expected-spec assertions. The PDFs are not from real vendors — they contain
 * synthetic but well-formed spec text that exercises the OpenAI extractor and
 * the review-queue confidence path.
 *
 * Usage: tsx scripts/build-golden-fixtures.ts
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

interface Page { title: string; lines: string[]; }

async function buildPdf(pages: Page[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const p of pages) {
    const page = doc.addPage([612, 792]);
    page.drawText(p.title, { x: 50, y: 740, size: 18, font: bold });
    let y = 700;
    for (const line of p.lines) {
      page.drawText(line, { x: 50, y, size: 11, font });
      y -= 18;
      if (y < 60) break;
    }
  }
  return await doc.save();
}

async function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const dir = path.resolve(__dirname, "..", "fixtures", "datasheets");
  await fs.mkdir(dir, { recursive: true });

  // ── Fixture 1: clear-cut spec table (high-confidence extraction) ────────
  const acmePdf = await buildPdf([
    {
      title: "Acme Switch X100 — Datasheet",
      lines: [
        "Model: X100",
        "Form factor: 1U rack-mount",
        "Performance",
        "  Throughput: 10 Gbps",
        "  Latency: 800 ns",
        "  Forwarding rate: 14.88 Mpps",
        "Power",
        "  Typical power: 95 W",
        "  Max power: 130 W",
        "Physical",
        "  Weight: 6.2 kg",
        "  Operating temperature: 0 to 45 C",
      ],
    },
  ]);
  await fs.writeFile(path.join(dir, "acme-switch-x100.pdf"), acmePdf);

  // ── Fixture 2: storage array, mixed numeric+text ─────────────────────────
  const nimbusPdf = await buildPdf([
    {
      title: "Nimbus Array NX-9000 — Product Datasheet",
      lines: [
        "All-flash storage array",
        "Capacity",
        "  Maximum raw capacity: 1024 TB",
        "  Effective capacity (with 4:1 reduction): 4096 TB",
        "Performance",
        "  Read IOPS: 2,500,000",
        "  Write latency: 120 us",
        "Connectivity",
        "  Host ports: 32 x 32 Gb FC",
        "  Replication: synchronous and async",
      ],
    },
  ]);
  await fs.writeFile(path.join(dir, "nimbus-nx9000.pdf"), nimbusPdf);

  // ── Fixture 3: low-confidence edge case (vague language) ─────────────────
  const obscurePdf = await buildPdf([
    {
      title: "Obscure Networks ON-7 Switch",
      lines: [
        "Designed for the modern data center.",
        "Delivers excellent performance across workloads.",
        "Power consumption is industry-leading.",
        "Throughput varies by configuration; consult sales.",
        "Weight is consistent with comparable 1U devices.",
      ],
    },
  ]);
  await fs.writeFile(path.join(dir, "obscure-on7.pdf"), obscurePdf);

  // ── Manifest ─────────────────────────────────────────────────────────────
  const manifest = [
    {
      name: "acme-switch-x100",
      pdf: "acme-switch-x100.pdf",
      marketSchema: {
        groups: [
          { key: "performance", label: "Performance", attributes: [
            { key: "throughput", label: "Throughput", type: "number", unit: "Gbps", higherIsBetter: true },
            { key: "latency", label: "Latency", type: "number", unit: "ns", higherIsBetter: false },
          ]},
          { key: "power", label: "Power", attributes: [
            { key: "max_power", label: "Max power", type: "number", unit: "W", higherIsBetter: false },
          ]},
        ],
      },
      expected: {
        minSpecs: 3,
        specs: [
          { categoryKey: "performance", attributeKey: "throughput", rawValueIncludes: "10" },
          { categoryKey: "performance", attributeKey: "latency", rawValueIncludes: "800" },
          { categoryKey: "power", attributeKey: "max_power", rawValueIncludes: "130" },
        ],
      },
    },
    {
      name: "nimbus-nx9000",
      pdf: "nimbus-nx9000.pdf",
      marketSchema: {
        groups: [
          { key: "capacity", label: "Capacity", attributes: [
            { key: "max_raw", label: "Max raw capacity", type: "number", unit: "TB", higherIsBetter: true },
          ]},
          { key: "performance", label: "Performance", attributes: [
            { key: "read_iops", label: "Read IOPS", type: "number", higherIsBetter: true },
          ]},
        ],
      },
      expected: {
        minSpecs: 2,
        specs: [
          { categoryKey: "capacity", attributeKey: "max_raw", rawValueIncludes: "1024" },
          { categoryKey: "performance", attributeKey: "read_iops", rawValueIncludes: "2" },
        ],
      },
    },
    // Edge-case: extraction should NOT confidently produce numeric values
    // here. We assert only that the harness still runs end-to-end and that the
    // extractor returns the row (even if value is null / low confidence). This
    // guards against regressions where the model hallucinates concrete numbers
    // from vague marketing copy.
    {
      name: "obscure-on7-edge",
      pdf: "obscure-on7.pdf",
      marketSchema: {
        groups: [
          { key: "performance", label: "Performance", attributes: [
            { key: "throughput", label: "Throughput", type: "number", unit: "Gbps", higherIsBetter: true },
          ]},
        ],
      },
      expected: { minSpecs: 0 },
    },
  ];
  await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`[fixtures] wrote 3 PDFs + manifest to ${dir}`);
}

main().catch(err => { console.error(err); process.exit(1); });
