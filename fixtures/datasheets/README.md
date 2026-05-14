# Golden datasheet regression fixtures

Drop sample PDFs in this folder and register them in `manifest.json`.

Each entry has the shape:

```json
{
  "name": "acme-switch-x100",
  "pdf": "acme-switch-x100.pdf",
  "marketSchema": { "groups": [
    { "key": "perf", "label": "Performance", "attributes": [
      { "key": "throughput", "label": "Throughput", "type": "number", "unit": "Gbps" }
    ]}
  ]},
  "expected": {
    "minSpecs": 4,
    "specs": [
      { "categoryKey": "perf", "attributeKey": "throughput",
        "rawValueIncludes": "10 Gbps", "normalizedMin": 9, "normalizedMax": 11, "unit": "Gbps" }
    ]
  }
}
```

Run the harness from project root:

```bash
tsx scripts/test-datasheet-extraction.ts
```

Hits the same OpenAI extractor used in production, so requires
`AI_INTEGRATIONS_OPENAI_API_KEY` to be set. Exits non-zero on any failure.
