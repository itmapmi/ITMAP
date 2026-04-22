-- Seed script: Vendor Newsroom URLs
-- Purpose: Pre-populate newsroom_url for all vendors so the news scraping pipeline works.
-- URLs point to vendor newsroom / press-release / blog listing pages (not homepages).
-- Run once against the target database: psql $DATABASE_URL -f scripts/seed-newsroom-urls.sql

UPDATE vendors SET newsroom_url = CASE id

  -- =========================================================
  -- ITMAP for Public Cloud Object Storage providers
  -- =========================================================
  WHEN '4c442739-82dd-460d-9ec8-eaf8a0009ef5' THEN 'https://aws.amazon.com/about-aws/whats-new/storage/'
  WHEN '5421030b-e05e-4878-97f1-29aaa81e644e' THEN 'https://www.alibabacloud.com/blog'
  WHEN 'f711dbec-d486-4fc0-8b33-8b324c87c1c9' THEN 'https://www.backblaze.com/blog/'
  WHEN '25808dd8-e430-4600-b0dc-2a7f143e5573' THEN 'https://www.digitalocean.com/blog/'
  WHEN '3c1e8e61-e0b7-4b3e-b5e4-c35fc85c32a9' THEN 'https://cloud.google.com/blog/products/storage-data-transfer'
  WHEN '31d171a2-c1b7-4853-90ef-11bff2b9211c' THEN 'https://www.ibm.com/blog/category/cloud/'
  WHEN '4c9e97b8-440d-44c4-aeaf-94281347e4f7' THEN 'https://azure.microsoft.com/en-us/blog/'
  WHEN '6f13908c-84d2-4133-b84a-0b1c7f7cdd74' THEN 'https://blog.ovhcloud.com/'
  WHEN '43387ce2-5f8c-499c-9b96-048fafb3c8f2' THEN 'https://blogs.oracle.com/cloud-infrastructure/'
  WHEN 'bc512319-38ea-4619-9a28-78a8f02548f2' THEN 'https://www.tencentcloud.com/news'
  WHEN '52a55fa6-7cb1-4fc9-88d8-4e2118816041' THEN 'https://www.vultr.com/news/'
  WHEN '8e74741b-7b5c-446d-a0d8-0c483f9015bb' THEN 'https://wasabi.com/blog/'

  -- =========================================================
  -- ITMAP for Backup & Recovery of SaaS Applications
  -- =========================================================
  WHEN '0734fb9e-1430-4d6d-aac8-37358f4e9f38' THEN 'https://www.avepoint.com/blog/'
  WHEN 'a82101c7-5814-4b6b-af59-86101e006493' THEN 'https://www.datto.com/blog/'
  WHEN '8cbe27fd-25c5-45bd-8c11-1b55840a5fb9' THEN 'https://cloudally.com/blog/'
  WHEN 'lF-DTgRLd3JjMlvWLdSfB'               THEN 'https://www.commvault.com/blogs'
  WHEN 'rO8o2umtcqS9eNwSR5xLQ'               THEN 'https://www.druva.com/blog/'
  WHEN 'MT7kGMZwftj6TcLmNIEC3'               THEN 'https://www.hycu.com/blog'
  WHEN '2b04ae5b-45af-4e66-b774-a3a5f6372a05' THEN 'https://www.keepit.com/blog/'
  WHEN 'vL2LztVHf_5UU-sxSwGxM'               THEN 'https://www.veeam.com/blog/'

  -- =========================================================
  -- ITMAP for Backup and Recovery Solutions
  -- =========================================================
  WHEN '73e0e6ba-7517-4a20-b286-9bc9d2be2fab' THEN 'https://www.cohesity.com/blogs/'
  WHEN '77d87492-7c54-40af-be16-d274c19269a2' THEN 'https://www.commvault.com/blogs'
  WHEN '7bdbfe8a-6bba-4010-9c94-1f695387e14a' THEN 'https://www.dell.com/en-us/blog/'
  WHEN '898d070b-eab4-4dea-857f-2f4fea163222' THEN 'https://www.druva.com/blog/'
  WHEN '3d68054e-b5e8-4fc6-aae1-006398813baa' THEN 'https://www.hycu.com/blog'
  WHEN 'cf8bd2a5-7be6-4f22-978e-c1c2544c60ef' THEN 'https://e.huawei.com/en/news/'
  WHEN 'dbb7630e-89d7-4179-bc4e-b7f2ef9d613e' THEN 'https://www.ibm.com/blog/'
  WHEN '26b00880-fe7b-4382-8ce6-df04ee42989a' THEN 'https://www.rubrik.com/blog/'
  WHEN 'e2d23e8c-ef9c-42a6-b2c6-981b0ebb050e' THEN 'https://www.veeam.com/blog/'

  -- =========================================================
  -- ITMAP for Backup and Recovery Solutions for Mid-market enterprises
  -- =========================================================
  WHEN 'YAkffBq7d3u5eFIXB75wd' THEN 'https://www.arcserve.com/blog'
  WHEN 'qK8YulbgeXRU5ZuCS4xBD' THEN 'https://www.druva.com/blog/'
  WHEN 'ulwCfze5Gu0w5SGTrfSwU' THEN 'https://www.hycu.com/blog'
  WHEN 'tUKTQbNN2EYtwjdlBsf7Y' THEN 'https://www.nakivo.com/blog/'
  WHEN 'FU3zIlxEhkOl_Z75lfxFH' THEN 'https://storware.eu/blog/'
  WHEN 's11ZzmSCMT06AEr2_Eipj' THEN 'https://www.unitrends.com/blog/'
  WHEN 'X4mSjDJMvcOEmOz6IDM2M' THEN 'https://www.veeam.com/blog/'

  -- =========================================================
  -- ITMAP for High-End General Purpose Storage Arrays
  -- =========================================================
  WHEN 'e4fec3a0-f072-4f1e-9633-311eba96d448' THEN 'https://www.dell.com/en-us/blog/'
  WHEN '90de3409-f582-4c35-81fa-72dafc38fb7b' THEN 'https://www.hpe.com/us/en/newsroom.html'
  WHEN '32ab28fd-f012-4a9b-a430-f470d702864d' THEN 'https://www.hitachivantara.com/en-us/newsroom.html'
  WHEN 'b9e4219f-2b57-47ab-88b7-8393a1f282aa' THEN 'https://e.huawei.com/en/news/'
  WHEN 'b2c3d9af-8b1b-48ba-966b-18617fece318' THEN 'https://www.ibm.com/blog/'
  WHEN '91ddbc40-cfc4-47ef-a9dc-8a1673d28e45' THEN 'https://news.lenovo.com/'
  WHEN '8c99fe0b-734b-4c01-abb8-37ea938328cc' THEN 'https://www.netapp.com/blog/'
  WHEN '952cf2e9-ce55-4436-a1a7-4c330c582230' THEN 'https://blog.purestorage.com/'

  ELSE newsroom_url
