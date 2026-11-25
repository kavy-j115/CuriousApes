import { APP_NAME } from "@/lib/appName";
export const metadata = { title: "Privacy policy" };

const CONTACT = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;

// DRAFT for legal review before the app is submitted: it describes what the app does today.
export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy policy</h1>
      <p className="text-zinc-500">{APP_NAME} reporting app for Shopify stores. Last updated: November 2026.</p>

      <h2>What the app is</h2>
      <p>
        {APP_NAME} is a reporting app for online stores. It reads your store&apos;s order, customer and sales data from Shopify so that you and your marketing team can
        see daily, weekly and monthly reports, alerts and customer segments. The app only reads data. It never changes anything in your Shopify store.
      </p>

      <h2>Data we access</h2>
      <p>The app asks Shopify for read-only access. It has no permission to create, change or delete anything. The access covers:</p>
      <ul>
        <li>Orders: order numbers, dates, totals, discounts, payment and fulfillment status, the products ordered, draft orders, fulfillments and returns.</li>
        <li>Customers: name, email address, phone number and city or state shown on orders, customer activity events and merged customer records, used to group repeat customers.</li>
        <li>Products and inventory: product titles, product listings, inventory levels, store locations, sales channels (publications), markets and languages.</li>
        <li>Store analytics and marketing: Shopify&apos;s own sales and visitor figures and reports, marketing events and the tracking pixels installed on the store.</li>
        <li>Pricing and money: discounts and price rules, gift cards, shipping settings and Shopify Payments payouts, used to explain order totals and net sales in reports.</li>
      </ul>
      <p>We use this data only to produce your reports, alerts and customer lists. We do not read payment card details.</p>

      <h2>How we use it</h2>
      <p>
        To build reports and charts for your store, to send you or your marketing team report summaries and alerts, and to prepare customer lists
        that your team uses for your own marketing. We do not sell your data or your customers&apos; data, and we do not use it
        for advertising of our own.
      </p>

      <h2>Where it is stored and who can see it</h2>
      <p>
        Data is stored in an encrypted database hosted in India (AWS Mumbai region) with access limited by role. Only the staff of your reporting team
        assigned to your store, and your own login, can see it. Access keys are kept in an encrypted vault, not in the code.
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
          <>Questions about this policy can be sent to the team that connected your store.</>
        )}
      </p>
    </>
  );
}
