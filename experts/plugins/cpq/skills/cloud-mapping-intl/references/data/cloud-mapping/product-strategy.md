# 产品推荐策略（国际站）

> 本文件由 cn cloud-mapping 数据派生 + 腾讯云国际站 `tcloud-price` 目录校正生成（一次性派生）。
> 派生方法见 `.tmp/<user>/intl-derivation/report.md`；激活规范见
> `.agent/skills/cloud-mapping-import/references/variants/intl/format-*.md`。
> 后续增量条目请走 `cloud-mapping-import` skill 的正常 Excel 导入流程。

友商到腾讯云国际站的产品推荐方法和匹配策略。每行格式：
`<厂商> <产品> (<源→目标>) 推荐: <方法> 匹配: <策略> [排序: ...] [兜底: ...] [备注: ...] [BOQ: ...]`

阿里云 CVM (ECS→CVM) 推荐: engine_grpc 匹配: {"cpu":">=向上取整(从目标实例族可售规格中过滤CPU>=源端)","memory":">=向上取整(从目标实例族可售规格中过滤Memory>=源端)","instance_family":"查表映射(1:N候选族列表)"} 排序: CPU升序→Memory升序，取最小满足规格 兜底: 三级兜底:1)指定族匹配 2)扩大族范围 3)全量规格 备注: 实例族映射表分standard/cost两种策略。CPU/Memory不是枚举映射，是从目标族所有可售规格中动态过滤>=源端值的最小规格
阿里云 CBS (EBS→CBS) 推荐: engine_grpc 匹配: {"disk_type":"查表映射(1:N候选列表按优先级)","disk_size":"边界限幅(系统盘50-2048GB,数据盘20-32000GB)"} 排序: 按磁盘类型候选列表优先级 备注: 磁盘类型1:N映射，按优先级依次匹配可用磁盘类型
阿里云 EIP (EIP→EIP) 推荐: engine_grpc 匹配: {"bandwidth":"带宽限幅(按计费模式不同上限不同)","charge_type":"1:1精确映射"} 备注: 按流量/包月带宽上限100M，按小时带宽上限200M，共享带宽包上限2000M
阿里云 CLB (SLB→CLB) 推荐: engine_grpc 匹配: {"bandwidth":"规格映射(按带宽区间选CLB规格)","network_type":"1:1映射","ip_version":"1:1映射"} 排序: 按带宽区间匹配CLB规格等级 兜底: 共享型兜底(带宽上限2048Mbps) 备注: 共享型/性能容量型两种，性能容量型按带宽区间选规格
阿里云 COS (OSS→COS) 推荐: engine_grpc 匹配: {"storage_type":"1:1精确映射","size":"保持原值"} 备注: 存储类型直接映射到腾讯云COS存储类型
阿里云 CFS (NAS→CFS) 推荐: engine_grpc 匹配: {"storage_type":"协议+存储类型匹配","protocol":"NFS/CIFS/TURBO"} 兜底: 用通用性能型(HP)兜底 备注: 按协议和存储类型联合匹配可用CFS规格
阿里云 NAT (NAT→NAT) 推荐: engine_grpc 匹配: {"max_connections":"区间映射(<=100万small/<=300万middle/<=1000万large)","bandwidth":">=最近有效值"} 兜底: 默认small(100万连接) 备注: NAT出带宽有效值:[10,20,50,100,200,500,1000,2000,5000]Mbps
阿里云 VPN (VPN→VPN) 推荐: engine_grpc 匹配: {"bandwidth":">=最近有效值(SSL和IPSEC有效值列表不同)","vpn_type":"直传(SSL/IPSEC)","max_connection":">=最近有效值(SSL专用)"} 备注: SSL带宽有效值:[5,10,20,50,100,200,500,1000]MB; IPSEC带宽有效值:[5,10,20,50,100,200,500,1000,3000]MB
阿里云 Redis (Redis→Redis) 推荐: engine_grpc 匹配: {"architecture":"1:1映射(cluster→集群/standard→标准)","version":">=最近版本","capacity":"分片数*单片内存>=源端总容量","replica_num":"1-9限幅"} 排序: 版本>=最近匹配，容量向上取整 兜底: 默认版本6.2，默认标准架构 备注: 标准架构内存有效值:[0.25,0.5,1,2,4,6,8,10,12,16,20,24,32,40,48,64]GB; 集群架构单片:[1,2,4,6,8,10,12,16,20,24,32,40,48,64]GB
阿里云 MySQL (RDS→CDB) 推荐: engine_grpc 匹配: {"cpu":">=最近","memory":">=最近","disk_size":">=最近","version":"直传(5.6/5.7/8.0)","architecture":"HA(高可用)"} 排序: CPU升序→Memory升序 备注: 版本直传，架构默认高可用
阿里云 PostgreSQL (RDS→PostgreSQL) 推荐: engine_grpc 匹配: {"cpu":">=最近","memory":">=最近","disk_size":">=最近","version":"直传(10/11/12/13/14/15/16)"} 排序: CPU升序→Memory升序 备注: 版本直传
阿里云 SQLServer (RDS→SQLServer) 推荐: engine_grpc 匹配: {"cpu":">=最近","memory":">=最近","disk_size":">=最近","version":"直传"} 排序: CPU升序→Memory升序
阿里云 MongoDB (MongoDB→MongoDB) 推荐: engine_grpc 匹配: {"cpu":">=最近","memory":">=最近","disk_size":">=最近","node_num":">=最近","architecture":"副本集/分片映射"} 排序: CPU升序→Memory升序 备注: 分片集群按每个分片独立推荐
阿里云 ES (ES→ES) 推荐: engine_grpc 匹配: {"cpu":">=最近","memory":">=最近","disk_size":">=最近","node_num":"保持原值","version":">=最近"} 排序: CPU升序→Memory升序
阿里云 Kafka (Kafka→CKafka) 推荐: engine_grpc 匹配: {"partition_num":">=最近","bandwidth":">=最近","disk_size":">=最近"}
阿里云 RocketMQ (RocketMQ→TDMQ) 推荐: engine_grpc 匹配: {"topic_num":">=最近","tps":">=最近"}
阿里云 TDSQLC (PolarDB→TDSQL-C) 推荐: engine_grpc 匹配: {"cpu":">=最近","memory":">=最近","version":"直传"} 排序: CPU升序→Memory升序
阿里云 ACK (ACK→TKE) 推荐: direct 匹配: {"cluster_type":"直传","node_spec":"按CVM规则推荐"} 备注: 节点规格复用CVM推荐逻辑
阿里云 SAS (SAS→主机安全) 推荐: direct 匹配: {"version":"版本映射"} 备注: 按安全等级映射
阿里云 CSS (视频直播 ApsaraVideo Live→CSS) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 视频直播 ApsaraVideo Live→腾讯云云直播（migraq 推断 · M6-orphans）
阿里云 MPS (媒体处理 MPS→MPS) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 媒体处理 MPS（ApsaraVideo for Media Processing）→腾讯云媒体处理（migraq 推断 · M6-orphans）
阿里云 VOD (视频点播 ApsaraVideo VOD→VOD) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 视频点播 ApsaraVideo VOD→腾讯云云点播（migraq 推断 · M6-orphans）
阿里云 TRTC (音视频通信 RTC→TRTC) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 音视频通信 RTC→腾讯云实时音视频（migraq 推断 · M6-orphans）
阿里云 AVC (云通信 IM→AVC) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 云通信 IM（ApsaraVideo for IM，已整合至 IMKit）→腾讯云Chat（migraq 推断 · M6-orphans）
阿里云 SMS (阿里云短信服务→SMS) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 阿里云短信服务（SMS）→腾讯云短信（migraq 推断 · M6-orphans）
阿里云 MQTT (微消息队列 MQTT 版→MQTT) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 微消息队列 MQTT 版（MQ for MQTT）→腾讯云TDMQ for MQTT（migraq 推断 · M6-orphans）
阿里云 trabbit (消息队列 RabbitMQ 版→trabbit) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 消息队列 RabbitMQ 版（AMQP）→腾讯云TDMQ for RabbitMQ（migraq 推断 · M6-orphans）
阿里云 Tendis (云数据库 Redis→Tendis) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 云数据库 Redis（冷热混合存储版）→腾讯云云数据库 Tendis（migraq 推断 · M6-orphans）
阿里云 TcaplusDB (表格存储 TableStore→TcaplusDB) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 表格存储 TableStore→腾讯云TcaplusDB（migraq 推断 · M6-orphans）
阿里云 CTSDB (时序数据库 TSDB→CTSDB) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 时序数据库 TSDB→腾讯云时序数据库 CTSDB（migraq 推断 · M6-orphans）
阿里云 TCHouseD (AnalyticDB for MySQL→TCHouseD) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: AnalyticDB for MySQL→腾讯云TCHouse-D 数据仓库（migraq 推断 · M6-orphans）
阿里云 TDStore (PolarDB-X→TDStore) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: PolarDB-X（分布式版）→腾讯云TDStore 分布式 SQL（migraq 推断 · M6-orphans）
阿里云 Vector (向量检索服务 DashVector→Vector) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 向量检索服务 DashVector→腾讯云向量数据库 VectorDB（migraq 推断 · M6-orphans）
阿里云 AntiDDoS (DDoS 高防→AntiDDoS) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: DDoS 高防（Anti-DDoS Premium/Pro）→腾讯云DDoS 高防（migraq 推断 · M6-orphans）
阿里云 BH (堡垒机→BH) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 堡垒机（Bastionhost）→腾讯云堡垒机（migraq 推断 · M6-orphans）
阿里云 PrivateDNS (PrivateZone→PrivateDNS) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: PrivateZone（云解析 DNS 私有域）→腾讯云私有 DNS（migraq 推断 · M6-orphans）
阿里云 CDH (专有宿主机→CDH) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 专有宿主机（Dedicated Host）→腾讯云CVM 专用宿主机（migraq 推断 · M6-orphans）
阿里云 CDSAudit (数据库审计→CDSAudit) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 数据库审计（Database Audit）→腾讯云数据安全审计（migraq 推断 · M6-orphans）
阿里云 ADP (阿里云百炼→ADP) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 阿里云百炼（百炼 Agent 应用）→腾讯云腾讯云 Agent 开发平台（migraq 推断 · M6-orphans）
阿里云 AIArt (通义万相→AIArt) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 通义万相（文生图）→腾讯云文生图大模型（migraq 推断 · M6-orphans）
阿里云 AIPay (通义灵码→AIPay) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 通义灵码（Lingma）→腾讯云CodeBuddy（migraq 推断 · M6-orphans）
阿里云 CAR (阿里云无影云电脑→CAR) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 阿里云无影云电脑（游戏/应用版）→腾讯云Cloud Application Rendering（migraq 推断 · M6-orphans）
阿里云 Hunyuan (通义千问→Hunyuan) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 通义千问（Qwen）→腾讯云混元大模型（migraq 推断 · M6-orphans）
阿里云 FaceID (阿里云实人认证→FaceID) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 阿里云实人认证（人脸核验）→腾讯云人脸核身（migraq 推断 · M6-orphans）
阿里云 IPC (阿里云内容安全→IPC) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 阿里云内容安全（智能审核）→腾讯云智能预审（migraq 推断 · M6-orphans）
阿里云 IVH (阿里云数字人→IVH) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 阿里云数字人（虚拟数字人）→腾讯云腾讯云数智人（migraq 推断 · M6-orphans）
阿里云 LeXiang (阿里云钉钉→LeXiang) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 阿里云钉钉（知识管理/社区版）→腾讯云腾讯乐享（migraq 推断 · M6-orphans）
阿里云 License (阿里云视频点播 SDK / 短视频 SDK→License) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 阿里云视频点播 SDK / 短视频 SDK→腾讯云短视频 SDK（migraq 推断 · M6-orphans）
阿里云 RUMPro (阿里云 ARMS 前端监控→RUMPro) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 阿里云 ARMS 前端监控→腾讯云前端性能监控 RUM（migraq 推断 · M6-orphans）
阿里云 TBaaS (阿里云区块链服务→TBaaS) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 阿里云区块链服务（BaaS）→腾讯云腾讯云区块链 TBaaS（migraq 推断 · M6-orphans）
阿里云 TCED (阿里云企业网盘→TCED) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 阿里云企业网盘（企业版 Teambition Docs）→腾讯云腾讯云企业网盘（migraq 推断 · M6-orphans）
AWS CVM (ECS→CVM) 推荐: engine_grpc 匹配: {"cpu":">=向上取整","memory":">=向上取整","instance_family":"查表映射(1:N候选族列表)"} 排序: CPU升序→Memory升序，取最小满足规格 兜底: 三级兜底:1)指定族匹配 2)扩大族范围 3)全量规格 备注: AWS实例族映射分Standard/Cost两种策略
AWS CBS (EBS→CBS) 推荐: engine_grpc 匹配: {"disk_type":"查表映射(1:N候选列表按优先级)","disk_size":"边界限幅"} 排序: 按磁盘类型候选列表优先级 备注: AWS磁盘类型:gp2/gp3/io1/io2/st1/sc1/standard
AWS CLB (SLB→CLB) 推荐: engine_grpc 匹配: {"elb_type":"ALB/NLB/GWLB类型映射"} 备注: AWS ELBv2类型:application/network/gateway
AWS COS (OSS→COS) 推荐: engine_grpc 匹配: {"storage_type":"1:1精确映射","size":"保持原值"} 备注: AWS S3存储类型已在枚举映射表中
AWS CFS (NAS→CFS) 推荐: engine_grpc 匹配: {"performance_mode":"性能模式映射","throughput_mode":"吞吐模式映射"} 备注: AWS EFS性能模式:generalPurpose/maxIO
AWS VPN (VPN→VPN) 推荐: engine_grpc 匹配: {"vpn_type":"SiteToSite/ClientEndpoint类型映射"} 备注: AWS VPN分Site-to-Site和Client VPN
AWS Redis (Redis→Redis) 推荐: engine_grpc 匹配: {"engine":"redis/memcached","node_spec":">=最近规格","shard_count":"保持原值","replica_count":"保持原值"} 备注: AWS ElastiCache固定按量付费 BOQ: cache.m5.large → TencentDB for Redis
AWS MySQL (RDS→CDB) 推荐: engine_grpc 匹配: {"cpu":">=最近","memory":">=最近","disk_size":">=最近","version":"直传"} 排序: CPU升序→Memory升序 BOQ: db.t3.small → TencentDB for MySQL
AWS PostgreSQL (RDS→PostgreSQL) 推荐: engine_grpc 匹配: {"cpu":">=最近","memory":">=最近","disk_size":">=最近","version":"直传"} 排序: CPU升序→Memory升序 BOQ: db.t3.large → TencentDB for PostgreSQL
AWS SQLServer (RDS→SQLServer) 推荐: engine_grpc 匹配: {"cpu":">=最近","memory":">=最近","disk_size":">=最近","version":"直传"} 排序: CPU升序→Memory升序 BOQ: db.m5.xl → TencentDB for SQL Server (Single-Node Dedicated, 4-core, 16 GB)
AWS ES (ES→ES) 推荐: engine_grpc 匹配: {"instance_type":">=最近规格","ebs_size":">=最近","version":">=最近"}
AWS Kafka (Kafka→CKafka) 推荐: engine_grpc 匹配: {"broker_count":"保持原值","broker_spec":">=最近规格"}
AWS Lighthouse (Lightsail→Lighthouse) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Amazon Lightsail→腾讯云Lighthouse
AWS TKE (EKS→TKE) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Amazon Elastic Container Service for Kubernetes→腾讯云TKE
AWS TCR (ECR→TCR) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Amazon EC2 Container Registry (ECR)→腾讯云TCR
AWS TCR (ECR Public→TCR) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Amazon Elastic Container Registry Public→腾讯云TCR
AWS DNSPod (Route53→DNSPod) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Amazon Route 53→腾讯云DNSPod
AWS SCF (Lambda→SCF) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: AWS Lambda→腾讯云SCF
AWS CFW (NetworkFirewall→CFW) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: AWS Network Firewall→腾讯云CFW
AWS KMS (KMS→KMS) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: AWS Key Management Service→腾讯云KMS
AWS SSM (SecretsManager→SSM) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: AWS Secrets Manager→腾讯云SSM
AWS SSL (ACM→SSL) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: AWS Certificate Manager→腾讯云SSL
AWS CKafka (MSK→CKafka) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Amazon Managed Streaming for Apache Kafka→腾讯云CKafka
AWS DLC (Athena→DLC) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Amazon Athena→腾讯云DLC
AWS DTS (DMS→DTS) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: AWS Database Migration Service→腾讯云DTS
AWS TDMQ (SQS→TDMQ) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Amazon Simple Queue Service→腾讯云TDMQ
AWS TMP (Prometheus→TMP) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Amazon Managed Service for Prometheus→腾讯云TMP
AWS CSS (IVS→CSS) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: IVS（Interactive Video Service）→腾讯云云直播（migraq 推断 · M6-orphans）
AWS MPS (MediaConvert→MPS) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: MediaConvert→腾讯云媒体处理（migraq 推断 · M6-orphans）
AWS VOD (Elemental MediaStore + CloudFront→VOD) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Elemental MediaStore + CloudFront（组合）→腾讯云云点播（migraq 推断 · M6-orphans）
AWS TRTC (Amazon Chime SDK→TRTC) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Amazon Chime SDK（实时通信部分）→腾讯云实时音视频（migraq 推断 · M6-orphans）
AWS TIW (Amazon Chime SDK→TIW) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Amazon Chime SDK（共享内容部分，弱对标）→腾讯云互动白板（migraq 推断 · M6-orphans）
AWS AVC (Amazon Chime SDK（消息部分）+ Pinpoint→AVC) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Amazon Chime SDK（消息部分）+ Pinpoint→腾讯云Chat（migraq 推断 · M6-orphans）
AWS SMS (Amazon SNS（短信能力）/ Amazon Pinpoint→SMS) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Amazon SNS（短信能力）/ Amazon Pinpoint→腾讯云短信（migraq 推断 · M6-orphans）
AWS MQTT (AWS IoT Core（MQTT Broker）/ Amazon MQ for MQTT→MQTT) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: AWS IoT Core（MQTT Broker）/ Amazon MQ for MQTT→腾讯云TDMQ for MQTT（migraq 推断 · M6-orphans）
AWS trabbit (Amazon MQ for RabbitMQ→trabbit) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Amazon MQ for RabbitMQ→腾讯云TDMQ for RabbitMQ（migraq 推断 · M6-orphans）
AWS TcaplusDB (DynamoDB→TcaplusDB) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: DynamoDB→腾讯云TcaplusDB（migraq 推断 · M6-orphans）
AWS CTSDB (Amazon Timestream→CTSDB) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Amazon Timestream→腾讯云时序数据库 CTSDB（migraq 推断 · M6-orphans）
AWS TCHouseD (Amazon Redshift→TCHouseD) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Amazon Redshift→腾讯云TCHouse-D 数据仓库（migraq 推断 · M6-orphans）
AWS TDStore (Aurora→TDStore) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Aurora（DSQL）→腾讯云TDStore 分布式 SQL（migraq 推断 · M6-orphans）
AWS Vector (Amazon OpenSearch→Vector) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Amazon OpenSearch（向量插件）→腾讯云向量数据库 VectorDB（migraq 推断 · M6-orphans）
AWS AntiDDoS (AWS Shield Advanced→AntiDDoS) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: AWS Shield Advanced→腾讯云DDoS 高防（migraq 推断 · M6-orphans）
AWS BH (AWS Systems Manager Session Manager→BH) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: AWS Systems Manager Session Manager（无独立堡垒机产品）→腾讯云堡垒机（migraq 推断 · M6-orphans）
AWS PrivateDNS (Amazon Route 53 Private Hosted Zones→PrivateDNS) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Amazon Route 53 Private Hosted Zones→腾讯云私有 DNS（migraq 推断 · M6-orphans）
AWS CDH (Amazon EC2 Dedicated Hosts→CDH) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Amazon EC2 Dedicated Hosts→腾讯云CVM 专用宿主机（migraq 推断 · M6-orphans）
AWS CDSAudit (Amazon RDS / Aurora 数据库活动流（Database Activity Streams）+ CloudTrail→CDSAudit) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Amazon RDS / Aurora 数据库活动流（Database Activity Streams）+ CloudTrail→腾讯云数据安全审计（migraq 推断 · M6-orphans）
AWS ADP (Amazon Bedrock Agents→ADP) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Amazon Bedrock Agents→腾讯云腾讯云 Agent 开发平台（migraq 推断 · M6-orphans）
AWS AIArt (Amazon Titan Image Generator / Stable Diffusion on Bedrock→AIArt) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Amazon Titan Image Generator / Stable Diffusion on Bedrock→腾讯云文生图大模型（migraq 推断 · M6-orphans）
AWS AIPay (Amazon Q Developer→AIPay) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Amazon Q Developer（原 CodeWhisperer）→腾讯云CodeBuddy（migraq 推断 · M6-orphans）
AWS CAR (Amazon AppStream 2.0→CAR) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Amazon AppStream 2.0→腾讯云Cloud Application Rendering（migraq 推断 · M6-orphans）
AWS Hunyuan (Amazon Titan / Bedrock 基础模型→Hunyuan) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Amazon Titan / Bedrock 基础模型→腾讯云混元大模型（migraq 推断 · M6-orphans）
AWS FaceID (Amazon Rekognition→FaceID) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Amazon Rekognition（Identity Verification）→腾讯云人脸核身（migraq 推断 · M6-orphans）
AWS IPC (Amazon Rekognition Content Moderation→IPC) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Amazon Rekognition Content Moderation→腾讯云智能预审（migraq 推断 · M6-orphans）
AWS License (Amazon IVS（Interactive Video Service）SDK→License) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Amazon IVS（Interactive Video Service）SDK→腾讯云短视频 SDK（migraq 推断 · M6-orphans）
AWS RUMPro (Amazon CloudWatch RUM→RUMPro) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Amazon CloudWatch RUM→腾讯云前端性能监控 RUM（migraq 推断 · M6-orphans）
AWS TBaaS (Amazon Managed Blockchain→TBaaS) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Amazon Managed Blockchain→腾讯云腾讯云区块链 TBaaS（migraq 推断 · M6-orphans）
AWS TCED (Amazon WorkDocs→TCED) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Amazon WorkDocs→腾讯云腾讯云企业网盘（migraq 推断 · M6-orphans）
华为云 CVM (ECS→CVM) 推荐: engine_grpc 匹配: {"cpu":">=向上取整","memory":">=向上取整","instance_family":"查表映射(1:N候选族列表)"} 排序: CPU升序→Memory升序，取最小满足规格 兜底: 三级兜底:1)指定族匹配 2)扩大族范围 3)全量规格 备注: 华为云ECS→腾讯云CVM，实例族映射仅Standard策略
华为云 CBS (EBS→CBS) 推荐: engine_grpc 匹配: {"disk_type":"查表映射(1:N候选列表按优先级)","disk_size":"边界限幅"} 排序: 按磁盘类型候选列表优先级 备注: 华为云磁盘类型:ESSD/GPSSD/SSD/SAS/SATA等
华为云 EIP (EIP→EIP) 推荐: engine_grpc 匹配: {"bandwidth":"带宽限幅","charge_type":"1:1映射"} 备注: 华为云EIP带宽直传，付费类型0→按量/1→包年包月
华为云 CLB (SLB→CLB) 推荐: engine_grpc 匹配: {"elb_type":"共享/独享映射","network_type":"1:1映射"} 备注: 华为云ELB分共享型和独享型
华为云 COS (OSS→COS) 推荐: engine_grpc 匹配: {"storage_type":"1:1精确映射","size":"保持原值"} 备注: 存储类型:STANDARD/STANDARD_IA/WARM/COLD/DEEP_ARCHIVE/GLACIER
华为云 CFS (NAS→CFS) 推荐: engine_grpc 匹配: {"storage_type":"存储类型映射(SFS/SFS_Turbo_Standard/SFS_Turbo_Performance)","protocol":"NFS"} 兜底: 用通用标准型(SD)兜底 备注: 华为云SFS弹性文件→SD, SFS Turbo标准型→TB, SFS Turbo性能型→TP
华为云 NAT (NAT→NAT) 推荐: engine_grpc 匹配: {"spec":"规格映射(1=小型/2=中型/3=大型/4=超大型)"} 兜底: 默认small 备注: 华为云NAT规格1/2/3/4对应小型/中型/大型/超大型
华为云 Redis (Redis→Redis) 推荐: engine_grpc 匹配: {"architecture":"架构映射","version":">=最近版本","capacity":">=最近有效值"} 排序: 版本>=最近匹配，容量向上取整 兜底: 默认版本6.2 备注: 华为云DCS付费类型:0=按需/1=包年包月
华为云 MySQL (RDS→CDB) 推荐: engine_grpc 匹配: {"cpu":">=最近","memory":">=最近","disk_size":">=最近","version":"直传"} 排序: CPU升序→Memory升序 备注: 华为云RDS实例类型:Single/Ha/Replica
华为云 PostgreSQL (RDS→PostgreSQL) 推荐: engine_grpc 匹配: {"cpu":">=最近","memory":">=最近","disk_size":">=最近","version":"直传"} 排序: CPU升序→Memory升序
华为云 MongoDB (MongoDB→MongoDB) 推荐: engine_grpc 匹配: {"cpu":">=最近","memory":">=最近","disk_size":">=最近","architecture":"ReplicaSet/Sharding/Single"} 排序: CPU升序→Memory升序 备注: 华为云DDS集群类型:ReplicaSet/Sharding/Single
华为云 CSS (视频直播 Live→CSS) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 视频直播 Live→腾讯云云直播（migraq 推断 · M6-orphans）
华为云 MPS (媒体处理 MPC→MPS) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 媒体处理 MPC→腾讯云媒体处理（migraq 推断 · M6-orphans）
华为云 VOD (视频点播 VOD→VOD) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 视频点播 VOD→腾讯云云点播（migraq 推断 · M6-orphans）
华为云 TRTC (云实时音视频 SparkRTC→TRTC) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 云实时音视频 SparkRTC→腾讯云实时音视频（migraq 推断 · M6-orphans）
华为云 AVC (云通信 CPaaS IM→AVC) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 云通信 CPaaS IM→腾讯云Chat（migraq 推断 · M6-orphans）
华为云 SMS (消息&短信服务→SMS) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 消息&短信服务（MSGSMS）→腾讯云短信（migraq 推断 · M6-orphans）
华为云 MQTT (IoTDA（设备接入，含 MQTT）/ DMS for MQTT→MQTT) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: IoTDA（设备接入，含 MQTT）/ DMS for MQTT→腾讯云TDMQ for MQTT（migraq 推断 · M6-orphans）
华为云 trabbit (分布式消息服务 RabbitMQ 版→trabbit) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 分布式消息服务 RabbitMQ 版（DMS for RabbitMQ）→腾讯云TDMQ for RabbitMQ（migraq 推断 · M6-orphans）
华为云 TCHouseD (DWS→TCHouseD) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: DWS（数据仓库服务）→腾讯云TCHouse-D 数据仓库（migraq 推断 · M6-orphans）
华为云 TDStore (GaussDB 分布式版→TDStore) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: GaussDB 分布式版→腾讯云TDStore 分布式 SQL（migraq 推断 · M6-orphans）
华为云 AntiDDoS (Anti-DDoS流量清洗→AntiDDoS) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Anti-DDoS流量清洗（AAD）→腾讯云DDoS 高防（migraq 推断 · M6-orphans）
华为云 BH (云堡垒机→BH) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 云堡垒机（CBH）→腾讯云堡垒机（migraq 推断 · M6-orphans）
华为云 PrivateDNS (云解析服务（DNS）内网域名解析→PrivateDNS) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 云解析服务（DNS）内网域名解析→腾讯云私有 DNS（migraq 推断 · M6-orphans）
华为云 CDH (专属主机→CDH) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 专属主机（Dedicated Host）→腾讯云CVM 专用宿主机（migraq 推断 · M6-orphans）
华为云 CDSAudit (数据库安全审计→CDSAudit) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 数据库安全审计（DBSS）→腾讯云数据安全审计（migraq 推断 · M6-orphans）
华为云 ADP (华为云 AppStage / ModelArts Agent→ADP) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 华为云 AppStage / ModelArts Agent→腾讯云腾讯云 Agent 开发平台（migraq 推断 · M6-orphans）
华为云 AIArt (华为云盘古图像大模型→AIArt) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 华为云盘古图像大模型→腾讯云文生图大模型（migraq 推断 · M6-orphans）
华为云 AIPay (华为云 CodeArts Snap→AIPay) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 华为云 CodeArts Snap→腾讯云CodeBuddy（migraq 推断 · M6-orphans）
华为云 CAR (华为云云应用 CloudApp→CAR) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 华为云云应用 CloudApp→腾讯云Cloud Application Rendering（migraq 推断 · M6-orphans）
华为云 Hunyuan (华为云盘古大模型→Hunyuan) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 华为云盘古大模型→腾讯云混元大模型（migraq 推断 · M6-orphans）
华为云 FaceID (华为云人脸识别服务→FaceID) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 华为云人脸识别服务（人证核验）→腾讯云人脸核身（migraq 推断 · M6-orphans）
华为云 IPC (华为云内容审核→IPC) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 华为云内容审核（Content Moderation）→腾讯云智能预审（migraq 推断 · M6-orphans）
华为云 IVH (华为云 MetaStudio 数字内容生产线→IVH) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 华为云 MetaStudio 数字内容生产线→腾讯云腾讯云数智人（migraq 推断 · M6-orphans）
华为云 LeXiang (华为云 WeLink 知识社区→LeXiang) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 华为云 WeLink 知识社区→腾讯云腾讯乐享（migraq 推断 · M6-orphans）
华为云 License (华为云视频直播 SDK→License) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 华为云视频直播 SDK→腾讯云短视频 SDK（migraq 推断 · M6-orphans）
华为云 RUMPro (华为云 APM 前端监控→RUMPro) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 华为云 APM 前端监控→腾讯云前端性能监控 RUM（migraq 推断 · M6-orphans）
华为云 TBaaS (华为云区块链服务→TBaaS) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 华为云区块链服务（BCS）→腾讯云腾讯云区块链 TBaaS（migraq 推断 · M6-orphans）
华为云 TCED (华为云 WeLink 云空间→TCED) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: 华为云 WeLink 云空间→腾讯云腾讯云企业网盘（migraq 推断 · M6-orphans）
IDC CVM (ECS→CVM) 推荐: engine_grpc 匹配: {"cpu":">=向上取整","memory":">=向上取整","instance_family":"查表映射(通用族列表)"} 排序: CPU升序→Memory升序，取最小满足规格 兜底: 三级兜底 备注: IDC无源实例族，使用通用目标族列表
GCP CVM (ECS→CVM) 推荐: engine_grpc 匹配: {"cpu":">=向上取整","memory":">=向上取整","instance_family":"查表映射(1:N候选族列表)"} 排序: CPU升序→Memory升序，取最小满足规格 兜底: 三级兜底 备注: GCP实例族映射仅Standard策略
GCP CBS (EBS→CBS) 推荐: engine_grpc 匹配: {"disk_type":"查表映射","disk_size":"边界限幅"} 备注: GCP磁盘:pd-standard/pd-balanced/pd-ssd/pd-extreme
GCP CLB (SLB→CLB) 推荐: engine_grpc 匹配: {"lb_type":"类型映射"}
GCP COS (OSS→COS) 推荐: engine_grpc 匹配: {"storage_type":"1:1精确映射","size":"保持原值"} 备注: GCP存储类型已在枚举映射表中
GCP CFS (NAS→CFS) 推荐: engine_grpc 匹配: {"tier":"服务层级映射(BASIC_HDD/BASIC_SSD/HIGH_SCALE_SSD/ENTERPRISE)","protocol":"NFS"} 兜底: 用通用标准型(SD)兜底 备注: GCP Filestore BASIC_HDD→SD, BASIC_SSD→HP, HIGH_SCALE_SSD→TP, ENTERPRISE→TB
GCP NAT (NAT→NAT) 推荐: engine_grpc 匹配: {"spec":"规格映射"}
GCP VPN (VPN→VPN) 推荐: engine_grpc 匹配: {"bandwidth":">=最近有效值"}
GCP Redis (Redis→Redis) 推荐: engine_grpc 匹配: {"capacity":">=最近有效值","version":">=最近版本"}
GCP MySQL (RDS→CDB) 推荐: engine_grpc 匹配: {"cpu":">=最近","memory":">=最近","disk_size":">=最近","version":"直传"} 排序: CPU升序→Memory升序
GCP PostgreSQL (RDS→PostgreSQL) 推荐: engine_grpc 匹配: {"cpu":">=最近","memory":">=最近","disk_size":">=最近","version":"直传"} 排序: CPU升序→Memory升序
GCP TKE (GKE→TKE) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Google Kubernetes Engine→腾讯云TKE
GCP SCF (CloudFunctions→SCF) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Google Cloud Run Functions→腾讯云SCF
GCP TCR (ArtifactRegistry→TCR) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Google Artifact Registry→腾讯云TCR
GCP DNSPod (CloudDNS→DNSPod) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Google Cloud DNS→腾讯云DNSPod
GCP CSS (Live Stream API→CSS) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Live Stream API→腾讯云云直播（migraq 推断 · M6-orphans）
GCP MPS (Transcoder API→MPS) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Transcoder API（部分重叠）→腾讯云媒体处理（migraq 推断 · M6-orphans）
GCP VOD (Video Stitcher API→VOD) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Video Stitcher API（部分重叠）→腾讯云云点播（migraq 推断 · M6-orphans）
GCP AVC (Firebase Realtime Database / Firebase Cloud Messaging→AVC) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Firebase Realtime Database / Firebase Cloud Messaging（弱对标）→腾讯云Chat（migraq 推断 · M6-orphans）
GCP MQTT (Cloud IoT Core→MQTT) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Cloud IoT Core（含 MQTT）→腾讯云TDMQ for MQTT（migraq 推断 · M6-orphans）
GCP TcaplusDB (Cloud Bigtable→TcaplusDB) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Cloud Bigtable→腾讯云TcaplusDB（migraq 推断 · M6-orphans）
GCP CTSDB (Cloud Bigtable→CTSDB) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Cloud Bigtable（时序场景）→腾讯云时序数据库 CTSDB（migraq 推断 · M6-orphans）
GCP TCHouseD (BigQuery→TCHouseD) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: BigQuery→腾讯云TCHouse-D 数据仓库（migraq 推断 · M6-orphans）
GCP TDStore (Cloud Spanner→TDStore) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Cloud Spanner→腾讯云TDStore 分布式 SQL（migraq 推断 · M6-orphans）
GCP Vector (Vertex AI Vector Search→Vector) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Vertex AI Vector Search→腾讯云向量数据库 VectorDB（migraq 推断 · M6-orphans）
GCP AntiDDoS (Cloud Armor→AntiDDoS) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Cloud Armor→腾讯云DDoS 高防（migraq 推断 · M6-orphans）
GCP PrivateDNS (Cloud DNS→PrivateDNS) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Cloud DNS（Private Zones）→腾讯云私有 DNS（migraq 推断 · M6-orphans）
GCP CDH (Sole-Tenant Nodes→CDH) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Sole-Tenant Nodes→腾讯云CVM 专用宿主机（migraq 推断 · M6-orphans）
GCP CDSAudit (Cloud Audit Logs→CDSAudit) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Cloud Audit Logs（Database 审计功能）→腾讯云数据安全审计（migraq 推断 · M6-orphans）
GCP ADP (Vertex AI Agent Builder→ADP) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Vertex AI Agent Builder→腾讯云腾讯云 Agent 开发平台（migraq 推断 · M6-orphans）
GCP AIArt (Imagen on Vertex AI→AIArt) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Imagen on Vertex AI→腾讯云文生图大模型（migraq 推断 · M6-orphans）
GCP AIPay (Gemini Code Assist→AIPay) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Gemini Code Assist→腾讯云CodeBuddy（migraq 推断 · M6-orphans）
GCP Hunyuan (Gemini 系列模型→Hunyuan) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Gemini 系列模型→腾讯云混元大模型（migraq 推断 · M6-orphans）
GCP FaceID (Google Cloud Identity Platform + Vision API→FaceID) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Google Cloud Identity Platform + Vision API→腾讯云人脸核身（migraq 推断 · M6-orphans）
GCP IPC (Google Cloud Video/Image Intelligence API→IPC) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Google Cloud Video/Image Intelligence API→腾讯云智能预审（migraq 推断 · M6-orphans）
GCP License (Google ML Kit Video SDK→License) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Google ML Kit Video SDK→腾讯云短视频 SDK（migraq 推断 · M6-orphans）
GCP RUMPro (Google Cloud Operations / Firebase Performance→RUMPro) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Google Cloud Operations / Firebase Performance→腾讯云前端性能监控 RUM（migraq 推断 · M6-orphans）
GCP TCED (Google Workspace Drive→TCED) 推荐: direct_mapping 匹配: {"service":"产品级映射"} 备注: Google Workspace Drive（企业版）→腾讯云腾讯云企业网盘（migraq 推断 · M6-orphans）
