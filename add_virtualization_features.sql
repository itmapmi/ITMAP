-- SQL Script to Add All Virtualization Platform Features
-- Market: ITMAP for Virtualization Platforms
-- Total Features: 76 across 15 categories

-- Performance & Efficiency (5 features)
INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'CPU Virtualization Overhead',
  'Minimizes the performance penalty of the hypervisor on CPU-intensive workloads, ensuring near-native execution speed for virtual CPUs.',
  fc.id,
  1
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Performance & Efficiency';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Memory Overcommit & Optimization',
  'Ability to allocate more virtual memory to VMs than physically available via techniques like transparent page sharing or ballooning, maximizing memory usage while maintaining stable performance',
  fc.id,
  2
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Performance & Efficiency';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'I/O Throughput and Offloads',
  'Efficient virtual I/O performance for disk and network, with support for hardware offloads (e.g., SR-IOV, VMQ) to reduce virtualization overhead and improve throughput.',
  fc.id,
  3
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Performance & Efficiency';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'GPU/Accelerator Virtualization',
  'Supports virtual GPUs or direct pass-through of accelerators (GPUs, FPGA) to VMs, enabling high-performance computing and graphics workloads in virtualized environments.',
  fc.id,
  4
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Performance & Efficiency';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'NUMA Awareness',
  'Optimizes VM performance on multi-socket hosts by aligning virtual CPUs and memory with NUMA nodes, avoiding cross-node memory latency penalties.',
  fc.id,
  5
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Performance & Efficiency';

-- Scalability & Capacity (5 features)
INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Maximum Hosts per Cluster',
  'The maximum number of physical hosts supported in a single cluster, defining how large the resource pool can scale (e.g., up to 96 hosts per cluster on some platforms',
  fc.id,
  1
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Scalability & Capacity';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Maximum VMs per Host/Cluster',
  'Limits on the number of VMs that can run on one host and within one cluster, indicating the platform''s capacity for consolidation in large deployments.',
  fc.id,
  2
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Scalability & Capacity';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Maximum VM Size (vCPU/RAM)',
  'Upper limits on virtual machine specifications (max vCPUs, RAM per VM) to accommodate demanding workloads (e.g., so-called "monster" VMs with up to 768 vCPUs and 24 TB RAM as supported on some platforms',
  fc.id,
  3
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Scalability & Capacity';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Host Hardware Scalability',
  'Support for high-end server hardware (many cores, large memory) and advanced CPU features, ensuring the hypervisor can fully utilize modern multi-socket servers in big-scale environments.',
  fc.id,
  4
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Scalability & Capacity';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Multi-Cluster Management',
  'Ability to manage multiple clusters or data centers under one management domain, enabling scaling out to thousands of VMs and hosts with centralized control.',
  fc.id,
  5
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Scalability & Capacity';

-- Resource Allocation & Management (5 features)
INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Dynamic Resource Scheduling (DRS)',
  'Automated load balancing of VMs across hosts by monitoring resource use and migrating VMs or adjusting placement to prevent hotspots[4].',
  fc.id,
  1
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Resource Allocation & Management';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Live VM Migration',
  'Capability to move running VMs between hosts with no downtime, facilitating maintenance and workload balancing without service interruption',
  fc.id,
  2
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Resource Allocation & Management';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Resource Overcommit & Throttling',
  'Controls for safely over-allocating CPU/memory beyond physical limits and throttling usage, allowing higher utilization while preventing any VM from starving others.',
  fc.id,
  3
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Resource Allocation & Management';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Reservations and QoS',
  'Ability to set resource reservations, limits, and shares for VMs (guaranteeing minimum resources or capping maximum usage) to enforce Quality of Service for critical applications.',
  fc.id,
  4
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Resource Allocation & Management';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Hot-Add/Hot-Plug Resources',
  'Support for adding CPU, memory, or virtual devices to a running VM without reboot, enabling on-the-fly scaling of resources as workload demands grow.',
  fc.id,
  5
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Resource Allocation & Management';

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

-- Backup & Disaster Recovery (5 features)
INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Native Backup APIs',
  'Provides APIs (or tooling) for integrated VM backup, such as snapshotting with change block tracking and quiescence, to allow third-party or built-in solutions to back up VMs efficiently[11].',
  fc.id,
  1
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Backup & Disaster Recovery';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'VM Replication',
  'Built-in support for replicating VMs to another host or site (asynchronously or synchronously) for disaster recovery, maintaining an up-to-date copy that can be rapidly activated if the primary VM fails or site goes down.',
  fc.id,
  2
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Backup & Disaster Recovery';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'DR Orchestration',
  'Support for automating disaster recovery processes, including orchestrated failover and failback of multiple VMs, testing of DR plans in isolation, and sequencing of recovery steps to bring applications back online coherently.',
  fc.id,
  3
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Backup & Disaster Recovery';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Application-Consistent Snapshots',
  'Ability to quiesce VMs and integrated applications (e.g., via VSS for Windows) during snapshots or backups, ensuring that restores result in consistent, usable application state (no data corruption in databases, etc.).',
  fc.id,
  4
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Backup & Disaster Recovery';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Multi-Site & Cloud DR',
  'Flexibility to use multiple sites or public cloud as disaster recovery targets, enabling hybrid DR solutions (for example, replicating VMs to cloud storage or spinning up replicas in a cloud environment if the primary datacenter fails).',
  fc.id,
  5
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Backup & Disaster Recovery';

