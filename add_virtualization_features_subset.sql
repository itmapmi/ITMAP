-- SQL Script to Add Virtualization Platform Features
-- Market: ITMAP for Virtualization Platforms
-- Total Features: 46 across 8 categories

-- Storage Capabilities (8 features)
INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Multi-Storage Support',
  'Compatibility with various storage backends and protocols (SAN, NAS, DAS, NVMe) so VMs can reside on FC, iSCSI, NFS, or local disks as needed',
  fc.id,
  1
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Storage Capabilities';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Software-Defined Storage (SDS)',
  'Built-in distributed storage or integration with software-defined storage solutions that pools local or network drives into a unified datastore for the virtualization cluster.',
  fc.id,
  2
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Storage Capabilities';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Virtual Disk Features (Thin Provisioning, Dedup)',
  'Advanced virtual disk options like thin provisioning (allocate storage on demand), deduplication, and compression to optimize storage utilization and efficiency.',
  fc.id,
  3
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Storage Capabilities';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Snapshots and Clones',
  'Ability to take point-in-time snapshots of VM disks and create clones (full or linked) of VMs quickly, aiding backups, patch testing, and rapid provisioning with minimal performance impact.',
  fc.id,
  4
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Storage Capabilities';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Storage Live Migration',
  'Ability to migrate a VM''s virtual disks from one storage array or datastore to another while the VM is running, enabling storage maintenance or load balancing with no downtime',
  fc.id,
  5
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Storage Capabilities';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Multipathing & Storage Failover',
  'Support for multiple I/O paths to storage and automatic failover if a path or storage controller fails, ensuring continuous VM access to storage resources.',
  fc.id,
  6
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Storage Capabilities';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Storage Quality of Service',
  'Controls to limit or prioritize storage I/O (IOPS, throughput) per VM or per volume, preventing noisy-neighbor issues and guaranteeing performance for high-priority workloads.',
  fc.id,
  7
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Storage Capabilities';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Container Storage Integration',
  'Integration with container orchestrator storage interfaces (CSI), allowing containerized applications to provision and use persistent volumes from the virtualization platform''s storage.',
  fc.id,
  8
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Storage Capabilities';

-- Networking Capabilities (7 features)
INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Virtual Network Switching',
  'Built-in virtual switches on each host to connect VMs, supporting VLAN tagging and basic network segmentation for traffic isolation within the virtual environment.',
  fc.id,
  1
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Networking Capabilities';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Distributed Network Management',
  'Centralized virtual networking configuration (e.g., distributed switches) that spans multiple hosts, ensuring consistent network policies (port groups, VLANs, NIC teaming) across the cluster.',
  fc.id,
  2
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Networking Capabilities';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Network Overlays & SDN',
  'Support for overlay networks (VXLAN/GENEVE) and software-defined networking integration to enable multi-tenant network segmentation and advanced network virtualization (e.g., via SDN controllers).',
  fc.id,
  3
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Networking Capabilities';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Network Isolation & Firewall',
  'Built-in virtual firewalls or microsegmentation to enforce isolation between VMs/networks, providing granular security controls at the hypervisor layer (integration with platforms like NSX for advanced network security)',
  fc.id,
  4
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Networking Capabilities';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'High Performance Networking',
  'Support for technologies like SR-IOV for direct device access, jumbo frames, and network offload engines (checksum offload, TSO, etc.), enabling low-latency and high throughput networking for VM workloads.',
  fc.id,
  5
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Networking Capabilities';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Network Quality of Service',
  'Traffic shaping and bandwidth allocation features to control network throughput per VM or per virtual network, ensuring critical applications have guaranteed bandwidth and limiting noisy neighbors.',
  fc.id,
  6
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Networking Capabilities';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Container Networking Integration',
  'Compatibility with container networking (CNI) plugins and ability to bridge container networks with the virtual network, allowing containers to communicate over the same software-defined networks as VMs.',
  fc.id,
  7
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Networking Capabilities';

