import { useEffect, useState } from "react";

export function App() {
  const [serverOk, setServerOk] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((body) => setServerOk(Boolean(body.ok)))
      .catch(() => setServerOk(false));
  }, []);

  return (
    <main>
      <h1>Beacon</h1>
      <p>Server: {serverOk === null ? "checking…" : serverOk ? "connected" : "unreachable"}</p>
    </main>
  );
}