-- Management & Orchestration (5 features)
INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Centralized Management Console',
  'A unified management platform or console to administer all hosts, VMs, storage, and networking in the environment, providing a "single pane of glass" for the entire virtual infrastructure.',
  fc.id,
  1
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Management & Orchestration';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Role-Based Access Control',
  'Granular administrative roles and permissions, allowing separation of duties (e.g., network admin vs VM admin) and safe delegation of management tasks while maintaining security.',
  fc.id,
  2
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Management & Orchestration';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Multi-Tenant & Quotas',
  'Support for logically dividing resources or clusters for different departments or tenants, with the ability to set quotas and isolate administrative domains within the same physical infrastructure.',
  fc.id,
  3
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Management & Orchestration';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'UI, CLI & API Access',
  'Multiple management interfaces: a user-friendly GUI for console operations, command-line tools for automation (CLI/PowerShell), and a full RESTful API/SDK for integration with external tools.',
  fc.id,
  4
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Management & Orchestration';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Orchestration & Workflows',
  'Built-in or integrable workflow engines to automate complex IT tasks (e.g., multi-step provisioning, automated scaling or scheduling) and integration with ITSM/DevOps pipelines for streamlined operations.',
  fc.id,
  5
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Management & Orchestration';

-- Automation & APIs (5 features)
INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Programmable Infrastructure (IaC)',
  'Support for Infrastructure-as-Code through comprehensive APIs or declarative configuration, enabling integration with tools like Terraform or CloudFormation to define and manage virtual infrastructure in code.',
  fc.id,
  1
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Automation & APIs';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Scripting & SDKs',
  'Availability of scripting languages and software development kits (SDKs) (e.g., PowerCLI for PowerShell, Python SDKs) to script tasks, enabling automation of routine management actions and custom integrations.',
  fc.id,
  2
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Automation & APIs';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Event-Driven Automation',
  'Ability to trigger actions or scripts in response to system events or alerts (for example, run a script when a VM exceeds a CPU threshold) to enable automated remediation and dynamic resource management.',
  fc.id,
  3
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Automation & APIs';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Auto-Scaling Capabilities',
  'Integration with auto-scaling mechanisms, either natively or via orchestrators, to automatically adjust VM or container resources (or instantiate new VMs) based on load or predefined policies for elasticity.',
  fc.id,
  4
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Automation & APIs';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Integration with DevOps Tools',
  'Compatibility with CI/CD and configuration management tools (such as Ansible, Puppet, or Chef), including modules or providers that allow those tools to provision and manage VMs/containers on the platform.',
  fc.id,
  5
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Automation & APIs';

-- Monitoring & Analytics (5 features)
INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Real-Time Performance Monitoring',
  'Continuous monitoring of host and VM performance metrics (CPU, memory, I/O, network) with live dashboards, enabling administrators to observe system health and identify performance bottlenecks in real time.',
  fc.id,
  1
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Monitoring & Analytics';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Historical Metrics & Trending',
  'Retention of performance and resource usage data over time, with tools to analyze trends, generate reports, and predict future capacity needs based on historical consumption patterns.',
  fc.id,
  2
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Monitoring & Analytics';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Alerts and Notifications',
  'Configurable alerting system that generates alarms for specified conditions (e.g., high usage, failures) and can send notifications or trigger scripts, ensuring issues are flagged for prompt attention.',
  fc.id,
  3
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Monitoring & Analytics';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Log Aggregation & Analysis',
  'Centralized collection of logs and events from hosts and VMs, with search and analysis capabilities or integration to external log analytics/SIEM systems for debugging, security audits, and compliance.',
  fc.id,
  4
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Monitoring & Analytics';

INSERT INTO features (name, description, category_id, display_order)
SELECT 
  'Capacity & Anomaly Analytics',
  'Advanced analytics that may leverage machine learning to detect anomalies in usage patterns or to recommend optimizations (e.g., rightsizing VMs, balancing workloads), and capacity planning tools to model growth scenarios.',
  fc.id,
  5
FROM feature_categories fc
JOIN markets m ON fc.market_id = m.id
WHERE m.name = 'ITMAP for Virtualization Platforms' AND fc.name = 'Monitoring & Analytics';

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
