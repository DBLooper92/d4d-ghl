// src/app/page.tsx
export default function Page() {
  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">D4D – GHL OAuth Test</h1>
      <div className="space-x-3">
        <a
          className="inline-block rounded px-4 py-2 border"
          href="/api/oauth/login?user_type=Company"
        >
          Install for Agency (Company)
        </a>
        <a
          className="inline-block rounded px-4 py-2 border"
          href="/api/oauth/login?user_type=Location"
        >
          Install for Sub-Account (Location)
        </a>
      </div>
      <p className="text-sm opacity-70">
        After approval, you’ll return to <code>/api/oauth/callback</code>.
      </p>
    </main>
  );
}