-- Security & Isolation (6 features)
INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Hypervisor Hardening & Integrity',
  'A secure hypervisor design with minimal attack surface (often a hardened, bare-metal architecture) and features like secure boot for the hypervisor to ensure the virtualization layer itself is protected',
  fc.id,
  1
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Security & Isolation';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'VM Isolation Enforcement',
  'Strong isolation between VMs so that escape or interference is prevented; may include use of mandatory access controls (e.g., SELinux/sVirt in Linux hypervisors) to sandbox VMs for enhanced security',
  fc.id,
  2
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Security & Isolation';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Secure Boot & UEFI for VMs',
  'Support for UEFI Secure Boot in virtual machines, ensuring that only signed, trusted OS bootloaders and drivers run in VMs to prevent malware at startup.',
  fc.id,
  3
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Security & Isolation';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'VM Disk & Memory Encryption',
  'Ability to encrypt virtual machine disks (and even VM memory) so that data is protected both at-rest and in-use, using encryption keys that are securely managed (e.g., via an external KMS).',
  fc.id,
  4
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Security & Isolation';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Virtual TPM Support',
  'Provision of a virtual Trusted Platform Module to VMs, allowing guest OS to use TPM-dependent security features (like BitLocker, Measured Boot) in a virtualized environment.',
  fc.id,
  5
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Security & Isolation';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Audit Logging & Compliance',
  'Comprehensive logging of administrative actions and security events, plus compliance certifications (e.g., Common Criteria) and integration with enterprise identity management (AD/LDAP) for authenticated, auditable access control.',
  fc.id,
  6
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Security & Isolation';

-- High Availability & Fault Tolerance (5 features)
INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Host Failover (VM HA)',
  'Automatic detection of host failures and restart of affected VMs on surviving hosts in a cluster, providing high availability by minimizing VM downtime in the event of hardware/server outages.',
  fc.id,
  1
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'High Availability & Fault Tolerance';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Fault Tolerance (Zero-Downtime)',
  'Capability to run a shadow instance of a VM on a different host in lockstep with the primary VM, so if the primary host fails the secondary takes over immediately with no service interruption[10].',
  fc.id,
  2
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'High Availability & Fault Tolerance';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Guest Clustering Support',
  'Support for configurations that enhance VM-level availability, such as shared virtual disks and anti-affinity rules to separate clustered VM nodes across hosts, facilitating application-level HA (e.g., SQL Server failover clusters).',
  fc.id,
  3
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'High Availability & Fault Tolerance';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'HA Configuration Controls',
  'Granular settings for HA behavior, like specifying VM restart priorities, dependencies, and guaranteed reserve resources to ensure critical VMs recover first and with sufficient capacity after a failure.',
  fc.id,
  4
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'High Availability & Fault Tolerance';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Stretched Cluster Capability',
  'Ability to span a virtualization cluster across two sites or availability zones with synchronous replication, enabling automatic failover of VMs to a secondary site for continuous availability in site-level disasters.',
  fc.id,
  5
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'High Availability & Fault Tolerance';

-- Lifecycle Management (5 features)
INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Non-Disruptive Patching',
  'Mechanisms to update hypervisor hosts and management software with little to no VM downtime, such as rolling cluster upgrades or live patching of hypervisor kernels.',
  fc.id,
  1
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Lifecycle Management';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Automated Cluster Upgrades',
  'Central tools to orchestrate upgrades across hosts (and even firmware) in a cluster from a single interface, simplifying maintenance (e.g., one-click cluster patching that updates all hosts in sequence)',
  fc.id,
  2
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Lifecycle Management';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Host Provisioning Automation',
  'Capabilities for rapid provisioning of new virtualization hosts (PXE-boot or auto-deploy) and auto-configuration to join existing clusters with predefined settings, reducing manual effort for scaling infrastructure.',
  fc.id,
  3
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Lifecycle Management';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Template & Image Library',
  'Built-in library for VM templates or base images that allows IT to standardize and quickly deploy new VMs (or container images) from pre-approved, pre-configured golden images.',
  fc.id,
  4
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Lifecycle Management';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Configuration Drift Control',
  'Ability to enforce consistent host and VM configurations (through policies or profiles) and detect or remediate drift (config changes) over time to maintain a compliant and stable environment.',
  fc.id,
  5
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Lifecycle Management';

