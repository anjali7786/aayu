import os
import ssl

# This is Python's officially supported way to handle corporate MITM proxies.
import truststore

truststore.inject_into_ssl()

# gRPC uses BoringSSL and doesn't respect truststore — feed it a combined bundle.
CA_BUNDLE = "/tmp/combined-ca.pem"
os.environ["SSL_CERT_FILE"] = CA_BUNDLE
os.environ["REQUESTS_CA_BUNDLE"] = CA_BUNDLE
os.environ["GRPC_DEFAULT_SSL_ROOTS_FILE_PATH"] = CA_BUNDLE

_orig = ssl.create_default_context


def _lax(*a, **kw):
    ctx = _orig(*a, **kw)
    try:
        ctx.verify_flags &= ~ssl.VERIFY_X509_STRICT
    except AttributeError:
        pass
    return ctx


ssl.create_default_context = _lax
ssl._create_default_https_context = _lax

from dotenv import load_dotenv

load_dotenv()

print("== env check ==", flush=True)
print("  GCP_PROJECT_ID:", os.environ.get("GCP_PROJECT_ID"), flush=True)
print("  GCP_REGION:", os.environ.get("GCP_REGION"), flush=True)
print(
    "  GOOGLE_APPLICATION_CREDENTIALS:",
    os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"),
    flush=True,
)
print(
    "  key file exists:",
    os.path.isfile(os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")),
    flush=True,
)

MODEL_AISTUDIO = "gemini-flash-latest"
MODEL_VERTEX = "gemini-2.5-flash"

print("\n== 1) BigQuery ==", flush=True)
try:
    from google.cloud import bigquery

    bq = bigquery.Client()
    print("  client created, running query...", flush=True)
    row = next(bq.query("SELECT 1 AS ok").result(timeout=30))
    print("  BigQuery:", row.ok, flush=True)
except Exception as e:
    print("  BigQuery FAILED:", type(e).__name__, "-", e, flush=True)

print("\n== 2) Gemini via Vertex ==", flush=True)
try:
    from google import genai

    vertex = genai.Client(
        vertexai=True, project=os.environ["GCP_PROJECT_ID"], location=os.environ["GCP_REGION"]
    )
    print("  client created, calling model...", flush=True)
    r = vertex.models.generate_content(model=MODEL_VERTEX, contents="Say hi via Vertex.")
    print("  Gemini (Vertex):", r.text.strip(), flush=True)
except Exception as e:
    print("  Gemini (Vertex) FAILED:", type(e).__name__, "-", e, flush=True)

print("\n== 3) Firestore ==", flush=True)
try:
    from google.cloud import firestore

    db = firestore.Client()
    print("  client created, writing doc...", flush=True)
    db.collection("hello").document("t1").set({"msg": "hi from aayu"})
    print("  reading doc back...", flush=True)
    print("  Firestore:", db.collection("hello").document("t1").get().to_dict(), flush=True)
except Exception as e:
    print("  Firestore FAILED:", type(e).__name__, "-", e, flush=True)

print("\n== done ==", flush=True)