END
WHERE id IN (
  '4c442739-82dd-460d-9ec8-eaf8a0009ef5',
  '5421030b-e05e-4878-97f1-29aaa81e644e',
  'f711dbec-d486-4fc0-8b33-8b324c87c1c9',
  '25808dd8-e430-4600-b0dc-2a7f143e5573',
  '3c1e8e61-e0b7-4b3e-b5e4-c35fc85c32a9',
  '31d171a2-c1b7-4853-90ef-11bff2b9211c',
  '4c9e97b8-440d-44c4-aeaf-94281347e4f7',
  '6f13908c-84d2-4133-b84a-0b1c7f7cdd74',
  '43387ce2-5f8c-499c-9b96-048fafb3c8f2',
  'bc512319-38ea-4619-9a28-78a8f02548f2',
  '52a55fa6-7cb1-4fc9-88d8-4e2118816041',
  '8e74741b-7b5c-446d-a0d8-0c483f9015bb',
  '0734fb9e-1430-4d6d-aac8-37358f4e9f38',
  'a82101c7-5814-4b6b-af59-86101e006493',
  '8cbe27fd-25c5-45bd-8c11-1b55840a5fb9',
  'lF-DTgRLd3JjMlvWLdSfB',
  'rO8o2umtcqS9eNwSR5xLQ',
  'MT7kGMZwftj6TcLmNIEC3',
  '2b04ae5b-45af-4e66-b774-a3a5f6372a05',
  'vL2LztVHf_5UU-sxSwGxM',
  '73e0e6ba-7517-4a20-b286-9bc9d2be2fab',
  '77d87492-7c54-40af-be16-d274c19269a2',
  '7bdbfe8a-6bba-4010-9c94-1f695387e14a',
  '898d070b-eab4-4dea-857f-2f4fea163222',
  '3d68054e-b5e8-4fc6-aae1-006398813baa',
  'cf8bd2a5-7be6-4f22-978e-c1c2544c60ef',
  'dbb7630e-89d7-4179-bc4e-b7f2ef9d613e',
  '26b00880-fe7b-4382-8ce6-df04ee42989a',
  'e2d23e8c-ef9c-42a6-b2c6-981b0ebb050e',
  'YAkffBq7d3u5eFIXB75wd',
  'qK8YulbgeXRU5ZuCS4xBD',
  'ulwCfze5Gu0w5SGTrfSwU',
  'tUKTQbNN2EYtwjdlBsf7Y',
  'FU3zIlxEhkOl_Z75lfxFH',
  's11ZzmSCMT06AEr2_Eipj',
  'X4mSjDJMvcOEmOz6IDM2M',
  'e4fec3a0-f072-4f1e-9633-311eba96d448',
  '90de3409-f582-4c35-81fa-72dafc38fb7b',
  '32ab28fd-f012-4a9b-a430-f470d702864d',
  'b9e4219f-2b57-47ab-88b7-8393a1f282aa',
  'b2c3d9af-8b1b-48ba-966b-18617fece318',
  '91ddbc40-cfc4-47ef-a9dc-8a1673d28e45',
  '8c99fe0b-734b-4c01-abb8-37ea938328cc',
  '952cf2e9-ce55-4436-a1a7-4c330c582230'
);
