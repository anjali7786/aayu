# Aayu — Dynamic Shelf-Life Intelligence for Perishable Food

AI-powered estimation of *effective* remaining shelf life for perishable food,
based on the product's real cold-chain journey — not just the date printed on the pack.

Built for **Patchamomma 2026** (Google Cloud hackathon).

---

## The idea in one line

Two products with the same printed expiry date can have very different real freshness.
Aayu combines cold-chain telemetry, product characteristics and Gemini reasoning to
estimate a Dynamic Shelf-Life Score and recommend the next best operational action.

## Example

| | Batch A | Batch B |
|---|---|---|
| Printed expiry | 4 days remaining | 4 days remaining |
| Journey | Stable refrigeration | Delay + temperature excursion |
| Aayu estimate | Higher remaining life | Lower remaining life |
| Recommended action | Sell normally | Prioritize sale or inspect |

---

## Stack (planned)

| Layer | Tool |
|---|---|
| Language | Python 3.14 |
| Streaming ingest | Cloud Pub/Sub |
| Data store | BigQuery |
| ML | BigQuery ML |
| Managed AI | Vertex AI |
| LLM | Gemini via `google-genai` (Vertex path) |
| Agentic | Google ADK |
| App state | Firestore |
| UI | Streamlit + Plotly |
| Deploy | Cloud Run |
| Reporting | Looker Studio |
| Secrets | Secret Manager |

---

## Progress so far

- GCP project set up (`aayu-506916`), all required APIs enabled, Firestore database created in Native mode.
- Service account (`aayu-dev`) with Editor + Secret Manager Admin roles; JSON key generated.
- Python 3.14 virtual environment with all SDKs installed (BigQuery, Vertex AI, Firestore, Pub/Sub, ADK, Streamlit).
- Corporate SSL proxy (Zscaler) worked around using `truststore` + custom CA bundle for gRPC.
- End-to-end sanity check (`hello.py`) confirms BigQuery, Gemini via Vertex AI, and Firestore are all reachable from Python.

## Not yet built

Data generator, BigQuery tables, features view, BQML model, Pub/Sub replay, ADK agents, Streamlit UI, Cloud Run deploy, Looker dashboard.

---

## Local setup

Prerequisites:
- Python 3.10+ (3.14 tested)
- GCP project with billing enabled
- Service-account JSON key with Editor + Secret Manager Admin roles

```bash
git clone git@github.com:anjali7786/aayu.git
cd aayu

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Create .env (never commit — it's in .gitignore)
cat > .env << 'EOF'
GEMINI_API_KEY=<optional-aistudio-key>
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/gcp-key.json
GCP_PROJECT_ID=<your-project-id>
GCP_REGION=us-central1
EOF

python hello.py
```

Expected:
```
BigQuery: 1
Gemini (Vertex): Hi there! ...
Firestore: {'msg': 'hi from aayu'}
```

### Corporate SSL proxies (Zscaler, Netskope)

If you hit `SSLCertVerificationError`:

```bash
pip install truststore
```

`hello.py` calls `truststore.inject_into_ssl()` at the top, delegating cert
verification to the OS keychain (which already trusts your corporate proxy).

For gRPC (BigQuery, Firestore), also point `GRPC_DEFAULT_SSL_ROOTS_FILE_PATH`
at a combined CA bundle:

```bash
security find-certificate -a -c "Zscaler" -p /Library/Keychains/System.keychain > /tmp/zscaler.pem
CERTIFI=$(python -c "import certifi; print(certifi.where())")
mkdir -p ~/.certs
cat "$CERTIFI" /tmp/zscaler.pem > ~/.certs/combined-ca.pem
export GRPC_DEFAULT_SSL_ROOTS_FILE_PATH=~/.certs/combined-ca.pem
```

Add the export to `~/.zshrc` to persist.

### Committing from a corporate machine with personal identity

If you're on a work laptop whose global git identity is a company email, set a
**repo-local** identity so this project's commits stay attached to your personal
GitHub account without touching your work repos.

```bash
cd aayu

# Repo-scoped — no --global flag
git config user.name "Your Name"
git config user.email "your-personal-email@example.com"

# Verify: repo shows personal, global stays as company
git config user.email          # → personal
git config --global user.email # → company (leave untouched)
```

Every commit made from this folder will now be authored by your personal
identity. Verify after each commit:

```bash
git commit -m "..."
git log -1 --format="%an <%ae>"   # must show personal email
```

If a commit slipped through with the wrong identity, amend it before pushing:

```bash
git commit --amend --author="Your Name <your-personal-email@example.com>" --no-edit
```

Also use SSH (not HTTPS) so commits push under a personal SSH key uploaded to
your personal GitHub account:

```bash
# Generate a project-specific key
ssh-keygen -t ed25519 -C "your-personal-email@example.com" -f ~/.ssh/github_personal -N ""

# Tell SSH to use this key for github.com only
cat >> ~/.ssh/config << 'EOF'

Host github.com
  User git
  IdentityFile ~/.ssh/github_personal
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config

# Upload ~/.ssh/github_personal.pub at https://github.com/settings/keys
# Then verify:
ssh -T git@github.com   # → "Hi <your-username>! ..."
```

Always sanity-check before staging on a corporate machine:

```bash
git status                                          # look for accidental Intuit/company files
git diff --cached --name-only | grep -E "\.env$|gcp-key" && echo STOP || echo clean
```
