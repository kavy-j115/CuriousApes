import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-8 font-sans dark:bg-black">
      <form action={login} className="w-full max-w-sm rounded border border-zinc-300 p-6 dark:border-zinc-700">
        <h1 className="mb-6 text-xl font-semibold text-black dark:text-zinc-50">
          D2C Analytics
        </h1>

        {error && (
          <p className="mb-4 rounded bg-red-100 p-2 text-sm text-red-800">{error}</p>
        )}

        <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Email</label>
        <input
          name="email"
          type="email"
          required
          className="mb-4 w-full rounded border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />

        <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Password</label>
        <input
          name="password"
          type="password"
          required
          className="mb-6 w-full rounded border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />

        <button
          type="submit"
          className="w-full rounded bg-[#4472C4] px-4 py-2 text-sm font-medium text-white"
        >
          Log in
        </button>
      </form>
    </div>
  );
}
