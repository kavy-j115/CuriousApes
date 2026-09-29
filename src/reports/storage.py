"""Uploads a generated report file to Supabase Storage, so it's downloadable
from the UI later without needing the pipeline to run on demand.

UNTESTED against a live bucket -- SUPABASE_SERVICE_ROLE_KEY isn't set yet
(see docs/reporting.md). Uses plain REST calls to Supabase's Storage API
(stable, long-standing endpoints) rather than a client SDK, consistent
with this project's other connectors.

Uses the service role key deliberately, not the anon key: uploading is a
write operation, and with RLS now enabled (docs/auth.md), only a
privileged key can write regardless -- this key must only ever be used
server-side (the Python pipeline), never shipped to the browser.
"""

import os

import requests

STORAGE_BUCKET = "reports"


def _storage_url(project_url: str, path: str) -> str:
    return f"{project_url}/storage/v1/object/{STORAGE_BUCKET}/{path}"


def ensure_bucket_exists(project_url: str, service_role_key: str) -> None:
    """Creates the bucket if it doesn't already exist. Safe to call every run."""
    response = requests.post(
        f"{project_url}/storage/v1/bucket",
        headers={
            "Authorization": f"Bearer {service_role_key}",
            "apikey": service_role_key,
        },
        json={"id": STORAGE_BUCKET, "name": STORAGE_BUCKET, "public": False},
        timeout=15,
    )
    # 400 with "already exists" is expected on every run after the first --
    # not an error, just means there's nothing to do.
    if response.status_code not in (200, 201) and "already exists" not in response.text:
        response.raise_for_status()


def upload_report(local_path: str, client_id: str, project_url: str, service_role_key: str) -> str:
    """Uploads local_path to reports/<client_id>/<filename>, overwriting any
    existing file at that path (each pipeline run replaces the previous
    report rather than accumulating versions). Returns the storage path."""
    filename = os.path.basename(local_path)
    storage_path = f"{client_id}/{filename}"

    with open(local_path, "rb") as f:
        response = requests.put(
            _storage_url(project_url, storage_path),
            headers={
                "Authorization": f"Bearer {service_role_key}",
                "apikey": service_role_key,
                "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "x-upsert": "true",  # overwrite rather than error if the path already exists
            },
            data=f,
            timeout=30,
        )
    response.raise_for_status()
    return storage_path
