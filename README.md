# queue-lab

Load-test a BullMQ job pipeline end to end.

A Next.js app (on Vercel) lets you enter how many jobs to create and how long each
should take. It enqueues them to Redis. A NestJS worker (on GKE Autopilot, scaled by
KEDA) processes them. You watch the queue drain live and measure whether any job is
processed twice.

```
┌──────────────┐    addBulk     ┌────────────┐    BLPOP/process   ┌───────────────┐
│  apps/web    │ ─────────────▶ │   Redis    │ ◀───────────────── │  apps/worker  │
│  (Vercel)    │                │ (Upstash)  │                    │   (GKE)       │
│  Next.js UI  │ ◀───────────── │  BullMQ +  │ ──── LLEN wait ───▶│  NestJS       │
│  /api/stats  │   getJobCounts │ bookkeeping│         │          │  LoadTest     │
└──────────────┘                └────────────┘         │          └───────────────┘
                                                        │                  ▲
                                                   ┌────┴─────┐            │ scales
                                                   │   KEDA   │ ───────────┘ 1..10
                                                   └──────────┘
```

## Repo layout

```
queue-lab/
  apps/web          Next.js 14 (App Router, TS, Tailwind) — producer + live UI
  apps/worker       NestJS standalone worker + /healthz — consumer
  packages/shared   Shared TS types and constants (queue name, payload, stats)
  k8s/              Kubernetes manifests for GKE Autopilot + KEDA
  cloudbuild.yaml   Optional Cloud Build config for the worker image
```

- Package manager: **pnpm** workspaces. Node **20**.
- `QUEUE_NAME = "load-test"`; BullMQ wait list is `bull:load-test:wait`.

## Prerequisites

- Node 20 and pnpm (`corepack enable` gives you pnpm).
- A Redis for local dev (Docker, or `brew install redis`).
- For deploy: a GCP project with billing, `gcloud`, `kubectl`, `helm`, and a Vercel account.

---

## 1. Local development (start here)

```bash
# from the repo root
corepack enable
pnpm install

# build the shared package once (web/worker import it)
pnpm --filter @queue-lab/shared build
```

Start a local Redis:

```bash
# Docker
docker run --rm -d --name queue-lab-redis -p 6379:6379 redis:7-alpine
# ...or Homebrew
# brew install redis && redis-server --port 6379 --daemonize yes
```

Create the env files (both default to the local Redis):

```bash
cp apps/worker/.env.example apps/worker/.env
cp apps/web/.env.example apps/web/.env.local
```

Run the worker and the web app in two terminals:

```bash
pnpm dev:worker   # NestJS worker + health on :3001
pnpm dev:web      # Next.js on :3000
```

Open http://localhost:3000, enter e.g. **200 jobs at 1 second**, submit, and watch the
panel: `waiting` falls, `active` sits at your concurrency, `done`/percent climbs to 100,
`Duplicates detected` stays `0`.

The worker health check: `curl localhost:3001/healthz` returns `{"status":"ok"}`.

---

## 2. Create the Upstash Redis

1. In the Upstash console, create a Redis database on the **Fixed** plan, in a region
   close to your GKE region (e.g. `us-east-1` if GKE is `us-east4`).
2. Copy the **TCP** connection string. It looks like
   `rediss://default:<PASSWORD>@<HOST>:<PORT>`. BullMQ needs this TCP `rediss://` URL, not
   the REST API.
3. Note the three pieces you will need: the full URL, the `HOST:PORT`, and the `PASSWORD`.

---

## 3. GCP setup

```bash
# pick your values
export PROJECT_ID=your-project
export REGION=us-east4
gcloud config set project "$PROJECT_ID"

# enable APIs
gcloud services enable \
  container.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com

# Artifact Registry repo for the image
gcloud artifacts repositories create queue-lab \
  --repository-format=docker \
  --location="$REGION" \
  --description="queue-lab images"

# GKE Autopilot cluster
gcloud container clusters create-auto queue-lab --region="$REGION"

# wire kubectl to it
gcloud container clusters get-credentials queue-lab --region="$REGION"
```

---

## 4. Build and push the worker image

The build context must be the repo root so the shared package is included.

Option A, local Docker:

