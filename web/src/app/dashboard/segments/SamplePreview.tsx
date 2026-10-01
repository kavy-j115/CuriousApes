const SAMPLE_ROWS = [
  { phone: "9876543210", email: "priya.sharma@gmail.com", first: "Priya", last: "Sharma", cc: "91" },
  { phone: "9123456780", email: "arjun.mehta@yahoo.com", first: "Arjun", last: "Mehta", cc: "91" },
  { phone: "5551234567", email: "j.smith@outlook.com", first: "J", last: "Smith", cc: "1" },
];

// A static preview of exactly what the download will contain -- shown
// up front, not just after processing, so it's clear before uploading
// anything what shape of file comes out the other end.
export default function SamplePreview() {
  return (
    <div className="sticky top-6 rounded-lg border border-zinc-800 bg-black p-4">
      <p className="mb-1 text-sm font-semibold text-zinc-200">Output format</p>
      <p className="mb-4 text-xs text-zinc-500">
        Every recipe produces the same ConvertWay-ready CSV shape -- only which rows make it in
        differs.
      </p>

      <div className="overflow-x-auto scrollbar-thin rounded-md border border-zinc-900">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-950 text-left text-zinc-400">
              <th className="whitespace-nowrap px-2 py-1.5">phone</th>
              <th className="whitespace-nowrap px-2 py-1.5">email</th>
              <th className="whitespace-nowrap px-2 py-1.5">first name</th>
              <th className="whitespace-nowrap px-2 py-1.5">last name</th>
              <th className="whitespace-nowrap px-2 py-1.5">country code</th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_ROWS.map((r) => (
              <tr key={r.phone} className="border-b border-zinc-900 text-zinc-400">
                <td className="whitespace-nowrap px-2 py-1">{r.phone}</td>
                <td className="whitespace-nowrap px-2 py-1">{r.email}</td>
                <td className="whitespace-nowrap px-2 py-1">{r.first}</td>
                <td className="whitespace-nowrap px-2 py-1">{r.last}</td>
                <td className="whitespace-nowrap px-2 py-1">{r.cc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="mt-4 space-y-1.5 text-xs text-zinc-500">
        <li>· <span className="text-zinc-400">phone</span> / <span className="text-zinc-400">country code</span> are split from one combined number (e.g. +919876543210 → 9876543210 / 91).</li>
        <li>· A customer with no phone, or an unparseable one, is skipped and counted separately -- never silently dropped.</li>
        <li>· Nothing here is uploaded anywhere -- the file is generated entirely in your browser.</li>
      </ul>
    </div>
  );
}