-- Container & Orchestration Support (5 features)
INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Kubernetes Integration',
  'Native support for running Kubernetes clusters or pods on the virtualization platform (e.g., embedding Kubernetes into the control plane) so containerized workloads can be managed alongside VMs',
  fc.id,
  1
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Container & Orchestration Support';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Container Runtime on Hypervisor',
  'Capability to run containers directly on the hypervisor or in lightweight VM constructs, reducing overhead and providing VM-level isolation for container workloads while leveraging the same infrastructure.',
  fc.id,
  2
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Container & Orchestration Support';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Unified Management of VMs & Containers',
  'Single-pane management for both virtual machines and container clusters, allowing administrators to apply consistent policies, security, and monitoring across VMs and containers in a unified way',
  fc.id,
  3
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Container & Orchestration Support';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Container Networking & Storage',
  'Integration that allows containers to use the virtualization platform''s networking (via CNI plugins) and storage (via CSI drivers), ensuring container workloads have access to enterprise-grade networking and persistent storage.',
  fc.id,
  4
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Container & Orchestration Support';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Developer Self-Service Portals',
  'Features enabling developers to provision and manage container resources (like namespaces or clusters) on-demand via self-service interfaces, while IT maintains governance over resource quotas and security',
  fc.id,
  5
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Container & Orchestration Support';

-- Hybrid Cloud Integration (5 features)
INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Unified Hybrid Management',
  'Ability to manage on-premises and public cloud resources under a single management framework, offering unified visibility and operations across a hybrid cloud deployment',
  fc.id,
  1
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Hybrid Cloud Integration';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Workload Portability',
  'Tools for migrating or extending workloads between private datacenter and public cloud environments (e.g., VM format compatibility and migration services), enabling applications to run in the optimal environment and move as needed.',
  fc.id,
  2
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Hybrid Cloud Integration';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Consistent Operations',
  'Ensures a consistent set of capabilities and similar configurations on both on-prem and cloud instances (when using the platform''s hybrid offering) so that applications experience the same performance, security, and management policies in either environment.',
  fc.id,
  3
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Hybrid Cloud Integration';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Cloud Bursting',
  'Supports augmenting on-prem capacity with on-demand cloud resources (cloud bursting) during peak loads, by seamlessly deploying additional workloads to cloud hosts while managing them as part of the same environment.',
  fc.id,
  4
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Hybrid Cloud Integration';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Cloud Service Integration',
  'Integrations with public cloud services such as using cloud-based storage, backup targets, or monitoring services directly from the virtualization platform, and support for container services across hybrid environments, increasing the overall flexibility of deployments.',
  fc.id,
  5
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Hybrid Cloud Integration';

-- Licensing Model (5 features)
INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'License Metric (CPU/VM/etc.)',
  'How the platform''s licensing is measured from a technical standpoint (per CPU socket, per core, per VM, per memory, etc.), which affects how scaling up hardware or deploying many VMs might be constrained by license counts',
  fc.id,
  1
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Licensing Model';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'License Editions & Features',
  'Whether different license editions unlock specific technical features or capacities (for example, advanced networking or replication might require higher-tier licenses), determining what functionality is available in a given deployment.',
  fc.id,
  2
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Licensing Model';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Hybrid Use Licensing',
  'Support for license portability or conversion between on-prem and cloud usage (e.g., bring-your-own-license to cloud or subscription models that cover both), allowing hybrid cloud deployments without separate licensing silos.',
  fc.id,
  3
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Licensing Model';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Open Source vs Proprietary',
  'The nature of the platform''s software license – fully open source (code available, community-driven) or proprietary – which can influence extensibility, community support, and the need for vendor support (aside from cost implications).',
  fc.id,
  4
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Licensing Model';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Scalability of Licensing',
  'How well the licensing scheme accommodates large scale (enterprise-wide) deployments – for instance, does it impose hard limits or require complex license management, or is it straightforward for thousands of VMs across many hosts.',
  fc.id,
  5
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Licensing Model';

-- Verification query to count inserted features
SELECT fc.name as category, COUNT(f.id) as feature_count
FROM feature_categories fc
LEFT JOIN features f ON f.category_id = fc.id
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms'
GROUP BY fc.name
ORDER BY fc.name;