```bash
export IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/queue-lab/worker:latest"
gcloud auth configure-docker "$REGION-docker.pkg.dev"
docker build -f apps/worker/Dockerfile -t "$IMAGE" .
docker push "$IMAGE"
```

Option B, Cloud Build (no local Docker):

```bash
export IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/queue-lab/worker:latest"
gcloud builds submit --config cloudbuild.yaml --substitutions _IMAGE="$IMAGE" .
```

---

## 5. Install KEDA

```bash
helm repo add kedacore https://kedacore.github.io/charts
helm repo update
helm install keda kedacore/keda --namespace keda --create-namespace
kubectl get pods -n keda   # wait until Running
```

---

## 6. Deploy the worker

Put your real image into the deployment manifest (replace the placeholder):

```bash
# macOS sed; on Linux drop the empty ''
sed -i '' "s|REGION-docker.pkg.dev/PROJECT_ID/queue-lab/worker:latest|$IMAGE|" \
  k8s/worker-deployment.yaml
```

Create the namespace and the secret, then apply the manifests:

```bash
kubectl apply -f k8s/namespace.yaml

# Secret — never committed. Fill in from your Upstash values.
kubectl -n queue-lab create secret generic queue-lab-redis \
  --from-literal=REDIS_URL='rediss://default:<PASSWORD>@<HOST>:<PORT>' \
  --from-literal=REDIS_ADDRESS='<HOST>:<PORT>' \
  --from-literal=REDIS_PASSWORD='<PASSWORD>'

kubectl apply -f k8s/worker-deployment.yaml
kubectl apply -f k8s/keda-scaledobject.yaml

# verify
kubectl -n queue-lab get pods
kubectl -n queue-lab logs -f deploy/worker
```

The secret carries three keys: `REDIS_URL` for the worker (ioredis parses the full URL and
enables TLS), and `REDIS_ADDRESS` + `REDIS_PASSWORD` for KEDA's redis scaler, which cannot
parse a URL. See `k8s/secret.example.yaml`.

---

## 7. Deploy the web app to Vercel

1. Import the repo into Vercel.
2. **Root Directory**: `apps/web`.
3. Enable **"Include files outside of the Root Directory in the Build Step"** (Settings →
   General). This is required so Vercel can see the workspace root and the `@queue-lab/shared`
   package.
4. Framework preset: **Next.js**. Leave Build and Install commands at their defaults; Vercel
   detects pnpm from the root lockfile, and the web `build` script builds `shared` first.
5. **Environment Variables**: add `REDIS_URL` = your Upstash `rediss://...` URL (Production,
   and Preview if you want). Optionally `MAX_JOBS_PER_REQUEST`.
6. Deploy. Open the URL and run a batch.

Redis credentials live only in server-side route handlers (`runtime = "nodejs"`). Nothing
sensitive is sent to the browser; the UI only ever calls `/api/jobs` and `/api/stats`.

---

## Demonstrating the acceptance criteria

- **5,000 jobs at 2 seconds drains to 0 with unique jobIds.** Submit `5000` / `2`. Each job
  gets `jobId = "<batchId>_<index>"`, so every job is unique and the queue drains to 0.
  (The spec suggested `:` as the separator, but BullMQ v5 forbids `:` in a custom jobId, so
  we use `_`. Same idempotency guarantee.)

- **Resubmitting the same request does not duplicate.** Because `jobId` is deterministic from
  `(batchId, index)`, enqueuing the same batch again is a no-op in BullMQ. A retried
  `addBulk` (network blip, function retry) cannot create a second copy of a job.

- **Kill a worker pod mid-run: no lost jobs, duplicate counter may tick.**
  ```bash
  kubectl -n queue-lab delete pod <a-worker-pod>
  ```
  The in-flight job's lock expires after `lockDuration` (30s) and BullMQ recovers it onto
  another worker (`maxStalledCount: 1`), or the retry policy re-runs it. Either way the batch
  still completes, so **no work is lost**. BullMQ is **at-least-once**, not exactly-once, so a
  recovered job may run a second time. The worker records a start counter per `(batch, index)`
  in Redis; when it sees a start count above 1 it increments `batch:<id>:duplicates`. That is
  exactly what the "Duplicates detected" tile measures. In the happy path it is `0`; after a
  hard kill you may see a small non-zero count, which is expected and correct.

