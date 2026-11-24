import { APP_NAME } from "@/lib/appName";
export const metadata = { title: "Connected" };

// Where a store owner lands after approving the app: the app's own page.
export default async function ConnectedPage({ searchParams }: { searchParams: Promise<{ shop?: string }> }) {
  const { shop } = await searchParams;
  return (
    <>
      <h1>Your store is connected</h1>
      <p>
        {shop ? <>The store <span className="font-mono text-zinc-100">{shop}</span> is now connected to {APP_NAME}.</> : <>Your store is now connected to {APP_NAME}.</>}
      </p>
      <p>
        The app only reads your store&apos;s order, customer and sales data to build reports for your marketing team.
        It never changes anything in your store. Reports start appearing after your reporting team has switched syncing on for your store.
      </p>
      <p>You can close this tab. To disconnect, uninstall the app from your Shopify admin at any time.</p>
    </>
  );
}
