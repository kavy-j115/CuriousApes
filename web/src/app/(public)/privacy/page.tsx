export const metadata = { title: "Privacy policy" };

const CONTACT = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;

// DRAFT for legal review before the app is submitted: it describes what the app does today.
export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy policy</h1>
      <p className="text-zinc-500">Curious Apes reporting app for Shopify stores. Last updated: October 2026.</p>

      <h2>What the app is</h2>
      <p>
        Curious Apes is a reporting service operated for the agency that manages your online store&apos;s marketing. It reads your
        store&apos;s order, customer and sales data from Shopify so the agency can show you daily, weekly and monthly reports, alerts and
        customer segments. The app only reads data. It never changes anything in your Shopify store.
      </p>

      <h2>Data we access</h2>
      <ul>
        <li>Orders: order numbers, dates, totals, discounts, payment and fulfillment status, and the products ordered.</li>
        <li>Customers: name, email address, phone number and city or state shown on orders, used to group repeat customers.</li>
        <li>Products and store analytics: product titles and Shopify&apos;s own sales and visitor figures.</li>
      </ul>

      <h2>How we use it</h2>
      <p>
        To build reports and charts for your store, to send you or your agency report summaries and alerts, and to prepare customer lists
        that your agency uses for its own marketing on your behalf. We do not sell your data or your customers&apos; data, and we do not use it
        for advertising of our own.
      </p>

      <h2>Where it is stored and who can see it</h2>
      <p>
        Data is stored in an encrypted database hosted in India (AWS Mumbai region) with access limited by role. Only the agency&apos;s staff
        assigned to your store and your own login can see it. Access keys are kept in an encrypted vault, not in the code.
      </p>

      <h2>How long we keep it</h2>
      <p>
        While the app is installed we keep the data needed for your reports. If you uninstall the app, syncing stops immediately. Shopify then
        asks us to erase your store&apos;s data 48 hours after uninstall, and we delete it, including stored orders, customers and reports.
      </p>

      <h2>Customer requests</h2>
      <p>
        When a customer asks you for their data, or asks to be erased, Shopify notifies us and we act on it: we erase that customer&apos;s
        personal details (name, email, phone) from our records, and we answer data requests through you.
      </p>

      <h2>Contact</h2>
      <p>
        {CONTACT ? (
          <>
            Questions about this policy: <a className="text-accent underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
          </>
        ) : (
          <>Questions about this policy can be sent to the agency that connected your store.</>
        )}
      </p>
    </>
  );
}
