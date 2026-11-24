import { APP_NAME } from "@/lib/appName";
export const metadata = { title: "Support" };

const CONTACT = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;

export default function SupportPage() {
  return (
    <>
      <h1>Support</h1>
      <p>Need help with the {APP_NAME} reporting app for your Shopify store?</p>
      <h2>Contact</h2>
      <p>
        {CONTACT ? (
          <>
            Email <a className="text-accent underline" href={`mailto:${CONTACT}`}>{CONTACT}</a> and mention your store address. We reply within one business day.
          </>
        ) : (
          <>Contact the team that connected your store, and mention your store address.</>
        )}
      </p>
      <h2>Common questions</h2>
      <ul>
        <li>The numbers look different from Shopify: reports use completed days only, so today appears tomorrow.</li>
        <li>To disconnect: uninstall the app from your Shopify admin (Settings, Apps and sales channels).</li>
        <li>To ask for your data to be erased: tell us, or uninstall the app and it is erased within 48 hours.</li>
      </ul>
    </>
  );
}
