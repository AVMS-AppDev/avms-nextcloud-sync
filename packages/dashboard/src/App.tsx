import { useCallback, useEffect, useState } from "react";

const api = (path: string, init?: RequestInit) => fetch(path, init);

export function App() {
  const [status, setStatus] = useState<string>("");
  const [profiles, setProfiles] = useState<unknown[]>([]);
  const [shareUrl, setShareUrl] = useState("");
  const [localRoot, setLocalRoot] = useState("content/mocon");
  const [validateOut, setValidateOut] = useState<string>("");
  const [planOut, setPlanOut] = useState<string>("");
  const [selectedProfile, setSelectedProfile] = useState("");
  const [planId, setPlanId] = useState("");
  const [jobs, setJobs] = useState<unknown[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const s = await api("/api/nextcloud-sync/status");
    setStatus(JSON.stringify(await s.json(), null, 2));
    const p = await api("/api/nextcloud-sync/profiles");
    const list = (await p.json()) as unknown[];
    setProfiles(list);
    if (list.length > 0 && !selectedProfile) {
      const first = list[0] as { id: string };
      setSelectedProfile(first.id);
    }
    const j = await api("/api/nextcloud-sync/jobs");
    setJobs((await j.json()) as unknown[]);
  }, [selectedProfile]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!jobId) return;
    const t = setInterval(() => void refresh(), 2000);
    return () => clearInterval(t);
  }, [jobId, refresh]);

  return (
    <div style={{ fontFamily: "system-ui", padding: 24, maxWidth: 900 }}>
      <h1>Showcase Kiosk — Cloud Sync</h1>
      <p style={{ opacity: 0.85 }}>
        Manual Nextcloud public share sync. Validate → Preview plan → Run. No background autosync in V1.
      </p>

      <section style={{ marginBottom: 24 }}>
        <h2>Service status</h2>
        <pre style={{ background: "#111", color: "#8f8", padding: 12, overflow: "auto" }}>{status}</pre>
        <button type="button" onClick={() => void refresh()}>
          Refresh
        </button>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>Validate connection</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 560 }}>
          <label>
            Share URL
            <input
              style={{ width: "100%" }}
              value={shareUrl}
              onChange={(e) => setShareUrl(e.target.value)}
              placeholder="https://…/s/TOKEN"
            />
          </label>
          <label>
            Local content root
            <input
              style={{ width: "100%" }}
              value={localRoot}
              onChange={(e) => setLocalRoot(e.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={async () => {
              const r = await api("/api/nextcloud-sync/validate", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ shareUrl, localRoot }),
              });
              setValidateOut(JSON.stringify(await r.json(), null, 2));
            }}
          >
            Validate (real DAV)
          </button>
          <pre style={{ background: "#111", color: "#aaf", padding: 12, overflow: "auto" }}>{validateOut}</pre>
        </div>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>Profiles</h2>
        <pre style={{ background: "#111", color: "#ffa", padding: 12, overflow: "auto" }}>
          {JSON.stringify(profiles, null, 2)}
        </pre>
        <p style={{ fontSize: 14 }}>
          Create via API: <code>POST /api/nextcloud-sync/profiles</code> with id, name, shareUrl, localRoot, mode,
          deletePolicy, excludePatterns.
        </p>
        <label>
          Profile id for plan/run{" "}
          <input value={selectedProfile} onChange={(e) => setSelectedProfile(e.target.value)} />
        </label>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>Preview (plan)</h2>
        <button
          type="button"
          onClick={async () => {
            if (!selectedProfile) return;
            const r = await api("/api/nextcloud-sync/plan", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ profileId: selectedProfile }),
            });
            const j = (await r.json()) as { planId?: string };
            setPlanOut(JSON.stringify(j, null, 2));
            if (j.planId) setPlanId(j.planId);
          }}
        >
          Build plan
        </button>
        <pre style={{ background: "#111", color: "#faf", padding: 12, overflow: "auto" }}>{planOut}</pre>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>Run sync</h2>
        <label>
          planId{" "}
          <input style={{ width: "100%" }} value={planId} onChange={(e) => setPlanId(e.target.value)} />
        </label>
        <label style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input type="checkbox" id="confirm" />
          Confirm destructive changes (local deletes)
        </label>
        <button
          type="button"
          style={{ marginTop: 8 }}
          onClick={async () => {
            const confirmDeletes = (document.getElementById("confirm") as HTMLInputElement)?.checked ?? false;
            const r = await api("/api/nextcloud-sync/run", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                profileId: selectedProfile,
                planId,
                confirmDeletes,
              }),
            });
            const j = (await r.json()) as { jobId?: string; error?: string };
            if (j.jobId) setJobId(j.jobId);
            alert(j.error ? JSON.stringify(j) : `Job ${j.jobId}`);
            void refresh();
          }}
        >
          Run now
        </button>
      </section>

      <section>
        <h2>Jobs</h2>
        <pre style={{ background: "#111", color: "#ccc", padding: 12, overflow: "auto" }}>
          {JSON.stringify(jobs, null, 2)}
        </pre>
      </section>
    </div>
  );
}
