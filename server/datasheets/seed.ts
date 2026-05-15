import {
  listDatasheetMarkets, createDatasheetMarket,
  listDatasheetVendors, createDatasheetVendor,
  listProductsByMarket, createProduct,
} from "../storage/datasheets";
import type { DatasheetSchemaDefinition } from "@shared/schema";

const STORAGE_ARRAYS_SCHEMA: DatasheetSchemaDefinition = {
  groups: [
    { key: "performance", label: "Performance", attributes: [
      { key: "max_iops", label: "Max IOPS", type: "number", unit: "IOPS", higherIsBetter: true },
      { key: "throughput", label: "Sequential throughput", type: "number", unit: "GB/s", higherIsBetter: true },
      { key: "latency_p95", label: "Latency (p95)", type: "number", unit: "ms", higherIsBetter: false },
    ]},
    { key: "capacity", label: "Capacity & Density", attributes: [
      { key: "max_raw_capacity", label: "Max raw capacity", type: "number", unit: "TB", higherIsBetter: true },
      { key: "max_drives", label: "Max drives", type: "number", higherIsBetter: true },
      { key: "rack_units", label: "Rack units", type: "number", unit: "U", higherIsBetter: false },
    ]},
    { key: "connectivity", label: "Connectivity", attributes: [
      { key: "front_end_ports", label: "Front-end host ports", type: "number", higherIsBetter: true },
      { key: "max_bandwidth", label: "Max host bandwidth", type: "number", unit: "Gbps", higherIsBetter: true },
      { key: "protocols", label: "Protocols", type: "text" },
    ]},
    { key: "data_services", label: "Data Services", attributes: [
      { key: "dedupe", label: "Deduplication", type: "boolean" },
      { key: "compression", label: "Compression", type: "boolean" },
      { key: "snapshots", label: "Snapshots", type: "boolean" },
      { key: "replication", label: "Replication", type: "boolean" },
    ]},
    { key: "power", label: "Power & Environment", attributes: [
      { key: "max_power", label: "Max power draw", type: "number", unit: "W", higherIsBetter: false },
      { key: "operating_temp_max", label: "Max operating temp", type: "number", unit: "°C" },
    ]},
  ],
};

export async function seedDatasheets(): Promise<void> {
  // Only seed on a brand-new install. Once the admin has any datasheet market
  // (including ones they created themselves), never re-create the demo content
  // — even if they deleted the original seed market on purpose.
  const existing = await listDatasheetMarkets();
  if (existing.length > 0) {
    console.log("[Datasheet seed] Datasheet markets already exist — skipping seed.");
    return;
  }
  const market = await createDatasheetMarket({
    name: "Enterprise Storage Arrays",
    slug: "enterprise-storage-arrays",
    category: "Storage",
    description: "Side-by-side datasheet comparison for primary all-flash and hybrid enterprise storage arrays.",
    schemaDefinition: STORAGE_ARRAYS_SCHEMA,
    isVisible: true,
  });
  console.log(`[Datasheet seed] Created market ${market.slug}`);

  const vendorsExisting = await listDatasheetVendors();
  const upsertVendor = async (name: string, slug: string, website: string) => {
    const found = vendorsExisting.find(v => v.slug === slug);
    if (found) return found;
    return await createDatasheetVendor({ name, slug, website });
  };
  const dell = await upsertVendor("Dell Technologies", "dell", "https://www.dell.com");
  const netapp = await upsertVendor("NetApp", "netapp", "https://www.netapp.com");
  const pure = await upsertVendor("Pure Storage", "pure-storage", "https://www.purestorage.com");

  const existingProducts = await listProductsByMarket(market.id);
  const upsertProduct = async (vendorId: string, name: string, slug: string) => {
    if (existingProducts.some(p => p.slug === slug)) return;
    await createProduct({ marketId: market.id, vendorId, name, slug, subCategory: "All-flash" });
  };
  await upsertProduct(dell.id, "PowerStore 5200T", "powerstore-5200t");
  await upsertProduct(netapp.id, "AFF A800", "aff-a800");
  await upsertProduct(pure.id, "FlashArray //X90R3", "flasharray-x90r3");
  console.log("[Datasheet seed] Seeded 3 products.");
}
