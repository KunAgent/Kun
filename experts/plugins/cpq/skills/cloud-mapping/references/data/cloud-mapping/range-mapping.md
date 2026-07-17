# 数值范围映射

各产品参数的有效范围、有效值列表和匹配规则。每行格式：
`<产品> <参数名> (<厂商>): <下限>~<上限> (<单位>) 匹配: <方法> [默认: <值>] [有效值: [...]] | <说明>`
CBS data_disk_size (阿里云): 20.00~32000.00 (GB) 匹配: clamp 默认: 40.00 | 数据盘大小范围，小于20取20，大于32000取32000，默认40GB
CBS data_disk_size (AWS): 20.00~32000.00 (GB) 匹配: clamp 默认: 40.00 | 数据盘大小范围，小于20取20，大于32000取32000
CBS data_disk_size (GCP): 20.00~32000.00 (GB) 匹配: clamp 默认: 40.00 | 数据盘大小范围
CBS data_disk_size (华为云): 20.00~32000.00 (GB) 匹配: clamp 默认: 40.00 | 数据盘大小范围，小于20取20，大于32000取32000
CBS data_disk_size (IDC): 20.00~32000.00 (GB) 匹配: clamp 默认: 40.00 | 数据盘大小范围
CBS system_disk_size (阿里云): 50.00~2048.00 (GB) 匹配: clamp 默认: 50.00 | 系统盘大小范围，小于50取50，大于2048取2048
CBS system_disk_size (AWS): 50.00~2048.00 (GB) 匹配: clamp 默认: 50.00 | 系统盘大小范围，小于50取50，大于2048取2048
CBS system_disk_size (GCP): 50.00~2048.00 (GB) 匹配: clamp 默认: 50.00 | 系统盘大小范围
CBS system_disk_size (华为云): 50.00~2048.00 (GB) 匹配: clamp 默认: 50.00 | 系统盘大小范围，小于50取50，大于2048取2048
CBS system_disk_size (IDC): 50.00~2048.00 (GB) 匹配: clamp 默认: 50.00 | 系统盘大小范围
CLB clb_bw_c2_medium (阿里云): 0.00~2048.00 (Mbps) 匹配: clamp | 标准型(clb.c2.medium)适用带宽<=2048Mbps
CLB clb_bw_c3_medium (阿里云): 4097.00~6144.00 (Mbps) 匹配: clamp | 高阶型2(clb.c3.medium)适用带宽<=6144Mbps
CLB clb_bw_c3_small (阿里云): 2049.00~4096.00 (Mbps) 匹配: clamp | 高阶型1(clb.c3.small)适用带宽<=4096Mbps
CLB clb_bw_c4_large (阿里云): 20481.00~40960.00 (Mbps) 匹配: clamp | 超强型3(clb.c4.large)适用带宽<=40960Mbps
CLB clb_bw_c4_medium (阿里云): 10241.00~20480.00 (Mbps) 匹配: clamp | 超强型2(clb.c4.medium)适用带宽<=20480Mbps
CLB clb_bw_c4_small (阿里云): 6145.00~10240.00 (Mbps) 匹配: clamp | 超强型1(clb.c4.small)适用带宽<=10240Mbps
CLB clb_bw_c4_xlarge (阿里云): 40961.00~61440.00 (Mbps) 匹配: clamp | 超强型4(clb.c4.xlarge)适用带宽<=61440Mbps
CLB clb_bw_exclusive (AWS): 0.00~61440.00 (Mbps) 匹配: clamp | 性能容量型(NLB/GWLB)带宽上限
CLB clb_bw_exclusive (GCP): 0.00~61440.00 (Mbps) 匹配: clamp | 性能容量型带宽上限
CLB clb_bw_exclusive (华为云): 0.00~61440.00 (Mbps) 匹配: clamp | 独享型CLB带宽上限
CLB clb_bw_shared (阿里云): 0.00~2048.00 (Mbps) 匹配: clamp 默认: 2048.00 | 共享型CLB带宽上限2048Mbps
CLB clb_bw_shared (AWS): 0.00~2048.00 (Mbps) 匹配: clamp 默认: 2048.00 | 共享型(ALB/CLB)带宽上限
CLB clb_bw_shared (GCP): 0.00~2048.00 (Mbps) 匹配: clamp 默认: 2048.00 | 共享型带宽上限
CLB clb_bw_shared (华为云): 0.00~2048.00 (Mbps) 匹配: clamp 默认: 2048.00 | 共享型CLB带宽上限
EIP eip_bw_bandwidth (华为云): 0.00~200.00 (Mbps) 匹配: clamp | 按带宽计费带宽上限200Mbps
EIP eip_bw_package (阿里云): 0.00~2000.00 (Mbps) 匹配: clamp | 共享带宽包(BANDWIDTH_PACKAGE)带宽上限2000Mbps
EIP eip_bw_postpaid (阿里云): 0.00~200.00 (Mbps) 匹配: clamp | 按小时带宽(BANDWIDTH_POSTPAID_BY_HOUR)带宽上限200Mbps
EIP eip_bw_prepaid (阿里云): 0.00~100.00 (Mbps) 匹配: clamp | 包月带宽(BANDWIDTH_PREPAID_BY_MONTH)带宽上限100Mbps
EIP eip_bw_prepaid (华为云): 0.00~100.00 (Mbps) 匹配: clamp | 包月带宽上限100Mbps
EIP eip_bw_traffic (阿里云): 0.00~100.00 (Mbps) 匹配: clamp | 按流量计费(TRAFFIC_POSTPAID_BY_HOUR)带宽上限100Mbps
EIP eip_bw_traffic (AWS): 0.00~100.00 (Mbps) 匹配: clamp | AWS EIP按流量计费，带宽上限100Mbps
EIP eip_bw_traffic (华为云): 0.00~100.00 (Mbps) 匹配: clamp | 按流量计费带宽上限100Mbps
NAT nat_max_connections_large (阿里云): 3000001.00~10000000.00 (个) 匹配: clamp | <=1000万连接→large
NAT nat_max_connections_middle (阿里云): 1000001.00~3000000.00 (个) 匹配: clamp | <=300万连接→middle
NAT nat_max_connections_small (阿里云): 0.00~1000000.00 (个) 匹配: clamp | <=100万连接→small
NAT nat_out_bandwidth (阿里云): 10.00~5000.00 (Mbps) 匹配: nearest_gte 默认: 10.00 有效值: [10,20,50,100,200,500,1000,2000,5000] | 从有效值列表中取>=源端的最小值，默认10
NAT nat_out_bandwidth (华为云): 10.00~5000.00 (Mbps) 匹配: nearest_gte 默认: 10.00 有效值: [10,20,50,100,200,500,1000,2000,5000] | 从有效值列表中取>=源端的最小值
Redis redis_cluster_shard_memory (阿里云): 1.00~64.00 (GB) 匹配: nearest_gte 有效值: [1,2,4,6,8,10,12,16,20,24,32,40,48,64] | 集群架构单分片内存有效值
Redis redis_cluster_shard_memory (AWS): 1.00~64.00 (GB) 匹配: nearest_gte 有效值: [1,2,4,6,8,10,12,16,20,24,32,40,48,64] | 集群架构单分片内存有效值
Redis redis_cluster_shard_memory (华为云): 1.00~64.00 (GB) 匹配: nearest_gte 有效值: [1,2,4,6,8,10,12,16,20,24,32,40,48,64] | 集群架构单分片内存有效值
Redis redis_cluster_shard_num (阿里云): 1.00~128.00 (个) 匹配: nearest_gte 默认: 128.00 有效值: [1,3,5,8,12,16,24,32,40,48,64,80,96,128] | 集群架构分片数有效值
Redis redis_cluster_shard_num (AWS): 1.00~128.00 (个) 匹配: nearest_gte 默认: 128.00 有效值: [1,3,5,8,12,16,24,32,40,48,64,80,96,128] | 集群架构分片数有效值
Redis redis_cluster_shard_num (华为云): 1.00~128.00 (个) 匹配: nearest_gte 默认: 128.00 有效值: [1,3,5,8,12,16,24,32,40,48,64,80,96,128] | 集群架构分片数有效值
Redis redis_replica_num (阿里云): 1.00~9.00 (个) 匹配: clamp 默认: 1.00 | 副本数范围[1,9]，不在范围内则取边界值
Redis redis_replica_num (AWS): 1.00~9.00 (个) 匹配: clamp 默认: 1.00 | 副本数范围[1,9]
Redis redis_replica_num (GCP): 1.00~9.00 (个) 匹配: clamp 默认: 1.00 | 副本数范围[1,9]
Redis redis_replica_num (华为云): 1.00~9.00 (个) 匹配: clamp 默认: 1.00 | 副本数范围[1,9]
Redis redis_standard_memory (阿里云): 0.25~64.00 (GB) 匹配: nearest_gte 有效值: [0.25,0.5,1,2,4,6,8,10,12,16,20,24,32,40,48,64] | 标准架构单实例内存有效值
Redis redis_standard_memory (AWS): 0.25~64.00 (GB) 匹配: nearest_gte 有效值: [0.25,0.5,1,2,4,6,8,10,12,16,20,24,32,40,48,64] | 标准架构单实例内存有效值
Redis redis_standard_memory (GCP): 0.25~64.00 (GB) 匹配: nearest_gte 有效值: [0.25,0.5,1,2,4,6,8,10,12,16,20,24,32,40,48,64] | 标准架构内存有效值
Redis redis_standard_memory (华为云): 0.25~64.00 (GB) 匹配: nearest_gte 有效值: [0.25,0.5,1,2,4,6,8,10,12,16,20,24,32,40,48,64] | 标准架构单实例内存有效值
VPN vpn_ipsec_bandwidth (阿里云): 5.00~3000.00 (MB) 匹配: nearest_gte 默认: 1000.00 有效值: [5,10,20,50,100,200,500,1000,3000] | IPSEC VPN带宽有效值
VPN vpn_ipsec_bandwidth (AWS): 5.00~3000.00 (MB) 匹配: nearest_gte 默认: 1000.00 有效值: [5,10,20,50,100,200,500,1000,3000] | IPSEC VPN带宽有效值
VPN vpn_ipsec_bandwidth (华为云): 5.00~3000.00 (MB) 匹配: nearest_gte 默认: 1000.00 有效值: [5,10,20,50,100,200,500,1000,3000] | IPSEC VPN带宽有效值
VPN vpn_ssl_bandwidth (阿里云): 5.00~1000.00 (MB) 匹配: nearest_gte 默认: 1000.00 有效值: [5,10,20,50,100,200,500,1000] | SSL VPN带宽有效值，从列表取>=源端的最小值
VPN vpn_ssl_connections (阿里云): 5.00~100.00 (个) 匹配: nearest_gte 默认: 100.00 有效值: [5,10,20,50,100] | SSL VPN最大连接数有效值
