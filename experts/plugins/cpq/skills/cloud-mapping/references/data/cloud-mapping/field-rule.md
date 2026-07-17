# 字段匹配规则

各产品各字段从友商到腾讯云的映射方式。每行格式：
`<产品> (<厂商>) <源字段> (<说明>) => <目标字段> (<说明>) 匹配: <方法> 说明: <详情> [默认: <值>]`
CBS (阿里云) Category (磁盘类型) => DiskType (磁盘类型) 匹配: lookup_table 说明: 查磁盘类型映射表，获取1:N候选列表按优先级匹配
CBS (阿里云) DiskSize (磁盘大小(GB)) => DiskSize (磁盘大小(GB)) 匹配: range_clamp 说明: 系统盘:min=50,max=2048; 数据盘:min=20,max=32000; 范围内保持原值，默认40GB 默认: 40
CBS (阿里云) ChargeType (付费类型) => ChargeType (付费类型) 匹配: exact 说明: PostPaid→POSTPAID_BY_HOUR, PrePaid→PREPAID
CBS (阿里云) PerformanceLevel (性能等级) => PerformanceLevel (性能等级) 匹配: direct_pass 说明: PL0/PL1/PL2/PL3直传
CBS (AWS) VolumeType (磁盘类型) => DiskType (磁盘类型) 匹配: lookup_table 说明: 查磁盘类型映射表，AWS VolumeType(gp2/gp3/io1/io2/st1/sc1/standard)→腾讯云CBS类型
CBS (AWS) Size (磁盘大小(GB)) => DiskSize (磁盘大小(GB)) 匹配: range_clamp 说明: 系统盘:min=50,max=2048; 数据盘:min=20,max=32000 默认: 40
CBS (AWS) ChargeType (付费类型) => ChargeType (付费类型) 匹配: exact 说明: AWS EBS固定按量付费→POSTPAID_BY_HOUR
CBS (GCP) DiskType (磁盘类型) => DiskType (磁盘类型) 匹配: lookup_table 说明: 查磁盘类型映射表，GCP DiskType(pd-standard/pd-balanced/pd-ssd/pd-extreme)→腾讯云CBS
CBS (GCP) SizeGb (磁盘大小(GB)) => DiskSize (磁盘大小(GB)) 匹配: range_clamp 说明: 系统盘:min=50,max=2048; 数据盘:min=20,max=32000 默认: 40
CBS (华为云) VolumeType (磁盘类型) => DiskType (磁盘类型) 匹配: lookup_table 说明: 查磁盘类型映射表，华为云VolumeType(ESSD/GPSSD/SSD/SAS/SATA等)→腾讯云CBS类型
CBS (华为云) Size (磁盘大小(GB)) => DiskSize (磁盘大小(GB)) 匹配: range_clamp 说明: 系统盘:min=50,max=2048; 数据盘:min=20,max=32000; 范围内保持原值 默认: 40
CBS (华为云) ChargeType (付费类型) => ChargeType (付费类型) 匹配: exact 说明: 华为云metadata[orderID]有值→PREPAID, 否则POSTPAID_BY_HOUR
CFS (阿里云) Protocol (协议类型) => Protocol (协议类型) 匹配: direct_pass 说明: NFS/CIFS/TURBO直传
CFS (阿里云) StorageType (存储类型) => StorageType (存储类型) 匹配: exact 说明: SD(通用标准型)/HP(通用性能型)/TB(Turbo标准型)/TP(Turbo性能型)
CFS (AWS) PerformanceMode (性能模式) => StorageType (存储类型) 匹配: exact 说明: generalPurpose→SD(通用标准型), maxIO→HP(通用性能型)
CFS (AWS) ThroughputMode (吞吐模式) => Protocol (协议类型) 匹配: direct_pass 说明: AWS EFS仅支持NFS协议 默认: NFS
CFS (GCP) Tier (服务层级) => StorageType (存储类型) 匹配: exact 说明: BASIC_HDD→SD(通用标准型), BASIC_SSD→HP(通用性能型), HIGH_SCALE_SSD→TP(Turbo性能型), ENTERPRISE→TB(Turbo标准型)
CFS (GCP) Protocol (协议类型) => Protocol (协议类型) 匹配: direct_pass 说明: GCP Filestore仅支持NFS协议 默认: NFS
CFS (华为云) ShareType (存储类型) => StorageType (存储类型) 匹配: exact 说明: SFS→SD(通用标准型), SFS_Turbo_Standard→TB(Turbo标准型), SFS_Turbo_Performance→TP(Turbo性能型)
CFS (华为云) Protocol (协议类型) => Protocol (协议类型) 匹配: direct_pass 说明: 华为云SFS支持NFS协议，SFS Turbo支持NFS 默认: NFS
CLB (阿里云) BandwidthLimit (带宽(Mbps)) => BandwidthLimit/SpecType (带宽/规格) 匹配: algorithm 说明: 共享型:带宽上限2048Mbps直传; 性能容量型:按带宽区间选规格(<=2048→c2.medium/<=4096→c3.small/<=6144→c3.medium/<=10240→c4.small/<=20480→c4.medium/<=40960→c4.large/<=61440→c4.xlarge)
CLB (阿里云) NetworkType (网络类型) => NetWorkType (网络类型) 匹配: exact 说明: INTERNAL→内网, BGP→公网
CLB (阿里云) IPVersion (IP版本) => IPVersion (IP版本) 匹配: direct_pass 说明: IPv4/IPv6/IPv6_Nat直传
CLB (AWS) Type (ELB类型) => SpecType (CLB规格类型) 匹配: exact 说明: application(ALB)→共享型, network(NLB)→性能容量型, gateway(GWLB)→性能容量型
CLB (AWS) Scheme (网络类型) => NetWorkType (网络类型) 匹配: exact 说明: internet-facing→公网(BGP), internal→内网(INTERNAL)
CLB (GCP) LBType (LB类型) => SpecType (CLB规格类型) 匹配: exact 说明: HTTP(S)→共享型, TCP/UDP→性能容量型
CLB (GCP) Scheme (网络类型) => NetWorkType (网络类型) 匹配: exact 说明: EXTERNAL→公网, INTERNAL→内网
CLB (华为云) Guaranteed (是否独享型) => SpecType (CLB规格类型) 匹配: exact 说明: true→独享型(性能容量型), false→共享型
CLB (华为云) NetworkType (网络类型) => NetWorkType (网络类型) 匹配: exact 说明: 按公网IP判断:有PublicIP→公网, 无→内网
COS (阿里云) BuketType (存储类型) => BucketType (存储类型) 匹配: exact 说明: 查COS存储类型映射表
COS (阿里云) StorageSize (存储大小) => StorageSize (存储大小) 匹配: direct_pass 说明: 保持原值(按存储类型分类汇总)
COS (AWS) StorageClass (存储类型) => BucketType (存储类型) 匹配: exact 说明: 查COS存储类型映射表，STANDARD/STANDARD_IA/ONEZONE_IA/GLACIER/DEEP_ARCHIVE等
COS (AWS) StorageSize (存储大小) => StorageSize (存储大小) 匹配: direct_pass 说明: 保持原值
COS (GCP) StorageClass (存储类型) => BucketType (存储类型) 匹配: exact 说明: 查COS存储类型映射表，STANDARD/NEARLINE/COLDLINE/ARCHIVE
COS (GCP) StorageSize (存储大小) => StorageSize (存储大小) 匹配: direct_pass 说明: 保持原值
COS (华为云) StorageClass (存储类型) => BucketType (存储类型) 匹配: exact 说明: 查COS存储类型映射表，STANDARD/STANDARD_IA/WARM/COLD/DEEP_ARCHIVE/GLACIER
COS (华为云) StorageSize (存储大小) => StorageSize (存储大小) 匹配: direct_pass 说明: 保持原值
CVM (阿里云) CPU (CPU核数) => CPU (CPU核数) 匹配: gte_nearest 说明: 从目标实例族可售规格中过滤CPU>=源端的最小值。任意核数(1/2/4/8/16/32/48/64/96/128等)均适用，非固定枚举
CVM (阿里云) Memory (内存(GB)) => Memory (内存(GB)) 匹配: gte_nearest 说明: 从目标实例族可售规格中过滤Memory>=源端的最小值。任意内存(0.5/1/2/4/8/16/32/64/128/256/512等)均适用
CVM (阿里云) InstanceFamily (实例族) => InstanceFamily (实例族) 匹配: lookup_table 说明: 查实例族映射表，获取1:N候选目标族列表，分standard/cost两种策略
CVM (阿里云) ChargeType (付费类型) => ChargeType (付费类型) 匹配: exact 说明: PrePaid→PREPAID, PostPaid→POSTPAID_BY_HOUR
CVM (AWS) CPU (CPU核数) => CPU (CPU核数) 匹配: gte_nearest 说明: AWS InstanceType中解析vCPU，从目标实例族可售规格中过滤CPU>=源端的最小值
CVM (AWS) Memory (内存(GB)) => Memory (内存(GB)) 匹配: gte_nearest 说明: AWS InstanceType中解析Memory(GB)，从目标实例族可售规格中过滤Memory>=源端的最小值
CVM (AWS) InstanceFamily (实例族) => InstanceFamily (实例族) 匹配: lookup_table 说明: 查实例族映射表，AWS实例族从InstanceType解析(如m5.xlarge→m5)
CVM (AWS) ChargeType (付费类型) => ChargeType (付费类型) 匹配: exact 说明: AWS默认On-Demand→POSTPAID_BY_HOUR; Reserved→PREPAID
CVM (GCP) CPU (CPU核数) => CPU (CPU核数) 匹配: gte_nearest 说明: GCP MachineType中解析vCPU，从目标实例族可售规格中过滤CPU>=源端的最小值
CVM (GCP) Memory (内存(GB)) => Memory (内存(GB)) 匹配: gte_nearest 说明: GCP MachineType中解析Memory(GB)
CVM (GCP) InstanceFamily (实例族) => InstanceFamily (实例族) 匹配: lookup_table 说明: 查实例族映射表，GCP实例族从MachineType解析(如n2-standard-4→n2)
CVM (GCP) ChargeType (付费类型) => ChargeType (付费类型) 匹配: exact 说明: GCP默认按量付费→POSTPAID_BY_HOUR; 承诺使用折扣→PREPAID
CVM (华为云) CPU (CPU核数) => CPU (CPU核数) 匹配: gte_nearest 说明: 华为云Flavor.Vcpus(string→int)，从目标实例族可售规格中过滤CPU>=源端的最小值
CVM (华为云) Memory (内存(GB)) => Memory (内存(GB)) 匹配: gte_nearest 说明: 华为云Flavor.Ram(MB)/1024→GB，从目标实例族可售规格中过滤Memory>=源端的最小值
CVM (华为云) InstanceFamily (实例族) => InstanceFamily (实例族) 匹配: lookup_table 说明: 查实例族映射表，华为云实例族从Flavor.Id解析(如s7.xlarge.2→s7)
CVM (华为云) ChargeType (付费类型) => ChargeType (付费类型) 匹配: exact 说明: 华为云charging_mode: 0→POSTPAID_BY_HOUR, 1→PREPAID
CVM (IDC) CPU (CPU核数) => CPU (CPU核数) 匹配: gte_nearest 说明: 物理机CPU核数，从目标实例族可售规格中过滤CPU>=源端的最小值
CVM (IDC) Memory (内存(GB)) => Memory (内存(GB)) 匹配: gte_nearest 说明: 物理机内存(GB)，从目标实例族可售规格中过滤Memory>=源端的最小值
CVM (IDC) InstanceFamily (实例族) => InstanceFamily (实例族) 匹配: lookup_table 说明: 查实例族映射表，IDC无源实例族，使用通用目标族列表
EIP (阿里云) TotalBandwidth (带宽(Mbps)) => BandwidthLimit (带宽上限(Mbps)) 匹配: range_clamp 说明: 按计费模式不同有不同上限：按流量/包月带宽≤100M，按小时带宽≤200M，共享带宽包≤2000M
EIP (阿里云) NetChargeType (网络计费类型) => EIPChargeType (EIP计费类型) 匹配: exact 说明: PrePaid→BANDWIDTH_PREPAID_BY_MONTH, PayByTraffic→TRAFFIC_POSTPAID_BY_HOUR, PayByBandwidth→BANDWIDTH_POSTPAID_BY_HOUR
EIP (阿里云) ChargeType (实例计费类型) => EIPChargeType (EIP计费类型) 匹配: exact 说明: 若ChargeType=PrePaid，则覆盖NetChargeType，统一为BANDWIDTH_PREPAID_BY_MONTH
EIP (AWS) Bandwidth (带宽(Mbps)) => Bandwidth (带宽(Mbps)) 匹配: range_clamp 说明: AWS EIP按流量计费，带宽上限100Mbps
EIP (AWS) ChargeType (计费类型) => ChargeType (计费类型) 匹配: exact 说明: AWS EIP默认按流量计费→TRAFFIC_POSTPAID_BY_HOUR
EIP (华为云) BandwidthSize (带宽(Mbit/s)) => BandwidthLimit (带宽上限(Mbps)) 匹配: range_clamp 说明: 华为云BandwidthSize直传，按计费模式限幅
EIP (华为云) ChargeType (付费类型) => EIPChargeType (EIP计费类型) 匹配: exact 说明: 按带宽计费→BANDWIDTH_POSTPAID_BY_HOUR, 按流量计费→TRAFFIC_POSTPAID_BY_HOUR
ES (阿里云) CPU (CPU核数) => CPU (CPU核数) 匹配: gte_nearest 说明: 从可售规格中取>=源端的最小CPU
ES (阿里云) Memory (内存(GB)) => Memory (内存(GB)) 匹配: gte_nearest 说明: 从可售规格中取>=源端的最小内存
ES (阿里云) DiskSize (磁盘大小(GB)) => DiskSize (磁盘大小(GB)) 匹配: gte_nearest 说明: >=源端
ES (阿里云) NodeNum (节点数) => NodeNum (节点数) 匹配: direct_pass 说明: 保持原值
ES (AWS) InstanceType (实例规格) => CPU (CPU核数) 匹配: gte_nearest 说明: 从InstanceType解析vCPU
ES (AWS) InstanceTypeMemory (实例内存) => Memory (内存(GB)) 匹配: gte_nearest 说明: 从InstanceType解析Memory(GB)
ES (AWS) EBSVolumeSize (EBS磁盘大小(GB)) => DiskSize (磁盘大小(GB)) 匹配: gte_nearest 说明: >=源端
ES (AWS) InstanceCount (节点数) => NodeNum (节点数) 匹配: direct_pass 说明: 保持原值
Kafka (阿里云) PartitionNum (分区数) => PartitionNum (分区数) 匹配: gte_nearest 说明: >=源端最近值
Kafka (阿里云) Bandwidth (带宽(MB/s)) => Bandwidth (带宽(MB/s)) 匹配: gte_nearest 说明: >=源端最近值
Kafka (阿里云) DiskSize (磁盘大小(GB)) => DiskSize (磁盘大小(GB)) 匹配: gte_nearest 说明: >=源端最近值
Kafka (AWS) BrokerNodeCount (Broker数) => PartitionNum (分区数) 匹配: algorithm 说明: AWS按Broker数→腾讯云按分区数推荐，需要换算
Kafka (AWS) BrokerNodeSpec (Broker规格) => Bandwidth (带宽(MB/s)) 匹配: algorithm 说明: 从BrokerNodeSpec规格推导带宽
Kafka (AWS) StoragePerBroker (每Broker存储(GB)) => DiskSize (磁盘大小(GB)) 匹配: algorithm 说明: 总存储=StoragePerBroker*BrokerCount
MongoDB (阿里云) CPU (CPU核数) => CPU (CPU核数) 匹配: gte_nearest 说明: 从可售规格中取>=源端的最小CPU
MongoDB (阿里云) Memory (内存(MB)) => Memory (内存(MB)) 匹配: gte_nearest 说明: 从可售规格中取>=源端的最小内存
MongoDB (阿里云) DiskSize (磁盘大小(GB)) => Volume (磁盘大小(GB)) 匹配: gte_nearest 说明: 从可选磁盘列表中取>=源端的最小值
MongoDB (阿里云) NodeNum (节点数) => NodeNum (节点数) 匹配: gte_nearest 说明: 副本集节点数>=源端
MongoDB (华为云) CPU (CPU核数) => CPU (CPU核数) 匹配: gte_nearest 说明: 从SpecCode解析CPU(如dds.mongodb.s6.large.4→2核)
MongoDB (华为云) Memory (内存(MB)) => Memory (内存(MB)) 匹配: gte_nearest 说明: 从SpecCode解析Memory(CPU*mem_ratio)
MongoDB (华为云) DiskSize (磁盘大小(GB)) => Volume (磁盘大小(GB)) 匹配: gte_nearest 说明: 华为云Volume.Size(string→int,GB)
MongoDB (华为云) Mode (集群类型) => Architecture (架构类型) 匹配: exact 说明: ReplicaSet→副本集, Sharding→分片集群, Single→单节点
MySQL (阿里云) CPU (CPU核数) => CPU (CPU核数) 匹配: gte_nearest 说明: 从腾讯云CDB可售规格中取>=源端的最小CPU
MySQL (阿里云) Memory (内存(MB)) => Memory (内存(MB)) 匹配: gte_nearest 说明: 从腾讯云CDB可售规格中取>=源端的最小内存
MySQL (阿里云) DiskSize (磁盘大小(GB)) => Volume (磁盘大小(GB)) 匹配: gte_nearest 说明: 从可选磁盘列表中取>=源端的最小值
MySQL (阿里云) EngineVersion (引擎版本) => EngineVersion (引擎版本) 匹配: direct_pass 说明: 5.6→5.6, 5.7→5.7, 8.0→8.0 直传
MySQL (AWS) CPU (CPU核数) => CPU (CPU核数) 匹配: gte_nearest 说明: 从DBInstanceClass解析vCPU，取>=源端的最小CPU
MySQL (AWS) Memory (内存(MB)) => Memory (内存(MB)) 匹配: gte_nearest 说明: 从DBInstanceClass解析Memory，取>=源端的最小内存
MySQL (AWS) DiskSize (磁盘大小(GB)) => Volume (磁盘大小(GB)) 匹配: gte_nearest 说明: AWS AllocatedStorage(int32,GB)
MySQL (AWS) EngineVersion (引擎版本) => EngineVersion (引擎版本) 匹配: direct_pass 说明: 5.6→5.6, 5.7→5.7, 8.0→8.0 直传
MySQL (GCP) CPU (CPU核数) => CPU (CPU核数) 匹配: gte_nearest 说明: GCP CloudSQL tier中解析vCPU
MySQL (GCP) Memory (内存(MB)) => Memory (内存(MB)) 匹配: gte_nearest 说明: GCP CloudSQL tier中解析Memory
MySQL (GCP) DiskSize (磁盘大小(GB)) => Volume (磁盘大小(GB)) 匹配: gte_nearest 说明: >=源端
MySQL (GCP) EngineVersion (引擎版本) => EngineVersion (引擎版本) 匹配: direct_pass 说明: 5.6/5.7/8.0 直传
MySQL (华为云) CPU (CPU核数) => CPU (CPU核数) 匹配: gte_nearest 说明: 华为云Instances.Cpu(string→int)，从腾讯云CDB可售规格中取>=源端的最小CPU
MySQL (华为云) Memory (内存(GB)) => Memory (内存(MB)) 匹配: gte_nearest 说明: 华为云Instances.Mem(string→int,GB→MB*1024)，从可售规格中取>=源端
MySQL (华为云) DiskSize (磁盘大小(GB)) => Volume (磁盘大小(GB)) 匹配: gte_nearest 说明: 华为云Volume.Size(int32,GB)
MySQL (华为云) EngineVersion (引擎版本) => EngineVersion (引擎版本) 匹配: direct_pass 说明: 5.6→5.6, 5.7→5.7, 8.0→8.0 直传
NAT (阿里云) MaxConnections (最大连接数) => InstanceType (NAT规格) 匹配: algorithm 说明: <=100万→small(小型), <=300万→middle(中型), <=1000万→large(大型), 超出默认small
NAT (阿里云) BandwidthLimit (出带宽(Mbps)) => OutBandwidthLimit (出带宽(Mbps)) 匹配: gte_nearest 说明: 从有效值列表[10,20,50,100,200,500,1000,2000,5000]中取>=源端的最小值，默认10 默认: 10
NAT (GCP) NATType (NAT类型) => InstanceType (NAT规格) 匹配: exact 说明: GCP CloudNAT无规格区分，默认映射为small 默认: small
NAT (AWS) DataProcessed (数据处理量(GB)) => OutBandwidth (出带宽(Mbps)) 匹配: algorithm 说明: 根据数据处理量估算出带宽需求
NAT (华为云) Spec (NAT规格) => InstanceType (NAT规格) 匹配: exact 说明: 华为云Spec: 1→small, 2→middle, 3→large, 4→xlarge(腾讯云无超大型，映射为large)
PostgreSQL (阿里云) CPU (CPU核数) => CPU (CPU核数) 匹配: gte_nearest 说明: 从可售规格中取>=源端的最小CPU
PostgreSQL (阿里云) Memory (内存(MB)) => Memory (内存(MB)) 匹配: gte_nearest 说明: 从可售规格中取>=源端的最小内存
PostgreSQL (阿里云) DiskSize (磁盘大小(GB)) => Volume (磁盘大小(GB)) 匹配: gte_nearest 说明: 从可选磁盘列表中取>=源端的最小值
PostgreSQL (阿里云) EngineVersion (引擎版本) => EngineVersion (引擎版本) 匹配: direct_pass 说明: 10/11/12/13/14/15/16 直传
PostgreSQL (AWS) CPU (CPU核数) => CPU (CPU核数) 匹配: gte_nearest 说明: 从DBInstanceClass解析vCPU
PostgreSQL (AWS) Memory (内存(MB)) => Memory (内存(MB)) 匹配: gte_nearest 说明: 从DBInstanceClass解析Memory
PostgreSQL (AWS) DiskSize (磁盘大小(GB)) => Volume (磁盘大小(GB)) 匹配: gte_nearest 说明: >=源端
PostgreSQL (AWS) EngineVersion (引擎版本) => EngineVersion (引擎版本) 匹配: direct_pass 说明: 版本直传
PostgreSQL (GCP) CPU (CPU核数) => CPU (CPU核数) 匹配: gte_nearest 说明: 从tier中解析vCPU
PostgreSQL (GCP) Memory (内存(MB)) => Memory (内存(MB)) 匹配: gte_nearest 说明: 从tier中解析Memory
PostgreSQL (GCP) DiskSize (磁盘大小(GB)) => Volume (磁盘大小(GB)) 匹配: gte_nearest 说明: >=源端
PostgreSQL (GCP) EngineVersion (引擎版本) => EngineVersion (引擎版本) 匹配: direct_pass 说明: 版本直传
PostgreSQL (华为云) CPU (CPU核数) => CPU (CPU核数) 匹配: gte_nearest 说明: 从可售规格中取>=源端的最小CPU
PostgreSQL (华为云) Memory (内存(GB)) => Memory (内存(MB)) 匹配: gte_nearest 说明: 从可售规格中取>=源端的最小内存
PostgreSQL (华为云) DiskSize (磁盘大小(GB)) => Volume (磁盘大小(GB)) 匹配: gte_nearest 说明: 从可选磁盘列表中取>=源端的最小值
PostgreSQL (华为云) EngineVersion (引擎版本) => EngineVersion (引擎版本) 匹配: direct_pass 说明: 版本直传
Redis (阿里云) Architecture (架构类型) => Architecture (架构类型) 匹配: exact 说明: cluster→集群架构, standard→标准架构(master-slave)
Redis (阿里云) Version (版本) => Version (版本) 匹配: gte_nearest 说明: 从有效版本[4.0,5.0,6.2,7.0]中取>=源端的最近版本，默认6.2 默认: 6.2
Redis (阿里云) Capacity (总容量(GB)) => Memory (单片内存(GB)) 匹配: algorithm 说明: 标准架构:从[0.25,0.5,1,2,4,6,8,10,12,16,20,24,32,40,48,64]GB取>=源端的最小值; 集群架构:ShardNum*Memory>=源端总容量
Redis (阿里云) ShardCount (分片数) => ShardNum (分片数) 匹配: gte_nearest 说明: 集群有效值:[1,3,5,8,12,16,24,32,40,48,64,80,96,128]，标准架构无分片 默认: 0
Redis (阿里云) ReplicaNum (副本数) => ReplicaNum (副本数) 匹配: range_clamp 说明: 范围[1,9]，<1取1，>9取9 默认: 1
Redis (AWS) Engine (引擎类型) => Engine (引擎类型) 匹配: exact 说明: redis→Redis(仅支持Redis引擎，Memcached不映射)
Redis (AWS) EngineVersion (版本) => Version (版本) 匹配: gte_nearest 说明: 从有效版本[4.0,5.0,6.2,7.0]中取>=源端的最近版本 默认: 6.2
Redis (AWS) ClusterEnabled (是否集群) => Architecture (架构类型) 匹配: exact 说明: true→cluster(集群架构), false→standard(标准架构)
Redis (AWS) CacheNodeType (节点规格) => Memory (单片内存(GB)) 匹配: algorithm 说明: 从节点规格解析内存大小，取>=源端的最近有效值
Redis (AWS) NumCacheNodes (节点数/分片数) => ShardNum (分片数) 匹配: gte_nearest 说明: 集群分片数 默认: 0
Redis (AWS) ReplicasPerShard (每分片副本数) => ReplicaNum (副本数) 匹配: range_clamp 说明: 范围[1,9] 默认: 1
Redis (GCP) Tier (服务层级) => Architecture (架构类型) 匹配: exact 说明: BASIC→standard(标准架构), STANDARD→standard(标准架构)
Redis (GCP) RedisVersion (版本) => Version (版本) 匹配: gte_nearest 说明: 从有效版本[4.0,5.0,6.2,7.0]中取>=源端的最近版本 默认: 6.2
Redis (GCP) MemorySizeGb (内存(GB)) => Memory (单片内存(GB)) 匹配: gte_nearest 说明: 从有效值列表取>=源端的最近值
Redis (华为云) CacheMode (架构类型) => Architecture (架构类型) 匹配: exact 说明: single/ha/ha_rw_split→standard(标准架构), cluster/proxy→cluster(集群架构)
Redis (华为云) EngineVersion (版本) => Version (版本) 匹配: gte_nearest 说明: 从有效版本[4.0,5.0,6.2,7.0]中取>=源端的最近版本 默认: 6.2
Redis (华为云) Capacity (总容量(GB)) => Memory (单片内存(GB)) 匹配: algorithm 说明: 标准架构:直接从有效值取>=源端; 集群架构:ShardNum*Memory>=源端总容量
Redis (华为云) ShardingCount (分片数) => ShardNum (分片数) 匹配: gte_nearest 说明: 集群有效值:[1,3,5,8,12,16,24,32,40,48,64,80,96,128]，标准架构无分片 默认: 0
Redis (华为云) ReplicaCount (副本数) => ReplicaNum (副本数) 匹配: range_clamp 说明: 范围[1,9] 默认: 1
Redis (华为云) ChargingMode (付费类型) => ChargeType (付费类型) 匹配: exact 说明: 0→POSTPAID_BY_HOUR, 1→PREPAID
RocketMQ (阿里云) TopicNum (Topic数) => TopicNum (Topic数) 匹配: gte_nearest 说明: >=源端最近值
RocketMQ (阿里云) TPS (TPS) => TPS (TPS) 匹配: gte_nearest 说明: >=源端最近值
SG (华为云) Region (地域) => Region (地域) 匹配: lookup_table 说明: 查地域映射表
SQLServer (阿里云) CPU (CPU核数) => CPU (CPU核数) 匹配: gte_nearest 说明: 从可售规格中取>=源端的最小CPU
SQLServer (阿里云) Memory (内存(MB)) => Memory (内存(MB)) 匹配: gte_nearest 说明: 从可售规格中取>=源端的最小内存
SQLServer (阿里云) DiskSize (磁盘大小(GB)) => Volume (磁盘大小(GB)) 匹配: gte_nearest 说明: 从可选磁盘列表中取>=源端的最小值
SQLServer (阿里云) EngineVersion (引擎版本) => EngineVersion (引擎版本) 匹配: direct_pass 说明: 版本直传
TDSQLC (阿里云) CPU (CPU核数) => CPU (CPU核数) 匹配: gte_nearest 说明: 从可售规格中取>=源端的最小CPU
TDSQLC (阿里云) Memory (内存(GB)) => Memory (内存(GB)) 匹配: gte_nearest 说明: 从可售规格中取>=源端的最小内存
TDSQLC (阿里云) EngineVersion (引擎版本) => EngineVersion (引擎版本) 匹配: direct_pass 说明: 版本直传
VPN (阿里云) VPNType (VPN类型) => VPNType (VPN类型) 匹配: direct_pass 说明: SSL/IPSEC直传
VPN (阿里云) BandwidthSize (带宽(MB)) => BandwidthSize (带宽(MB)) 匹配: gte_nearest 说明: SSL有效值:[5,10,20,50,100,200,500,1000]MB; IPSEC有效值:[5,10,20,50,100,200,500,1000,3000]MB
VPN (阿里云) MaxConnection (SSL最大连接数) => MaxConnection (SSL最大连接数) 匹配: gte_nearest 说明: 有效值:[5,10,20,50,100]，仅SSL类型适用
VPN (AWS) VPNType (VPN类型) => VPNType (VPN类型) 匹配: exact 说明: Site-to-Site→IPSEC, Client VPN→SSL
VPN (GCP) VPNType (VPN类型) => VPNType (VPN类型) 匹配: exact 说明: Classic VPN→IPSEC, HA VPN→IPSEC
VPC (AWS) CIDR (CIDR) => CIDR (CIDR) 匹配: algorithm 说明: CIDR推导算法(确定性)
VPC (AWS) Subnet (子网) => Subnet (子网) 匹配: algorithm 说明: 子网推导
RDS (AWS) Engine (数据库引擎) => Engine (数据库引擎) 匹配: exact 说明: mysql→MySQL, postgres→PostgreSQL, sqlserver→SQLServer, mariadb→MariaDB
RDS (AWS) InstanceClass (实例规格) => InstanceType (实例规格) 匹配: gte_nearest 说明: 解析CPU/Memory，从目标引擎可售规格中过滤>=源端的最小规格
RDS (AWS) StorageType (存储类型) => StorageType (存储类型) 匹配: lookup_table 说明: gp2/gp3→高性能云盘, io1/io2→SSD云盘
RDS (AWS) AllocatedStorage (存储大小(GB)) => DiskSize (存储大小(GB)) 匹配: range_clamp 说明: 最小50GB，最大32000GB
RDS (AWS) MultiAZ (多可用区) => DeployMode (部署模式) 匹配: exact 说明: true→多可用区, false→单可用区
