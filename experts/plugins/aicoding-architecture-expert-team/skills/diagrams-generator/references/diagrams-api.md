# Diagrams API Reference

Complete node import paths for Python `diagrams` library.

## GCP (Google Cloud Platform)

### Compute
```python
from diagrams.gcp.compute import (
    AppEngine, GAE,           # App Engine
    ComputeEngine, GCE,       # Compute Engine
    Functions, GCF,           # Cloud Functions
    KubernetesEngine, GKE,    # GKE
    Run, CloudRun,            # Cloud Run
    GPU,
)
```

### Database
```python
from diagrams.gcp.database import (
    Bigtable, BigTable,
    Datastore,
    Firestore,
    Memorystore,              # Redis/Memcached
    Spanner,
    SQL,                      # Cloud SQL
)
```

### Network
```python
from diagrams.gcp.network import (
    Armor,                    # Cloud Armor
    CDN,
    DNS,
    FirewallRules,
    LoadBalancing,
    NAT,
    Router,
    VirtualPrivateCloud, VPC,
    VPN,
)
```

### Storage
```python
from diagrams.gcp.storage import (
    Filestore,
    PersistentDisk,
    Storage, GCS,             # Cloud Storage
)
```

### Analytics
```python
from diagrams.gcp.analytics import (
    Bigquery, BigQuery,
    Composer,
    Dataflow,
    Dataproc,
    Pubsub, PubSub,
)
```

### Security
```python
from diagrams.gcp.security import (
    Iam,
    KeyManagementService, KMS,
    SecretManager,
    SecurityCommandCenter, SCC,
)
```

### ML
```python
from diagrams.gcp.ml import (
    AIPlatform,
    AutoML,
    VertexAI,
    VisionAPI,
    SpeechToText, STT,
    TextToSpeech, TTS,
)
```

### DevTools
```python
from diagrams.gcp.devtools import (
    Build,                    # Cloud Build
    ContainerRegistry, GCR,
    SourceRepositories,
    Scheduler,
)
```

### Operations
```python
from diagrams.gcp.operations import (
    Logging,
    Monitoring,
)
```

## AWS (Amazon Web Services)

### Compute
```python
from diagrams.aws.compute import (
    EC2,
    Lambda,
    ECS,
    EKS,
    Fargate,
    Batch,
    ElasticBeanstalk,
)
```

### Database
```python
from diagrams.aws.database import (
    RDS,
    Aurora,
    DynamoDB,
    Elasticache,
    Redshift,
    Neptune,
)
```

### Network
```python
from diagrams.aws.network import (
    ELB, ALB, NLB,
    CloudFront,
    Route53,
    VPC,
    APIGateway,
    DirectConnect,
)
```

### Storage
```python
from diagrams.aws.storage import (
    S3,
    EBS,
    EFS,
    Glacier,
)
```

### Analytics
```python
from diagrams.aws.analytics import (
    Athena,
    EMR,
    Glue,
    Kinesis,
    Quicksight,
    Redshift,
)
```

### ML
```python
from diagrams.aws.ml import (
    Sagemaker,
    Rekognition,
    Comprehend,
    Polly,
    Lex,
)
```

### Security
```python
from diagrams.aws.security import (
    IAM,
    Cognito,
    KMS,
    WAF,
    Shield,
    SecretsManager,
)
```

### Integration
```python
from diagrams.aws.integration import (
    SQS,
    SNS,
    EventBridge,
    StepFunctions,
)
```

## Azure

### Compute
```python
from diagrams.azure.compute import (
    VM,
    VMScaleSet,
    FunctionApps,
    ContainerInstances,
    KubernetesServices, AKS,
    AppServices,
)
```

### Database
```python
from diagrams.azure.database import (
    SQLDatabases,
    CosmosDb,
    CacheForRedis,
    BlobStorage,
)
```

### Network
```python
from diagrams.azure.network import (
    LoadBalancers,
    ApplicationGateway,
    VirtualNetworks,
    DNS,
    CDNProfiles,
    Firewall,
)
```

## Kubernetes (K8s)

### Compute
```python
from diagrams.k8s.compute import (
    Pod,
    Deployment,
    ReplicaSet,
    StatefulSet,
    DaemonSet,
    Job,
    CronJob,
)
```

### Network
```python
from diagrams.k8s.network import (
    Service,
    Ingress,
    NetworkPolicy,
)
```

### Storage
```python
from diagrams.k8s.storage import (
    PersistentVolume, PV,
    PersistentVolumeClaim, PVC,
    StorageClass, SC,
)
```

### Cluster
```python
from diagrams.k8s.clusterconfig import (
    HPA,
    Limits,
    Quota,
)
```

## On-Premise / Generic

### Client
```python
from diagrams.onprem.client import (
    User,
    Users,
    Client,
)
```

### Database
```python
from diagrams.onprem.database import (
    PostgreSQL,
    MySQL,
    MongoDB,
    Redis,
    Cassandra,
    ClickHouse,
    Elasticsearch,
)
```

### Queue
```python
from diagrams.onprem.queue import (
    Kafka,
    RabbitMQ,
    Celery,
)
```

### CI/CD
```python
from diagrams.onprem.ci import (
    Jenkins,
    GithubActions,
    GitlabCI,
    CircleCI,
)
```

### Container
```python
from diagrams.onprem.container import (
    Docker,
)
```

### Network
```python
from diagrams.onprem.network import (
    Nginx,
    Apache,
    Traefik,
    Kong,
    Envoy,
)
```

### Monitoring
```python
from diagrams.onprem.monitoring import (
    Prometheus,
    Grafana,
    Datadog,
)
```

### Logging
```python
from diagrams.onprem.logging import (
    Fluentd,
    Logstash,
)
```

## Generic Icons

```python
from diagrams.generic.compute import Rack
from diagrams.generic.database import SQL
from diagrams.generic.network import Firewall, Router, Switch
from diagrams.generic.storage import Storage
from diagrams.generic.os import Windows, Linux, Android, IOS
```

## Programming Languages

```python
from diagrams.programming.language import (
    Python,
    Go,
    Java,
    JavaScript,
    TypeScript,
    Rust,
    Cpp,
)
```

## SaaS

```python
from diagrams.saas.analytics import Snowflake
from diagrams.saas.cdn import Cloudflare
from diagrams.saas.chat import Slack, Teams
from diagrams.saas.identity import Auth0, Okta
from diagrams.saas.logging import Datadog, NewRelic
```
