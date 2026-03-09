# Kubernetes Setup Guide

Complete setup guide for running the Pinot Agent System locally on OrbStack with Prometheus, Grafana, and Apache Pinot.

## Prerequisites

- **OrbStack** with Kubernetes enabled (provides a single-node k8s v1.33.5+orb1 cluster)
- **Helm 3.x** (`brew install helm`)
- **kubectl** configured for the OrbStack context (`kubectl config use-context orbstack`)
- **Docker** (included with OrbStack)

Verify your environment:

```bash
kubectl cluster-info
helm version
```

---

## Pinot Installation

### 1. Create the namespace

```bash
kubectl create namespace pinot
```

### 2. Add the Pinot Helm repository

```bash
helm repo add apachepinot https://apachepinot.github.io/pinot-helm-charts
helm repo update
```

### 3. Create a values file for local development

Save the following as `pinot-values.yaml`:

```yaml
# pinot-values.yaml — minimal local dev configuration
cluster:
  name: pinot-local

controller:
  replicaCount: 1
  resources:
    requests:
      cpu: 100m
      memory: 512Mi
    limits:
      memory: 1Gi

broker:
  replicaCount: 1
  resources:
    requests:
      cpu: 100m
      memory: 512Mi
    limits:
      memory: 1Gi

server:
  replicaCount: 1
  resources:
    requests:
      cpu: 100m
      memory: 512Mi
    limits:
      memory: 1Gi

minion:
  replicaCount: 1
  resources:
    requests:
      cpu: 100m
      memory: 256Mi
    limits:
      memory: 512Mi

zookeeper:
  replicaCount: 1
  resources:
    requests:
      cpu: 50m
      memory: 256Mi
    limits:
      memory: 512Mi
```

### 4. Install Pinot

```bash
helm install pinot apachepinot/pinot \
  --namespace pinot \
  -f pinot-values.yaml \
  --timeout 10m
```

### 5. Verify Pinot is running

```bash
kubectl get pods -n pinot
```

All pods should reach `Running` status. ZooKeeper starts first, then controller, then broker and server.

You can access the Pinot controller UI via port-forward:

```bash
kubectl port-forward -n pinot svc/pinot-controller 9000:9000
# Open http://localhost:9000 in your browser
```

---

## Prometheus Installation

Prometheus is installed via the `kube-prometheus-stack` Helm chart, which bundles Prometheus, Grafana, and the necessary CRDs (ServiceMonitor, PodMonitor, etc.).

### 1. Create the namespace

```bash
kubectl create namespace monitoring
```

### 2. Add the Helm repository

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
```

### 3. Create a values file

Save the following as `prometheus-values.yaml`:

```yaml
# prometheus-values.yaml — local dev configuration

prometheus:
  prometheusSpec:
    retention: 7d
    resources:
      requests:
        cpu: 100m
        memory: 512Mi
      limits:
        memory: 1Gi

    # Scrape ServiceMonitors from all namespaces
    serviceMonitorSelectorNilUsesHelmValues: false
    podMonitorSelectorNilUsesHelmValues: false

    # Additional scrape configs for Pinot components and agents
    additionalScrapeConfigs:
      # Pinot Controller metrics
      - job_name: "pinot-controller"
        kubernetes_sd_configs:
          - role: pod
            namespaces:
              names: ["pinot"]
        relabel_configs:
          - source_labels: [__meta_kubernetes_pod_label_app, __meta_kubernetes_pod_label_component]
            regex: pinot;controller
            action: keep
          - target_label: __address__
            replacement: "${1}:9000"
            source_labels: [__meta_kubernetes_pod_ip]
        metrics_path: /metrics

      # Pinot Broker metrics
      - job_name: "pinot-broker"
        kubernetes_sd_configs:
          - role: pod
            namespaces:
              names: ["pinot"]
        relabel_configs:
          - source_labels: [__meta_kubernetes_pod_label_app, __meta_kubernetes_pod_label_component]
            regex: pinot;broker
            action: keep
          - target_label: __address__
            replacement: "${1}:8099"
            source_labels: [__meta_kubernetes_pod_ip]
        metrics_path: /metrics

      # Pinot Server metrics
      - job_name: "pinot-server"
        kubernetes_sd_configs:
          - role: pod
            namespaces:
              names: ["pinot"]
        relabel_configs:
          - source_labels: [__meta_kubernetes_pod_label_app, __meta_kubernetes_pod_label_component]
            regex: pinot;server
            action: keep
          - target_label: __address__
            replacement: "${1}:8097"
            source_labels: [__meta_kubernetes_pod_ip]
        metrics_path: /metrics

      # Pinot Agents (future — these services don't expose /metrics yet)
      - job_name: "pinot-agents"
        static_configs:
          - targets:
              - "pinot-agents-monitor.pinot.svc.cluster.local:3000"
              - "pinot-agents-mitigator.pinot.svc.cluster.local:3001"
              - "pinot-agents-operator.pinot.svc.cluster.local:3002"
        metrics_path: /metrics

grafana:
  adminUser: admin
  adminPassword: admin
  resources:
    requests:
      cpu: 50m
      memory: 128Mi
    limits:
      memory: 256Mi

alertmanager:
  enabled: false

nodeExporter:
  enabled: true
  resources:
    requests:
      cpu: 20m
      memory: 32Mi

kubeStateMetrics:
  enabled: true
```

### 4. Install the stack

```bash
helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  -f prometheus-values.yaml \
  --timeout 10m
