export default function Home() {
  return (
    <main className="flex min-h-full flex-col items-center justify-center bg-zinc-50 px-6 py-16">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-10 shadow-sm">
        <p className="text-sm font-medium text-blue-600">LangGraph + Next.js</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900">
          Email Agent
        </h1>
        <p className="mt-4 text-zinc-600 leading-relaxed">
          Starter app for your email assistant project. Next steps: Google
          sign-in, LangGraph agent, and a chat UI.
        </p>
        <div className="mt-8 rounded-lg bg-zinc-50 p-4 text-sm text-zinc-700">
          <p className="font-medium text-zinc-900">Run locally</p>
          <code className="mt-2 block text-zinc-600">npm run dev</code>
        </div>
      </div>
    </main>
  );
}
