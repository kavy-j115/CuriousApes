import { APP_NAME } from "@/lib/appName";
export const metadata = { title: "Terms of service" };

// DRAFT for legal review before the app is submitted.
export default function TermsPage() {
  return (
    <>
      <h1>Terms of service</h1>
      <p className="text-zinc-500">{APP_NAME} reporting app for Shopify stores. Last updated: November 2026.</p>

      <h2>The service</h2>
      <p>
        {APP_NAME} reads your Shopify store&apos;s data and presents reports, alerts and customer lists to you and to your marketing team. By installing the app you allow it to read your store&apos;s orders, customers, products and inventory, analytics and marketing data, and pricing, discount and payout data. The access is read-only.
      </p>

      <h2>Your responsibilities</h2>
      <p>
        You confirm you may connect the store and that your own customer privacy notices allow your marketing team to use customer data for
        your marketing. Use of customer lists (for example for WhatsApp or email campaigns) must follow the law that applies
        to you, including consent rules.
      </p>

      <h2>What we do not do</h2>
      <p>The app does not create, edit or delete anything in your store, and does not process payments.</p>

      <h2>Availability</h2>
      <p>The service is provided as is. Figures come from Shopify and can differ slightly from other reports because of timing and rounding.</p>

      <h2>Ending the service</h2>
      <p>You can uninstall the app at any time from your Shopify admin. Your data is then erased as described in the privacy policy.</p>
    </>
  );
}