```

### 5. Verify Prometheus is running

```bash
kubectl get pods -n monitoring
```

Access the Prometheus UI:

```bash
kubectl port-forward -n monitoring svc/prometheus-kube-prometheus-prometheus 9090:9090
# Open http://localhost:9090 in your browser
```

---

## Grafana

Grafana is included in the `kube-prometheus-stack` installation above.

### Access Grafana

**Option A: Port-forward**

```bash
kubectl port-forward -n monitoring svc/prometheus-grafana 3030:80
# Open http://localhost:3030
```

(Port 3030 is used to avoid conflicts with the Monitor agent on port 3000.)

**Option B: OrbStack domain routing**

OrbStack exposes services at `<svc>.<namespace>.svc.orb.local`. Access Grafana at:

```
http://prometheus-grafana.monitoring.svc.orb.local
```

### Default credentials

- **Username:** `admin`
- **Password:** `admin`

### Data sources

Prometheus is automatically configured as a data source by the kube-prometheus-stack chart. No manual configuration is needed.

---

## Pinot Agent System Installation

The agent system is deployed via a Helm chart located in this repository.

### 1. Build and load the Docker image

```bash
# Build the image
docker build -t pinot-monitor:latest /Users/richard/git/pinot-monitor

# OrbStack automatically makes locally-built images available to k8s,
# so no explicit load step is needed.
```

### 2. Install the agents

```bash
helm install pinot-agents ./k8s/helm/pinot-agents \
  --namespace pinot \
  --set image.repository=pinot-monitor \
  --set image.tag=latest \
  --set image.pullPolicy=Never \
  --set ollama.host=host.internal \
  --set ollama.port=11434 \
  --set ollama.model=qwen3:32b \
  --set trustLevel=low \
  --set dryRun=true
```

### Key configuration values

| Value | Default | Description |
|-------|---------|-------------|
| `ollama.host` | `host.internal` | Ollama hostname (use `host.internal` in-cluster) |
| `ollama.port` | `11434` | Ollama port |
| `ollama.model` | `qwen3:32b` | LLM model to use |
| `trustLevel` | `low` | Agent trust level (`low`, `medium`, `high`) |
| `dryRun` | `true` | When true, mitigator logs actions without executing |
| `openai.apiKey` | (none) | Set this to use OpenAI instead of Ollama |
| `openai.baseUrl` | (none) | OpenAI-compatible API base URL |

### Using OpenAI instead of Ollama

```bash
helm install pinot-agents ./k8s/helm/pinot-agents \
  --namespace pinot \
  --set openai.apiKey=$OPENAI_API_KEY \
  --set openai.baseUrl=https://api.openai.com/v1 \
  --set ollama.model=gpt-4o
```

---

## Verification

### Check all components are running

```bash
# Pinot
kubectl get pods -n pinot

# Monitoring stack
kubectl get pods -n monitoring

# Agent system
kubectl get pods -n pinot -l app=pinot-agents
```

### Trigger a manual sweep

```bash
# Port-forward the monitor service
kubectl port-forward -n pinot svc/pinot-agents-monitor 3000:3000 &

# Trigger a sweep
curl -s http://localhost:3000/sweep | jq .
```

### Check the audit log

```bash
kubectl port-forward -n pinot svc/pinot-agents-operator 3002:3002 &
curl -s http://localhost:3002/audit | jq .
```

### View Prometheus targets

Open the Prometheus UI at `http://localhost:9090/targets` (after port-forwarding) to confirm Pinot metrics endpoints are being scraped.

---

## Troubleshooting

### OrbStack Kubernetes issues

- **Pods stuck in Pending:** OrbStack runs a single-node cluster. Check resource usage with `kubectl describe node orb` and reduce resource requests in your values files if the node is overcommitted.
- **Image pull errors:** Ensure you are using `imagePullPolicy: Never` (or `IfNotPresent`) for locally built images. OrbStack makes local Docker images available to k8s automatically.
- **Context not set:** Run `kubectl config use-context orbstack` to switch to the OrbStack cluster.

### Ollama connectivity from inside the cluster

Pods cannot reach `localhost` on the host machine. Use `host.internal:11434` as the Ollama address. This hostname is resolved by OrbStack to the host's IP.

Verify connectivity from inside a pod:

```bash
kubectl run -it --rm curl-test --image=curlimages/curl --restart=Never -- \
  curl -s http://host.internal:11434/api/tags
```

### Resource constraints

The full stack (Pinot + Prometheus + Grafana + Agents) requires approximately 4-6 GB of RAM. If your machine is constrained:

1. Reduce Pinot memory limits in `pinot-values.yaml`
2. Disable node-exporter and kube-state-metrics in `prometheus-values.yaml`
3. Run only the Monitor agent initially (skip Operator and Mitigator)

### Pinot pods crash-looping

ZooKeeper must be healthy before controller, broker, and server pods can start. Check ZooKeeper logs first:

```bash
kubectl logs -n pinot -l component=zookeeper
```

If ZooKeeper is healthy but other components fail, check for insufficient memory:

```bash
kubectl describe pod -n pinot <pod-name> | grep -A5 "Last State"
```

### Prometheus not scraping Pinot metrics

Verify the scrape targets are reachable by checking the Prometheus Targets page. Common issues:

- Pod labels do not match the relabel config (check with `kubectl get pods -n pinot --show-labels`)
- Pinot metrics port is not exposed (ensure the Helm chart exposes the correct ports)
- Network policies blocking cross-namespace traffic (not typically an issue on OrbStack)