- **KEDA scales up when deep, back to min when empty.** Enqueue a large/slow batch and watch:
  ```bash
  kubectl -n queue-lab get hpa -w
  kubectl -n queue-lab get pods -w
  ```
  KEDA runs `LLEN bull:load-test:wait` and targets `ceil(LLEN / 50)` replicas, capped at 10.
  When the list empties it scales back to `minReplicaCount: 1` (it does not scale to zero, so a
  worker stays warm).

---

## Environment variables

| Var | Where | Meaning |
|-----|-------|---------|
| `REDIS_URL` | web (Vercel), worker (k8s secret), local | TCP `rediss://` (or `redis://` local) connection string. |
| `WORKER_CONCURRENCY` | worker | Jobs processed in parallel per pod (default 10). |
| `PORT` | worker | Health server port (default 3001). |
| `MAX_JOBS_PER_REQUEST` | web | Per-request enqueue cap (default 25000). Requests above it return 400. |
| `REDIS_ADDRESS`, `REDIS_PASSWORD` | k8s secret | For KEDA's redis scaler only. |

Job options set by the producer: `attempts: 3`, exponential backoff (2s),
`removeOnComplete: { age: 86400, count: 5000 }`, `removeOnFail: { age: 604800 }`.

---

## Troubleshooting

**Redis TLS errors** (`ECONNRESET`, `self signed certificate`, `Connection is closed`).
- Make sure the URL is `rediss://` (two s). ioredis enables TLS from that scheme.
  `redis://` (one s) will fail against Upstash.
- The connection sets `maxRetriesPerRequest: null` (required by BullMQ) and
  `enableReadyCheck: false` (Upstash does not support every introspection command).
- For KEDA, `enableTLS: "true"` is set in the ScaledObject, and `REDIS_ADDRESS` is
  `host:port` with no scheme.

**Vercel function timeout** (enqueue request hangs or 504).
- Enqueuing is chunked (1,000 per `addBulk`) and awaited. Very large counts take longer.
  The server caps a single request at `MAX_JOBS_PER_REQUEST` (default 25,000) and returns a
  clear 400 above it. Lower the count, raise the cap, or raise the function `maxDuration` on a
  paid Vercel plan.
- Confirm the route runs on Node, not Edge: handlers export `runtime = "nodejs"`.

**KEDA not scaling.**
- `kubectl -n queue-lab describe scaledobject worker-scaler` and check the conditions.
- `kubectl get triggerauthentication -n queue-lab` and confirm the secret keys
  `REDIS_ADDRESS` / `REDIS_PASSWORD` exist and are correct.
- Verify the list key: with `redis-cli` against Upstash, `LLEN bull:load-test:wait` should be
  non-zero while a batch is queued. If your queue name changes, update `listName`.
- KEDA pods healthy: `kubectl get pods -n keda`. The `keda-operator-metrics-apiserver` must be
  running for the HPA to read the external metric.
- Remember `minReplicaCount: 1`: it never scales to zero, so one pod is always present.

---

## Design notes (where this deviates from a naive reading of the spec)

- **jobId separator**: `_` not `:`. BullMQ v5 rejects `:` in a custom jobId.
- **Jitter** is baked into each job's `durationMs` at enqueue time, because the shared
  `JobPayload` carries no jitter field. Each job in a jittered batch gets its own randomized
  duration; the worker simply sleeps it.
- **Docker** uses `pnpm deploy --prod --legacy` to produce the pruned runtime (the pnpm
  equivalent of `npm ci --omit=dev`); `--legacy` is required on pnpm v10.
- **Lock/stall**: `lockDuration 30000`, `maxStalledCount 1`. BullMQ auto-renews the lock while
  `process()` runs (the sleep is non-blocking), so long jobs keep their lock while the pod is
  alive; a dead pod's lock expires in 30s and the job is recovered once. See the comment in
  `apps/worker/src/load-test.processor.ts`.
- **Graceful shutdown**: `enableShutdownHooks()` drains the BullMQ worker on SIGTERM, and an
  abortable sleep unblocks in-flight work. `terminationGracePeriodSeconds: 120` must exceed the
  longest expected job for a clean drain.
