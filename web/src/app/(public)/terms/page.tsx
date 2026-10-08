export const metadata = { title: "Terms of service" };

// DRAFT for legal review before the app is submitted.
export default function TermsPage() {
  return (
    <>
      <h1>Terms of service</h1>
      <p className="text-zinc-500">Curious Apes reporting app for Shopify stores. Last updated: October 2026.</p>

      <h2>The service</h2>
      <p>
        Curious Apes reads your Shopify store&apos;s data and presents reports, alerts and customer lists to you and to the agency that
        manages your marketing. By installing the app you allow it to read your store&apos;s orders, customers, products and analytics.
      </p>

      <h2>Your responsibilities</h2>
      <p>
        You confirm you may connect the store and that your own customer privacy notices allow your agency to use customer data for the
        marketing it runs on your behalf. Use of customer lists (for example for WhatsApp or email campaigns) must follow the law that applies
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
